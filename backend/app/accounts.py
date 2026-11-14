"""Opaque sessions and server-side OAuth code exchange; provider tokens are never persisted."""
import base64
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json
import re
import secrets
from urllib.parse import urlencode, urlsplit
from uuid import uuid4

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError
from .legal import approved_documents, published_version

SESSION_COOKIE = "fp_session"
CSRF_COOKIE = "fp_csrf"
FLOW_COOKIE = "fp_oauth"
LINK_COOKIE = "fp_link"
PROVIDERS = {"yandex", "vk"}
router = APIRouter()


def now():
    return datetime.now(timezone.utc)


def stamp():
    return now().isoformat()


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def future(value):
    return value.replace(tzinfo=timezone.utc) > now() if value.tzinfo is None else value > now()


def migrate(db):
    db.users.create_index("username", unique=True, sparse=True)
    db.users.create_index("email", unique=True, sparse=True)
    db.users.create_index("created_at")
    db.identities.create_index([("provider", 1), ("subject", 1)], unique=True)
    db.identities.create_index([("user_id", 1), ("provider", 1)], unique=True)
    for collection in [db.sessions, db.oauth_flows, db.pending_links, db.auth_limits]:
        collection.create_index("expires_at", expireAfterSeconds=0)
    db.sessions.create_index("user_id")
    db.auth_events.create_index("created_at")
    db.audit_log.create_index("created_at")
    db.simulation_runs.create_index([("_owner_user_id", 1), ("created_at", -1)])
    db.schema_migrations.update_one({"_id": "accounts-v1"}, {"$setOnInsert": {"applied_at": stamp()}}, upsert=True)


def database(request):
    if not getattr(request.app.state, "security_ready", False):
        raise HTTPException(503, "Аккаунты временно недоступны. Проверьте миграцию базы.")
    return request.app.state.db


def settings(request):
    return request.app.state.settings


def cookie(response, request, name, value, age):
    response.set_cookie(name, value, max_age=age, httponly=True, secure=settings(request).public_origin.startswith("https://"), samesite="lax", path="/")


def csrf(request: Request):
    origin = request.headers.get("origin")
    if origin and origin not in {settings(request).public_origin, *[v.strip() for v in settings(request).cors_origins.split(",")]}:
        raise HTTPException(403, "Недопустимый источник запроса")
    expected = request.cookies.get(CSRF_COOKIE, "")
    actual = request.headers.get("x-csrf-token", "")
    if len(expected) < 32 or not hmac.compare_digest(expected.encode(), actual.encode()):
        raise HTTPException(403, "Обновите страницу и повторите действие")


def session_record(request):
    token = request.cookies.get(SESSION_COOKIE, "")
    if not token:
        return None
    record = database(request).sessions.find_one({"_id": digest(token)})
    return record if record and future(record["expires_at"]) else None


def current_user(request: Request):
    session = session_record(request)
    if not session:
        return None
    user = database(request).users.find_one({"_id": session["user_id"]})
    if user and user["status"] != "active":
        raise HTTPException(403, "Аккаунт заблокирован")
    return user


def require_user(request: Request):
    user = current_user(request)
    if not user:
        raise HTTPException(401, "Войдите в аккаунт")
    return user


def require_admin(request: Request):
    user = require_user(request)
    if user["role"] != "admin":
        raise HTTPException(403, "Доступ только для администратора")
    return user


def require_recent(request):
    user = require_user(request)
    session = session_record(request)
    created = session["created_at"].replace(tzinfo=timezone.utc)
    if now() - created > timedelta(minutes=10):
        raise HTTPException(403, "Сначала подтвердите вход повторно")
    return user


def public_user(user):
    return {key: user.get(key) for key in ["username", "display_name", "email", "role", "status", "created_at", "version"]} | {"id": user["_id"]}


def password_hash(password):
    salt = secrets.token_bytes(16)
    key = hashlib.scrypt(password.encode(), salt=salt, n=32768, r=8, p=1, maxmem=64 * 1024 * 1024)
    return "scrypt$" + salt.hex() + "$" + key.hex()


def check_password(password, encoded):
    try:
        _, salt, expected = encoded.split("$")
        actual = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=32768, r=8, p=1, maxmem=64 * 1024 * 1024)
        return hmac.compare_digest(actual.hex(), expected)
    except (ValueError, AttributeError):
        return False


def limit(request, key, maximum=20):
    bucket = int(now().timestamp()) // 900
    item = database(request).auth_limits.find_one_and_update({"_id": digest(key) + ":" + str(bucket)},
        {"$inc": {"count": 1}, "$setOnInsert": {"expires_at": now() + timedelta(minutes=30)}}, upsert=True, return_document=ReturnDocument.AFTER)
    if item["count"] > maximum:
        raise HTTPException(429, "Слишком много попыток. Повторите через 15 минут.")


def create_session(request, response, user, method, registered=False, track_login=True):
    if user["status"] != "active":
        raise HTTPException(403, "Аккаунт заблокирован")
    db = database(request)
    previous = request.cookies.get(SESSION_COOKIE)
    if previous:
        db.sessions.delete_one({"_id": digest(previous)})
    token = secrets.token_urlsafe(48)
    record = {"_id": digest(token), "user_id": user["_id"], "created_at": now(), "expires_at": now() + timedelta(days=settings(request).session_days)}
    if track_login:
        record["outcome"] = {"kind": "registration_success" if registered else "login_success", "method": method}
    db.sessions.insert_one(record)
    cookie(response, request, SESSION_COOKIE, token, settings(request).session_days * 86400)
    db.users.update_one({"_id": user["_id"]}, {"$set": {"last_login_at": stamp()}})
    if track_login:
        db.auth_events.insert_one({"_id": str(uuid4()), "kind": "login", "method": method, "user_id": user["_id"], "created_at": stamp()})


def registrations_allowed(request):
    cfg = settings(request)
    if urlsplit(cfg.public_origin).hostname not in {"localhost", "127.0.0.1", "::1"} and not approved_documents(cfg):
        raise HTTPException(503, "Регистрация откроется после публикации правовых документов")


def check_terms(request, version):
    current = published_version(settings(request))
    if current and version != current:
        raise HTTPException(409, "Условия обновились. Обновите страницу и подтвердите текущую редакцию.")
    return current


class Register(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=3, max_length=40, pattern=r"^[a-zA-Z0-9_-]+$")
    password: str = Field(min_length=12, max_length=128)
    email: str | None = Field(default=None, max_length=254)
    accept_terms: bool
    terms_version: str = Field(default="", max_length=60)

    @field_validator("email")
    @classmethod
    def email_format(cls, value):
        if not value:
            return None
        value = value.strip().lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
            raise ValueError("Некорректный email")
        return value


class Login(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=1, max_length=254)
    password: str = Field(min_length=1, max_length=128)


@router.get("/api/site/config")
def site_config(request: Request):
    cfg = settings(request)
    documents = approved_documents(cfg)
    try:
        raw = json.loads(cfg.analytics_utm_allowlist)
        allowlist = {key: [value for value in raw.get(key, []) if isinstance(value, str) and re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,39}", value)]
                     for key in ["utm_source", "utm_medium", "utm_campaign"]}
    except (ValueError, TypeError, AttributeError):
        allowlist = {}
    return {"providers": {"yandex": bool(cfg.yandex_client_id and cfg.yandex_client_secret.get_secret_value()), "vk": bool(cfg.vk_client_id)},
            "metrica_counter_id": cfg.metrica_counter_id if cfg.metrica_counter_id.isdigit() else "", "utm_allowlist": allowlist,
            "legal_published": bool(documents), "legal_version": documents["version"] if documents else "",
            "local": urlsplit(cfg.public_origin).hostname in {"localhost", "127.0.0.1", "::1"}}


@router.get("/api/auth/csrf")
def csrf_token(request: Request, response: Response):
    token = request.cookies.get(CSRF_COOKIE) or secrets.token_urlsafe(32)
    cookie(response, request, CSRF_COOKIE, token, 86400)
    return {"csrf_token": token}


@router.post("/api/auth/register", dependencies=[Depends(csrf)])
def register(payload: Register, request: Request, response: Response):
    registrations_allowed(request)
    accepted_version = check_terms(request, payload.terms_version)
    if not payload.accept_terms:
        raise HTTPException(422, "Подтвердите создание аккаунта и условия сервиса")
    db = database(request)
    username = payload.username.lower()
    limit(request, "register:" + username)
    user = {"_id": str(uuid4()), "username": username, "display_name": payload.username, "password_hash": password_hash(payload.password),
            "role": "user", "status": "active", "version": 1, "registration_method": "local", "created_at": stamp(),
            "terms_version": accepted_version or "local-draft", "terms_accepted_at": stamp()}
    if payload.email:
        user["email"] = payload.email
    try:
        db.users.insert_one(user)
    except DuplicateKeyError:
        raise HTTPException(409, "Логин или email уже используется. Войдите в существующий аккаунт.")
    create_session(request, response, user, "local", registered=True)
    return {"user": public_user(user)}


@router.post("/api/auth/login", dependencies=[Depends(csrf)])
def login(payload: Login, request: Request, response: Response):
    name = payload.username.strip().lower()
    limit(request, "login:" + name)
    user = database(request).users.find_one({"$or": [{"username": name}, {"email": name}]})
    # Equal-cost verification for missing users avoids a username timing oracle.
    encoded = user.get("password_hash") if user else None
    if not encoded:
        encoded = "scrypt$" + "00" * 16 + "$" + "00" * 64
    valid = check_password(payload.password, encoded)
    if not user or not valid:
        raise HTTPException(401, "Неверный логин или пароль")
    create_session(request, response, user, "local")
    return {"user": public_user(user)}


@router.get("/api/auth/me")
def me(request: Request):
    user = current_user(request)
    identities = list(database(request).identities.find({"user_id": user["_id"]}, {"_id": 0, "provider": 1})) if user else []
    return {"user": public_user(user) if user else None, "providers": [item["provider"] for item in identities], "has_password": bool(user and user.get("password_hash"))}


@router.post("/api/auth/outcome", dependencies=[Depends(csrf), Depends(require_user)])
def outcome(request: Request):
    record = database(request).sessions.find_one_and_update({"_id": digest(request.cookies[SESSION_COOKIE])}, {"$unset": {"outcome": ""}})
    return {"outcome": record.get("outcome") if record else None}


@router.post("/api/auth/logout", dependencies=[Depends(csrf)])
def logout(request: Request, response: Response):
    token = request.cookies.get(SESSION_COOKIE, "")
    if token:
        database(request).sessions.delete_one({"_id": digest(token)})
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}


@router.get("/api/auth/oauth/{provider}/start")
def oauth_start(provider: str, request: Request, intent: str = "login", accept_terms: bool = False, terms_version: str = ""):
    if provider not in PROVIDERS or intent not in {"login", "link"}:
        raise HTTPException(404, "Неизвестный способ входа")
    cfg = settings(request)
    if not site_config(request)["providers"][provider]:
        raise HTTPException(503, "Способ входа ещё не настроен")
    user = require_recent(request) if intent == "link" else None
    if intent == "login" and not accept_terms:
        raise HTTPException(422, "Перед входом подтвердите условия создания аккаунта")
    accepted_version = check_terms(request, terms_version) if intent == "login" else published_version(cfg)
    browser = secrets.token_urlsafe(32)
    state = secrets.token_urlsafe(48)
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    redirect_uri = cfg.public_origin + f"/api/auth/oauth/{provider}/callback"
    database(request).oauth_flows.insert_one({"_id": digest(state), "provider": provider, "browser": digest(browser), "verifier": verifier,
        "expires_at": now() + timedelta(minutes=10), "redirect_uri": redirect_uri, "intent": intent, "user_id": user["_id"] if user else None, "terms_version": accepted_version})
    params = {"response_type": "code", "client_id": cfg.yandex_client_id if provider == "yandex" else cfg.vk_client_id,
              "redirect_uri": redirect_uri, "state": state, "code_challenge": challenge,
              "code_challenge_method": "S256" if provider == "yandex" else "s256", "scope": "login:info" if provider == "yandex" else "vkid.personal_info"}
    response = RedirectResponse(("https://oauth.yandex.ru/authorize" if provider == "yandex" else "https://id.vk.ru/authorize") + "?" + urlencode(params), status_code=303)
    cookie(response, request, FLOW_COOKIE, browser, 600)
    return response


def exchange_profile(provider, code, device_id, flow, state, cfg):
    payload = {"grant_type": "authorization_code", "code": code, "redirect_uri": flow["redirect_uri"], "code_verifier": flow["verifier"]}
    with httpx.Client(timeout=12, follow_redirects=False) as client:
        if provider == "yandex":
            payload.update(client_id=cfg.yandex_client_id, client_secret=cfg.yandex_client_secret.get_secret_value())
            result = client.post("https://oauth.yandex.ru/token", data=payload)
        else:
            if not device_id or len(device_id) > 1024:
                raise ValueError("device_id")
            payload.update(client_id=cfg.vk_client_id, device_id=device_id, state=state)
            result = client.post("https://id.vk.ru/oauth2/auth", data=payload)
        result.raise_for_status()
        tokens = result.json()
        if tokens.get("error") or not isinstance(tokens.get("access_token"), str) or not tokens["access_token"]:
            raise ValueError("token response")
        if provider == "vk" and not hmac.compare_digest(str(tokens.get("state", "")), state):
            raise ValueError("token state")
        if provider == "yandex":
            result = client.get("https://login.yandex.ru/info", params={"format": "json"}, headers={"Authorization": "OAuth " + tokens["access_token"]})
        else:
            result = client.post("https://id.vk.ru/oauth2/user_info", data={"client_id": cfg.vk_client_id, "access_token": tokens["access_token"]})
        result.raise_for_status()
        profile = result.json()
        if provider == "vk":
            profile = profile.get("user", {})
        subject = str(profile.get("id" if provider == "yandex" else "user_id") or "")
        if not subject or len(subject) > 200 or (provider == "vk" and str(tokens.get("user_id")) != subject):
            raise ValueError("identity")
        name = profile.get("display_name") or profile.get("first_name") or "Пользователь"
        email = profile.get("default_email") or profile.get("email")
        return {"provider": provider, "subject": subject, "display_name": str(name)[:100], "email": str(email).lower()[:254] if email else None}


def provider_user(request, profile, terms_version):
    db = database(request)
    provider = profile["provider"]
    identity = db.identities.find_one({"provider": provider, "subject": profile["subject"]})
    if identity:
        user = db.users.find_one({"_id": identity["user_id"]})
        if not user:
            raise HTTPException(503, "Аккаунт временно недоступен")
        return user, False
    registrations_allowed(request)
    accepted_version = check_terms(request, terms_version)
    user_id = "oauth_" + digest(provider + ":" + profile["subject"])
    user = {"_id": user_id, "display_name": profile["display_name"], "role": "user", "status": "active", "version": 1,
            "registration_method": provider, "created_at": stamp(), "terms_version": accepted_version or "local-draft", "terms_accepted_at": stamp()}
    result = db.users.update_one({"_id": user_id}, {"$setOnInsert": user}, upsert=True)
    registered = bool(result.upserted_id)
    try:
        db.identities.update_one({"provider": provider, "subject": profile["subject"]},
            {"$setOnInsert": {**{key: profile.get(key) for key in ["provider", "subject", "display_name", "email"]}, "user_id": user_id, "created_at": stamp()}}, upsert=True)
    except DuplicateKeyError:
        pass
    identity = db.identities.find_one({"provider": provider, "subject": profile["subject"]})
    if not identity:
        raise HTTPException(409, "Профиль уже привязан")
    if identity["user_id"] != user_id and registered:
        db.users.delete_one({"_id": user_id})
        registered = False
    return db.users.find_one({"_id": identity["user_id"]}), registered


def pending_identity(request, profile, user_id, terms_version=""):
    token = secrets.token_urlsafe(48)
    database(request).pending_links.insert_one({"_id": digest(token), **profile, "user_id": user_id, "expires_at": now() + timedelta(minutes=10), "terms_version": terms_version})
    response = RedirectResponse("/account" if user_id else "/login?error=link_required", status_code=303)
    cookie(response, request, LINK_COOKIE, token, 600)
    return response


@router.get("/api/auth/oauth/{provider}/callback")
def oauth_callback(provider: str, request: Request):
    def fail(reason):
        response = RedirectResponse("/login?error=" + reason, status_code=303)
        response.delete_cookie(FLOW_COOKIE, path="/")
        return response
    if provider not in PROVIDERS:
        return fail("provider")
    state = request.query_params.get("state", "")
    browser = request.cookies.get(FLOW_COOKIE, "")
    if not state or not browser or len(state) > 256:
        return fail("state")
    # Consumed atomically, including failed/cancelled callbacks; TTL deletion is not trusted for expiry checks.
    flow = database(request).oauth_flows.find_one_and_delete({"_id": digest(state), "provider": provider, "browser": digest(browser)})
    if not flow or not future(flow["expires_at"]):
        return fail("state")
    if request.query_params.get("error"):
        return fail("cancelled" if request.query_params["error"] == "access_denied" else "provider")
    code = request.query_params.get("code", "")
    if not code or len(code) > 4096:
        return fail("provider")
    try:
        profile = exchange_profile(provider, code, request.query_params.get("device_id"), flow, state, settings(request))
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        return fail("provider")
    db = database(request)
    if flow["intent"] == "link":
        try:
            user = require_recent(request)
        except HTTPException:
            return fail("reauth")
        if user["_id"] != flow["user_id"]:
            return fail("state")
        response = pending_identity(request, profile, user["_id"])
    else:
        identity = db.identities.find_one({"provider": provider, "subject": profile["subject"]})
        registered = False
        if identity:
            user = db.users.find_one({"_id": identity["user_id"]})
            if not user:
                return fail("provider")
        elif profile["email"] and db.users.find_one({"email": profile["email"]}):
            response = pending_identity(request, profile, None, flow.get("terms_version", ""))
            response.delete_cookie(FLOW_COOKIE, path="/")
            return response
        else:
            try:
                user, registered = provider_user(request, profile, flow.get("terms_version", ""))
            except HTTPException as error:
                return fail("terms" if error.status_code == 409 else "registration_closed")
        response = RedirectResponse("/account", status_code=303)
        if user["status"] != "active":
            return fail("blocked")
        create_session(request, response, user, provider, registered)
    response.delete_cookie(FLOW_COOKIE, path="/")
    return response


@router.get("/api/auth/pending-link")
def pending_link(request: Request, user=Depends(require_user)):
    record = database(request).pending_links.find_one({"_id": digest(request.cookies.get(LINK_COOKIE, ""))})
    if not record or not future(record["expires_at"]) or record["user_id"] not in {None, user["_id"]}:
        return {"pending": None}
    return {"pending": {"provider": record["provider"], "display_name": record["display_name"]}}


@router.get("/api/auth/pending-signin")
def pending_signin(request: Request):
    record = database(request).pending_links.find_one({"_id": digest(request.cookies.get(LINK_COOKIE, "")), "user_id": None})
    return {"pending": {"provider": record["provider"], "display_name": record["display_name"]} if record and future(record["expires_at"]) else None}


@router.post("/api/auth/continue-separate", dependencies=[Depends(csrf)])
def continue_separate(request: Request, response: Response):
    record = database(request).pending_links.find_one_and_delete({"_id": digest(request.cookies.get(LINK_COOKIE, "")), "user_id": None})
    if not record or not future(record["expires_at"]):
        raise HTTPException(409, "Подтверждение истекло. Начните вход заново.")
    user, registered = provider_user(request, record, record.get("terms_version", ""))
    create_session(request, response, user, record["provider"], registered)
    response.delete_cookie(LINK_COOKIE, path="/")
    return {"user": public_user(user)}


@router.post("/api/auth/confirm-link", dependencies=[Depends(csrf)])
def confirm_link(request: Request, response: Response):
    user = require_recent(request)
    db = database(request)
    record = db.pending_links.find_one_and_delete({"_id": digest(request.cookies.get(LINK_COOKIE, "")), "user_id": {"$in": [None, user["_id"]]}})
    if not record or not future(record["expires_at"]):
        raise HTTPException(409, "Подтверждение истекло. Начните привязку заново.")
    identity = {key: record[key] for key in ["provider", "subject", "display_name", "email"]} | {"user_id": user["_id"], "created_at": stamp()}
    existing = db.identities.find_one({"provider": identity["provider"], "subject": identity["subject"]})
    if existing and existing["user_id"] != user["_id"]:
        raise HTTPException(409, "Этот профиль уже связан с другим аккаунтом")
    try:
        db.identities.update_one({"provider": identity["provider"], "subject": identity["subject"], "user_id": user["_id"]}, {"$setOnInsert": identity}, upsert=True)
    except DuplicateKeyError:
        raise HTTPException(409, "У аккаунта уже есть привязка этого провайдера")
    db.audit_log.insert_one({"_id": str(uuid4()), "actor_id": user["_id"], "action": "identity.link", "target_id": user["_id"], "after": {"provider": identity["provider"]}, "created_at": stamp(), "status": "applied"})
    response.delete_cookie(LINK_COOKIE, path="/")
    return {"ok": True}


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=12, max_length=128)


@router.post("/api/auth/password", dependencies=[Depends(csrf)])
def change_password(payload: PasswordChange, request: Request, response: Response, user=Depends(require_user)):
    limit(request, "password:" + user["_id"])
    if not check_password(payload.current_password, user.get("password_hash")):
        raise HTTPException(403, "Неверный текущий пароль")
    db = database(request)
    db.users.update_one({"_id": user["_id"]}, {"$set": {"password_hash": password_hash(payload.new_password)}})
    db.sessions.delete_many({"user_id": user["_id"]})
    create_session(request, response, user, "local", track_login=False)
    db.audit_log.insert_one({"_id": str(uuid4()), "actor_id": user["_id"], "action": "password.change", "target_id": user["_id"], "created_at": stamp(), "status": "applied"})
    return {"ok": True}


@router.get("/api/account/runs")
def my_runs(request: Request, page: int = 1, user=Depends(require_user)):
    page = max(1, min(page, 10000))
    query = {"_owner_user_id": user["_id"], "archived": {"$ne": True}}
    db = database(request)
    items = [{"run_id": item["_id"], "created_at": item["created_at"], "scenario_type": item["input"]["scenario_type"]}
             for item in db.simulation_runs.find(query, {"created_at": 1, "input.scenario_type": 1}).sort("created_at", -1).skip((page - 1) * 20).limit(20)]
    return {"items": items, "total": db.simulation_runs.count_documents(query), "page": page, "page_size": 20}
