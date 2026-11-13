"""Одноразовая подготовка локальных парковок и моделируемого жилого дома."""
import json
import math
import argparse
from datetime import datetime, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]


def distance(a, b):
    return math.hypot((a[0] - b[0]) * 81000, (a[1] - b[1]) * 111000)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--refresh", action="store_true", help="Заново получить парковки OpenStreetMap")
    args = parser.parse_args()
    data = json.loads((ROOT / "backend/data/pervaya-rechka-v1.json").read_text(encoding="utf-8"))
    nodes = {n["node_id"]: n for n in data["nodes"]}
    incoming = {e["v"] for e in data["edges"]}
    outgoing = {e["u"] for e in data["edges"]}

    def nearest(coords, allowed):
        return min((n for n in nodes.values() if n["node_id"] in allowed), key=lambda n: (distance(coords, [n["lon"], n["lat"]]), n["node_id"]))

    cache = ROOT / ".local/osm-parkings-region-v2.json"
    query = ('[out:json][timeout:60];nwr["amenity"="parking"]'
             f'({min(n["lat"] for n in nodes.values()) - .0045},'
             f'{min(n["lon"] for n in nodes.values()) - .0062},'
             f'{max(n["lat"] for n in nodes.values()) + .0045},'
             f'{max(n["lon"] for n in nodes.values()) + .0062});out center tags;')
    if cache.exists() and not args.refresh:
        raw = json.loads(cache.read_text(encoding="utf-8"))
    else:
        response = requests.get("https://overpass-api.de/api/interpreter", params={"data": query}, timeout=85,
                                headers={"User-Agent": "FarPost-Butterfly-MVP/1.0", "Accept": "application/json"})
        response.raise_for_status()
        raw = response.json()
        cache.write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")
    parkings = []
    for item in raw["elements"]:
        tags = item.get("tags", {})
        if tags.get("amenity") != "parking" or tags.get("access") in {"private", "no", "permit"}:
            continue
        position = item.get("center", item)
        coords = [position["lon"], position["lat"]]
        node = nearest(coords, incoming)
        snap_m = distance(coords, [node["lon"], node["lat"]])
        if snap_m > 150:
            continue
        capacity = tags.get("capacity", "")
        parkings.append({"parking_id": f"osm-{item['type']}-{item['id']}",
                         "name": tags.get("name", tags.get("operator", "Парковка OSM")), "coordinates": coords,
                         "entry_node_id": node["node_id"], "entry_snap_distance_m": round(snap_m, 1),
                         "source": "OpenStreetMap", "source_id": f"{item['type']}/{item['id']}",
                         "source_url": f"https://www.openstreetmap.org/{item['type']}/{item['id']}",
                         "source_tags": tags, "name_is_generated": not bool(tags.get("name") or tags.get("operator")),
                         "is_demo": False, "baseline_occupancy_percent": 50,
                         "capacity": int(capacity) if str(capacity).isdigit() else None})
    parkings.sort(key=lambda p: (distance(p["coordinates"], data["center"]), p["parking_id"]))
    for index, parking in enumerate(parkings):
        if parking["name"] == "Парковка OSM":
            street = next((e["name"] for e in data["edges"] if (e["u"] == parking["entry_node_id"] or e["v"] == parking["entry_node_id"]) and e["name"] != "Безымянный проезд"), "У дороги")
            parking["name"] = f"{street} · парковка {index+1:02d}"
    raw_context = json.loads((ROOT / ".local/osm-context.json").read_text(encoding="utf-8"))
    trip = next(t for t in data["trips"] if t["trip_id"] == "trip-07")
    origin = nodes[trip["origin"]]
    buildings = []
    for item in raw_context["elements"]:
        if item.get("tags", {}).get("building") not in {"apartments", "residential", "house"} or not item.get("geometry"):
            continue
        ring = item["geometry"][:-1]
        if not ring:
            continue
        coords = [sum(p["lon"] for p in ring) / len(ring), sum(p["lat"] for p in ring) / len(ring)]
        buildings.append((distance(coords, [origin["lon"], origin["lat"]]), item, coords))
    gap, building, coords = min(buildings, key=lambda b: b[0])
    if gap > 150:
        raise ValueError("Нет жилого дома рядом с исходной поездкой")
    tags = building["tags"]
    address = " ".join(filter(None, [tags.get("addr:street"), tags.get("addr:housenumber")]))
    house = {"house_id": f"osm-way-{building['id']}", "name": address or "Жилой дом у Хабаровской",
             "coordinates": coords, "exit_node_id": trip["origin"], "residents": 20,
             "origin_trip_id": trip["trip_id"], "source_vehicle_count": 1,
             "source": "OpenStreetMap", "source_id": f"way/{building['id']}",
             "geometry": {"type": "Polygon", "coordinates": [[[p["lon"], p["lat"]] for p in building["geometry"]]]}}
    terminals = [{"terminal_id": f"terminal-{i+1:02d}", "label": t["label"], "node_id": t["node_id"],
                  "coordinates": [nodes[t["node_id"]]["lon"], nodes[t["node_id"]]["lat"]]} for i, t in enumerate(data["terminals"])]
    catalogs = {"dataset_version": data["version"], "catalog_version": "city-scenarios-v2", "parkings": parkings,
                "parking_source": {"name": "OpenStreetMap", "query": query,
                                   "osm_timestamp": raw.get("osm3s", {}).get("timestamp_osm_base"),
                                   "prepared_at": datetime.now(timezone.utc).isoformat(), "raw_count": len(raw["elements"])},
                "houses": [house], "terminals": terminals,
                "config": {"snap_radius_m": 150, "parking_radius_m": 500, "walking_speed_kmh": 4.5,
                           "parking_search_base_s": 60, "parking_search_max_s": 900, "k_auto": 1,
                           "weather_factors": {"dry": 1, "rain": .85, "snow": .7},
                           "default_vehicle_count": 1000, "reference_vehicle_count": 1000,
                           "min_vehicle_count": house["residents"], "max_vehicle_count": 10000},
                "demo_personal_route": {"origin": {"lon": nodes['4712930411']["lon"], "lat": nodes['4712930411']["lat"]},
                                        "destination": {"lon": 131.89965, "lat": 43.13272}, "via": [], "parking_mode": "auto"}}
    target = ROOT / "backend/data/scenario-catalog-v1.json"
    target.write_text(json.dumps(catalogs, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"parkings": len(parkings), "raw_parkings": len(raw["elements"]),
                      "osm_timestamp": catalogs["parking_source"]["osm_timestamp"],
                      "house_id": house["house_id"], "residents": house["residents"], "k_auto": 1}, ensure_ascii=False))


if __name__ == "__main__":
    main()
