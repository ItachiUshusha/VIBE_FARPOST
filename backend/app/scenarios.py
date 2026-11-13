"""Составные сценарии поверх исходного двухпроходного назначения потока."""
from collections import OrderedDict, defaultdict
from copy import deepcopy
import math
from threading import RLock
from .geo import distance_m
from .roads import add_scenario_roads

DEFAULT_CONFIG = {
    "snap_radius_m": 150, "parking_radius_m": 500, "walking_speed_kmh": 4.5,
    "parking_search_base_s": 60, "parking_search_max_s": 900, "k_auto": 1,
    "weather_factors": {"dry": 1, "rain": .85, "snow": .7},
    "default_vehicle_count": 1000, "reference_vehicle_count": 1000,
    "min_vehicle_count": 1, "max_vehicle_count": 10000,
}


def search_time(occupancy_percent, config):
    p = occupancy_percent / 100
    return None if p >= 1 else min(config["parking_search_max_s"], config["parking_search_base_s"] * p / (1 - p))


class ScenarioService:
    def __init__(self, engine):
        self.engine = engine
        self.catalogs = deepcopy(engine.dataset.get("catalogs", {"dataset_version": engine.dataset["version"],
            "catalog_version": "empty", "config": DEFAULT_CONFIG, "houses": [], "parkings": [], "terminals": []}))
        self.config = {**DEFAULT_CONFIG, **self.catalogs["config"]}
        self.catalogs["config"] = self.config
        self.nodes = {str(n["node_id"]): n for n in engine.dataset["nodes"]}
        self.parkings = {p["parking_id"]: p for p in self.catalogs["parkings"]}
        self.houses = {h["house_id"]: h for h in self.catalogs["houses"]}
        self.terminals = {t["terminal_id"]: t for t in self.catalogs["terminals"]}
        self.source_trips = {t["trip_id"]: t for t in engine.dataset["trips"]}
        self.source_count = math.fsum(t["vehicle_count"] for t in self.source_trips.values())
        self.house_weights = defaultdict(float)
        source_house_weights = defaultdict(float)
        self.validate_catalogs()
        for house in self.houses.values():
            self.house_weights[house["origin_trip_id"]] += house["residents"] * self.config["k_auto"]
            # Доля дома в старой калибровке отделена от текущего правила «1 житель = 1 авто».
            source_house_weights[house["origin_trip_id"]] += house.get("source_vehicle_count", house["residents"] * self.config["k_auto"])
        self.background_weights = {tid: t["vehicle_count"] - source_house_weights[tid] for tid, t in self.source_trips.items()}
        if any(weight < -1e-10 for weight in self.background_weights.values()):
            raise ValueError("Вклад домов превышает исходный спрос поездки")
        self.config["min_vehicle_count"] = max(self.config["min_vehicle_count"], math.ceil(math.fsum(self.house_weights.values())))
        self._baseline_cache = OrderedDict()
        self._cache_lock = RLock()

    def validate_catalogs(self):
        if self.catalogs["dataset_version"] != self.engine.dataset["version"]:
            raise ValueError("Каталоги относятся к другой дорожной версии")
        for key in ["snap_radius_m", "parking_radius_m", "walking_speed_kmh", "parking_search_base_s", "parking_search_max_s", "k_auto", "reference_vehicle_count"]:
            if not math.isfinite(self.config[key]) or self.config[key] <= 0:
                raise ValueError(f"Некорректный параметр модели {key}")
        if self.config["weather_factors"].get("dry") != 1 or any(not 0 < self.config["weather_factors"].get(w, 0) <= 1 for w in ["dry", "rain", "snow"]):
            raise ValueError("Некорректные коэффициенты погоды")
        for item in [*self.parkings.values(), *self.houses.values(), *self.terminals.values()]:
            lon, lat = item["coordinates"]
            if not -180 <= lon <= 180 or not -85 <= lat <= 85:
                raise ValueError("Координаты каталога должны быть в WGS84")
        for name, items, lookup in [("парковок", self.catalogs["parkings"], self.parkings),
                                    ("домов", self.catalogs["houses"], self.houses),
                                    ("терминалов", self.catalogs["terminals"], self.terminals)]:
            if len(items) != len(lookup):
                raise ValueError(f"Повторяющиеся ID {name}")
        for p in self.parkings.values():
            if p["entry_node_id"] not in self.nodes or not self.engine.graph.in_degree(p["entry_node_id"]):
                raise ValueError("У парковки нет допустимого узла въезда")
            if not 0 <= p["baseline_occupancy_percent"] <= 100:
                raise ValueError("Некорректная исходная занятость парковки")
        for t in self.terminals.values():
            if t["node_id"] not in self.nodes or not self.engine.graph.in_degree(t["node_id"]):
                raise ValueError("Неизвестный или недоступный терминал")
        for house in self.houses.values():
            trip = self.source_trips.get(house["origin_trip_id"])
            if not trip or house["exit_node_id"] != trip["origin"] or house["exit_node_id"] not in self.nodes:
                raise ValueError("Дом не связан с исходной поездкой того же узла")
            if type(house["residents"]) is not int or house["residents"] <= 0:
                raise ValueError("Некорректное число жильцов")
            if "source_vehicle_count" in house and (not math.isfinite(house["source_vehicle_count"]) or house["source_vehicle_count"] < 0):
                raise ValueError("Некорректная исходная доля дома")

    def snap(self, point, role, label):
        coords = [point["lon"], point["lat"]]
        eligible = []
        for nid, node in self.nodes.items():
            outgoing = self.engine.graph.out_degree(nid) > 0
            incoming = self.engine.graph.in_degree(nid) > 0
            if (role == "origin" and outgoing) or (role == "destination" and incoming) or (role == "via" and incoming and outgoing):
                eligible.append((distance_m(coords, [node["lon"], node["lat"]]), nid, node))
        if not eligible:
            raise ValueError(f"Для точки {label} нет подходящего дорожного узла.")
        gap, nid, node = min(eligible, key=lambda n: (n[0], n[1]))
        if gap > self.config["snap_radius_m"]:
            raise ValueError(f"Точка {label} дальше {self.config['snap_radius_m']:g} м от подходящей дороги. Поставьте её ближе к дороге.")
        return {"label": label, "node_id": nid, "requested": point,
                "coordinates": [node["lon"], node["lat"]], "distance_m": gap}

    def base_trips(self, vehicle_count=None):
        house_total = math.fsum(self.house_weights.values())
        background_total = math.fsum(self.background_weights.values())
        target = self.source_count if vehicle_count is None else vehicle_count
        if not math.isfinite(target) or not self.config["min_vehicle_count"] <= target <= self.config["max_vehicle_count"]:
            raise ValueError("Количество автомобилей вне допустимого диапазона")
        if target < house_total:
            raise ValueError(f"Количество авто не может быть меньше вклада существующих домов ({house_total:g}).")
        if not background_total and target != house_total:
            raise ValueError("Невозможно масштабировать набор без фонового спроса")
        scale = (target - house_total) / background_total if background_total else 1
        trips = [{**deepcopy(t), "vehicle_count": self.background_weights[tid] * scale + self.house_weights[tid]}
                 for tid, t in self.source_trips.items()]
        # Исправляем только машинную погрешность суммы, сохраняя точный выбранный общий спрос.
        adjustable = next((t for t in reversed(trips) if self.background_weights[t["trip_id"]] > 0), None)
        if adjustable:
            adjustable["vehicle_count"] += target - math.fsum(t["vehicle_count"] for t in trips)
        return trips, scale

    def capacity_scale(self, vehicle_count):
        # Ёмкость фиксирована относительно опорного спроса, а не подгоняется под выбранное N.
        return self.config["reference_vehicle_count"] / self.source_count if vehicle_count is not None else 1

    def baseline(self, vehicle_count=None):
        with self._cache_lock:
            cached = self._baseline_cache.get(vehicle_count)
            if cached is not None:
                self._baseline_cache.move_to_end(vehicle_count)
                return deepcopy(cached)
        trips, _ = self.base_trips(vehicle_count)
        state = self.engine.state(trips=trips, capacity_scale=self.capacity_scale(vehicle_count))
        with self._cache_lock:
            self._baseline_cache[vehicle_count] = state
            if len(self._baseline_cache) > 16:
                self._baseline_cache.popitem(last=False)
        return deepcopy(state)

    def simulate(self, payload):
        vehicle_count = payload.get("vehicle_count")
        before_trips, background_scale = self.base_trips(vehicle_count)
        after_trips = deepcopy(before_trips)
        after_lookup = {t["trip_id"]: t for t in after_trips}
        housing = payload.get("housing") or {"add": [], "remove": []}
        if len(set(housing["remove"])) != len(housing["remove"]):
            raise ValueError("Один дом указан несколько раз")
        removed = []
        for hid in housing["remove"]:
            if hid not in self.houses:
                raise ValueError("Дом для удаления не найден в каталоге")
            house = self.houses[hid]
            weight = house["residents"] * self.config["k_auto"]
            trip = after_lookup[house["origin_trip_id"]]
            trip["vehicle_count"] = max(0, trip["vehicle_count"] - weight)
            removed.append({**house, "vehicle_count": weight})
        additions, added_ids = [], set()
        for new in housing["add"]:
            hid = new["house_id"]
            if hid in self.houses or hid in added_ids:
                raise ValueError("ID нового дома уже используется")
            added_ids.add(hid)
            terminal = self.terminals.get(new["terminal_id"])
            if terminal is None:
                raise ValueError("Выберите существующий пункт назначения дома")
            snapped = self.snap(new["coordinates"], "origin", "выезда нового дома")
            weight = new["residents"] * self.config["k_auto"]
            house = {**new, "name": f"Новый дом · {new['residents']} жителей", "coordinates": [new["coordinates"]["lon"], new["coordinates"]["lat"]],
                     "exit_node_id": snapped["node_id"], "snap": snapped, "vehicle_count": weight, "source": "Точка пользователя"}
            additions.append(house)
            after_trips.append({"trip_id": "house-" + hid, "origin": snapped["node_id"], "destination": terminal["node_id"],
                                "vehicle_count": weight, "origin_label": house["name"], "destination_label": terminal["label"],
                                "label": f"{house['name']} → {terminal['label']}"})
        overrides = payload.get("parking_occupancy", {})
        if set(overrides) - self.parkings.keys():
            raise ValueError("Настройки занятости содержат неизвестную парковку")
        before_occupancy = {pid: p["baseline_occupancy_percent"] for pid, p in self.parkings.items()}
        after_occupancy = {**before_occupancy, **overrides}
        weather = payload.get("weather", "dry")
        if weather not in self.config["weather_factors"]:
            raise ValueError("Неизвестная погода")
        road = payload.get("road_change")
        demand = payload.get("demand_factor", 1)
        if payload["scenario_type"] in {"closure", "capacity_reduction"}:
            road = {"scenario_type": payload["scenario_type"], "segment_id": payload["segment_id"], "factor": payload.get("factor")}
        elif payload["scenario_type"] == "demand_increase":
            demand = payload.get("factor") or 1.4
        closed, capacities = set(), {}
        if road:
            segment = self.engine.segments.get(road["segment_id"])
            if segment is None:
                raise KeyError("Неизвестный участок")
            if not segment["can_close"]:
                raise ValueError(segment.get("disabled_reason") or "Изменение этого участка недоступно")
            if road["scenario_type"] == "closure":
                closed = set(segment["edge_ids"])
            else:
                capacities = {eid: road.get("factor") or .5 for eid in segment["edge_ids"]}
        request = payload.get("personal_route")
        anchors = self.prepare_anchors(request) if request else None
        if request and request.get("parking_id") and request["parking_id"] not in self.parkings:
            raise ValueError("Выбранная парковка не найдена в каталоге")
        before = self.baseline(vehicle_count)
        capacity_scale = self.capacity_scale(vehicle_count)
        after_engine, added_roads = add_scenario_roads(self, payload.get("added_roads", []))
        after = after_engine.state(closed=closed, capacity_factors=capacities, demand_factor=demand,
                                  trips=after_trips, weather_factor=self.config["weather_factors"][weather], capacity_scale=capacity_scale)
        comparison = after_engine.compare_states(before, after, {t["trip_id"]: t["vehicle_count"] for t in before_trips}, demand)
        removed_weights = defaultdict(float)
        for house in removed:
            removed_weights[house["origin_trip_id"]] += house["vehicle_count"]
        trip_demand = [{"trip_id": t["trip_id"],
                        "background_before": self.background_weights[t["trip_id"]] * background_scale,
                        "houses_before": self.house_weights[t["trip_id"]],
                        "background_after": self.background_weights[t["trip_id"]] * background_scale,
                        "houses_after": self.house_weights[t["trip_id"]] - removed_weights[t["trip_id"]],
                        "before_weight": t["vehicle_count"], "after_weight": after_lookup[t["trip_id"]]["vehicle_count"] * demand}
                       for t in before_trips]
        for house in additions:
            trip_demand.append({"trip_id": "house-" + house["house_id"], "background_before": 0, "houses_before": 0,
                                "background_after": 0, "houses_after": house["vehicle_count"],
                                "before_weight": 0, "after_weight": house["vehicle_count"] * demand})
        personal = None
        if request:
            personal_before = self.personal_phase(request, anchors, before, set(), before_occupancy)
            personal_after = self.personal_phase(request, anchors, after, closed, after_occupancy, engine=after_engine)
            comparable = personal_before["parking_included"] == personal_after["parking_included"]
            personal_delta = self.engine.delta(personal_before["total_time_s"], personal_after["total_time_s"])
            if not comparable:
                personal_delta.update(absolute=None, percent=None)
            personal = {"request": request, "snapped_points": anchors, "before": personal_before, "after": personal_after,
                        "comparison": personal_delta,
                        "comparison_note": None if comparable else "В одном варианте учтены парковка и пеший путь, в другом — только поездка до Б. Эти времена нельзя сравнить напрямую.",
                        "vehicle_count": 0}
        applied = {"vehicle_count_requested": vehicle_count, "source_vehicle_count": self.source_count,
                   "vehicle_count_before": before["metrics"]["vehicle_count"], "vehicle_count_after": after["metrics"]["vehicle_count"],
                   "reference_vehicle_count": self.config["reference_vehicle_count"], "capacity_scale": capacity_scale,
                   "background_scale": background_scale, "demand_factor": demand, "road_change": road,
                   "weather_before": "dry", "weather_after": weather, "weather_factor_before": self.config["weather_factors"]["dry"],
                   "weather_factor_after": self.config["weather_factors"][weather], "k_auto": self.config["k_auto"],
                   "alpha": self.engine.config["alpha"], "beta": self.engine.config["beta"],
                   "elevated_threshold": self.engine.config["elevated_threshold"], "high_threshold": self.engine.config["high_threshold"],
                   "walking_speed_kmh": self.config["walking_speed_kmh"], "snap_radius_m": self.config["snap_radius_m"],
                   "parking_radius_m": self.config["parking_radius_m"], "parking_search_base_s": self.config["parking_search_base_s"],
                   "parking_search_max_s": self.config["parking_search_max_s"],
                   "parking_occupancy_before": before_occupancy, "parking_occupancy_after": after_occupancy}
        return {"dataset_version": self.engine.dataset["version"], "catalog_version": self.catalogs["catalog_version"],
                "closed_edge_ids": sorted(closed), "before": before, "after": after, "comparison": comparison,
                "personal_route": personal, "house_changes": {"added": additions, "removed": removed}, "applied_settings": applied,
                "trip_demand": trip_demand, "added_roads": added_roads}

    def prepare_anchors(self, request):
        anchors = {"origin": self.snap(request["origin"], "origin", "А"),
                   "via": [self.snap(p, "via", f"Через {i+1}") for i, p in enumerate(request.get("via", []))],
                   "destination": None}
        try:
            anchors["destination"] = self.snap(request["destination"], "destination", "Б")
        except ValueError as exc:
            if request.get("parking_mode", "none") == "none":
                raise
            anchors["destination_error"] = str(exc)
        return anchors

    def route_feature(self, edge_ids, origin_id, engine=None):
        engine = engine or self.engine
        coordinates = []
        for eid in edge_ids:
            geometry = engine.edges[eid]["geometry"]["coordinates"]
            coordinates.extend(geometry if not coordinates else geometry[1:])
        if not coordinates:
            n = self.nodes[origin_id]
            coordinates = [[n["lon"], n["lat"]], [n["lon"], n["lat"]]]
        return {"type": "Feature", "properties": {"edge_ids": edge_ids, "vehicle_count": 0, "trip_id": "personal"},
                "geometry": {"type": "LineString", "coordinates": coordinates}}

    def personal_phase(self, request, anchors, state, closed, occupancy, engine=None):
        engine = engine or self.engine
        empty = {"status": "unreachable", "message": "Маршрут недоступен. Измените точки или условия.",
                 "total_time_s": None, "drive_time_s": None, "search_time_s": None, "walk_time_s": None,
                 "length_m": None, "walk_distance_m": None, "edge_ids": [], "car_route": None, "walk_route": None,
                 "parking": None, "alternatives": [], "parking_included": False,
                 "parking_status": "not_requested", "parking_message": None}
        origin = anchors["origin"]["node_id"]
        via = [p["node_id"] for p in anchors["via"]]
        costs = {eid: load["time_s"] for eid, load in state["edge_loads"].items()}

        def drive(destination):
            edges = engine.shortest_via(origin, via + [destination], costs, closed)
            if edges is None:
                return None
            return {"edge_ids": edges, "drive_time_s": math.fsum(costs[e] for e in edges),
                    "length_m": math.fsum(engine.edges[e]["length_m"] for e in edges),
                    "car_route": self.route_feature(edges, origin, engine)}

        mode = request.get("parking_mode", "none")
        if mode == "none":
            result = drive(anchors["destination"]["node_id"])
            if result is None:
                return empty
            return {**empty, **result, "status": "ok", "message": "Маршрут построен", "search_time_s": 0,
                    "walk_time_s": 0, "walk_distance_m": 0, "total_time_s": result["drive_time_s"]}
        destination = [request["destination"]["lon"], request["destination"]["lat"]]
        alternatives = []

        def without_parking(status, message, parking=None):
            # Отсутствие места не отменяет независимый автомобильный маршрут до Б.
            result = drive(anchors["destination"]["node_id"]) if anchors["destination"] else None
            warning = {"parking_status": status, "parking_message": message,
                       "parking": parking, "alternatives": alternatives}
            if result is None:
                detail = anchors.get("destination_error", "Нет допустимого пути по дорогам при выбранных условиях.")
                return {**empty, **warning, "message": f"Маршрут до Б недоступен. {detail}"}
            return {**empty, **result, **warning, "status": "ok",
                    "message": "Автомобильный маршрут до Б построен без парковки.",
                    "total_time_s": result["drive_time_s"]}

        for pid, parking in sorted(self.parkings.items()):
            gap = distance_m(parking["coordinates"], destination)
            if gap > self.config["parking_radius_m"]:
                continue
            search = search_time(occupancy[pid], self.config)
            snapshot = {**parking, "occupancy_percent": occupancy[pid]}
            alternative = {"parking": snapshot, "status": "full" if search is None else "unreachable", "total_time_s": None,
                           "drive_time_s": None, "search_time_s": search, "walk_time_s": gap / (self.config["walking_speed_kmh"] / 3.6),
                           "walk_distance_m": gap, "length_m": None, "edge_ids": [], "car_route": None}
            if search is not None:
                car = drive(parking["entry_node_id"])
                if car is not None:
                    alternative.update({**car, "status": "ok", "total_time_s": car["drive_time_s"] + search + alternative["walk_time_s"]})
            alternatives.append(alternative)
        available = [a for a in alternatives if a["status"] == "ok"]
        chosen = None
        if mode == "manual":
            chosen = next((a for a in alternatives if a["parking"]["parking_id"] == request["parking_id"]), None)
            if chosen is None:
                parking = self.parkings[request["parking_id"]]
                return without_parking("outside_radius", "Выбранная парковка дальше радиуса поиска от Б. Время поиска места и пешего пути не учтено.",
                                       {**parking, "occupancy_percent": occupancy[parking["parking_id"]]})
            if chosen["status"] != "ok":
                return without_parking("parking_full" if chosen["status"] == "full" else "parking_unreachable",
                                       "На выбранной парковке мест нет. Поиск места и пеший путь не учтены." if chosen["status"] == "full" else "До выбранной парковки нет пути. Показан маршрут до Б без учёта парковки.",
                                       chosen["parking"])
        elif available:
            chosen = min(available, key=lambda a: (a["total_time_s"], a["parking"]["parking_id"]))
        if chosen is None:
            message = (f"В каталоге OpenStreetMap нет парковок в радиусе {self.config['parking_radius_m']:g} м от Б."
                       if not alternatives else "В радиусе поиска нет достижимых парковок со свободными местами.")
            return without_parking("no_parking", message + " Поиск места и пеший путь не учтены.")
        return {**empty, **chosen, "status": "ok", "message": "Маршрут с парковкой построен", "alternatives": alternatives,
                "parking_included": True, "parking_status": "ok",
                "walk_route": {"type": "Feature", "properties": {"mode": "walking", "estimate": "straight_line"},
                               "geometry": {"type": "LineString", "coordinates": [chosen["parking"]["coordinates"], destination]}}}
