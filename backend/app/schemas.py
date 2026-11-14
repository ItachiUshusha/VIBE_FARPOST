from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Coordinate(StrictModel):
    lon: float = Field(ge=-180, le=180)
    lat: float = Field(ge=-85, le=85)


class PersonalRouteRequest(StrictModel):
    origin: Coordinate
    destination: Coordinate
    via: list[Coordinate] = Field(default_factory=list, max_length=5)
    parking_mode: Literal["none", "auto", "manual"] = "none"
    parking_id: str | None = Field(default=None, min_length=1, max_length=100)

    @model_validator(mode="after")
    def check_parking(self):
        if self.parking_mode == "manual" and not self.parking_id:
            raise ValueError("Выберите парковку для ручного режима.")
        if self.parking_mode != "manual" and self.parking_id:
            raise ValueError("ID парковки указывается только для ручного выбора.")
        return self


class RoadChange(StrictModel):
    scenario_type: Literal["closure", "capacity_reduction"]
    segment_id: str = Field(min_length=1, max_length=120)
    factor: float | None = None

    @model_validator(mode="after")
    def check_factor(self):
        if self.scenario_type == "closure" and self.factor is not None:
            raise ValueError("Для перекрытия коэффициент не используется.")
        if self.scenario_type == "capacity_reduction":
            self.factor = .5 if self.factor is None else self.factor
            if not 0 < self.factor < 1:
                raise ValueError("Оставшаяся пропускная способность должна быть больше 0 и меньше 1.")
        return self


class AddedHouse(StrictModel):
    house_id: str = Field(min_length=1, max_length=90, pattern=r"^[A-Za-z0-9_-]+$")
    coordinates: Coordinate
    residents: int = Field(strict=True, ge=1, le=20000)
    # Accepted for older clients; new houses always use automatic distribution.
    terminal_id: str | None = Field(default=None, min_length=1, max_length=100, deprecated=True)


class HousingChanges(StrictModel):
    add: list[AddedHouse] = Field(default_factory=list, max_length=10)
    remove: list[str] = Field(default_factory=list, max_length=30)

    @model_validator(mode="after")
    def unique_ids(self):
        ids = [h.house_id for h in self.add]
        if len(ids) != len(set(ids)) or len(self.remove) != len(set(self.remove)):
            raise ValueError("Один дом указан несколько раз.")
        return self


class AddedRoad(StrictModel):
    road_id: str = Field(min_length=1, max_length=90, pattern=r"^[A-Za-z0-9_-]+$")
    name: str = Field(default="Новая дорога", min_length=1, max_length=80)
    points: list[Coordinate] = Field(min_length=2, max_length=12)
    lanes: int = Field(default=1, strict=True, ge=1, le=6)
    speed_kmh: int = Field(default=40, strict=True, ge=10, le=90)
    two_way: bool = True

    @model_validator(mode="after")
    def clean_name(self):
        self.name = self.name.strip()
        if not self.name:
            raise ValueError("Укажите название новой дороги.")
        return self


class SimulationRequest(StrictModel):
    scenario_type: Literal["closure", "capacity_reduction", "demand_increase", "composite"] = "closure"
    segment_id: str | None = Field(default=None, min_length=1, max_length=120)
    factor: float | None = None
    vehicle_count: int | None = Field(default=None, strict=True, ge=1, le=10000)
    weather: Literal["dry", "rain", "snow"] = "dry"
    personal_route: PersonalRouteRequest | None = None
    parking_occupancy: dict[str, Annotated[float, Field(ge=0, le=100)]] = Field(default_factory=dict, max_length=10000)
    housing: HousingChanges = Field(default_factory=HousingChanges)
    added_roads: list[AddedRoad] = Field(default_factory=list, max_length=5)
    road_change: RoadChange | None = None
    demand_factor: float = Field(default=1, ge=1, le=3)

    @model_validator(mode="after")
    def validate_parameters(self):
        ids = [road.road_id for road in self.added_roads]
        if len(ids) != len(set(ids)):
            raise ValueError("Одна новая дорога указана несколько раз.")
        if self.added_roads and self.scenario_type != "composite":
            raise ValueError("Добавляйте новые дороги в составной сценарий.")
        if self.scenario_type == "composite":
            if self.segment_id is not None or self.factor is not None:
                raise ValueError("Для составного сценария используйте road_change и demand_factor.")
            return self
        if self.road_change is not None or self.demand_factor != 1:
            raise ValueError("Для сочетания настроек дороги и спроса используйте составной сценарий.")
        if self.scenario_type != "demand_increase" and not self.segment_id:
            raise ValueError("Выберите участок дороги.")
        if self.scenario_type == "closure" and self.factor is not None:
            raise ValueError("Для перекрытия коэффициент не используется.")
        if self.scenario_type == "capacity_reduction":
            self.factor = 0.5 if self.factor is None else self.factor
            if not 0 < self.factor < 1:
                raise ValueError("Оставшаяся пропускная способность должна быть больше 0 и меньше 1.")
        if self.scenario_type == "demand_increase":
            self.factor = 1.4 if self.factor is None else self.factor
            if not 1 < self.factor <= 3:
                raise ValueError("Коэффициент спроса должен быть больше 1 и не больше 3.")
            if self.segment_id is not None:
                raise ValueError("Условный час пик применяется ко всей сети; участок не указывается.")
        return self


class AnalyzeRequest(StrictModel):
    run_id: str = Field(min_length=1, max_length=120)
