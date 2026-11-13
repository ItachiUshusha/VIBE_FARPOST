"""Проверка сохранения составного расчёта до/после реального перезапуска API."""
import json
from pathlib import Path
import sys
import time
import urllib.request
import urllib.error

ROOT = Path(__file__).resolve().parents[1]
SAVED = ROOT / ".local/extended-persistence.json"
BASE = "http://127.0.0.1:3000/api"


def call(path, body=None):
    request = urllib.request.Request(BASE + path, data=None if body is None else json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=12) as response:
        return json.load(response)


def main():
    phase = sys.argv[1] if len(sys.argv) > 1 else "before"
    for attempt in range(30):
        try:
            call("/health")
            break
        except urllib.error.URLError:
            if attempt == 29:
                raise
            time.sleep(.5)
    if phase == "before":
        catalog = call("/catalogs")
        pid = catalog["parkings"][0]["parking_id"]
        payload = {"scenario_type": "composite", "vehicle_count": 1000, "weather": "rain",
                   "personal_route": {**catalog["demo_personal_route"], "parking_mode": "manual", "parking_id": pid},
                   "parking_occupancy": {pid: 75}, "housing": {"add": [], "remove": [catalog["houses"][0]["house_id"]]}}
        result = call("/simulate", payload)
        assert result["after"]["metrics"]["vehicle_count"] == 980
        assert result["personal_route"]["after"]["search_time_s"] == 180
        assert result["applied_settings"]["alpha"] == .15
        component = next(t for t in result["trip_demand"] if t["trip_id"] == catalog["houses"][0]["origin_trip_id"])
        assert component["houses_before"] == 20 and component["houses_after"] == 0
        SAVED.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
        print(json.dumps({"saved_run_id": result["run_id"], "calculation_ms": result["calculation_ms"], "before": result["before"]["metrics"]["vehicle_count"], "after": result["after"]["metrics"]["vehicle_count"]}))
    elif phase == "after":
        expected = json.loads(SAVED.read_text(encoding="utf-8"))
        actual = call("/runs/" + expected["run_id"])
        assert actual == expected
        analysis = call("/analyze", {"run_id": expected["run_id"]})
        assert analysis["source"] == "template" and "180" in analysis["text"] and "980" in analysis["text"]
        print(json.dumps({"persisted_run_id": actual["run_id"], "snapshots": "equal", "analysis": analysis["source"]}))
    else:
        raise ValueError("Используйте before или after")


if __name__ == "__main__":
    main()
