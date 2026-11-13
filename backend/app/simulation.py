"""Детерминированное двухпроходное назначение потока на направленный мультиграф."""

from collections import defaultdict
from copy import deepcopy
import heapq
import math

import networkx as nx


def validate_dataset(data: dict) -> None:
    nodes = {str(n["node_id"]) for n in data["nodes"]}
    if len(nodes) != len(data["nodes"]):
        raise ValueError("Повторяющиеся идентификаторы узлов")
    edges = {e["edge_id"]: e for e in data["edges"]}
    if len(edges) != len(data["edges"]):
        raise ValueError("Повторяющиеся идентификаторы рёбер")
    triples = set()
    for e in edges.values():
        triple = (str(e["u"]), str(e["v"]), str(e["key"]))
        if triple in triples:
            raise ValueError("Повторяющийся ключ ребра мультиграфа")
        triples.add(triple)
        if str(e["u"]) not in nodes or str(e["v"]) not in nodes:
            raise ValueError("Ребро ссылается на неизвестный узел")
        for key in ("length_m", "capacity"):
            if not math.isfinite(e[key]) or e[key] <= 0:
                raise ValueError(f"Некорректное значение {key}")
        if e.get("speed_kmh") is not None and (not math.isfinite(e["speed_kmh"]) or e["speed_kmh"] <= 0):
            raise ValueError("Некорректная скорость")
        if e["geometry"]["type"] != "LineString" or len(e["geometry"]["coordinates"]) < 2:
            raise ValueError("Некорректная геометрия")
        for lon, lat in e["geometry"]["coordinates"]:
            if not -180 <= lon <= 180 or not -90 <= lat <= 90:
                raise ValueError("Геометрия должна быть в WGS84")
    segments = {s["segment_id"]: s for s in data["segments"]}
    if len(segments) != len(data["segments"]):
        raise ValueError("Повторяющиеся идентификаторы сегментов")
    for s in segments.values():
        if not s["edge_ids"] or any(e not in edges for e in s["edge_ids"]):
            raise ValueError("Сегмент ссылается на неизвестные рёбра")
        if any(edges[e].get("segment_id") != s["segment_id"] for e in s["edge_ids"]):
            raise ValueError("Несогласованная связь сегмента и ребра")
    for e in edges.values():
        if e.get("segment_id") not in segments or e["edge_id"] not in segments[e["segment_id"]]["edge_ids"]:
            raise ValueError("Ребро ссылается на неизвестный сегмент")
    trip_ids = set()
    for t in data["trips"]:
        if t["trip_id"] in trip_ids:
            raise ValueError("Повторяющийся идентификатор поездки")
        trip_ids.add(t["trip_id"])
        if str(t["origin"]) not in nodes or str(t["destination"]) not in nodes:
            raise ValueError("Поездка ссылается на неизвестный узел")
        if not math.isfinite(t["vehicle_count"]) or t["vehicle_count"] <= 0:
            raise ValueError("Некорректный вес поездки")
    for preset in data.get("presets", []):
        if preset["dataset_version"] != data["version"]:
            raise ValueError("Несовместимая версия сценария")
        if preset.get("segment_id") and preset["segment_id"] not in segments:
            raise ValueError("Сценарий ссылается на неизвестный сегмент")
    for turn in data.get("turn_restrictions", []):
        if turn["from_edge_id"] not in edges or turn["to_edge_id"] not in edges:
            raise ValueError("Ограничение манёвра ссылается на неизвестное ребро")
        if str(edges[turn["from_edge_id"]]["v"]) != str(edges[turn["to_edge_id"]]["u"]):
            raise ValueError("Несвязные рёбра в ограничении манёвра")


class SimulationEngine:
    def __init__(self, dataset: dict):
        validate_dataset(dataset)
        self.dataset = deepcopy(dataset)
        self.config = dataset["config"]
        self.edges = {e["edge_id"]: e for e in dataset["edges"]}
        self.segments = {s["segment_id"]: s for s in dataset["segments"]}
        self.graph = nx.MultiDiGraph()
        self.graph.add_nodes_from(str(n["node_id"]) for n in dataset["nodes"])
        for e in sorted(self.edges.values(), key=lambda e: e["edge_id"]):
            self.graph.add_edge(str(e["u"]), str(e["v"]), key=e["edge_id"], edge_id=e["edge_id"])
        self.t0 = {
            eid: e["length_m"] / ((e.get("speed_kmh") or self.config["speeds"].get(e["highway"], 30)) / 3.6)
            for eid, e in self.edges.items()
        }
        self.forbidden_turns = defaultdict(set)
        self.turn_nodes = set()
        for turn in dataset.get("turn_restrictions", []):
            self.forbidden_turns[turn["from_edge_id"]].add(turn["to_edge_id"])
            self.turn_nodes.add(str(self.edges[turn["from_edge_id"]]["v"]))
        self.baseline = self.state()

    def shortest_edges(self, origin: str, destination: str, costs: dict, closed: set) -> list[str] | None:
        """Dijkstra с порядком (стоимость, последовательность edge_id).

        В очереди хранится конкретный путь по рёбрам, поэтому параллельное
        ребро в результате совпадает с ребром, выбранным по весу.
        """
        origin, destination = str(origin), str(destination)
        queue = [(0.0, (), origin)]
        best = {(origin, ""): (0.0, ())}
        while queue:
            cost, route, node = heapq.heappop(queue)
            previous = route[-1] if route else ""
            state_key = (node, previous if node in self.turn_nodes else "")
            if best.get(state_key) != (cost, route):
                continue
            if node == destination:
                return list(route)
            for _, target, eid in sorted(self.graph.out_edges(node, keys=True), key=lambda item: item[2]):
                if eid in closed or eid in self.forbidden_turns.get(previous, set()):
                    continue
                candidate = (cost + costs[eid], route + (eid,))
                target_key = (target, eid if target in self.turn_nodes else "")
                if target_key not in best or candidate < best[target_key]:
                    best[target_key] = candidate
                    heapq.heappush(queue, (*candidate, target))
        return None

    def shortest_via(self, origin: str, targets: list[str], costs: dict, closed: set) -> list[str] | None:
        """Единый поиск через точки: входящее ребро не сбрасывается в точке «Через»."""
        origin, targets = str(origin), [str(t) for t in targets]

        def advance(node, index):
            while index < len(targets) and targets[index] == node:
                index += 1
            return index

        index = advance(origin, 0)
        queue = [(0.0, (), origin, index)]
        best = {(origin, "", index): (0.0, ())}
        while queue:
            cost, route, node, index = heapq.heappop(queue)
            previous = route[-1] if route else ""
            key = (node, previous if node in self.turn_nodes else "", index)
            if best.get(key) != (cost, route):
                continue
            if index == len(targets):
                return list(route)
            for _, target, eid in sorted(self.graph.out_edges(node, keys=True), key=lambda item: item[2]):
                if eid in closed or eid in self.forbidden_turns.get(previous, set()):
                    continue
                next_index = advance(target, index)
                candidate = (cost + costs[eid], route + (eid,))
                next_key = (target, eid if target in self.turn_nodes else "", next_index)
                if next_key not in best or candidate < best[next_key]:
                    best[next_key] = candidate
                    heapq.heappush(queue, (*candidate, target, next_index))
        return None

    def state(self, closed: set | None = None, capacity_factors: dict | None = None, demand_factor: float = 1,
              trips: list[dict] | None = None, weather_factor: float = 1, capacity_scale: float = 1) -> dict:
        closed = closed or set()
        capacity_factors = capacity_factors or {}
        if weather_factor <= 0 or capacity_scale <= 0:
            raise ValueError("Коэффициенты скорости и ёмкости должны быть положительными")
        trips = [t for t in (self.dataset["trips"] if trips is None else trips) if t["vehicle_count"] > 0]
        free_times = {eid: t / weather_factor for eid, t in self.t0.items()}

        def assign(costs):
            paths, flows = {}, defaultdict(float)
            for trip in sorted(trips, key=lambda t: t["trip_id"]):
                route = self.shortest_edges(trip["origin"], trip["destination"], costs, closed)
                paths[trip["trip_id"]] = route
                if route is not None:
                    for eid in route:
                        flows[eid] += trip["vehicle_count"] * demand_factor
            return paths, flows

        def edge_times(flows):
            return {
                eid: free_times[eid] * (1 + self.config["alpha"] * (
                    flows.get(eid, 0) / (e["capacity"] * capacity_scale * capacity_factors.get(eid, 1))
                ) ** self.config["beta"])
                for eid, e in self.edges.items()
            }

        _, first_flow = assign(free_times)
        paths, flow = assign(edge_times(first_flow))
        times = edge_times(flow)
        loads = {}
        for eid, e in sorted(self.edges.items()):
            capacity = e["capacity"] * capacity_scale * capacity_factors.get(eid, 1)
            ratio = flow.get(eid, 0) / capacity
            load_class = "low" if ratio < self.config["elevated_threshold"] else (
                "elevated" if ratio < self.config["high_threshold"] else "high"
            )
            loads[eid] = {
                "flow": flow.get(eid, 0), "capacity": capacity, "ratio": ratio,
                "load_class": load_class, "status": "closed" if eid in closed else "open",
                "time_s": times[eid],
            }
        routes, trip_metrics, unreachable = [], {}, []
        for trip in trips:
            tid, count = trip["trip_id"], trip["vehicle_count"] * demand_factor
            route = paths[tid]
            if route is None:
                unreachable.append({"trip_id": tid, "vehicle_count": count})
                continue
            time_s = sum(times[eid] for eid in route)
            length_m = sum(self.edges[eid]["length_m"] for eid in route)
            trip_metrics[tid] = {"time_s": time_s, "length_m": length_m, "vehicle_count": count, "edge_ids": route}
            coordinates = []
            for eid in route:
                coords = self.edges[eid]["geometry"]["coordinates"]
                coordinates.extend(coords if not coordinates else coords[1:])
            if len(coordinates) >= 2:
                routes.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": coordinates}, "properties": {
                    "trip_id": tid, "edge_ids": route, "vehicle_count": count,
                    "label": trip.get("label", tid), "time_s": time_s, "length_m": length_m,
                    "origin_label": trip.get("origin_label", "Начало"), "destination_label": trip.get("destination_label", "Конец"),
                }})
        available_weight = sum(m["vehicle_count"] for m in trip_metrics.values())
        return {
            "metrics": {
                "average_time_s": sum(m["time_s"] * m["vehicle_count"] for m in trip_metrics.values()) / available_weight if available_weight else None,
                "average_length_m": sum(m["length_m"] * m["vehicle_count"] for m in trip_metrics.values()) / available_weight if available_weight else None,
                "high_load_edges": sum(l["load_class"] == "high" and l["status"] != "closed" for l in loads.values()),
                "congested_road_count": len({self.edges[eid]["segment_id"] for eid, load in loads.items()
                                             if load["load_class"] == "high" and load["status"] != "closed"}),
                "unreachable_trip_count": len(unreachable),
                "unreachable_vehicle_count": sum(t["vehicle_count"] for t in unreachable),
                "trip_count": len(trips),
                "vehicle_count": math.fsum(t["vehicle_count"] for t in trips) * demand_factor,
            },
            "routes": {"type": "FeatureCollection", "features": routes},
            "edge_loads": loads, "unreachable_trips": unreachable, "trip_metrics": trip_metrics,
        }

    @staticmethod
    def delta(before, after):
        return {"before": before, "after": after,
                "absolute": after - before if before is not None and after is not None else None,
                "percent": (after - before) / before * 100 if before not in (None, 0) and after is not None else None}

    def simulate(self, scenario_type: str, segment_id: str | None = None, factor: float | None = None) -> dict:
        if scenario_type not in {"closure", "capacity_reduction", "demand_increase"}:
            raise ValueError("Неизвестный тип сценария")
        if scenario_type == "closure" and factor is not None:
            raise ValueError("Для перекрытия коэффициент не используется")
        if scenario_type == "capacity_reduction" and not 0 < (0.5 if factor is None else factor) < 1:
            raise ValueError("Некорректный коэффициент пропускной способности")
        if scenario_type == "demand_increase" and not 1 < (1.4 if factor is None else factor) <= 3:
            raise ValueError("Некорректный коэффициент спроса")
        segment = self.segments.get(segment_id) if segment_id else None
        if scenario_type != "demand_increase":
            if segment is None:
                raise KeyError("Участок дороги не найден")
            if not segment["can_close"]:
                raise ValueError(segment.get("disabled_reason") or "Изменение этого участка недоступно")
        edge_ids = segment["edge_ids"] if segment else []
        closed = set(edge_ids) if scenario_type == "closure" else set()
        factors = {eid: factor if factor is not None else 0.5 for eid in edge_ids} if scenario_type == "capacity_reduction" else {}
        demand = (factor if factor is not None else 1.4) if scenario_type == "demand_increase" else 1
        before = deepcopy(self.baseline)
        after = self.state(closed, factors, demand)
        weights = {t["trip_id"]: t["vehicle_count"] for t in self.dataset["trips"]}
        return {"dataset_version": self.dataset["version"], "closed_edge_ids": sorted(closed),
                "before": before, "after": after, "comparison": self.compare_states(before, after, weights, demand)}

    def compare_states(self, before: dict, after: dict, weights: dict, demand: float = 1) -> dict:
        matched = sorted(tid for tid in set(before["trip_metrics"]) & set(after["trip_metrics"]) if weights.get(tid, 0) > 0)
        matched_weight = sum(weights[tid] for tid in matched)

        def mean(state, key):
            return sum(state["trip_metrics"][tid][key] * weights[tid] for tid in matched) / matched_weight if matched_weight else None

        growth = []
        for eid, e in self.edges.items():
            before_load = before["edge_loads"].get(eid, {"flow": 0, "ratio": 0})
            after_load = after["edge_loads"].get(eid, {"flow": 0, "ratio": 0})
            change = self.delta(before_load["flow"], after_load["flow"])
            if change["absolute"] > 0:
                growth.append({"edge_id": eid, "segment_id": e["segment_id"], "name": e["name"], **change,
                               "ratio_before": before_load["ratio"], "ratio_after": after_load["ratio"]})
        growth.sort(key=lambda e: (-e["absolute"], e["edge_id"]))
        changed = [tid for tid in matched if before["trip_metrics"][tid]["edge_ids"] != after["trip_metrics"][tid]["edge_ids"]]
        comparison = {
            "matched_trip_count": len(matched), "matched_vehicle_count": matched_weight,
            "changed_trip_ids": changed, "changed_trip_count": len(changed),
            "average_time_s": self.delta(mean(before, "time_s"), mean(after, "time_s")),
            "average_length_m": self.delta(mean(before, "length_m"), mean(after, "length_m")),
            "high_load_edges": self.delta(before["metrics"]["high_load_edges"], after["metrics"]["high_load_edges"]),
            "congested_road_count": self.delta(before["metrics"].get("congested_road_count", before["metrics"]["high_load_edges"]),
                                                after["metrics"].get("congested_road_count", after["metrics"]["high_load_edges"])),
            "unreachable_trip_count": self.delta(before["metrics"]["unreachable_trip_count"], after["metrics"]["unreachable_trip_count"]),
            "unreachable_vehicle_count": self.delta(before["metrics"]["unreachable_vehicle_count"], after["metrics"]["unreachable_vehicle_count"]),
            "top_increased_edges": growth[:3], "demand_factor": demand,
        }
        return comparison
