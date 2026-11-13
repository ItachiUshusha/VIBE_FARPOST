"""Одноразовый импорт автомобильной сети OSMnx. Сервер OSMnx не использует.

Запуск из корня: python scripts/prepare_data.py --radius 2200
Повторный экспорт: python scripts/prepare_data.py --graphml .local/pervaya-rechka.graphml
"""
import argparse
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import sys

import networkx as nx
import osmnx as ox

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.simulation import SimulationEngine

CENTER = (43.13272, 131.89965)  # Океанский проспект × проспект Острякова
CONFIG = {
    "alpha": 0.15, "beta": 4, "elevated_threshold": 0.7, "high_threshold": 1.0,
    "speeds": {"motorway": 60, "trunk": 60, "primary": 40, "secondary": 40, "tertiary": 30, "residential": 25, "unclassified": 25, "living_street": 20, "service": 15},
    "capacities": {"motorway": 18, "trunk": 16, "primary": 12, "secondary": 10, "tertiary": 8, "residential": 5, "unclassified": 5, "living_street": 3, "service": 3},
}


def first(value):
    return value[0] if isinstance(value, list) else value


def export_graph(graph, radius):
    nodes = [{"node_id": str(n), "lon": round(d["x"], 7), "lat": round(d["y"], 7)} for n, d in sorted(graph.nodes(data=True))]
    edges, groups = [], defaultdict(list)
    for u, v, key, d in sorted(graph.edges(keys=True, data=True)):
        highway = str(first(d.get("highway", "unclassified")))
        name = str(first(d.get("name", "Безымянный проезд")))
        coords = list(d["geometry"].coords) if "geometry" in d else [(graph.nodes[u]["x"], graph.nodes[u]["y"]), (graph.nodes[v]["x"], graph.nodes[v]["y"])]
        # Ensure geometry direction matches the directed edge, including reciprocal edges.
        if math.dist(coords[-1], (graph.nodes[u]["x"], graph.nodes[u]["y"])) < math.dist(coords[0], (graph.nodes[u]["x"], graph.nodes[u]["y"])):
            coords.reverse()
        coords = [[round(x, 7), round(y, 7)] for x, y in coords]
        canonical = min(str(coords), str(list(reversed(coords))))
        osmids = d.get("osmid", [])
        osmids = sorted(osmids) if isinstance(osmids, list) else [osmids]
        group_key = json.dumps([osmids, canonical])
        sid = "seg-" + hashlib.sha1(group_key.encode()).hexdigest()[:12]
        raw_speed = str(first(d.get("maxspeed", "")))
        numbers = re.findall(r"\d+", raw_speed)
        speed = min(80, max(10, float(numbers[0]))) if numbers else CONFIG["speeds"].get(highway.replace("_link", ""), 30)
        edge = {
            "edge_id": f"{u}:{v}:{key}", "u": str(u), "v": str(v), "key": int(key),
            "segment_id": sid, "name": name, "highway": highway,
            "length_m": round(float(d["length"]), 2), "speed_kmh": speed,
            "capacity": CONFIG["capacities"].get(highway.replace("_link", ""), 5),
            "geometry": {"type": "LineString", "coordinates": coords},
            "osmid": osmids, "oneway": bool(d.get("oneway", False)),
        }
        edges.append(edge)
        groups[sid].append(edge)
    segments = []
    directions = ["На восток", "На северо-восток", "На север", "На северо-запад", "На запад", "На юго-запад", "На юг", "На юго-восток"]
    for sid, group in sorted(groups.items()):
        e = group[0]
        start, end = e["geometry"]["coordinates"][0], e["geometry"]["coordinates"][-1]
        bearing = math.atan2(end[1] - start[1], (end[0] - start[0]) * math.cos(math.radians(CENTER[0])))
        direction = directions[round(bearing / (math.pi / 4)) % 8]
        can_close = e["length_m"] >= 8
        segments.append({"segment_id": sid, "edge_ids": [x["edge_id"] for x in group], "name": e["name"],
                         "length_m": e["length_m"], "speed_kmh": e["speed_kmh"], "can_close": can_close,
                         "direction": "Оба направления" if len(group) == 2 else direction,
                         "disabled_reason": None if can_close else "Соединительный участок короче 8 м. Выберите соседний сегмент.",
                         "geometry": e["geometry"]})
    return {"version": "pervaya-rechka-v1", "title": "Первая Речка · Владивосток", "center": [CENTER[1], CENTER[0]],
            "radius_m": radius, "source": "OpenStreetMap / OSMnx network_type=drive", "is_test_network": False,
            "imported_at": datetime.now(timezone.utc).isoformat(), "license": "ODbL 1.0 · © OpenStreetMap contributors",
            "config": CONFIG, "nodes": nodes, "edges": edges, "segments": segments, "trips": [], "presets": []}


def make_trips(data):
    graph = nx.MultiDiGraph()
    for e in data["edges"]:
        graph.add_edge(e["u"], e["v"], key=e["edge_id"])
    component = max(nx.strongly_connected_components(graph), key=len)
    major = {e["u"] for e in data["edges"] if e["highway"] in {"primary", "secondary", "tertiary"}} & component
    targets = [
        ("Океанский · юг", 43.1228, 131.8946), ("Острякова · север", 43.1424, 131.9080),
        ("Первореченская", 43.1380, 131.8932), ("Красного Знамени", 43.1300, 131.9116),
        ("Партизанский", 43.1270, 131.9055), ("Амурская", 43.1390, 131.8982),
    ]
    terminals = []
    for label, lat, lon in targets:
        node = min((n for n in data["nodes"] if n["node_id"] in major), key=lambda n: (n["lat"] - lat)**2 + ((n["lon"] - lon)*0.73)**2)
        terminals.append((label, node["node_id"]))
    pairs = [(0,1,4),(1,0,4),(2,4,3),(4,2,3),(3,0,4),(0,3,3),(5,0,3),(0,5,3),(1,4,3),(4,1,3),(2,3,3),(3,2,2)]
    for i, (a,b,count) in enumerate(pairs):
        data["trips"].append({"trip_id": f"trip-{i+1:02d}", "origin": terminals[a][1], "destination": terminals[b][1],
                              "vehicle_count": count, "origin_label": terminals[a][0], "destination_label": terminals[b][0],
                              "label": f"{terminals[a][0]} → {terminals[b][0]}"})
    data["terminals"] = [{"label": label, "node_id": node} for label, node in terminals]


def apply_turn_restrictions(data):
    source = ROOT / "backend/data/osm-restrictions.json"
    if not source.exists():
        data["turn_restrictions"] = []
        data["restriction_import"] = {"available": False, "note": "Сначала запустите scripts/prepare_context.py"}
        return
    relations = json.loads(source.read_text(encoding="utf-8"))
    pairs, used_relations = {}, set()
    unsupported = []
    for relation in relations:
        tags = relation.get("tags", {})
        if "motorcar" in tags.get("except", "").split(";"):
            continue
        restriction = tags.get("restriction:motorcar", tags.get("restriction", ""))
        members = relation.get("members", [])
        from_ways = [m["ref"] for m in members if m["role"] == "from" and m["type"] == "way"]
        to_ways = [m["ref"] for m in members if m["role"] == "to" and m["type"] == "way"]
        via_nodes = [str(m["ref"]) for m in members if m["role"] == "via" and m["type"] == "node"]
        if not restriction or len(from_ways) != 1 or len(to_ways) != 1 or len(via_nodes) != 1:
            unsupported.append(relation["id"])
            continue
        via = via_nodes[0]
        incoming = [e for e in data["edges"] if e["v"] == via and from_ways[0] in e["osmid"]]
        outgoing = [e for e in data["edges"] if e["u"] == via]
        for before in incoming:
            for after in outgoing:
                matching = to_ways[0] in after["osmid"]
                if from_ways == to_ways:
                    if restriction == "no_u_turn":
                        matching = matching and after["v"] == before["u"]
                    elif restriction in {"no_straight_on", "only_straight_on"}:
                        matching = matching and after["v"] != before["u"]
                blocked = matching if restriction.startswith("no_") else not matching if restriction.startswith("only_") else False
                if blocked:
                    key = (before["edge_id"], after["edge_id"])
                    pairs[key] = {"from_edge_id": key[0], "to_edge_id": key[1], "osm_relation_id": relation["id"], "restriction": restriction}
                    used_relations.add(relation["id"])
    data["turn_restrictions"] = [pairs[key] for key in sorted(pairs)]
    data["restriction_import"] = {"available": True, "relation_count": len(relations), "applied_relation_count": len(used_relations),
                                  "forbidden_transition_count": len(pairs), "unsupported_relation_ids": unsupported,
                                  "note": "Учтены безусловные no_*/only_* с одним via-node. Via-way и условные ограничения требуют отдельной проверки."}


def pick_demo(data):
    engine = SimulationEngine(data)
    candidates = []
    for segment in data["segments"]:
        if not segment["can_close"] or segment["name"] == "Безымянный проезд" or segment["length_m"] < 35:
            continue
        coords = segment["geometry"]["coordinates"]
        distance = min(math.hypot((xy[0] - CENTER[1])*81000, (xy[1] - CENTER[0])*111000) for xy in coords)
        if distance > 450 or not any(engine.baseline["edge_loads"][eid]["flow"] > 0 for eid in segment["edge_ids"]):
            continue
        result = engine.simulate("closure", segment["segment_id"])
        cmp = result["comparison"]
        if cmp["changed_trip_count"] > 0 and cmp["top_increased_edges"] and result["after"]["metrics"]["unreachable_trip_count"] == 0 and cmp["average_time_s"]["absolute"] > 1:
            score = cmp["changed_trip_count"] * 5 + min(cmp["average_time_s"]["percent"], 60) - distance / 50
            candidates.append((score, segment, cmp))
    if not candidates:
        raise RuntimeError("Нет подходящего демо с объездом. Расширьте граф или пересмотрите спрос.")
    _, segment, comparison = max(candidates, key=lambda c: c[0])
    data["presets"] = [{"preset_id": "pervaya-rechka-closure-v1", "dataset_version": data["version"], "name": "Одно перекрытие — новый город",
                        "description": f"Перекроем участок: {segment['name']}. Посмотрим, куда переместится поток.",
                        "scenario_type": "closure", "segment_id": segment["segment_id"], "parameters": {}}]
    data["demo_verification"] = {"segment_id": segment["segment_id"], "changed_trip_count": comparison["changed_trip_count"],
                                 "positive_growth_edges": len(comparison["top_increased_edges"]), "all_trips_reachable": True,
                                 "note": "Направления и ограничения via-node сохранены из OSM. Все итоговые маршруты проверяются на запрещённые переходы; условные и via-way ограничения не моделируются."}
    print(json.dumps({"demo": segment, "comparison": comparison}, ensure_ascii=False, indent=2))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--radius", type=int, default=2200)
    parser.add_argument("--graphml", type=Path)
    parser.add_argument("--output", type=Path, default=ROOT / "backend/data/pervaya-rechka-v1.json")
    args = parser.parse_args()
    (ROOT / ".local").mkdir(exist_ok=True)
    ox.settings.cache_folder = str(ROOT / ".local/osm-cache")
    ox.settings.requests_timeout = 100
    ox.settings.log_console = True
    if args.graphml:
        graph = ox.load_graphml(args.graphml)
    else:
        graph = ox.graph_from_point(CENTER, dist=args.radius, network_type="drive", simplify=True, truncate_by_edge=True)
        ox.save_graphml(graph, ROOT / ".local/pervaya-rechka.graphml")
    data = export_graph(graph, args.radius)
    make_trips(data)
    apply_turn_restrictions(data)
    pick_demo(data)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Saved {len(data['nodes'])} nodes, {len(data['edges'])} directed edges to {args.output}")


if __name__ == "__main__":
    main()
