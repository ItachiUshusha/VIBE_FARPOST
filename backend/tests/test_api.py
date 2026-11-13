from copy import deepcopy
from pathlib import Path

from fastapi.testclient import TestClient
import mongomock
import pytest

from app.config import Settings
from app.main import create_app
from app.repository import seed_database

DATA = Path(__file__).resolve().parents[1] / "data/pervaya-rechka-v1.json"


@pytest.fixture
def db():
    return mongomock.MongoClient().butterfly_test


@pytest.fixture
def settings():
    return Settings(dataset_path=DATA)


def test_seed_idempotent_and_validates_references(db):
    data = seed_database(db, DATA)
    seed_database(db, DATA)
    assert db.datasets.count_documents({}) == 1
    assert db.scenario_presets.count_documents({}) == len(data["presets"])


def test_default_packaged_dataset_path_exists():
    assert Settings().dataset_path.is_file()


def test_api_persists_run_and_analysis_survives_app_restart(db, settings):
    with TestClient(create_app(settings, db)) as client:
        assert client.get("/api/health").json()["status"] == "ready"
        map_response = client.get("/api/map").json()
        assert map_response["edges"]["features"][0]["properties"]["edge_id"]
        baseline = client.get("/api/baseline").json()
        preset = client.get("/api/scenarios").json()["scenarios"][0]
        payload = {"scenario_type": "closure", "segment_id": preset["segment_id"]}
        first = client.post("/api/simulate", json=payload).json()
        second = client.post("/api/simulate", json=payload).json()
        assert first["before"]["metrics"] == baseline["metrics"]
        assert first["after"] == second["after"]
        assert first["comparison"] == second["comparison"]
        assert db.simulation_runs.find_one({"_id": first["run_id"]}) is not None
    with TestClient(create_app(settings, db)) as restarted:
        stored = restarted.get(f"/api/runs/{first['run_id']}").json()
        assert stored == first
        analysis = restarted.post("/api/analyze", json={"run_id": first["run_id"]}).json()
        assert analysis["source"] == "template"
        assert str(first["comparison"]["changed_trip_count"]) in analysis["text"]


def test_api_invalid_inputs_do_not_change_graph_or_save_runs(db, settings):
    with TestClient(create_app(settings, db)) as client:
        before = deepcopy(client.get("/api/baseline").json())
        assert client.post("/api/simulate", json={"scenario_type": "closure", "segment_id": "unknown"}).status_code == 404
        assert client.post("/api/simulate", json={"scenario_type": "closure"}).status_code == 422
        sid = client.get("/api/scenarios").json()["scenarios"][0]["segment_id"]
        for factor in [0, 1, -1, 3]:
            assert client.post("/api/simulate", json={"scenario_type": "capacity_reduction", "segment_id": sid, "factor": factor}).status_code == 422
        assert client.post("/api/simulate", json={"scenario_type": "demand_increase", "factor": 4}).status_code == 422
        assert client.post("/api/simulate", json={"scenario_type": "closure", "segment_id": sid, "edge_ids": ["injected"]}).status_code == 422
        assert client.post("/api/analyze", json={"run_id": "missing"}).status_code == 404
        assert client.get("/api/baseline").json() == before
        assert db.simulation_runs.count_documents({}) == 0


def test_health_is_503_without_active_dataset(db, settings):
    settings.auto_seed = False
    with TestClient(create_app(settings, db)) as client:
        assert client.get("/api/health").status_code == 503
        assert client.get("/api/baseline").status_code == 503


def test_disabled_segment_returns_422(db, settings):
    data = seed_database(db, DATA)
    sid = data["presets"][0]["segment_id"]
    for s in data["segments"]:
        if s["segment_id"] == sid:
            s["can_close"] = False
    db.datasets.replace_one({"_id": data["version"]}, {"_id": data["version"], **data})
    with TestClient(create_app(settings, db)) as client:
        response = client.post("/api/simulate", json={"scenario_type": "closure", "segment_id": sid})
        assert response.status_code == 422
        assert "недоступно" in response.json()["detail"]
