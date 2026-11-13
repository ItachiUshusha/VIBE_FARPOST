import json
from pathlib import Path

from pymongo import MongoClient

from .simulation import validate_dataset
from .catalogs import attach_catalogs
from .scenarios import ScenarioService
from .simulation import SimulationEngine


def seed_database(db, dataset_path: Path) -> dict:
    data = json.loads(dataset_path.read_text(encoding="utf-8"))
    validate_dataset(data)
    attach_catalogs(data)
    ScenarioService(SimulationEngine(data))  # validate catalogue references before any database write
    # stable primary keys make repeated seed imports idempotent
    db.datasets.replace_one({"_id": data["version"]}, {"_id": data["version"], **data}, upsert=True)
    for preset in data.get("presets", []):
        db.scenario_presets.replace_one({"_id": preset["preset_id"]}, {"_id": preset["preset_id"], **preset}, upsert=True)
    db.simulation_runs.create_index("created_at")
    db.scenario_presets.create_index("dataset_version")
    return data


def connect(settings):
    client = MongoClient(settings.mongodb_uri, serverSelectionTimeoutMS=1800, connectTimeoutMS=1800)
    return client, client[settings.mongodb_database]
