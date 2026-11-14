import base64
from datetime import timedelta
import hashlib
import json
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlsplit

from fastapi.testclient import TestClient
import httpx
import mongomock
import pytest

from app import accounts, legal
from app.config import Settings
from app.main import create_app

REAL_CLIENT = httpx.Client


def test_origin_normalization_and_https_requirement():
    assert Settings(public_origin="HTTPS://EXAMPLE.COM:443/").public_origin == "https://example.com"
    assert Settings(public_origin="http://localhost:3000/").public_origin == "http://localhost:3000"
    with pytest.raises(ValueError):
        Settings(public_origin="http://public.example")
    with pytest.raises(ValueError):
        Settings(public_origin="https://example.test/callback?code=bad")


@pytest.fixture
def app_db():
    db = mongomock.MongoClient().accounts_test
    cfg = Settings(yandex_client_id="yandex-test", yandex_client_secret="server-secret", vk_client_id="12345",
                   legal_publication_mode="manual", legal_published=False, legal_version="")
    app = create_app(cfg, db)
    with TestClient(app, base_url="http://localhost:3000", follow_redirects=False) as client:
        yield app, db, client


def post(client, path, data=None, method="POST"):
    token = client.get("/api/auth/csrf").json()["csrf_token"]
    return client.request(method, path, json=data, headers={"X-CSRF-Token": token, "Origin": str(client.base_url).rstrip("/")})


def register(client, name="test-user", email=None):
    response = post(client, "/api/auth/register", {"username": name, "password": "secure-password-123", "email": email, "accept_terms": True})
    assert response.status_code == 200, response.text
    return response.json()["user"]


def provider_http(monkeypatch, provider, subject="42", email=None, bad_state=False, fail=False):
    calls = []
    def handle(request):
        if provider == "vk":
            assert request.url.host == "id.vk.ru"
        fields = {key: values[0] for key, values in parse_qs(request.content.decode()).items()}
        calls.append((request, fields))
        if request.url.path in {"/token", "/oauth2/auth"}:
            if fail:
                return httpx.Response(400, json={"error": "invalid_grant"})
            assert fields["code_verifier"] and fields["grant_type"] == "authorization_code"
            if provider == "yandex":
                assert fields["client_secret"] == "server-secret"
            else:
                assert fields["device_id"] == "device-test"
            return httpx.Response(200, json={"access_token": "provider-secret-token", "user_id": subject, "state": "wrong" if bad_state else fields.get("state")})
        if provider == "yandex":
            assert request.headers["authorization"] == "OAuth provider-secret-token"
            return httpx.Response(200, json={"id": subject, "display_name": "Имя", **({"default_email": email} if email else {})})
        assert fields["access_token"] == "provider-secret-token"
        return httpx.Response(200, json={"user": {"user_id": subject, "first_name": "Имя", **({"email": email} if email else {})}})
    transport = httpx.MockTransport(handle)
    monkeypatch.setattr(accounts.httpx, "Client", lambda **kwargs: REAL_CLIENT(transport=transport, **kwargs))
    return calls


def start(client, provider, intent="login"):
    response = client.get(f"/api/auth/oauth/{provider}/start?accept_terms=true&intent={intent}")
    assert response.status_code == 303, response.text
    return {key: values[0] for key, values in parse_qs(urlsplit(response.headers["location"]).query).items()}


def callback(client, provider, flow, **extra):
    params = {"state": flow["state"], "code": "test-code", "device_id": "device-test", **extra}
    return client.get(f"/api/auth/oauth/{provider}/callback?" + urlencode(params))


def test_local_sessions_csrf_password_and_outcome(app_db):
    _, db, client = app_db
    assert client.post("/api/auth/register", json={"username": "bad", "password": "password-long", "accept_terms": True}).status_code == 403
    user = register(client)
    raw = client.cookies[accounts.SESSION_COOKIE]
    stored = db.sessions.find_one({"user_id": user["id"]})
    assert raw not in json.dumps({key: str(value) for key, value in stored.items()})
    assert stored["_id"] == accounts.digest(raw)
    profile = client.get("/api/auth/me")
    assert "password_hash" not in profile.text and "secure-password-123" not in profile.text
    assert profile.json()["has_password"] is True
    first = post(client, "/api/auth/outcome").json()["outcome"]
    assert first == {"kind": "registration_success", "method": "local"}
    assert post(client, "/api/auth/outcome").json()["outcome"] is None
    assert post(client, "/api/auth/logout").status_code == 200
    assert client.get("/api/auth/me").json()["user"] is None
    assert post(client, "/api/auth/login", {"username": "test-user", "password": "wrong"}).status_code == 401
    assert post(client, "/api/auth/login", {"username": "test-user", "password": "secure-password-123"}).status_code == 200
    assert client.cookies[accounts.SESSION_COOKIE] != raw
    second_client = TestClient(client.app, base_url="http://localhost:3000")
    assert post(second_client, "/api/auth/login", {"username": "test-user", "password": "secure-password-123"}).status_code == 200
    assert post(client, "/api/auth/password", {"current_password": "secure-password-123", "new_password": "changed-password-456"}).status_code == 200
    assert second_client.get("/api/auth/me").json()["user"] is None
    assert db.audit_log.find_one({"action": "password.change"})


@pytest.mark.parametrize("provider", ["yandex", "vk"])
def test_oauth_first_repeat_no_email_pkce_and_replay(app_db, monkeypatch, provider):
    _, db, client = app_db
    calls = provider_http(monkeypatch, provider)
    flow = start(client, provider)
    stored = db.oauth_flows.find_one({"_id": accounts.digest(flow["state"])})
    expected = base64.urlsafe_b64encode(hashlib.sha256(stored["verifier"].encode()).digest()).rstrip(b"=").decode()
    assert flow["code_challenge"] == expected
    assert flow["scope"] == ("login:info" if provider == "yandex" else "vkid.personal_info")
    assert flow["redirect_uri"] == f"http://localhost:3000/api/auth/oauth/{provider}/callback"
    response = callback(client, provider, flow)
    assert response.status_code == 303 and response.headers["location"] == "/account"
    assert calls[0][1]["code_verifier"] == stored["verifier"]
    assert calls[0][1]["redirect_uri"] == flow["redirect_uri"]
    user = client.get("/api/auth/me").json()["user"]
    assert user["email"] is None
    assert db.users.count_documents({}) == db.identities.count_documents({}) == 1
    assert post(client, "/api/auth/outcome").json()["outcome"]["kind"] == "registration_success"
    assert "error=state" in callback(client, provider, flow).headers["location"]
    flow2 = start(client, provider)
    assert callback(client, provider, flow2).headers["location"] == "/account"
    assert client.get("/api/auth/me").json()["user"]["id"] == user["id"]
    assert db.users.count_documents({}) == db.identities.count_documents({}) == 1
    assert post(client, "/api/auth/outcome").json()["outcome"]["kind"] == "login_success"
    assert len(calls) == 4
    assert "provider-secret-token" not in str(list(db.users.find())) + str(list(db.identities.find())) + str(list(db.sessions.find()))


@pytest.mark.parametrize("provider", ["yandex", "vk"])
def test_oauth_cancel_wrong_state_foreign_browser_expiry_and_provider_error(app_db, monkeypatch, provider):
    app, db, client = app_db
    provider_http(monkeypatch, provider, fail=True)
    flow = start(client, provider)
    outsider = TestClient(app, base_url="http://localhost:3000", follow_redirects=False)
    assert "error=state" in callback(outsider, provider, flow).headers["location"]
    assert db.oauth_flows.count_documents({}) == 1
    assert "error=cancelled" in callback(client, provider, flow, error="access_denied").headers["location"]
    flow = start(client, provider)
    db.oauth_flows.update_one({"_id": accounts.digest(flow["state"])}, {"$set": {"expires_at": accounts.now() - timedelta(seconds=1)}})
    assert "error=state" in callback(client, provider, flow).headers["location"]
    flow = start(client, provider)
    assert "error=provider" in callback(client, provider, flow).headers["location"]
    assert db.users.count_documents({}) == 0


def test_vk_token_state_checked(app_db, monkeypatch):
    _, db, client = app_db
    provider_http(monkeypatch, "vk", bad_state=True)
    assert "error=provider" in callback(client, "vk", start(client, "vk")).headers["location"]
    assert db.users.count_documents({}) == 0


@pytest.mark.parametrize("provider", ["yandex", "vk"])
def test_email_conflict_requires_owner_login_and_confirmation(app_db, monkeypatch, provider):
    _, db, client = app_db
    owner = register(client, email="owner@example.test")
    post(client, "/api/auth/logout")
    provider_http(monkeypatch, provider, email="owner@example.test")
    response = callback(client, provider, start(client, provider))
    assert "error=link_required" in response.headers["location"]
    assert db.users.count_documents({}) == 1 and db.identities.count_documents({}) == 0
    assert post(client, "/api/auth/confirm-link").status_code == 401
    post(client, "/api/auth/login", {"username": "test-user", "password": "secure-password-123"})
    assert client.get("/api/auth/pending-link").json()["pending"]["provider"] == provider
    assert post(client, "/api/auth/confirm-link").status_code == 200
    assert db.identities.find_one({"provider": provider})["user_id"] == owner["id"]
    assert post(client, "/api/auth/confirm-link").status_code == 409
    assert callback(client, provider, start(client, provider)).headers["location"] == "/account"
    assert db.users.count_documents({}) == 1


@pytest.mark.parametrize("provider", ["yandex", "vk"])
def test_explicit_link_requires_fresh_session_and_cannot_steal_identity(app_db, monkeypatch, provider):
    _, db, client = app_db
    provider_http(monkeypatch, provider)
    callback(client, provider, start(client, provider))
    original_id = client.get("/api/auth/me").json()["user"]["id"]
    post(client, "/api/auth/logout")
    second = register(client, "second-user")
    link = start(client, provider, "link")
    assert callback(client, provider, link).headers["location"] == "/account"
    assert post(client, "/api/auth/confirm-link").status_code == 409
    assert db.identities.find_one({"provider": provider})["user_id"] == original_id
    db.sessions.update_one({"user_id": second["id"]}, {"$set": {"created_at": accounts.now() - timedelta(minutes=11)}})
    assert client.get(f"/api/auth/oauth/{provider}/start?intent=link").status_code == 403


def test_admin_authorization_csrf_user_updates_and_audit(app_db):
    _, db, client = app_db
    assert client.get("/api/admin/overview").status_code == 401
    ordinary = register(client)
    assert client.get("/api/admin/overview").status_code == 403
    assert post(client, "/api/admin/users/" + ordinary["id"], {"role": "admin", "status": "active", "version": 1}, "PATCH").status_code == 403
    db.users.update_one({"_id": ordinary["id"]}, {"$set": {"role": "admin"}})
    another = TestClient(client.app, base_url="http://localhost:3000")
    target = register(another, "another-user")
    assert client.patch("/api/admin/users/" + target["id"], json={"role": "user", "status": "blocked", "version": 1}).status_code == 403
    changed = post(client, "/api/admin/users/" + target["id"], {"role": "user", "status": "blocked", "version": 1}, "PATCH")
    assert changed.status_code == 200
    assert another.get("/api/auth/me").json()["user"] is None
    assert db.audit_log.find_one({"target_id": target["id"], "status": "applied"})
    assert post(client, "/api/admin/users/" + ordinary["id"], {"role": "user", "status": "active", "version": 1}, "PATCH").status_code == 409
    assert post(client, "/api/admin/users/" + target["id"], {"role": "user", "status": "active", "version": 1}, "PATCH").status_code == 409
    response = client.get("/api/admin/users?q=another&status=blocked&sort=username&direction=asc&page_size=1")
    assert response.json()["total"] == 1 and len(response.json()["items"]) == 1
    assert "password_hash" not in response.text
    assert client.get("/api/admin/traffic").json()["status"] == "not_configured"
    assert client.get("/api/admin/overview").json()["metrics"]["new_users"] == 2


def test_private_runs_presets_and_dataset_management(app_db):
    _, db, client = app_db
    owner = register(client)
    simulation = post(client, "/api/simulate", {"scenario_type": "demand_increase", "factor": 1.4})
    assert simulation.status_code == 200
    run = simulation.json()
    outsider = TestClient(client.app, base_url="http://localhost:3000")
    assert outsider.get("/api/runs/" + run["run_id"]).status_code == 404
    stored = client.get("/api/runs/" + run["run_id"])
    assert stored.json() == run
    assert "no-store" in stored.headers["cache-control"]
    assert "noindex" in stored.headers["x-robots-tag"]
    assert client.get("/api/account/runs").json()["total"] == 1
    db.users.update_one({"_id": owner["id"]}, {"$set": {"role": "admin"}})
    assert post(client, "/api/admin/runs/" + run["run_id"], {"archived": True}, "PATCH").status_code == 200
    assert client.get("/api/account/runs").json()["total"] == 0
    payload = {"name": "Тестовый час пик", "scenario_type": "demand_increase", "factor": 1.6}
    created = post(client, "/api/admin/presets", payload)
    assert created.status_code == 200, created.text
    key = created.json()["id"]
    assert any(item["preset_id"] == key for item in client.get("/api/scenarios").json()["scenarios"])
    assert post(client, "/api/admin/presets/" + key, {**payload, "archived": True}, "PATCH").status_code == 200
    assert not any(item["preset_id"] == key for item in client.get("/api/scenarios").json()["scenarios"])
    version = client.get("/api/map").json()["dataset_version"]
    assert post(client, "/api/admin/datasets/" + version, {"admin_note": "Проверено"}, "PATCH").status_code == 200
    assert client.get("/api/admin/datasets/" + version).json()["admin_note"] == "Проверено"
    assert client.get("/api/admin/segments").json()["items"]
    assert client.get("/api/admin/runs?sort=password_hash").status_code == 422


def test_legal_gating_configuration_and_cross_origin(app_db, tmp_path, monkeypatch):
    app, _, client = app_db
    cfg = app.state.settings
    assert client.get("/api/legal/privacy").json() == {"published": False, "title": "Политика конфиденциальности"}
    public = client.get("/api/site/config")
    assert "server-secret" not in public.text and "metrica_read_token" not in public.text
    token = client.get("/api/auth/csrf").json()["csrf_token"]
    assert client.post("/api/auth/login", json={"username": "a", "password": "b"}, headers={"Origin": "https://evil.example", "X-CSRF-Token": token}).status_code == 403
    cfg.public_origin = "https://service.example"
    secure_client = TestClient(app, base_url="https://service.example", follow_redirects=False)
    assert post(secure_client, "/api/auth/register", {"username": "test", "password": "secure-password-123", "accept_terms": True}).status_code == 503
    path = tmp_path / "reviewed.json"
    path.write_text(json.dumps({"version": "v1", "approved_at": accounts.stamp(), "operator": {"name": "Operator", "contact": "contact@example.test", "jurisdiction": "RU"}, "documents": {key: "Reviewed text " * 20 for key in legal.TITLES}}))
    monkeypatch.setattr(legal, "APPROVAL_PATH", path)
    cfg.legal_published = True
    cfg.legal_version = "v1"
    assert client.get("/api/legal/privacy").json()["published"] is True
    assert client.get("/api/site/config").json()["legal_published"] is True
    assert post(secure_client, "/api/auth/register", {"username": "secure-user", "password": "secure-password-123", "accept_terms": True, "terms_version": "old"}).status_code == 409
    created = post(secure_client, "/api/auth/register", {"username": "secure-user", "password": "secure-password-123", "accept_terms": True, "terms_version": "v1"})
    assert created.status_code == 200
    assert all(value in created.headers["set-cookie"].lower() for value in ["httponly", "secure", "samesite=lax"])


def test_approved_release_publishes_with_legacy_disabled_settings(app_db, tmp_path, monkeypatch):
    app, db, client = app_db
    cfg = app.state.settings
    cfg.legal_publication_mode = "auto"
    cfg.public_origin = "https://service.example"
    path = tmp_path / "release.json"
    bundle = {"version": "release-v2", "approved_at": accounts.stamp(),
              "operator": {"name": "Operator", "contact": "contact@example.test", "jurisdiction": "RU"},
              "documents": {key: "Reviewed release text " * 20 for key in legal.TITLES}}
    path.write_text(json.dumps(bundle))
    monkeypatch.setattr(legal, "APPROVAL_PATH", path)
    assert cfg.legal_published is False and cfg.legal_version == ""
    assert client.get("/api/site/config").json()["legal_version"] == "release-v2"
    assert client.get("/api/site/config").json()["legal_published"] is True
    for slug, text in bundle["documents"].items():
        response = client.get("/api/legal/" + slug).json()
        assert response["published"] is True and response["text"] == text
    secure_client = TestClient(app, base_url="https://service.example", follow_redirects=False)
    data = {"username": "release-user", "password": "secure-password-123", "accept_terms": True}
    assert post(secure_client, "/api/auth/register", {**data, "terms_version": "old"}).status_code == 409
    response = post(secure_client, "/api/auth/register", {**data, "terms_version": "release-v2"})
    assert response.status_code == 200
    assert db.users.find_one({"username": "release-user"})["terms_version"] == "release-v2"
    cfg.legal_publication_mode = "disabled"
    assert client.get("/api/site/config").json()["legal_published"] is False
    assert client.get("/api/site/config").json()["legal_version"] == ""
    assert client.get("/api/legal/privacy").json()["published"] is False
    assert post(secure_client, "/api/auth/register", {**data, "username": "closed-user"}).status_code == 503


@pytest.mark.parametrize("missing", ["approved_at", "operator", "version", "privacy"])
def test_auto_publication_does_not_serve_unapproved_or_incomplete_bundle(app_db, tmp_path, monkeypatch, missing):
    app, _, client = app_db
    app.state.settings.legal_publication_mode = "auto"
    path = tmp_path / "incomplete.json"
    bundle = {"version": "release-v2", "approved_at": accounts.stamp(),
              "operator": {"name": "Operator", "contact": "contact@example.test", "jurisdiction": "RU"},
              "documents": {key: "Reviewed text " * 20 for key in legal.TITLES}}
    if missing == "privacy":
        del bundle["documents"][missing]
    else:
        del bundle[missing]
    path.write_text(json.dumps(bundle))
    monkeypatch.setattr(legal, "APPROVAL_PATH", path)
    assert client.get("/api/legal/privacy").json()["published"] is False
    assert client.get("/api/site/config").json()["legal_published"] is False


@pytest.mark.parametrize("provider", ["yandex", "vk"])
def test_email_conflict_can_create_separate_account_without_merging(app_db, monkeypatch, provider):
    _, db, client = app_db
    original = register(client, email="shared@example.test")
    post(client, "/api/auth/logout")
    provider_http(monkeypatch, provider, email="shared@example.test")
    callback(client, provider, start(client, provider))
    assert client.get("/api/auth/pending-signin").json()["pending"]["provider"] == provider
    response = post(client, "/api/auth/continue-separate")
    assert response.status_code == 200
    assert response.json()["user"]["id"] != original["id"]
    assert response.json()["user"]["email"] is None
    assert db.users.count_documents({}) == 2
    assert db.users.find_one({"_id": original["id"]})["email"] == "shared@example.test"
    assert post(client, "/api/auth/continue-separate").status_code == 409


@pytest.mark.parametrize("provider", ["yandex", "vk"])
def test_parallel_oauth_callbacks_deduplicate_accounts(app_db, monkeypatch, provider):
    from concurrent.futures import ThreadPoolExecutor
    app, db, first = app_db
    provider_http(monkeypatch, provider)
    second = TestClient(app, base_url="http://localhost:3000", follow_redirects=False)
    flows = [start(first, provider), start(second, provider)]
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda pair: callback(pair[0], provider, pair[1], code="code-" + pair[1]["state"]), zip([first, second], flows)))
    assert all(response.status_code == 303 and response.headers["location"] == "/account" for response in responses)
    assert db.users.count_documents({}) == db.identities.count_documents({}) == 1
    assert first.get("/api/auth/me").json()["user"]["id"] == second.get("/api/auth/me").json()["user"]["id"]


def test_metrica_read_api_and_failure_status(app_db, monkeypatch):
    from pydantic import SecretStr
    app, db, client = app_db
    user = register(client)
    db.users.update_one({"_id": user["id"]}, {"$set": {"role": "admin"}})
    cfg = app.state.settings
    cfg.metrica_counter_id = "12345678"
    cfg.metrica_read_token = SecretStr("read-only-test-token")
    cfg.metrica_registration_goal_id = "101"
    cfg.metrica_login_goal_id = "102"
    cfg.metrica_simulation_goal_id = "103"
    def report(request):
        assert request.headers["authorization"] == "OAuth read-only-test-token"
        assert "ym:s:goal101conversionRate" in request.url.params["metrics"]
        return httpx.Response(200, json={"data": [{"dimensions": [{"name": "Социальные сети"}], "metrics": [10, 8, 1.5, 2.5, 3.5]}]})
    monkeypatch.setattr(accounts.httpx, "Client", lambda **kwargs: REAL_CLIENT(transport=httpx.MockTransport(report), **kwargs))
    response = client.get("/api/admin/traffic?from=2026-11-01&to=2026-11-14")
    assert response.json()["status"] == "connected"
    assert response.json()["rows"][0]["simulation_conversion_percent"] == 3.5
    assert "read-only-test-token" not in response.text
    monkeypatch.setattr(accounts.httpx, "Client", lambda **kwargs: REAL_CLIENT(transport=httpx.MockTransport(lambda request: httpx.Response(403)), **kwargs))
    assert client.get("/api/admin/traffic").json()["status"] == "error"
