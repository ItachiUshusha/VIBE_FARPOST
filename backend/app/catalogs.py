import json
from pathlib import Path


CATALOG_PATH = Path(__file__).resolve().parents[1] / "data/scenario-catalog-v1.json"
ROAD_DETAILS_PATH = CATALOG_PATH.with_name("road-details-v1.json")


def attach_catalogs(data):
    if ROAD_DETAILS_PATH.exists():
        road_details = json.loads(ROAD_DETAILS_PATH.read_text(encoding="utf-8"))
        if road_details["dataset_version"] == data["version"]:
            for edge in data["edges"]:
                edge.update(road_details["edges"].get(edge["edge_id"], {}))
            edges = {edge["edge_id"]: edge for edge in data["edges"]}
            for segment in data["segments"]:
                entries = [edges[eid] for eid in segment["edge_ids"]]
                known = [edge for edge in entries if edge.get("lane_min")]
                if known and len(known) == len(entries):
                    low, high = min(edge["lane_min"] for edge in known), max(edge["lane_max"] for edge in known)
                    segment.update(lane_count=low if low == high else None, lane_min=low, lane_max=high,
                                   lanes_source="OpenStreetMap")
                segment["oneway"] = all(edge.get("oneway", False) for edge in entries)
    if not CATALOG_PATH.exists():
        return data
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    if catalog["dataset_version"] == data["version"]:
        data["catalogs"] = catalog
    return data
