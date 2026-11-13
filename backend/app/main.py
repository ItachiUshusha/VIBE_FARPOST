from contextlib import asynccontextmanager
from datetime import datetime, timezone
import logging
import time
from uuid import uuid4

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pymongo.errors import PyMongoError

from .config import Settings, get_settings
from .repository import connect, seed_database
from .schemas import AnalyzeRequest, SimulationRequest
from .simulation import SimulationEngine
from .catalogs import attach_catalogs
from .scenarios import ScenarioService

logger = logging.getLogger(__name__)


def readable_time(seconds):
    total = max(0, round(seconds))
    hours, rest = divmod(total, 3600)
    minutes, seconds = divmod(rest, 60)
    if hours:
        return f"{hours} ч" + (f" {minutes} мин" if minutes else "")
    if minutes:
        return f"{minutes} мин" + (f" {seconds} с" if seconds else "")
    return f"{seconds} с"


def create_app(settings: Settings | None = None, database=None) -> FastAPI:
    settings = settings or get_settings()

    def initialize(app):
        data = app.state.db.datasets.find_one({"_id": settings.dataset_version})
        if data is None and settings.auto_seed:
            imported = seed_database(app.state.db, settings.dataset_path)
            if imported["version"] != settings.dataset_version:
                raise ValueError("Версия набора не совпадает с конфигурацией")
            data = imported
        if data is None:
            raise ValueError("Активный дорожный набор не импортирован")
        attach_catalogs(data)
        engine = SimulationEngine(data)
        scenarios = ScenarioService(engine)
        if "catalogs" in data:
            app.state.db.datasets.update_one({"_id": data["version"]}, {"$set": {"catalogs": data["catalogs"]}})
        app.state.engine = engine
        app.state.scenarios = scenarios

    @asynccontextmanager
    async def lifespan(app):
        client = None
        if database is None:
            client, app.state.db = connect(settings)
        else:
            app.state.db = database
        app.state.engine = None
        try:
            app.state.db.command("ping")
            initialize(app)
        except (PyMongoError, ValueError, OSError):
            logger.exception("Инициализация дорожного набора не завершена")
        yield
        if client is not None:
            client.close()

    app = FastAPI(title="Эффект бабочки", version="1.0.0", lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
                       allow_credentials=False, allow_methods=["GET", "POST"], allow_headers=["Content-Type"])

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request, exc):
        messages = [e["msg"].removeprefix("Value error, ") for e in exc.errors()]
        return JSONResponse(status_code=422, content={"detail": "Проверьте параметры сценария. " + "; ".join(messages)})

    def ready(request: Request):
        try:
            request.app.state.db.command("ping")
            if not request.app.state.db.datasets.find_one({"_id": settings.dataset_version}, {"_id": 1}):
                if settings.auto_seed:
                    initialize(request.app)
                else:
                    raise ValueError("Нет активного набора")
            if request.app.state.engine is None:
                initialize(request.app)
            return request.app.state.engine
        except (PyMongoError, ValueError, OSError):
            raise HTTPException(503, "Расчёт пока недоступен. Проверьте MongoDB и импорт дорожных данных.")

    @app.get("/api/health")
    def health(engine=Depends(ready)):
        return {"status": "ready", "mongodb": "connected", "dataset_version": engine.dataset["version"],
                "is_test_network": engine.dataset.get("is_test_network", False)}

    @app.get("/api/map")
    def map_data(request: Request, engine=Depends(ready)):
        data = engine.dataset
        features = []
        for edge in data["edges"]:
            segment = engine.segments[edge["segment_id"]]
            features.append({"type": "Feature", "id": edge["edge_id"], "geometry": edge["geometry"], "properties": {
                key: edge[key] for key in ["edge_id", "segment_id", "name", "length_m", "speed_kmh", "highway"]
            } | {"can_close": segment["can_close"], "direction": segment["direction"],
                 "lane_count": segment.get("lane_count"), "lane_min": segment.get("lane_min"),
                 "lane_max": segment.get("lane_max"), "oneway": segment.get("oneway", False)}})
        return {"dataset_version": data["version"], "center": data["center"], "radius_m": data["radius_m"],
                "source": data["source"], "is_test_network": data.get("is_test_network", False),
                "imported_at": data.get("imported_at"), "license": data["license"],
                "edges": {"type": "FeatureCollection", "features": features}, "segments": data["segments"],
                "junctions": [{"node_id": str(node["node_id"]), "coordinates": [node["lon"], node["lat"]]} for node in data["nodes"]
                              if engine.graph.in_degree(str(node["node_id"])) > 0 and engine.graph.out_degree(str(node["node_id"])) > 0],
                "model": {k: data["config"][k] for k in ["alpha", "beta", "elevated_threshold", "high_threshold"]},
                "traffic": request.app.state.scenarios.config}

    @app.get("/api/catalogs")
    def catalogs(request: Request, _engine=Depends(ready)):
        return request.app.state.scenarios.catalogs

    @app.get("/api/scenarios")
    def scenarios(request: Request, engine=Depends(ready)):
        try:
            return {"dataset_version": engine.dataset["version"], "scenarios": list(request.app.state.db.scenario_presets.find(
                {"dataset_version": engine.dataset["version"]}, {"_id": 0}).sort("preset_id", 1))}
        except PyMongoError:
            raise HTTPException(503, "Не удалось загрузить сценарии из MongoDB.")

    @app.get("/api/baseline")
    def baseline(request: Request, vehicle_count: int | None = Query(default=None, ge=1, le=10000), engine=Depends(ready)):
        try:
            return {"dataset_version": engine.dataset["version"], **request.app.state.scenarios.baseline(vehicle_count)}
        except ValueError as exc:
            raise HTTPException(422, str(exc))

    @app.post("/api/simulate")
    def simulate(payload: SimulationRequest, request: Request, engine=Depends(ready)):
        start = time.perf_counter()
        try:
            result = request.app.state.scenarios.simulate(payload.model_dump())
        except KeyError:
            raise HTTPException(404, "Участок не найден в активной версии карты. Выберите дорогу заново.")
        except ValueError as exc:
            raise HTTPException(422, str(exc))
        result.update({"run_id": str(uuid4()), "created_at": datetime.now(timezone.utc).isoformat(),
                       "input": payload.model_dump(), "calculation_ms": round((time.perf_counter() - start) * 1000, 1)})
        try:
            request.app.state.db.simulation_runs.insert_one({"_id": result["run_id"], **result})
        except PyMongoError:
            raise HTTPException(503, "Не удалось сохранить расчёт в MongoDB. Проверьте соединение и повторите попытку.")
        return result

    def get_run(request, run_id):
        try:
            run = request.app.state.db.simulation_runs.find_one({"_id": run_id}, {"_id": 0})
        except PyMongoError:
            raise HTTPException(503, "Не удалось прочитать сохранённый расчёт.")
        if not run:
            raise HTTPException(404, "Сохранённый расчёт не найден.")
        return run

    @app.get("/api/runs/{run_id}")
    def saved_run(run_id: str, request: Request, _engine=Depends(ready)):
        return get_run(request, run_id)

    @app.post("/api/analyze")
    def analyze(payload: AnalyzeRequest, request: Request, _engine=Depends(ready)):
        # Текст строится только из сохранённого результата: без внешнего LLM
        # он доступен автономно и не может добавлять выдуманные дороги/цифры.
        run = get_run(request, payload.run_id)
        cmp = run["comparison"]
        time_change = cmp["average_time_s"]
        parts = []
        if cmp.get("demand_factor", 1) > 1:
            parts.append(f"В час пик машин на {(cmp['demand_factor'] - 1) * 100:.0f}% больше, чем в обычных условиях.")
        applied = run.get("applied_settings")
        if applied:
            weather_names = {"dry": "сухо", "rain": "дождь", "snow": "снег"}
            parts.append(f"Погода после изменения: {weather_names[applied['weather_after']]}.")
            if applied["weather_factor_after"] < 1:
                parts.append(f"Из-за погоды скорость без пробок ниже на {(1 - applied['weather_factor_after']) * 100:.0f}%.")
            parts.append(f"Машин в расчёте до изменения: {run['before']['metrics']['vehicle_count']:.0f}, после: {run['after']['metrics']['vehicle_count']:.0f}.")
        personal = run.get("personal_route")
        if personal:
            for phase, title in [("before", "До"), ("after", "После")]:
                journey = personal[phase]
                if journey["status"] == "ok":
                    if journey.get("parking_included", bool(journey.get("parking"))):
                        parts.append(f"{title}: ваша поездка занимает {readable_time(journey['total_time_s'])}, из них за рулём {readable_time(journey['drive_time_s'])}, поиск места {readable_time(journey['search_time_s'])}, пешком {readable_time(journey['walk_time_s'])}.")
                    else:
                        parts.append(f"{title}: доехать до Б — {readable_time(journey['drive_time_s'])}, без учёта парковки и пешего пути.")
                    if journey.get("parking") and journey.get("parking_included", True):
                        parts.append(f"{title}: парковка «{journey['parking']['name']}», занятость {journey['parking']['occupancy_percent']:g}%.")
                else:
                    parts.append(f"{title}: {journey['message']}")
                if journey.get("parking_message"):
                    parts.append(f"{title}: {journey['parking_message']}")
            if personal.get("comparison_note"):
                parts.append(personal["comparison_note"])
            if personal["comparison"]["absolute"] is not None:
                difference = personal["comparison"]["absolute"]
                parts.append("Время вашей поездки не изменилось." if round(difference) == 0 else f"Ваша поездка стала на {readable_time(abs(difference))} {'дольше' if difference > 0 else 'быстрее'}. Пеший путь оценён по прямой.")
        houses = run.get("house_changes")
        if houses and (houses["added"] or houses["removed"]):
            added = sum(h["vehicle_count"] for h in houses["added"])
            removed = sum(h["vehicle_count"] for h in houses["removed"])
            parts.append(f"Новые дома добавили {added:.0f} машин; снос домов убрал {removed:.0f} машин. Это число до увеличения в час пик.")
        for road in run.get("added_roads", []):
            count = sum(run["after"]["edge_loads"].get(edge_id, {}).get("flow", 0) for edge_id in road["edge_ids"])
            parts.append(f"Добавлена дорога «{road['name']}», длина {road['length_m']:.0f} м. По ней поедут примерно {count:.0f} машин из расчёта.")
        parts.append(f"Путь изменился на {cmp['changed_trip_count']} из {cmp['matched_trip_count']} сравниваемых направлений.")
        if time_change["absolute"] is not None:
            difference = time_change["absolute"]
            parts.append("Среднее время поездки не изменилось." if round(difference) == 0 else f"В среднем поездка стала на {readable_time(abs(difference))} {'дольше' if difference > 0 else 'быстрее'}.")
        else:
            parts.append("Нет направлений, по которым можно проехать и до, и после изменения. Сравнить среднее время не получится.")
        growth = cmp["top_increased_edges"]
        if growth:
            top = growth[0]
            parts.append(f"Больше всего машин добавилось на дороге «{top['name']}»: было примерно {top['before']:.0f}, стало {top['after']:.0f}.")
        unreachable = run["after"]["metrics"]["unreachable_trip_count"]
        if unreachable:
            parts.append(f"После изменения {run['after']['metrics']['unreachable_vehicle_count']:.0f} машин не могут доехать до цели. Их время не включено в среднее.")
        else:
            parts.append("После изменения все машины могут доехать до цели.")
        if personal:
            parts.append("Следующий эксперимент: сравните автоматический и ручной выбор парковки при той же погоде.")
        elif cmp.get("demand_factor", 1) > 1:
            parts.append("Следующий эксперимент: уменьшите число машин в час пик и сравните время поездки.")
        elif run.get("added_roads"):
            parts.append("Следующий эксперимент: измените полосы или скорость новой дороги и сравните время поездки.")
        elif applied and not applied.get("road_change"):
            parts.append("Следующий эксперимент: сравните этот результат с сухой погодой и исходными домами.")
        else:
            parts.append("Следующий эксперимент: вместо перекрытия сузьте ту же дорогу и сравните время поездки.")
        return {"run_id": run["run_id"], "source": "template", "text": " ".join(parts)}

    return app


app = create_app()
