from copy import deepcopy
import json
from pathlib import Path

import pytest

from app.simulation import SimulationEngine, validate_dataset


def dataset(edges=None, trips=None, restrictions=None):
    if edges is None:
        edges = [("ab", "a", "b", 100, 10), ("bc", "b", "c", 100, 10), ("ac", "a", "c", 400, 10)]
    result = {
        "version": "test-v1", "nodes": [{"node_id": node, "lon": 131 + i * .001, "lat": 43} for i, node in enumerate("abc")],
        "edges": [], "segments": [], "trips": trips or [{"trip_id": "t1", "origin": "a", "destination": "c", "vehicle_count": 2}],
        "config": {"alpha": .15, "beta": 4, "elevated_threshold": .7, "high_threshold": 1, "speeds": {"residential": 36}},
        "presets": [], "turn_restrictions": restrictions or [],
    }
    for i, (eid, u, v, length, capacity) in enumerate(edges):
        result["edges"].append({"edge_id": eid, "u": u, "v": v, "key": i, "segment_id": eid, "name": eid,
                                "length_m": length, "speed_kmh": 36, "capacity": capacity, "highway": "residential",
                                "geometry": {"type": "LineString", "coordinates": [[131 + ord(u) / 1000, 43], [131 + ord(v) / 1000, 43]]}})
        result["segments"].append({"segment_id": eid, "edge_ids": [eid], "can_close": True})
    return result


def test_directed_no_reverse_path():
    data = dataset(trips=[{"trip_id": "reverse", "origin": "c", "destination": "a", "vehicle_count": 3}])
    state = SimulationEngine(data).baseline
    assert state["routes"]["features"] == []
    assert state["unreachable_trips"] == [{"trip_id": "reverse", "vehicle_count": 3}]
    assert state["metrics"]["average_time_s"] is None


def test_parallel_edges_exact_selection_and_specific_closure():
    data = dataset(edges=[("slow", "a", "b", 250, 100), ("fast", "a", "b", 100, 100), ("bc", "b", "c", 100, 100)])
    engine = SimulationEngine(data)
    assert engine.baseline["trip_metrics"]["t1"]["edge_ids"] == ["fast", "bc"]
    result = engine.simulate("closure", "fast")
    assert result["after"]["trip_metrics"]["t1"]["edge_ids"] == ["slow", "bc"]
    assert result["closed_edge_ids"] == ["fast"]
    assert result["after"]["edge_loads"]["slow"]["status"] == "open"


def test_ties_are_stable_by_edge_id():
    data = dataset(edges=[("z", "a", "b", 100, 100), ("a", "a", "b", 100, 100), ("bc", "b", "c", 100, 100)])
    engine = SimulationEngine(data)
    assert engine.shortest_edges("a", "c", engine.t0, set()) == ["a", "bc"]
    first = engine.baseline
    data["edges"].reverse()
    second = SimulationEngine(data).baseline
    assert first == second
    # На втором проходе нагрузка может перевести поездку на другое ребро;
    # при этом результат по-прежнему не зависит от порядка входных данных.
    assert first["trip_metrics"]["t1"]["edge_ids"] == ["z", "bc"]


def test_two_pass_assignment_and_final_times():
    data = dataset(edges=[("direct", "a", "c", 10, 1), ("ab", "a", "b", 10, 10), ("bc", "b", "c", 10, 10)])
    state = SimulationEngine(data).baseline
    assert state["trip_metrics"]["t1"]["edge_ids"] == ["ab", "bc"]
    assert state["edge_loads"]["direct"]["flow"] == 0
    assert state["trip_metrics"]["t1"]["time_s"] == pytest.approx(2 * (1 + .15 * .2**4))
    assert state["trip_metrics"]["t1"]["time_s"] == sum(state["edge_loads"][e]["time_s"] for e in ["ab", "bc"])


def test_no_comparable_trips_null_averages_and_no_geometry():
    engine = SimulationEngine(dataset(edges=[("ab", "a", "b", 100, 10), ("bc", "b", "c", 100, 10)]))
    result = engine.simulate("closure", "ab")
    assert result["comparison"]["matched_trip_count"] == 0
    assert result["comparison"]["average_time_s"] == {"before": None, "after": None, "absolute": None, "percent": None}
    assert result["after"]["routes"]["features"] == []
    assert result["after"]["edge_loads"]["ab"]["status"] == "closed"


def test_weighted_comparison_excludes_unreachable_and_uses_base_demand():
    trips = [{"trip_id": "t1", "origin": "a", "destination": "b", "vehicle_count": 2},
             {"trip_id": "t2", "origin": "b", "destination": "c", "vehicle_count": 6}]
    engine = SimulationEngine(dataset(edges=[("ab", "a", "b", 100, 10), ("bc", "b", "c", 300, 10)], trips=trips))
    result = engine.simulate("closure", "ab")
    assert result["comparison"]["matched_trip_count"] == 1
    assert result["comparison"]["matched_vehicle_count"] == 6
    assert result["comparison"]["average_time_s"]["before"] == pytest.approx(result["before"]["trip_metrics"]["t2"]["time_s"])
    increased = engine.simulate("demand_increase", factor=1.4)
    assert increased["comparison"]["matched_vehicle_count"] == 8
    assert increased["after"]["edge_loads"]["ab"]["flow"] == pytest.approx(2.8)
    expected = sum(increased["after"]["trip_metrics"][t["trip_id"]]["time_s"] * t["vehicle_count"] for t in trips) / 8
    assert increased["comparison"]["average_time_s"]["after"] == pytest.approx(expected)


def test_zero_base_percent_is_null():
    assert SimulationEngine.delta(0, 4) == {"before": 0, "after": 4, "absolute": 4, "percent": None}


def test_capacity_reduction_keeps_road_open():
    engine = SimulationEngine(dataset())
    result = engine.simulate("capacity_reduction", "ab", .5)
    assert result["after"]["edge_loads"]["ab"]["capacity"] == 5
    assert result["after"]["edge_loads"]["ab"]["status"] == "open"
    assert result["closed_edge_ids"] == []


def test_forbidden_turn_is_avoided():
    data = dataset(restrictions=[{"from_edge_id": "ab", "to_edge_id": "bc"}])
    state = SimulationEngine(data).baseline
    assert state["trip_metrics"]["t1"]["edge_ids"] == ["ac"]


def test_runs_repeat_without_mutating_baseline():
    data = dataset()
    original = deepcopy(data)
    engine = SimulationEngine(data)
    baseline = deepcopy(engine.baseline)
    assert engine.simulate("closure", "ab") == engine.simulate("closure", "ab")
    assert engine.baseline == baseline
    assert data == original
    assert engine.graph.has_edge("a", "b", "ab")


@pytest.mark.parametrize("field,value", [("capacity", 0), ("length_m", -1), ("speed_kmh", 0)])
def test_invalid_edge_parameters_rejected(field, value):
    data = dataset()
    data["edges"][0][field] = value
    with pytest.raises(ValueError):
        validate_dataset(data)


def test_speed_fallback_from_config():
    data = dataset()
    data["edges"][0]["speed_kmh"] = None
    assert SimulationEngine(data).t0["ab"] == 10


def test_real_osm_demo_changes_routes_and_preserves_directions():
    data = json.loads((Path(__file__).resolve().parents[1] / "data/pervaya-rechka-v1.json").read_text(encoding="utf-8"))
    engine = SimulationEngine(data)
    result = engine.simulate("closure", data["presets"][0]["segment_id"])
    assert not data["is_test_network"]
    assert 8 <= len(data["trips"]) <= 15
    assert 20 <= sum(t["vehicle_count"] for t in data["trips"]) <= 50
    assert result["comparison"]["changed_trip_count"] > 0
    assert result["comparison"]["top_increased_edges"][0]["absolute"] > 0
    assert result["after"]["metrics"]["unreachable_trip_count"] == 0
    forbidden = {(t["from_edge_id"], t["to_edge_id"]) for t in data["turn_restrictions"]}
    for state in [result["before"], result["after"]]:
        for feature in state["routes"]["features"]:
            route = feature["properties"]["edge_ids"]
            for a, b in zip(route, route[1:]):
                assert engine.edges[a]["v"] == engine.edges[b]["u"]
                assert (a, b) not in forbidden
            if state is result["after"]:
                assert not (set(route) & set(result["closed_edge_ids"]))
            assert feature["properties"]["time_s"] == pytest.approx(sum(state["edge_loads"][e]["time_s"] for e in route))
