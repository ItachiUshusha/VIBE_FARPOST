"""Извлечь сохранённые в GraphML сведения OSM о полосах без загрузки сети."""
import ast
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
NS = {"g": "http://graphml.graphdrawing.org/xmlns"}


def lane_values(raw):
    try:
        value = ast.literal_eval(raw)
    except (ValueError, SyntaxError):
        value = raw
    values = value if isinstance(value, (list, tuple)) else [value]
    return sorted({int(str(n).strip()) for value in values for n in re.split(r"[;|]", str(value))
                   if re.fullmatch(r"\d+", str(n).strip()) and 0 < int(str(n).strip()) <= 30})


def main():
    root = ET.parse(ROOT / ".local/pervaya-rechka.graphml").getroot()
    keys = {key.attrib["id"]: key.attrib.get("attr.name") for key in root.findall("g:key", NS)}
    details = {}
    for edge in root.findall("g:graph/g:edge", NS):
        fields = {keys[item.attrib["key"]]: item.text for item in edge}
        values = lane_values(fields.get("lanes") or "")
        if values:
            edge_id = f"{edge.attrib['source']}:{edge.attrib['target']}:{edge.attrib.get('id', '0')}"
            details[edge_id] = {"lane_count": values[0] if len(values) == 1 else None,
                                "lane_min": min(values), "lane_max": max(values), "lanes_raw": fields["lanes"],
                                "lanes_source": "OpenStreetMap"}
    output = {"dataset_version": "pervaya-rechka-v1", "source": "OpenStreetMap / сохранённая выгрузка OSMnx",
              "edges": details}
    (ROOT / "backend/data/road-details-v1.json").write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Сохранены сведения о полосах для {len(details)} направлений дорог.")


if __name__ == "__main__":
    main()
