"""Пользовательские дороги существуют только в графе конкретного расчёта."""
from copy import copy, deepcopy
import math

from .geo import distance_m


def add_scenario_roads(service, roads):
    if not roads:
        return service.engine, []
    if len(roads) > 5 or len({road["road_id"] for road in roads}) != len(roads):
        raise ValueError("Добавьте не более пяти разных дорог.")
    engine = copy(service.engine)
    engine.edges = dict(service.engine.edges)
    engine.segments = dict(service.engine.segments)
    engine.graph = service.engine.graph.copy()
    engine.t0 = dict(service.engine.t0)
    snapshots = []
    for road in roads:
        points = road["points"]
        if not 2 <= len(points) <= 12:
            raise ValueError("У новой дороги должно быть от 2 до 12 точек.")
        start = service.snap(points[0], "via", "начала новой дороги")
        end = service.snap(points[-1], "via", "конца новой дороги")
        if start["node_id"] == end["node_id"]:
            raise ValueError("Начало и конец новой дороги должны соединять разные перекрёстки.")
        coordinates = [start["coordinates"], *[[p["lon"], p["lat"]] for p in points[1:-1]], end["coordinates"]]
        coordinates = [point for index, point in enumerate(coordinates) if not index or point != coordinates[index - 1]]
        length = math.fsum(distance_m(a, b) for a, b in zip(coordinates, coordinates[1:]))
        if not 10 <= length <= 10000:
            raise ValueError("Длина новой дороги должна быть от 10 м до 10 км.")
        segment_id = "new-" + road["road_id"]
        if segment_id in engine.segments:
            raise ValueError("Название новой дороги уже используется в расчёте.")
        edge_ids = []
        directions = [(start["node_id"], end["node_id"], coordinates)]
        if road["two_way"]:
            directions.append((end["node_id"], start["node_id"], list(reversed(coordinates))))
        for index, (origin, destination, geometry) in enumerate(directions):
            edge_id = f"{segment_id}:{index}"
            edge = {"edge_id": edge_id, "segment_id": segment_id, "u": origin, "v": destination,
                    "key": edge_id, "name": road["name"], "highway": "residential", "length_m": length,
                    "speed_kmh": road["speed_kmh"], "capacity": engine.config.get("capacities", {}).get("residential", 5) * road["lanes"],
                    "geometry": {"type": "LineString", "coordinates": deepcopy(geometry)},
                    "oneway": not road["two_way"], "source": "Пользовательский сценарий", "road_id": road["road_id"]}
            engine.edges[edge_id] = edge
            engine.graph.add_edge(origin, destination, key=edge_id, edge_id=edge_id)
            engine.t0[edge_id] = length / (road["speed_kmh"] / 3.6)
            edge_ids.append(edge_id)
        snapshot = {**deepcopy(road), "length_m": length, "edge_ids": edge_ids, "segment_id": segment_id,
                    "geometry": {"type": "LineString", "coordinates": deepcopy(coordinates)},
                    "connections": {"start": start, "end": end}, "source": "Пользовательский сценарий"}
        engine.segments[segment_id] = {**snapshot, "can_close": True}
        snapshots.append(snapshot)
    return engine, snapshots
