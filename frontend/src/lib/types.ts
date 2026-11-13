import type { Feature, FeatureCollection, LineString, Polygon } from "geojson";

export type RoadProperties = {
  edge_id: string;
  segment_id: string;
  name: string;
  length_m: number;
  speed_kmh: number;
  highway: string;
  can_close: boolean;
  direction: string;
  lane_count?: number | null;
  lane_min?: number | null;
  lane_max?: number | null;
  oneway?: boolean;
};
export type Segment = {
  segment_id: string;
  edge_ids: string[];
  name: string;
  length_m: number;
  speed_kmh: number;
  can_close: boolean;
  direction: string;
  disabled_reason: string | null;
  geometry: LineString;
  lane_count?: number | null;
  lane_min?: number | null;
  lane_max?: number | null;
  lanes_source?: string;
  oneway?: boolean;
};
export type MapData = {
  dataset_version: string;
  center: [number, number];
  radius_m: number;
  source: string;
  is_test_network: boolean;
  imported_at: string;
  edges: FeatureCollection<LineString, RoadProperties>;
  segments: Segment[];
  junctions?: { node_id: string; coordinates: [number, number] }[];
  model: { alpha: number; beta: number; elevated_threshold: number; high_threshold: number };
  traffic: ScenarioConfig;
};
export type EdgeLoad = {
  flow: number;
  capacity: number;
  ratio: number;
  load_class: "low" | "elevated" | "high";
  status: "open" | "closed";
  time_s: number;
};
export type RouteProperties = {
  trip_id: string;
  edge_ids: string[];
  vehicle_count: number;
  label: string;
  origin_label: string;
  destination_label: string;
  time_s: number;
  length_m: number;
};
export type Metrics = {
  average_time_s: number | null;
  average_length_m: number | null;
  high_load_edges: number;
  congested_road_count?: number;
  unreachable_trip_count: number;
  unreachable_vehicle_count: number;
  trip_count: number;
  vehicle_count: number;
};
export type State = {
  metrics: Metrics;
  routes: FeatureCollection<LineString, RouteProperties>;
  edge_loads: Record<string, EdgeLoad>;
  unreachable_trips: { trip_id: string; vehicle_count: number }[];
  trip_metrics: Record<string, { time_s: number; length_m: number; vehicle_count: number; edge_ids: string[] }>;
};
export type Delta = { before: number | null; after: number | null; absolute: number | null; percent: number | null };
export type ScenarioType = "closure" | "capacity_reduction" | "demand_increase" | "none";
export type Preset = { preset_id: string; name: string; description: string; scenario_type: ScenarioType; segment_id: string };
export type Run = {
  run_id: string;
  dataset_version: string;
  closed_edge_ids: string[];
  before: State;
  after: State;
  calculation_ms: number;
  input: { scenario_type: ScenarioType | "composite"; segment_id: string | null; factor: number | null; vehicle_count?: number | null };
  catalog_version?: string;
  personal_route?: PersonalComparison | null;
  house_changes?: { added: ModelHouse[]; removed: ModelHouse[] };
  applied_settings?: AppliedSettings;
  added_roads?: ScenarioRoad[];
  comparison: {
    matched_trip_count: number;
    matched_vehicle_count: number;
    changed_trip_count: number;
    changed_trip_ids: string[];
    average_time_s: Delta;
    average_length_m: Delta;
    high_load_edges: Delta;
    congested_road_count?: Delta;
    unreachable_trip_count: Delta;
    unreachable_vehicle_count: Delta;
    demand_factor: number;
    top_increased_edges: (Delta & { edge_id: string; segment_id: string; name: string; ratio_before: number; ratio_after: number })[];
  };
};

export type Coordinate = { lon: number; lat: number };
export type Weather = "dry" | "rain" | "snow";
export type ParkingMode = "none" | "auto" | "manual";
export type ScenarioConfig = {
  snap_radius_m: number; parking_radius_m: number; walking_speed_kmh: number;
  parking_search_base_s: number; parking_search_max_s: number; k_auto: number;
  weather_factors: Record<Weather, number>; default_vehicle_count: number;
  reference_vehicle_count: number; min_vehicle_count: number; max_vehicle_count: number;
};
export type Parking = {
  parking_id: string; name: string; coordinates: [number, number]; entry_node_id: string;
  source: string; source_id: string | null; is_demo: boolean; capacity: number | null;
  source_url?: string; source_tags?: Record<string, string>; name_is_generated?: boolean;
  baseline_occupancy_percent: number; occupancy_percent?: number; entry_snap_distance_m: number;
};
export type ModelHouse = {
  house_id: string; name: string; coordinates: [number, number]; exit_node_id: string;
  residents: number; origin_trip_id?: string; source: string; source_id?: string;
  geometry?: Polygon; vehicle_count?: number; terminal_id?: string;
};
export type HouseDraft = { house_id: string; coordinates: Coordinate; residents: number; terminal_id: string };
export type RoadDraft = { road_id: string; name: string; points: Coordinate[]; lanes: number; speed_kmh: number; two_way: boolean };
export type ScenarioRoad = RoadDraft & { length_m: number; edge_ids: string[]; segment_id: string; geometry: LineString; connections: { start: Snap; end: Snap } };
export type Catalogs = {
  dataset_version: string; catalog_version: string; config: ScenarioConfig;
  parkings: Parking[]; houses: ModelHouse[];
  terminals: { terminal_id: string; label: string; node_id: string; coordinates: [number, number] }[];
  demo_personal_route: { origin: Coordinate; destination: Coordinate; via: Coordinate[]; parking_mode: ParkingMode };
};
export type Experiment = {
  vehicleCount: number; weather: Weather; routeEnabled: boolean; points: (Coordinate | null)[];
  parkingMode: ParkingMode; parkingId: string; occupancy: Record<string, number>;
  addedHouses: HouseDraft[]; removedHouses: string[];
  addedRoads: RoadDraft[];
  showParkings: boolean; showHouses: boolean;
};
export type Placement = { kind: "route"; index: number } | { kind: "house"; houseId?: string } | { kind: "road" } | { kind: "demolish" } | null;
export type ParkingAlternative = {
  parking: Parking; status: "ok" | "full" | "unreachable"; total_time_s: number | null;
  drive_time_s: number | null; search_time_s: number | null; walk_time_s: number | null;
  walk_distance_m: number | null; length_m: number | null;
};
export type PersonalPhase = {
  status: string; message: string; total_time_s: number | null; drive_time_s: number | null;
  search_time_s: number | null; walk_time_s: number | null; walk_distance_m: number | null;
  length_m: number | null; edge_ids: string[];
  car_route: Feature<LineString> | null; walk_route: Feature<LineString> | null;
  parking: Parking | null; alternatives: ParkingAlternative[];
  parking_included?: boolean; parking_status?: string; parking_message?: string | null;
};
export type PersonalComparison = {
  before: PersonalPhase; after: PersonalPhase; comparison: Delta; vehicle_count: number;
  comparison_note?: string | null;
  snapped_points: { origin: Snap; via: Snap[]; destination: Snap | null };
};
export type Snap = { label: string; node_id: string; requested: Coordinate; coordinates: [number, number]; distance_m: number };
export type AppliedSettings = {
  vehicle_count_requested: number | null; vehicle_count_before: number; vehicle_count_after: number;
  source_vehicle_count: number; reference_vehicle_count: number; capacity_scale: number;
  alpha: number; beta: number; elevated_threshold: number; high_threshold: number;
  background_scale: number; demand_factor: number; k_auto: number; walking_speed_kmh: number;
  weather_before: Weather; weather_after: Weather; weather_factor_before: number; weather_factor_after: number;
  road_change: { scenario_type: "closure" | "capacity_reduction"; segment_id: string; factor?: number } | null;
  parking_occupancy_before: Record<string, number>; parking_occupancy_after: Record<string, number>;
};
