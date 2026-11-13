"""Локальные здания/зелёные зоны и ограничения поворотов из OSM.

Геометрия контекста не участвует в расчёте. Сырой ответ кэшируется.
"""
import json
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parents[1]


def main():
    cache = ROOT / ".local/osm-context.json"
    if cache.exists():
        raw = json.loads(cache.read_text(encoding="utf-8"))
    else:
        bbox = "43.1129,131.8725,43.1526,131.9268"
        query = f'''[out:json][timeout:100];(
          way["building"]({bbox});way["leisure"="park"]({bbox});
          way["landuse"~"forest|grass|recreation_ground"]({bbox});
          way["natural"="water"]({bbox});
          relation["type"="restriction"]({bbox});
        );out geom;'''
        response = requests.get("https://overpass-api.de/api/interpreter", params={"data": query}, timeout=120,
                                headers={"User-Agent": "FarPost-Butterfly-MVP/1.0", "Accept": "application/json"})
        response.raise_for_status()
        raw = response.json()
        cache.parent.mkdir(exist_ok=True)
        cache.write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")
    features = []
    restrictions = []
    for element in raw["elements"]:
        tags = element.get("tags", {})
        if element["type"] == "relation":
            restrictions.append(element)
            continue
        geometry = element.get("geometry", [])
        if len(geometry) < 4 or geometry[0] != geometry[-1]:
            continue
        kind = "building" if "building" in tags else "water" if tags.get("natural") == "water" else "green"
        features.append({"type": "Feature", "properties": {"kind": kind, "name": tags.get("name", "")}, "geometry": {
            "type": "Polygon", "coordinates": [[[round(p["lon"], 7), round(p["lat"], 7)] for p in geometry]]}})
    target = ROOT / "frontend/public/context.geojson"
    target.write_text(json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (ROOT / "backend/data/osm-restrictions.json").write_text(json.dumps(restrictions, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Context: {len(features)} polygons; restrictions: {len(restrictions)} relations")


if __name__ == "__main__":
    main()
