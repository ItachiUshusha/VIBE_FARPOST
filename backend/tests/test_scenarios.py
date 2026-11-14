from copy import deepcopy
import json

from fastapi.testclient import TestClient
import pytest

from app.catalogs import attach_catalogs
from app.main import create_app
from app.scenarios import DEFAULT_CONFIG, ScenarioService, search_time
from app.simulation import SimulationEngine
from test_simulation import dataset
from test_api import DATA, db, settings


def service(data=None, parkings=None, houses=None):
    data = data or dataset()
    data["catalogs"] = {"dataset_version": data["version"], "catalog_version": "test-city-v1", "config": deepcopy(DEFAULT_CONFIG),
                        "parkings": parkings or [], "houses": houses or [],
                        "terminals": [{"terminal_id": "to-b", "label": "Б", "node_id": "b", "coordinates": [131.001, 43]},
                                      {"terminal_id": "to-c", "label": "В", "node_id": "c", "coordinates": [131.002, 43]}]}
    data["catalogs"]["terminals"] = [t for t in data["catalogs"]["terminals"] if any(e["v"] == t["node_id"] for e in data["edges"])]
    return ScenarioService(SimulationEngine(data))


def parking(pid, node, coordinates, occupancy=50):
    return {"parking_id": pid, "name": pid, "entry_node_id": node, "coordinates": coordinates,
            "baseline_occupancy_percent": occupancy, "is_demo": True, "capacity": 30, "source": "test"}


def personal(destination=None, mode="none", pid=None, via=None):
    return {"origin": {"lon": 131, "lat": 43}, "destination": destination or {"lon": 131.002, "lat": 43},
            "via": via or [], "parking_mode": mode, "parking_id": pid}


def payload(**kwargs):
    return {"scenario_type": "composite", **kwargs}


def test_bpr_weather_and_house_formula_examples():
    data = dataset(edges=[("ab", "a", "b", 1200, 5)], trips=[{"trip_id": "t1", "origin": "a", "destination": "b", "vehicle_count": 5}])
    house = {"house_id": "h1", "name": "Дом", "exit_node_id": "a", "origin_trip_id": "t1", "residents": 1, "coordinates": [131, 43]}
    model = service(data, houses=[house])
    assert model.baseline()["trip_metrics"]["t1"]["time_s"] == pytest.approx(138)
    rain = model.simulate(payload(weather="rain"))
    assert rain["after"]["trip_metrics"]["t1"]["time_s"] == pytest.approx(162.35294117647)
    removed = model.simulate(payload(housing={"add": [], "remove": ["h1"]}))
    assert removed["after"]["edge_loads"]["ab"]["flow"] == 4
    assert removed["after"]["trip_metrics"]["t1"]["time_s"] == pytest.approx(127.3728)


def test_waypoint_cannot_reset_turn_restriction():
    data = dataset(edges=[("ab", "a", "b", 10, 100), ("bc", "b", "c", 10, 100), ("ac", "a", "c", 100, 100)],
                   restrictions=[{"from_edge_id": "ab", "to_edge_id": "bc"}])
    model = service(data)
    result = model.simulate(payload(personal_route=personal(via=[{"lon": 131.001, "lat": 43}])))
    assert result["personal_route"]["before"]["status"] == "unreachable"
    assert result["personal_route"]["before"]["car_route"] is None
    assert model.engine.shortest_via("a", ["c"], model.engine.t0, set()) == ["ac"]


def test_waypoint_search_can_find_legal_detour():
    data = dataset(edges=[("ab", "a", "b", 10, 100), ("bc", "b", "c", 10, 100), ("ac", "a", "c", 100, 100), ("cb", "c", "b", 10, 100)],
                   restrictions=[{"from_edge_id": "ab", "to_edge_id": "bc"}])
    model = service(data)
    assert model.engine.shortest_via("a", ["b", "c"], model.engine.t0, set()) == ["ac", "cb", "bc"]


def test_parking_search_50_75_100_and_manual_id_is_fixed():
    model = service(parkings=[parking("p1", "c", [131.002, 43])])
    request = personal(mode="manual", pid="p1")
    result = model.simulate(payload(personal_route=request, parking_occupancy={"p1": 75}))
    before, after = result["personal_route"]["before"], result["personal_route"]["after"]
    assert before["search_time_s"] == 60
    assert after["search_time_s"] == 180
    assert after["total_time_s"] - before["total_time_s"] == pytest.approx(120)
    full = model.simulate(payload(personal_route=request, parking_occupancy={"p1": 100}))
    assert full["personal_route"]["before"]["parking"]["parking_id"] == "p1"
    assert full["personal_route"]["after"]["status"] == "ok"
    assert full["personal_route"]["after"]["parking_status"] == "parking_full"
    assert full["personal_route"]["after"]["parking_included"] is False
    assert full["personal_route"]["after"]["total_time_s"] == full["personal_route"]["after"]["drive_time_s"]
    assert full["personal_route"]["after"]["car_route"] is not None
    assert full["personal_route"]["after"]["search_time_s"] is None
    assert full["personal_route"]["comparison"]["absolute"] is None
    assert full["personal_route"]["comparison_note"]
    assert search_time(99, DEFAULT_CONFIG) == 900


def test_auto_parking_chooses_total_time_and_can_change():
    model = service(parkings=[parking("p1", "c", [131.002, 43]), parking("p2", "b", [131.001, 43])])
    result = model.simulate(payload(personal_route=personal(mode="auto"), parking_occupancy={"p1": 100}))
    journey = result["personal_route"]
    assert journey["before"]["parking"]["parking_id"] == "p1"
    assert journey["after"]["parking"]["parking_id"] == "p2"
    for phase in ["before", "after"]:
        eligible = [a for a in journey[phase]["alternatives"] if a["status"] == "ok"]
        expected = min(eligible, key=lambda a: (a["total_time_s"], a["parking"]["parking_id"]))
        assert journey[phase]["parking"]["parking_id"] == expected["parking"]["parking_id"]


def test_auto_parking_tie_is_stable_by_id():
    model = service(parkings=[parking("z", "c", [131.002, 43]), parking("a", "c", [131.002, 43])])
    result = model.simulate(payload(personal_route=personal(mode="auto")))
    assert result["personal_route"]["after"]["parking"]["parking_id"] == "a"


def test_unreachable_parking_and_no_candidates_are_explicit():
    data = dataset(edges=[("ab", "a", "b", 100, 10), ("cb", "c", "b", 100, 10)],
                   trips=[{"trip_id": "t1", "origin": "a", "destination": "b", "vehicle_count": 2}])
    # c имеет въезд по дополнительному ребру, но из a в эту компоненту пути нет.
    data["nodes"].append({"node_id": "d", "lon": 131.003, "lat": 43})
    data["edges"].append({"edge_id": "dc", "u": "d", "v": "c", "key": 3, "segment_id": "dc", "name": "dc", "length_m": 100, "speed_kmh": 36, "capacity": 10, "highway": "residential", "geometry": {"type": "LineString", "coordinates": [[131.003, 43], [131.002, 43]]}})
    data["segments"].append({"segment_id": "dc", "edge_ids": ["dc"], "can_close": True})
    model = service(data, parkings=[parking("p1", "c", [131.002, 43])])
    result = model.simulate(payload(personal_route=personal(mode="manual", pid="p1")))
    assert result["personal_route"]["after"]["status"] == "unreachable"
    assert result["personal_route"]["after"]["parking_status"] == "parking_unreachable"
    reachable = model.simulate(payload(personal_route=personal(destination={"lon": 131.001, "lat": 43}, mode="manual", pid="p1")))
    assert reachable["personal_route"]["after"]["status"] == "ok"
    assert reachable["personal_route"]["after"]["parking_status"] == "parking_unreachable"
    assert reachable["personal_route"]["after"]["edge_ids"] == ["ab"]
    far = model.simulate(payload(personal_route=personal(destination={"lon": 132, "lat": 44}, mode="auto")))
    assert far["personal_route"]["after"]["parking_status"] == "no_parking"
    assert far["personal_route"]["after"]["status"] == "unreachable"


@pytest.mark.parametrize("mode", ["auto", "manual"])
def test_missing_or_distant_parking_keeps_route_to_destination(mode):
    parkings = [] if mode == "auto" else [parking("distant", "c", [131.02, 43])]
    model = service(parkings=parkings)
    request = personal(mode=mode, pid="distant" if mode == "manual" else None,
                       via=[{"lon": 131.001, "lat": 43}])
    result = model.simulate(payload(personal_route=request))
    for phase in ["before", "after"]:
        journey = result["personal_route"][phase]
        assert journey["status"] == "ok"
        assert journey["parking_status"] == ("no_parking" if mode == "auto" else "outside_radius")
        assert journey["parking_message"]
        assert journey["edge_ids"] == ["ab", "bc"]
        assert journey["car_route"] is not None and journey["walk_route"] is None
        assert journey["total_time_s"] == journey["drive_time_s"]
        assert journey["search_time_s"] is None and journey["walk_time_s"] is None
    assert result["personal_route"]["comparison"]["absolute"] == 0


def test_added_house_weight_and_selected_demand_are_independent():
    model = service()
    house = {"house_id": "new-40", "coordinates": {"lon": 131, "lat": 43}, "residents": 40, "terminal_id": "to-c"}
    result = model.simulate(payload(vehicle_count=1000, housing={"add": [house], "remove": []}, demand_factor=1.4))
    assert result["before"]["metrics"]["vehicle_count"] == 1000
    assert result["after"]["metrics"]["vehicle_count"] == pytest.approx(1040 * 1.4)
    assert result["after"]["trip_metrics"]["house-new-40"]["vehicle_count"] == pytest.approx(56)
    assert result["house_changes"]["added"][0]["vehicle_count"] == 40
    assert result["trip_demand"][-1]["before_weight"] == 0
    assert result["trip_demand"][-1]["after_weight"] == pytest.approx(56)
    assert result["applied_settings"]["alpha"] == .15
    assert result["applied_settings"]["beta"] == 4
    assert result["comparison"]["matched_trip_count"] == 1
    assert result["comparison"]["matched_vehicle_count"] == 1000


def test_existing_house_can_make_trip_zero_and_new_baseline_is_immutable():
    data = dataset(trips=[{"trip_id": "t1", "origin": "a", "destination": "c", "vehicle_count": 1}])
    h = {"house_id": "h1", "name": "Дом", "exit_node_id": "a", "origin_trip_id": "t1", "residents": 1, "coordinates": [131, 43]}
    model = service(data, houses=[h])
    result = model.simulate(payload(housing={"add": [], "remove": ["h1"]}))
    assert result["after"]["metrics"]["vehicle_count"] == 0
    assert result["after"]["routes"]["features"] == []
    assert result["comparison"]["average_time_s"]["after"] is None
    assert model.baseline()["metrics"]["vehicle_count"] == 1
    with pytest.raises(ValueError, match="фонового спроса"):
        model.baseline(1000)


def test_negative_background_and_invalid_references_rejected():
    h = {"house_id": "h1", "name": "Дом", "exit_node_id": "a", "origin_trip_id": "t1", "residents": 200, "coordinates": [131, 43]}
    with pytest.raises(ValueError, match="превышает"):
        service(houses=[h])
    model = service()
    with pytest.raises(ValueError, match="не найден"):
        model.simulate(payload(housing={"add": [], "remove": ["unknown"]}))
    with pytest.raises(ValueError, match="ближе"):
        model.simulate(payload(personal_route=personal(destination={"lon": 0, "lat": 0})))


def test_increasing_count_changes_load_without_scaling_capacity_to_match():
    model = service()
    a, b = model.baseline(500), model.baseline(1000)
    assert a["metrics"]["vehicle_count"] == 500
    assert b["metrics"]["vehicle_count"] == 1000
    assert a["edge_loads"]["ab"]["capacity"] == b["edge_loads"]["ab"]["capacity"]
    assert a["edge_loads"]["ab"]["flow"] < b["edge_loads"]["ab"]["flow"]
    assert a["metrics"]["average_time_s"] < b["metrics"]["average_time_s"]


def test_personal_trip_does_not_add_traffic():
    model = service()
    plain = model.simulate(payload())
    routed = model.simulate(payload(personal_route=personal()))
    assert plain["after"] == routed["after"]
    assert routed["personal_route"]["vehicle_count"] == 0
    assert routed["personal_route"]["snapped_points"]["origin"]["node_id"] == "a"


def test_composite_combines_road_weather_peak_and_house_without_losing_coefficients():
    model = service()
    house = {"house_id": "extra", "coordinates": {"lon": 131, "lat": 43}, "residents": 40, "terminal_id": "to-c"}
    common = {"vehicle_count": 1000, "weather": "snow", "demand_factor": 1.4, "housing": {"add": [house], "remove": []}}
    narrow = model.simulate(payload(**common, road_change={"scenario_type": "capacity_reduction", "segment_id": "ab", "factor": .5}))
    assert narrow["after"]["metrics"]["vehicle_count"] == pytest.approx(1040 * 1.4)
    assert narrow["after"]["edge_loads"]["ab"]["capacity"] == narrow["before"]["edge_loads"]["ab"]["capacity"] * .5
    ratio = narrow["after"]["edge_loads"]["ab"]["ratio"]
    assert narrow["after"]["edge_loads"]["ab"]["time_s"] == pytest.approx(model.engine.t0["ab"] / .7 * (1 + .15 * ratio**4))
    closure = model.simulate(payload(**common, road_change={"scenario_type": "closure", "segment_id": "ab"},
                                       personal_route=personal(via=[{"lon": 131.001, "lat": 43}])))
    assert closure["closed_edge_ids"] == ["ab"]
    assert closure["personal_route"]["before"]["status"] == "ok"
    assert closure["personal_route"]["after"]["status"] == "unreachable"
    assert closure["personal_route"]["after"]["car_route"] is None
    assert closure["personal_route"]["comparison"]["absolute"] is None
    assert all("ab" not in f["properties"]["edge_ids"] for f in closure["after"]["routes"]["features"])


def test_combined_real_graph_scenario_repeats_with_shared_snap_and_persistence(db, settings):
    data = attach_catalogs(json.loads(DATA.read_text(encoding="utf-8")))
    catalog = data["catalogs"]
    pid = catalog["parkings"][0]["parking_id"]
    request = payload(vehicle_count=1000, weather="rain", personal_route={**catalog["demo_personal_route"], "parking_mode": "manual", "parking_id": pid},
                      parking_occupancy={pid: 75}, housing={"add": [], "remove": [catalog["houses"][0]["house_id"]]})
    with TestClient(create_app(settings, db)) as client:
        assert client.get("/api/catalogs").json()["catalog_version"] == "city-scenarios-v2"
        assert client.get("/api/baseline").json()["metrics"]["vehicle_count"] == 38
        assert client.get("/api/baseline?vehicle_count=1000").json()["metrics"]["vehicle_count"] == 1000
        first_response = client.post("/api/simulate", json=request)
        assert first_response.status_code == 200, first_response.text
        first = first_response.json()
        second = client.post("/api/simulate", json=request).json()
        for key in ["before", "after", "comparison", "personal_route", "house_changes", "applied_settings"]:
            assert first[key] == second[key]
        assert first["after"]["metrics"]["vehicle_count"] == 980
        assert first["personal_route"]["after"]["search_time_s"] == 180
        assert first["applied_settings"]["weather_factor_after"] == .85
        assert first["personal_route"]["after"]["status"] == "ok"
    with TestClient(create_app(settings, db)) as client:
        assert client.get("/api/runs/" + first["run_id"]).json() == first
        explanation = client.post("/api/analyze", json={"run_id": first["run_id"]}).json()
        assert "поиск места 3 мин" in explanation["text"]
        assert "980" in explanation["text"]


def test_packaged_catalog_has_only_real_parking_and_one_car_per_resident():
    data = attach_catalogs(json.loads(DATA.read_text(encoding="utf-8")))
    model = ScenarioService(SimulationEngine(data))
    assert model.config["k_auto"] == 1
    assert len(model.parkings) > 14
    for p in model.parkings.values():
        assert not p["is_demo"]
        assert p["source_tags"]["amenity"] == "parking"
        assert p["source_url"] == "https://www.openstreetmap.org/" + p["source_id"]
        assert p["source_tags"].get("access") not in {"private", "no", "permit"}
    result = model.simulate(payload(vehicle_count=1000, housing={"add": [], "remove": [next(iter(model.houses))]}))
    assert result["before"]["metrics"]["vehicle_count"] == 1000
    assert result["after"]["metrics"]["vehicle_count"] == 980
    assert sum(t["houses_before"] for t in result["trip_demand"]) == 20
    with pytest.raises(ValueError):
        model.baseline(1)


def test_parking_warning_survives_saved_run_and_explanation(db, settings):
    data = attach_catalogs(json.loads(DATA.read_text(encoding="utf-8")))
    pid = data["catalogs"]["parkings"][0]["parking_id"]
    with TestClient(create_app(settings, db)) as client:
        response = client.post("/api/simulate", json=payload(vehicle_count=1000,
            personal_route={**data["catalogs"]["demo_personal_route"], "parking_mode": "manual", "parking_id": pid},
            parking_occupancy={pid: 100}))
        assert response.status_code == 200
        result = response.json()
        assert result["personal_route"]["after"]["status"] == "ok"
        assert result["personal_route"]["after"]["parking_status"] == "parking_full"
        assert client.get("/api/runs/" + result["run_id"]).json() == result
        explanation = client.post("/api/analyze", json={"run_id": result["run_id"]})
        assert explanation.status_code == 200
        assert "мест нет" in explanation.json()["text"]
        assert "без учёта парковки" in explanation.json()["text"]


@pytest.mark.parametrize("patch", [{"vehicle_count": 0}, {"vehicle_count": 1.5}, {"vehicle_count": 10001}, {"weather": "storm"},
                                   {"parking_occupancy": {"demo-ring-west": 101}}, {"parking_occupancy": {"unknown": 50}},
                                   {"housing": {"remove": ["unknown"], "add": []}}])
def test_new_invalid_inputs_never_save_runs(db, settings, patch):
    with TestClient(create_app(settings, db)) as client:
        response = client.post("/api/simulate", json=payload(**patch))
        assert response.status_code == 422, response.text
        assert db.simulation_runs.count_documents({}) == 0
