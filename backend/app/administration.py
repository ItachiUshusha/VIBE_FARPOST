"""Administrative operations use server-side roles, optimistic updates and an audit journal."""
from datetime import date, datetime, time, timedelta, timezone
import re
from typing import Literal
from uuid import uuid4
from zoneinfo import ZoneInfo

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field

from .accounts import csrf, database, public_user, require_admin, settings, stamp

router = APIRouter(prefix="/api/admin", dependencies=[Depends(require_admin)])
RESOURCES = {"users": "users", "runs": "simulation_runs", "presets": "scenario_presets", "datasets": "datasets", "audit": "audit_log"}


def period(request, start=None, end=None):
    tz = ZoneInfo(settings(request).report_timezone)
    today = datetime.now(tz).date()
    try:
        first = date.fromisoformat(start) if start else today - timedelta(days=29)
        last = date.fromisoformat(end) if end else today
    except ValueError:
        raise HTTPException(422, "Дата должна быть в формате ГГГГ-ММ-ДД")
    if first > last or (last - first).days > 365:
        raise HTTPException(422, "Выберите период не более 366 дней")
    lower = datetime.combine(first, time.min, tz).astimezone(timezone.utc).isoformat()
    upper = datetime.combine(last + timedelta(days=1), time.min, tz).astimezone(timezone.utc).isoformat()
    return first, last, {"$gte": lower, "$lt": upper}


def audit_mutation(request, action, target, before, after, operation):
    db = database(request)
    entry = {"_id": str(uuid4()), "actor_id": require_admin(request)["_id"], "action": action, "target_id": target,
             "before": before, "after": after, "status": "pending", "created_at": stamp()}
    db.audit_log.insert_one(entry)
    try:
        result = operation()
    except Exception:
        db.audit_log.update_one({"_id": entry["_id"]}, {"$set": {"status": "failed"}})
        raise
    db.audit_log.update_one({"_id": entry["_id"]}, {"$set": {"status": "applied"}})
    return result


@router.get("/guard")
def guard(user=Depends(require_admin)):
    return {"user": public_user(user)}


@router.get("/overview")
def overview(request: Request, start: str | None = Query(None, alias="from"), end: str | None = Query(None, alias="to")):
    first, last, bounds = period(request, start, end)
    db = database(request)
    tz = ZoneInfo(settings(request).report_timezone)
    trend = {(first + timedelta(days=i)).isoformat(): 0 for i in range((last - first).days + 1)}
    for user in db.users.find({"created_at": bounds}, {"created_at": 1}).batch_size(500):
        day = datetime.fromisoformat(user["created_at"]).astimezone(tz).date().isoformat()
        if day in trend:
            trend[day] += 1
    methods = list(db.auth_events.aggregate([{"$match": {"created_at": bounds, "kind": "login"}}, {"$group": {"_id": "$method", "count": {"$sum": 1}}}]))
    run_metrics = list(db.simulation_runs.aggregate([{"$match": {"created_at": bounds}}, {"$group": {"_id": None, "average_calculation_ms": {"$avg": "$calculation_ms"}}}]))
    return {"period": {"from": first.isoformat(), "to": last.isoformat(), "timezone": settings(request).report_timezone},
        "metrics": {"new_users": db.users.count_documents({"created_at": bounds}), "users_total": db.users.count_documents({}),
                    "blocked_users": db.users.count_documents({"status": "blocked"}), "runs": db.simulation_runs.count_documents({"created_at": bounds}),
                    "presets": db.scenario_presets.count_documents({"archived": {"$ne": True}}), "datasets": db.datasets.count_documents({}),
                    "average_calculation_ms": run_metrics[0]["average_calculation_ms"] if run_metrics else None},
        "registrations": [{"date": day, "count": count} for day, count in trend.items()],
        "login_methods": {method: next((item["count"] for item in methods if item["_id"] == method), 0) for method in ["local", "yandex", "vk"]},
        "sources": {"new_users": "users.created_at", "runs": "simulation_runs.created_at", "login_methods": "auth_events(kind=login)",
                    "presets": "scenario_presets(archived!=true)", "datasets": "datasets", "average_calculation_ms": "simulation_runs.calculation_ms"}}


@router.get("/traffic")
def traffic(request: Request, start: str | None = Query(None, alias="from"), end: str | None = Query(None, alias="to")):
    first, last, _ = period(request, start, end)
    cfg = settings(request)
    url = "https://metrika.yandex.ru/dashboard" + ("?id=" + cfg.metrica_counter_id if cfg.metrica_counter_id.isdigit() else "")
    if not cfg.metrica_counter_id.isdigit() or not cfg.metrica_read_token.get_secret_value():
        return {"status": "not_configured", "message": "Счётчик или серверный токен чтения не настроен", "report_url": url, "rows": []}
    goals = {"registration": cfg.metrica_registration_goal_id, "login": cfg.metrica_login_goal_id, "simulation": cfg.metrica_simulation_goal_id}
    metrics = ["ym:s:visits", "ym:s:users"]
    labels = ["visits", "users"]
    for name, goal in goals.items():
        if goal.isdigit():
            metrics.append(f"ym:s:goal{goal}conversionRate")
            labels.append(name + "_conversion_percent")
    try:
        with httpx.Client(timeout=12, follow_redirects=False) as client:
            response = client.get("https://api-metrika.yandex.net/stat/v1/data", params={"ids": cfg.metrica_counter_id,
                "date1": first.isoformat(), "date2": last.isoformat(), "dimensions": "ym:s:lastTrafficSource", "metrics": ",".join(metrics), "limit": 30, "lang": "ru"},
                headers={"Authorization": "OAuth " + cfg.metrica_read_token.get_secret_value()})
            response.raise_for_status()
            data = response.json()
        rows = [{"source": row["dimensions"][0]["name"], **dict(zip(labels, row["metrics"]))} for row in data["data"]]
        return {"status": "connected", "rows": rows, "report_url": url, "sampled": data.get("sampled", False),
                "missing_goals": [name for name, goal in goals.items() if not goal.isdigit()]}
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        return {"status": "error", "message": "Отчёт недоступен. Проверьте токен metrika:read, доступ к счётчику и сеть.", "report_url": url, "rows": []}


def collection_for(request, resource):
    if resource not in RESOURCES:
        raise HTTPException(404, "Раздел не найден")
    return database(request)[RESOURCES[resource]]


@router.get("/segments")
def segments(request: Request):
    engine = getattr(request.app.state, "engine", None)
    if engine is None:
        raise HTTPException(503, "Дорожная модель пока не готова")
    return {"items": [{key: segment[key] for key in ["segment_id", "name", "direction"]} for segment in engine.segments.values() if segment["can_close"]]}


def record_view(resource, item, detailed=False):
    if resource == "users":
        return public_user(item) | {"registration_method": item.get("registration_method"), "last_login_at": item.get("last_login_at")}
    if resource == "datasets":
        return {"id": item["_id"], "version": item.get("version"), "created_at": item.get("imported_at"), "admin_note": item.get("admin_note", ""),
                **{key + "_count": len(item.get(key, [])) for key in ["nodes", "edges", "trips", "turn_restrictions"]}}
    if resource == "runs" and not detailed:
        return {"id": item["_id"], "created_at": item["created_at"], "owner_id": item.get("_owner_user_id"), "dataset_version": item["dataset_version"],
                "scenario_type": item.get("input", {}).get("scenario_type"), "calculation_ms": item.get("calculation_ms"), "archived": item.get("archived", False)}
    return {"id": item["_id"], **{key: value for key, value in item.items() if key != "_id"}}


@router.get("/{resource}")
def listing(resource: str, request: Request, q: str = Query("", max_length=100), page: int = Query(1, ge=1, le=10000),
            page_size: int = Query(20, ge=1, le=100), sort: str = "created_at", direction: Literal["asc", "desc"] = "desc",
            status: str = "", method: str = "", start: str | None = Query(None, alias="from"), end: str | None = Query(None, alias="to")):
    collection = collection_for(request, resource)
    query = {}
    if q:
        fields = {"users": ["username", "email", "display_name", "_id"], "runs": ["_id", "_owner_user_id", "dataset_version"],
                  "presets": ["name", "preset_id"], "datasets": ["_id", "admin_note"], "audit": ["actor_id", "action", "target_id"]}[resource]
        query["$or"] = [{field: {"$regex": re.escape(q), "$options": "i"}} for field in fields]
    if resource == "users":
        if status in {"active", "blocked"}:
            query["status"] = status
        if method in {"local", "yandex", "vk"}:
            query["registration_method"] = method
    elif resource in {"runs", "presets"} and status in {"active", "archived"}:
        query["archived"] = True if status == "archived" else {"$ne": True}
    if (start or end) and resource in {"users", "runs", "audit"}:
        query["created_at"] = period(request, start, end)[2]
    allowed = {"created_at", "username", "role", "status", "name", "version", "calculation_ms"}
    if sort not in allowed:
        raise HTTPException(422, "Недопустимое поле сортировки")
    # Avoid fetching full geometry and result snapshots for table rows.
    projection = {"password_hash": 0} if resource == "users" else None
    if resource == "runs":
        projection = {key: 1 for key in ["created_at", "_owner_user_id", "dataset_version", "input.scenario_type", "calculation_ms", "archived"]}
    items = [record_view(resource, item) for item in collection.find(query, projection).sort([(sort, 1 if direction == "asc" else -1), ("_id", 1)]).skip((page - 1) * page_size).limit(page_size)]
    return {"items": items, "total": collection.count_documents(query), "page": page, "page_size": page_size}


@router.get("/{resource}/{record_id}")
def detail(resource: str, record_id: str, request: Request):
    item = collection_for(request, resource).find_one({"_id": record_id})
    if not item:
        raise HTTPException(404, "Запись не найдена")
    result = record_view(resource, item, True)
    if resource == "users":
        result["providers"] = [entry["provider"] for entry in database(request).identities.find({"user_id": item["_id"]}, {"provider": 1})]
        result["runs_count"] = database(request).simulation_runs.count_documents({"_owner_user_id": item["_id"]})
    return result


class UserPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: int = Field(ge=1)
    role: Literal["user", "admin"]
    status: Literal["active", "blocked"]


@router.patch("/users/{user_id}", dependencies=[Depends(csrf)])
def update_user(user_id: str, payload: UserPatch, request: Request):
    db = database(request)
    user = db.users.find_one({"_id": user_id})
    if not user:
        raise HTTPException(404, "Пользователь не найден")
    if user["role"] == "admin" and (payload.role != "admin" or payload.status != "active"):
        raise HTTPException(409, "Снять права или заблокировать администратора можно только локальной командой на сервере")
    if payload.role == "admin" and payload.status != "active":
        raise HTTPException(422, "Администратор должен быть активным")
    before = {key: user[key] for key in ["role", "status", "version"]}
    after = {"role": payload.role, "status": payload.status}

    def perform():
        result = db.users.update_one({"_id": user_id, "version": payload.version}, {"$set": after, "$inc": {"version": 1}})
        if not result.matched_count:
            raise HTTPException(409, "Пользователь уже изменён. Обновите страницу.")
        if payload.status == "blocked":
            db.sessions.delete_many({"user_id": user_id})
        return {"ok": True}
    return audit_mutation(request, "user.update", user_id, before, after, perform)


class ArchivePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    archived: bool


@router.patch("/runs/{run_id}", dependencies=[Depends(csrf)])
def archive_run(run_id: str, payload: ArchivePatch, request: Request):
    collection = database(request).simulation_runs
    run = collection.find_one({"_id": run_id}, {"archived": 1})
    if not run:
        raise HTTPException(404, "Расчёт не найден")
    return audit_mutation(request, "run.archive", run_id, {"archived": run.get("archived", False)}, payload.model_dump(),
                          lambda: {"ok": bool(collection.update_one({"_id": run_id}, {"$set": payload.model_dump()}).matched_count)})


class PresetPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=500)
    scenario_type: Literal["closure", "capacity_reduction", "demand_increase"] = "closure"
    segment_id: str | None = Field(default=None, max_length=200)
    factor: float | None = None
    archived: bool = False


def preset_values(request, payload):
    engine = getattr(request.app.state, "engine", None)
    if engine is None:
        raise HTTPException(503, "Дорожная модель пока не готова")
    if not payload.name.strip():
        raise HTTPException(422, "Введите название")
    if payload.scenario_type != "demand_increase":
        segment = engine.segments.get(payload.segment_id)
        if not segment or not segment["can_close"]:
            raise HTTPException(422, "Выберите доступный для изменения участок")
    if payload.scenario_type == "capacity_reduction" and not (payload.factor is not None and 0 < payload.factor < 1):
        raise HTTPException(422, "Для сужения нужен коэффициент от 0 до 1, не включая границы")
    if payload.scenario_type == "demand_increase" and not (payload.factor is not None and 1 < payload.factor <= 3):
        raise HTTPException(422, "Для часа пик нужен коэффициент больше 1 и не больше 3")
    return {"name": payload.name.strip(), "description": payload.description, "dataset_version": engine.dataset["version"],
            "scenario_type": payload.scenario_type, "segment_id": payload.segment_id if payload.scenario_type != "demand_increase" else None,
            "parameters": {"factor": payload.factor} if payload.scenario_type != "closure" else {}, "archived": payload.archived}


@router.post("/presets", dependencies=[Depends(csrf)])
def create_preset(payload: PresetPayload, request: Request):
    key = "user-" + str(uuid4())
    values = {"_id": key, "preset_id": key, "created_at": stamp(), **preset_values(request, payload)}
    return audit_mutation(request, "preset.create", key, None, {k: v for k, v in values.items() if k != "_id"},
                          lambda: (database(request).scenario_presets.insert_one(values), {"id": key})[1])


@router.patch("/presets/{preset_id}", dependencies=[Depends(csrf)])
def update_preset(preset_id: str, payload: PresetPayload, request: Request):
    collection = database(request).scenario_presets
    previous = collection.find_one({"_id": preset_id})
    if not previous:
        raise HTTPException(404, "Шаблон не найден")
    values = preset_values(request, payload)
    return audit_mutation(request, "preset.update", preset_id, {k: previous.get(k) for k in values}, values,
                          lambda: {"ok": bool(collection.update_one({"_id": preset_id}, {"$set": values}).matched_count)})


class DatasetPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    admin_note: str = Field(max_length=1000)


@router.patch("/datasets/{version}", dependencies=[Depends(csrf)])
def update_dataset(version: str, payload: DatasetPatch, request: Request):
    collection = database(request).datasets
    previous = collection.find_one({"_id": version}, {"admin_note": 1})
    if not previous:
        raise HTTPException(404, "Версия не найдена")
    return audit_mutation(request, "dataset.note", version, {"admin_note": previous.get("admin_note", "")}, payload.model_dump(),
                          lambda: {"ok": bool(collection.update_one({"_id": version}, {"$set": payload.model_dump()}).matched_count)})
