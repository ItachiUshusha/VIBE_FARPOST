"""Проверки реального запущенного стека, до и после перезапуска API.

python scripts/verify_stack.py before
docker compose restart backend
python scripts/verify_stack.py after
"""
import argparse
import json
from pathlib import Path
import subprocess
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
BASE = "http://127.0.0.1:3000/api"
SAVED = ROOT / ".local/run-before-restart.json"


def call(path, body=None):
    raw = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(BASE + path, data=raw, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.load(response)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("phase", choices=["before", "after", "outage"])
    args = parser.parse_args()
    if args.phase == "outage":
        subprocess.run(["docker", "compose", "stop", "mongo"], cwd=ROOT, check=True)
        try:
            for endpoint, body in [("/health", None), ("/simulate", {"scenario_type": "closure", "segment_id": "seg-0a73bf4d9a08"})]:
                try:
                    call(endpoint, body)
                    raise AssertionError("API должен вернуть 503 без MongoDB")
                except urllib.error.HTTPError as error:
                    assert error.code == 503
        finally:
            subprocess.run(["docker", "compose", "start", "mongo"], cwd=ROOT, check=True)
    for attempt in range(40):
        try:
            assert call("/health")["mongodb"] == "connected"
            break
        except (urllib.error.URLError, AssertionError):
            if attempt == 39:
                raise
            time.sleep(.5)
    if args.phase == "outage":
        print(json.dumps({"mongodb_outage": "health=503, simulate=503", "recovered": "ready"}))
    elif args.phase == "before":
        preset = call("/scenarios")["scenarios"][0]
        payload = {"scenario_type": "closure", "segment_id": preset["segment_id"]}
        timings = []
        results = []
        for _ in range(2):
            start = time.perf_counter()
            results.append(call("/simulate", payload))
            timings.append(round((time.perf_counter() - start) * 1000, 2))
        first, second = results
        for key in ["before", "after", "comparison", "closed_edge_ids"]:
            assert first[key] == second[key], key
        assert first["comparison"]["changed_trip_count"] > 0
        assert first["after"]["metrics"]["unreachable_trip_count"] == 0
        for route in first["after"]["routes"]["features"]:
            assert not (set(route["properties"]["edge_ids"]) & set(first["closed_edge_ids"]))
        assert first["comparison"]["top_increased_edges"][0]["absolute"] > 0
        narrow = call("/simulate", {"scenario_type": "capacity_reduction", "segment_id": preset["segment_id"], "factor": .5})
        assert narrow["closed_edge_ids"] == []
        rush = call("/simulate", {"scenario_type": "demand_increase", "factor": 1.4})
        assert rush["after"]["metrics"]["vehicle_count"] == 38 * 1.4
        for body, code in [({"scenario_type": "closure", "segment_id": "unknown"}, 404),
                           ({"scenario_type": "capacity_reduction", "segment_id": preset["segment_id"], "factor": 0}, 422)]:
            try:
                call("/simulate", body)
                raise AssertionError("Некорректный запрос принят")
            except urllib.error.HTTPError as error:
                assert error.code == code
        SAVED.parent.mkdir(exist_ok=True)
        SAVED.write_text(json.dumps(first, ensure_ascii=False), encoding="utf-8")
        print(json.dumps({"phase": args.phase, "roundtrip_ms": timings, "calculation_ms": first["calculation_ms"],
                          "run_id": first["run_id"], "comparison": first["comparison"]}, ensure_ascii=False, indent=2))
    else:
        expected = json.loads(SAVED.read_text(encoding="utf-8"))
        actual = call("/runs/" + expected["run_id"])
        assert actual == expected
        explanation = call("/analyze", {"run_id": expected["run_id"]})
        assert explanation["source"] == "template"
        print(json.dumps({"phase": args.phase, "persisted_run": actual["run_id"], "analysis": explanation}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
