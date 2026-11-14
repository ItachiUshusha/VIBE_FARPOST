"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type GeoJSONSource, type Map as LibreMap, type StyleSpecification } from "maplibre-gl";
import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import { Box, Check, Layers2, LocateFixed, Minus, Pause, Play, Plus, RotateCcw, Route, X } from "lucide-react";
import type { Catalogs, Coordinate, Experiment, HouseDraft, MapData, PersonalPhase, Placement, PointGuidance, RoadDraft, ScenarioRoad, Segment, State } from "@/lib/types";
import { distance } from "@/lib/api";
import AppDialog from "./AppDialog";
import { roadLanes } from "@/lib/roads";

type Props = {
  data: MapData;
  state: State;
  selected: Segment | null;
  onSelect: (id: string) => void;
  phase: "before" | "after";
  onPhase: (phase: "before" | "after") => void;
  hasResult: boolean;
  activeTrip: string | null;
  focus: number;
  resetKey: number;
  disabled: boolean;
  catalogs: Catalogs | null;
  experiment: Experiment;
  placement: Placement;
  onMapPoint: (point: Coordinate) => void;
  onMovePoint: (index: number, point: Coordinate) => void;
  onCancelPlacement: () => void;
  onParking: (id: string) => void;
  onHouse: (id: string) => void;
  editingHouseId: string | null;
  onEditHouse: (id: string) => void;
  onChangeHouse: (id: string, patch: Partial<HouseDraft>) => void;
  onCloseHouse: () => void;
  onRemoveHouse: (id: string) => void;
  onRepositionHouse: (id: string) => void;
  drawingRoad: RoadDraft | null;
  drawingErrorIndex: number | null;
  pointGuidance: PointGuidance | null;
  guidanceFocus: Coordinate | null;
  onApplyGuidance: () => void;
  onDismissGuidance: () => void;
  mobile: boolean;
  onDisplayChange: (patch: Partial<Experiment>) => void;
  addedRoads: ScenarioRoad[];
  onEditRoad: (id: string) => void;
  personal: PersonalPhase | null;
  parkingOccupancy: Record<string, number>;
  hasHouseChanges: boolean;
  dark: boolean;
  reducedMotion: boolean;
};

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

const MAP_COLORS: Record<string, [string, string]> = {
  "#181e20": ["#eef0e8", "#172129"], "#1b2e38": ["#bbdce9", "#203d50"],
  "#24362e": ["#d5e4c3", "#294035"], "#303735": ["#d3dacb", "#304047"],
  "#3c4441": ["#bbc5b5", "#3d4b52"], "#111a18": ["#b8c3b2", "#101920"],
  "#a3aeac": ["#5b6a60", "#aab8b6"], "#17201f": ["#f4f6ef", "#172129"],
  "#e3f5ca": ["#3f8ce4", "#77b9ff"], "#f5f9ed": ["#0071e3", "#7bbdff"],
  "#ff6c75": ["#db4c48", "#ff7a74"], "#a9c2ff": ["#6c9ff3", "#7cabf5"],
  "#c4d7ff": ["#4d7ac4", "#a3c5ff"], "#141a19": ["#fff", "#25323e"],
  "#d1e1ff": ["#4d7ac4", "#b0d0ff"], "#e1eaff": ["#35517f", "#cfe2ff"],
  "#161d1b": ["#f9fbf6", "#172129"], "#ddffa2": ["#2d925b", "#a4dfb2"],
  "#e2ffc0": ["#207d48", "#c2efd0"], "#b4caff": ["#0071e3", "#78b9ff"],
  "#79d9c7": ["#218d7b", "#77d6bc"], "#233648": ["#f9fcff", "#253543"],
  "#6c9fbc": ["#8da6bc", "#6e96b6"], "#c2e0f1": ["#48647d", "#bfd9f3"],
  "#b7dbf4": ["#3e688e", "#c0dff5"], "#29483e": ["#0071e3", "#318ce5"],
  "#d2f29c": ["#fff", "#bedcff"], "#e0f3c3": ["#fff", "#f6fbff"],
  "#273626": ["#f5effc", "#322a45"], "#c7ed83": ["#8854b9", "#c49ae6"],
  "#f18b7d": ["#d44b44", "#ff8177"], "#86bddd": ["#7399b8", "#86bddd"],
  "#63706a": ["#9da995", "#63767a"], "#5d6a62": ["#c7cfbc", "#526368"],
  "#f17f6e": ["#db5f4d", "#fa8d7a"], "#e7bb62": ["#c7912e", "#e5bf6f"],
  "#8ab97a": ["#51a35c", "#80bd8d"], "#424e49": ["#b1bda6", "#53686d"],
  "#a1b594": ["#5b6a60", "#aab8b6"], "#19241c": ["#f4f6ef", "#172129"],
  "#88d8c4": ["#27876a", "#88d8c4"], "#172522": ["#fff", "#172129"],
};
function mapColor(color: string, dark: boolean) { return MAP_COLORS[color]?.[dark ? 1 : 0] || color; }
function themedMapStyle(dark: boolean): StyleSpecification {
  const recolor = (value: unknown): unknown => typeof value === "string" ? mapColor(value, dark) : Array.isArray(value) ? value.map(recolor) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, recolor(item)])) : value;
  const style = recolor(mapStyle()) as StyleSpecification;
  const basemap = style.layers.find(layer => layer.id === "basemap");
  if (basemap?.type === "raster") basemap.paint = { ...basemap.paint, "raster-brightness-max": dark ? .5 : 1, "raster-opacity": dark ? .5 : .38 };
  return style;
}

function mapStyle(): StyleSpecification {
  return {
    version: 8,
    glyphs: `${window.location.origin}/fonts/{fontstack}/{range}.pbf`,
    sources: {
      basemap: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>', maxzoom: 19 },
      context: { type: "geojson", data: "/context.geojson" },
      roads: { type: "geojson", data: EMPTY, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>' },
      selected: { type: "geojson", data: EMPTY },
      route: { type: "geojson", data: EMPTY },
      endpoints: { type: "geojson", data: EMPTY },
      cars: { type: "geojson", data: EMPTY },
      parkings: { type: "geojson", data: EMPTY, cluster: true, clusterMaxZoom: 16, clusterRadius: 36 },
      "chosen-parking": { type: "geojson", data: EMPTY },
      houses: { type: "geojson", data: EMPTY },
      personal: { type: "geojson", data: EMPTY },
      walking: { type: "geojson", data: EMPTY },
      "new-roads": { type: "geojson", data: EMPTY },
      "road-draft-points": { type: "geojson", data: EMPTY },
      "point-guidance": { type: "geojson", data: EMPTY },
      "house-areas": { type: "geojson", data: EMPTY },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": "#181e20" } },
      { id: "basemap", type: "raster", source: "basemap", layout: { "visibility": "none" }, paint: { "raster-opacity": 0.55, "raster-saturation": -1, "raster-brightness-max": 0.35 } },
      { id: "water", type: "fill", source: "context", filter: ["==", ["get", "kind"], "water"], paint: { "fill-color": "#1b2e38", "fill-opacity": 0.75 } },
      { id: "green", type: "fill", source: "context", filter: ["==", ["get", "kind"], "green"], paint: { "fill-color": "#24362e", "fill-opacity": 0.7 } },
      { id: "buildings", type: "fill", source: "context", filter: ["==", ["get", "kind"], "building"], paint: { "fill-color": "#303735", "fill-opacity": 0.55, "fill-outline-color": "#3c4441" } },
      { id: "house-areas", type: "fill", source: "house-areas", paint: { "fill-color": ["get", "color"], "fill-opacity": .35, "fill-outline-color": ["get", "color"] } },
      { id: "road-casing", type: "line", source: "roads", layout: { "line-join": "round", "line-cap": "round" }, paint: {
        "line-color": "#111a18", "line-width": ["interpolate", ["linear"], ["zoom"], 12, 2, 16, 9, 19, 16], "line-opacity": 0.8 } },
      { id: "road-glow", type: "line", source: "roads", filter: [">", ["get", "flow"], 0], paint: {
        "line-color": ["get", "color"], "line-width": 13, "line-blur": 9, "line-opacity": 0.14 } },
      { id: "roads", type: "line", source: "roads", layout: { "line-join": "round", "line-cap": "round" }, paint: {
        "line-color": ["get", "color"], "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1, 15, 2.5, 17, 5, 19, 9], "line-offset": 0.65,
        "line-opacity": ["case", [">", ["get", "flow"], 0], 0.92, 0.48] } },
      { id: "road-hit", type: "line", source: "roads", paint: { "line-width": 18, "line-opacity": 0 } },
      { id: "labels", type: "symbol", source: "roads", minzoom: 13,
        filter: ["all", ["!=", ["get", "name"], "Безымянный проезд"], [">", ["get", "length_m"], 85]],
        layout: { "symbol-placement": "line", "text-field": ["get", "name"], "text-font": ["Open Sans Semibold"], "text-size": 11, "symbol-spacing": 400, "text-max-angle": 40, "text-padding": 8 },
        paint: { "text-color": "#a3aeac", "text-halo-color": "#17201f", "text-halo-width": 2.5 } },
      { id: "selected-halo", type: "line", source: "selected", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#e3f5ca", "line-width": 16, "line-opacity": 0.15, "line-blur": 3 } },
      { id: "selected", type: "line", source: "selected", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#f5f9ed", "line-width": 7, "line-opacity": 0.9 } },
      { id: "closed", type: "line", source: "roads", filter: ["==", ["get", "status"], "closed"], layout: { "line-cap": "butt" }, paint: { "line-color": "#ff6c75", "line-width": 7, "line-dasharray": [1, 1] } },
      { id: "route-halo", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#a9c2ff", "line-width": 12, "line-opacity": 0.16 } },
      { id: "route", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#c4d7ff", "line-width": 3.5, "line-dasharray": [2, 1] } },
      { id: "endpoints", type: "circle", source: "endpoints", paint: { "circle-color": "#141a19", "circle-radius": 8, "circle-stroke-color": "#d1e1ff", "circle-stroke-width": 2 } },
      { id: "endpoint-labels", type: "symbol", source: "endpoints", layout: { "text-field": ["get", "label"], "text-font": ["Open Sans Semibold"], "text-size": 11, "text-offset": [0, 1.9], "text-allow-overlap": true }, paint: { "text-color": "#e1eaff", "text-halo-color": "#161d1b", "text-halo-width": 2 } },
      { id: "cars-glow", type: "circle", source: "cars", paint: { "circle-color": "#ddffa2", "circle-radius": 7, "circle-opacity": 0.12, "circle-blur": 1 } },
      { id: "cars", type: "circle", source: "cars", paint: { "circle-color": "#e2ffc0", "circle-radius": 2, "circle-opacity": 0.95 } },
      { id: "new-road-outline", type: "line", source: "new-roads", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#141a19", "line-width": 9 } },
      { id: "new-road-built", type: "line", source: "new-roads", filter: ["==", ["get", "built"], true], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": 5 } },
      { id: "new-road-preview", type: "line", source: "new-roads", filter: ["==", ["get", "built"], false], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": 4, "line-dasharray": [2, 1] } },
      { id: "new-road-hit", type: "line", source: "new-roads", paint: { "line-width": 20, "line-opacity": 0 } },
      { id: "new-road-labels", type: "symbol", source: "new-roads", layout: { "symbol-placement": "line", "text-field": ["get", "name"], "text-font": ["Open Sans Semibold"], "text-size": 12 }, paint: { "text-color": "#c7ed83", "text-halo-color": "#161d1b", "text-halo-width": 2 } },
      { id: "road-draft-points", type: "circle", source: "road-draft-points", paint: { "circle-radius": 6, "circle-color": ["case", ["boolean", ["get", "invalid"], false], "#ff6c75", "#c7ed83"], "circle-stroke-color": "#141a19", "circle-stroke-width": 2 } },
      { id: "personal-halo", type: "line", source: "personal", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#b4caff", "line-width": 11, "line-opacity": .2 } },
      { id: "personal-route", type: "line", source: "personal", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#b4caff", "line-width": 4 } },
      { id: "walking-route", type: "line", source: "walking", paint: { "line-color": "#79d9c7", "line-width": 3, "line-dasharray": [1, 1.5] } },
      { id: "parking-clusters", type: "circle", source: "parkings", filter: ["has", "point_count"], paint: { "circle-radius": ["step", ["get", "point_count"], 13, 10, 16, 50, 19], "circle-color": "#233648", "circle-stroke-color": "#6c9fbc", "circle-stroke-width": 1.5, "circle-opacity": .9 } },
      { id: "parking-cluster-count", type: "symbol", source: "parkings", filter: ["has", "point_count"], layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": ["Open Sans Semibold"], "text-size": 11, "text-allow-overlap": true }, paint: { "text-color": "#c2e0f1" } },
      { id: "parking-points", type: "circle", source: "parkings", filter: ["!", ["has", "point_count"]], paint: { "circle-radius": 9, "circle-color": "#233648", "circle-stroke-color": ["get", "color"], "circle-stroke-width": 1.5 } },
      { id: "parking-labels", type: "symbol", source: "parkings", filter: ["!", ["has", "point_count"]], layout: { "text-field": "P", "text-font": ["Open Sans Semibold"], "text-size": 11, "text-allow-overlap": true }, paint: { "text-color": "#b7dbf4" } },
      { id: "chosen-parking-point", type: "circle", source: "chosen-parking", paint: { "circle-radius": 12, "circle-color": "#29483e", "circle-stroke-color": "#d2f29c", "circle-stroke-width": 2.5 } },
      { id: "chosen-parking-label", type: "symbol", source: "chosen-parking", layout: { "text-field": "P", "text-font": ["Open Sans Semibold"], "text-size": 13, "text-allow-overlap": true }, paint: { "text-color": "#e0f3c3" } },
      { id: "house-points", type: "circle", source: "houses", paint: { "circle-radius": 10, "circle-color": "#273626", "circle-stroke-color": ["get", "color"], "circle-stroke-width": 2, "circle-opacity": .9 } },
      { id: "house-labels", type: "symbol", source: "houses", layout: { "text-field": ["get", "label"], "text-font": ["Open Sans Semibold"], "text-size": 11, "text-allow-overlap": true }, paint: { "text-color": ["get", "color"] } },
      { id: "point-guidance-line-halo", type: "line", source: "point-guidance", filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": "#141a19", "line-width": 7, "line-opacity": .85 } },
      { id: "point-guidance-line", type: "line", source: "point-guidance", filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": "#f5f9ed", "line-width": 3, "line-dasharray": [2, 2] } },
      { id: "point-guidance-origin", type: "circle", source: "point-guidance", filter: ["==", ["get", "kind"], "origin"], paint: { "circle-radius": 10, "circle-color": "#ff6c75", "circle-stroke-width": 3, "circle-stroke-color": "#141a19" } },
    ],
  };
}

export default function RoadMap(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const guidanceCard = useRef<HTMLElement>(null);
  const map = useRef<LibreMap | null>(null);
  const propsRef = useRef(props);
  const guidanceMarker = useRef<maplibregl.Marker | null>(null);
  propsRef.current = props;
  const [ready, setReady] = useState(false);
  const [painted, setPainted] = useState(false);
  const [scheme, setScheme] = useState(true);
  const [pitched, setPitched] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [economy, setEconomy] = useState(true);
  const [showLayers, setShowLayers] = useState(false);
  const [showFlow, setShowFlow] = useState(true);
  const [showBuildings, setShowBuildings] = useState(true);
  const [mapError, setMapError] = useState(false);
  const [tileError, setTileError] = useState(false);
  const [hover, setHover] = useState<{ name: string; direction: string; x: number; y: number } | null>(null);
  const routeMarkers = useRef<maplibregl.Marker[]>([]);
  const houseMarkers = useRef<maplibregl.Marker[]>([]);

  const parkingFeatures: FeatureCollection = useMemo(() => ({ type: "FeatureCollection", features: props.experiment.showParkings ? (props.catalogs?.parkings || []).map(p => {
    const occupancy = props.parkingOccupancy[p.parking_id] ?? p.baseline_occupancy_percent;
    return { type: "Feature", geometry: { type: "Point", coordinates: p.coordinates }, properties: { parking_id: p.parking_id, name: p.name, occupancy, is_demo: p.is_demo, color: mapColor(occupancy >= 100 ? "#f18b7d" : "#86bddd", props.dark) } };
  }) : [] }), [props.catalogs, props.experiment.showParkings, props.parkingOccupancy, props.dark]);
  const houseFeatures: FeatureCollection = useMemo(() => {
    const features = (props.experiment.showHouses ? props.catalogs?.houses || [] : []).map(h => ({ type: "Feature" as const, geometry: { type: "Point" as const, coordinates: h.coordinates }, properties: {
      house_id: h.house_id, name: h.name, existing: true, residents: h.residents,
      color: mapColor((!props.hasResult || props.hasHouseChanges) && props.experiment.removedHouses.includes(h.house_id) ? "#f18b7d" : "#c7ed83", props.dark),
      label: (!props.hasResult || props.hasHouseChanges) && props.experiment.removedHouses.includes(h.house_id) ? "×" : "Д",
    } }));
    return { type: "FeatureCollection", features };
  }, [props.catalogs, props.experiment.showHouses, props.experiment.removedHouses, props.hasResult, props.hasHouseChanges, props.dark]);
  const customRoadFeatures = useMemo<FeatureCollection<LineString>>(() => {
    const roads = props.hasResult && props.phase === "before" ? [] : props.experiment.addedRoads;
    const all = props.drawingRoad ? [...roads.filter(road => road.road_id !== props.drawingRoad!.road_id), props.drawingRoad] : roads;
    return { type: "FeatureCollection", features: all.filter(road => road.points.length >= 2).map((road): Feature<LineString> => {
      const snapshot = props.hasResult && props.phase === "after" ? props.addedRoads.find(item => item.road_id === road.road_id) : null;
      return { type: "Feature", geometry: snapshot?.geometry || { type: "LineString", coordinates: road.points.map(point => [point.lon, point.lat]) },
        properties: { road_id: road.road_id, name: road.name, built: !!snapshot, color: mapColor("#c7ed83", props.dark) } };
    }) };
  }, [props.experiment.addedRoads, props.drawingRoad, props.addedRoads, props.hasResult, props.phase, props.dark]);

  const roadFeatures = useMemo(() => ({
    ...props.data.edges,
    features: props.data.edges.features.map(feature => {
      const load = props.state.edge_loads[feature.properties.edge_id];
      const color = mapColor(!load || !showFlow ? "#63706a" : load.status === "closed" ? "#ff6c75" : load.flow === 0 ? "#5d6a62" :
        load.load_class === "high" ? "#f17f6e" : load.load_class === "elevated" ? "#e7bb62" : "#8ab97a", props.dark);
      return { ...feature, properties: { ...feature.properties, flow: load?.flow || 0, status: load?.status || "open", color } };
    }),
  }), [props.data.edges, props.state, showFlow, props.dark]);

  useEffect(() => {
    if (!container.current) return;
    let instance: LibreMap;
    try {
      instance = new maplibregl.Map({ container: container.current, style: themedMapStyle(propsRef.current.dark), center: propsRef.current.data.center,
        zoom: 14.8, pitch: 0, bearing: 0, maxPitch: 60, minZoom: 12, maxZoom: 19,
        attributionControl: { compact: true }, pixelRatio: 1, canvasContextAttributes: { antialias: false },
      });
    } catch {
      setMapError(true);
      return;
    }
    map.current = instance;
    const confirmRoadsPainted = () => {
      if (instance.getLayer("roads") && instance.queryRenderedFeatures({ layers: ["roads"] }).length > 0) {
        setPainted(true);
        instance.off("render", confirmRoadsPainted);
      }
    };
    instance.on("render", confirmRoadsPainted);
    instance.addControl(new maplibregl.ScaleControl({ maxWidth: 90, unit: "metric" }), "bottom-left");
    instance.on("load", () => setReady(true));
    instance.on("error", (event) => {
      if ((event as unknown as { sourceId?: string }).sourceId === "basemap" || /tile\.openstreetmap/.test(event.error?.message || "")) {
        setTileError(true);
        instance.setLayoutProperty("basemap", "visibility", "none");
        setScheme(true);
      }
    });
    instance.on("click", "road-hit", (event) => {
      if (propsRef.current.disabled || propsRef.current.placement || instance.queryRenderedFeatures(event.point, { layers: ["parking-points", "parking-clusters", "chosen-parking-point", "house-points", "new-road-hit"] }).length) return;
      const id = event.features?.[0]?.properties?.segment_id;
      if (id) propsRef.current.onSelect(String(id));
    });
    instance.on("mousemove", "road-hit", (event) => {
      if (propsRef.current.placement || propsRef.current.disabled) return;
      instance.getCanvas().style.cursor = "pointer";
      const p = event.features?.[0]?.properties;
      if (p) setHover({ name: p.name, direction: `${p.direction} · ${roadLanes({ lane_count: p.lane_count, lane_min: p.lane_min, lane_max: p.lane_max })}`, x: event.point.x, y: event.point.y });
    });
    instance.on("mouseleave", "road-hit", () => { instance.getCanvas().style.cursor = propsRef.current.placement ? "crosshair" : ""; setHover(null); });
    instance.on("click", event => { if (propsRef.current.placement && propsRef.current.placement.kind !== "demolish" && !propsRef.current.disabled) propsRef.current.onMapPoint({ lon: event.lngLat.lng, lat: event.lngLat.lat }); });
    instance.on("click", "parking-points", event => { if (!propsRef.current.placement && !propsRef.current.disabled) { const pid = event.features?.[0]?.properties?.parking_id; if (pid) propsRef.current.onParking(pid); } });
    instance.on("click", "chosen-parking-point", event => { if (!propsRef.current.placement && !propsRef.current.disabled) { const pid = event.features?.[0]?.properties?.parking_id; if (pid) propsRef.current.onParking(pid); } });
    instance.on("click", "parking-clusters", event => {
      if (propsRef.current.placement || propsRef.current.disabled) return;
      const feature = event.features?.[0];
      if (!feature || feature.geometry.type !== "Point") return;
      const coordinates = feature.geometry.coordinates as [number, number];
      (instance.getSource("parkings") as GeoJSONSource).getClusterExpansionZoom(Number(feature.properties.cluster_id))
        .then(zoom => { if (map.current === instance) instance.easeTo({ center: coordinates, zoom: Math.min(zoom + .1, 18), duration: propsRef.current.reducedMotion ? 0 : 350 }); })
        .catch(() => {});
    });
    instance.on("click", "house-points", event => { if ((!propsRef.current.placement || propsRef.current.placement.kind === "demolish") && !propsRef.current.disabled) { const p = event.features?.[0]?.properties; if (p?.existing) propsRef.current.onHouse(String(p.house_id)); } });
    instance.on("click", "house-areas", event => { if (propsRef.current.placement?.kind === "demolish" && !propsRef.current.disabled && !instance.queryRenderedFeatures(event.point, { layers: ["house-points"] }).length) { const id = event.features?.[0]?.properties?.house_id; if (id) propsRef.current.onHouse(id); } });
    instance.on("click", "new-road-hit", event => { if (!propsRef.current.placement && !propsRef.current.disabled) { const id = event.features?.[0]?.properties?.road_id; if (id) propsRef.current.onEditRoad(id); } });
    for (const layer of ["parking-points", "house-points"]) {
      instance.on("mousemove", layer, event => { if (propsRef.current.placement) return; const p = event.features?.[0]?.properties; if (p) { instance.getCanvas().style.cursor = "pointer"; setHover({ name: p.name, direction: layer === "parking-points" ? `${p.occupancy}% занято${p.is_demo ? " · Демонстрационная точка" : " · OSM"}` : `${p.residents} жителей в расчёте · нажмите, чтобы снести / вернуть`, x: event.point.x, y: event.point.y }); } });
      instance.on("mouseleave", layer, () => { setHover(null); instance.getCanvas().style.cursor = propsRef.current.placement ? "crosshair" : ""; });
    }
    instance.on("mousemove", "parking-clusters", event => {
      if (propsRef.current.placement || propsRef.current.disabled) return;
      instance.getCanvas().style.cursor = "pointer";
      setHover({ name: `Парковок в группе: ${event.features?.[0]?.properties?.point_count || 0}`, direction: "Нажмите, чтобы приблизить реальные объекты OSM", x: event.point.x, y: event.point.y });
    });
    instance.on("mouseleave", "parking-clusters", () => { setHover(null); instance.getCanvas().style.cursor = propsRef.current.placement ? "crosshair" : ""; });
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(container.current);
    return () => { observer.disconnect(); instance.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    if (!ready || !map.current) return;
    for (const layer of themedMapStyle(props.dark).layers) {
      for (const [property, value] of Object.entries(layer.paint || {})) map.current.setPaintProperty(layer.id, property, value);
    }
  }, [ready, props.dark]);
  useEffect(() => {
    if (!ready || !map.current) return;
    map.current.setPixelRatio(economy ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    for (const id of ["road-glow", "cars-glow"]) map.current.setLayoutProperty(id, "visibility", economy ? "none" : "visible");
  }, [ready, economy]);
  useEffect(() => { if (props.reducedMotion) setPlaying(false); }, [props.reducedMotion]);

  useEffect(() => {
    if (!ready || !map.current) return;
    (map.current.getSource("roads") as GeoJSONSource).setData(roadFeatures);
  }, [ready, roadFeatures]);
  useEffect(() => {
    if (!ready || !map.current) return;
    (map.current.getSource("new-roads") as GeoJSONSource).setData(customRoadFeatures);
    (map.current.getSource("road-draft-points") as GeoJSONSource).setData({ type: "FeatureCollection", features: (props.drawingRoad?.points || []).map((point, index): Feature<Point> => ({ type: "Feature", properties: { invalid: index === props.drawingErrorIndex }, geometry: { type: "Point", coordinates: [point.lon, point.lat] } })) });
  }, [ready, customRoadFeatures, props.drawingRoad, props.drawingErrorIndex]);
  useEffect(() => {
    if (!ready || !map.current) return;
    (map.current.getSource("house-areas") as GeoJSONSource).setData({ type: "FeatureCollection", features: (props.experiment.showHouses ? props.catalogs?.houses || [] : []).flatMap(house => house.geometry ? [{ type: "Feature" as const, geometry: house.geometry, properties: { house_id: house.house_id, color: mapColor((!props.hasResult || props.hasHouseChanges) && props.experiment.removedHouses.includes(house.house_id) ? "#f18b7d" : "#c7ed83", props.dark) } }] : []) });
    map.current.setPaintProperty("house-points", "circle-radius", props.placement?.kind === "demolish" ? 18 : 10);
    if (props.placement?.kind === "demolish" && props.catalogs?.houses.length) {
      const bounds = props.catalogs.houses.reduce((result, house) => result.extend(house.coordinates), new maplibregl.LngLatBounds());
      map.current.fitBounds(bounds, { padding: 100, maxZoom: 16.5, duration: props.reducedMotion ? 0 : 400 });
    }
  }, [ready, props.catalogs, props.experiment.showHouses, props.experiment.removedHouses, props.hasResult, props.hasHouseChanges, props.placement?.kind, props.dark, props.reducedMotion]);

  useEffect(() => {
    if (!ready || !map.current) return;
    (map.current.getSource("parkings") as GeoJSONSource).setData(parkingFeatures);
  }, [ready, parkingFeatures]);
  useEffect(() => {
    if (!ready || !map.current) return;
    (map.current.getSource("houses") as GeoJSONSource).setData(houseFeatures);
  }, [ready, houseFeatures]);
  useEffect(() => {
    if (!ready || !map.current) return;
    (map.current.getSource("personal") as GeoJSONSource).setData(props.personal?.car_route ? { type: "FeatureCollection", features: [props.personal.car_route] } : EMPTY);
    (map.current.getSource("walking") as GeoJSONSource).setData(props.personal?.walk_route ? { type: "FeatureCollection", features: [props.personal.walk_route] } : EMPTY);
  }, [ready, props.personal]);
  useEffect(() => {
    if (!ready || !map.current) return;
    const parking = props.experiment.showParkings
      ? props.personal?.parking || props.catalogs?.parkings.find(p => props.experiment.parkingMode === "manual" && p.parking_id === props.experiment.parkingId)
      : null;
    (map.current.getSource("chosen-parking") as GeoJSONSource).setData(parking ? { type: "FeatureCollection", features: [
      { type: "Feature", geometry: { type: "Point", coordinates: parking.coordinates }, properties: { parking_id: parking.parking_id } },
    ] } : EMPTY);
  }, [ready, props.catalogs, props.personal, props.experiment.showParkings, props.experiment.parkingMode, props.experiment.parkingId]);
  useEffect(() => {
    if (map.current) map.current.getCanvas().style.cursor = props.placement ? "crosshair" : "";
    setHover(null);
  }, [props.placement]);
  useEffect(() => {
    routeMarkers.current.forEach(marker => marker.remove()); routeMarkers.current = [];
    if (!ready || !map.current || !props.experiment.routeEnabled) return;
    props.experiment.points.forEach((point, index) => {
      if (!point) return;
      const element = document.createElement("div"); element.className = "route-pin" + (index === props.experiment.points.length - 1 ? " destination" : "") + (props.pointGuidance?.target.kind === "route" && props.pointGuidance.target.index === index ? " invalid" : "");
      element.textContent = index === 0 ? "А" : index === props.experiment.points.length - 1 ? "Б" : String(index);
      element.title = `Точка ${element.textContent} · перетащите для изменения`;
      element.addEventListener("click", event => {
        event.stopPropagation();
        if (propsRef.current.placement && !propsRef.current.disabled) propsRef.current.onMapPoint({ lon: point.lon, lat: point.lat });
      });
      const marker = new maplibregl.Marker({ element, draggable: !props.disabled && !props.placement }).setLngLat([point.lon, point.lat]).addTo(map.current!);
      marker.on("dragend", () => { const point = marker.getLngLat(); propsRef.current.onMovePoint(index, { lon: point.lng, lat: point.lat }); });
      routeMarkers.current.push(marker);
    });
    return () => routeMarkers.current.forEach(marker => marker.remove());
  }, [ready, props.experiment.points, props.experiment.routeEnabled, props.disabled, props.placement, props.pointGuidance]);

  useEffect(() => {
    houseMarkers.current.forEach(marker => marker.remove()); houseMarkers.current = [];
    if (!ready || !map.current || !props.experiment.showHouses || (props.hasResult && !props.hasHouseChanges)) return;
    for (const house of props.experiment.addedHouses) {
      const element = document.createElement("button");
      element.type = "button";
      element.className = "house-pin" + (props.editingHouseId === house.house_id ? " selected" : "") + (props.pointGuidance?.target.kind === "house" && props.pointGuidance.target.houseId === house.house_id ? " invalid" : "");
      element.textContent = "Д";
      const label = Number.isFinite(house.residents) ? house.residents : "—";
      element.title = `Новый дом · ${label} жителей. Нажмите для настройки или перетащите`;
      element.setAttribute("aria-label", `Настроить метку дома · ${label} жителей`);
      const count = document.createElement("span"); count.className = "house-pin-count"; count.textContent = String(label); element.appendChild(count);
      element.addEventListener("click", event => {
        event.stopPropagation();
        if (propsRef.current.disabled) return;
        if (propsRef.current.placement) propsRef.current.onMapPoint(house.coordinates);
        else propsRef.current.onEditHouse(house.house_id);
      });
      const marker = new maplibregl.Marker({ element, draggable: !props.disabled && !props.placement })
        .setLngLat([house.coordinates.lon, house.coordinates.lat]).addTo(map.current);
      marker.on("dragend", () => { const point = marker.getLngLat(); propsRef.current.onChangeHouse(house.house_id, { coordinates: { lon: point.lng, lat: point.lat } }); });
      houseMarkers.current.push(marker);
    }
    return () => houseMarkers.current.forEach(marker => marker.remove());
  }, [ready, props.experiment.addedHouses, props.experiment.showHouses, props.hasResult, props.hasHouseChanges, props.disabled, props.placement, props.editingHouseId, props.pointGuidance]);

  useEffect(() => {
    if (!ready || !map.current) return;
    (map.current.getSource("selected") as GeoJSONSource).setData(props.selected ? {
      type: "FeatureCollection", features: [{ type: "Feature", geometry: props.selected.geometry, properties: {} }],
    } : EMPTY);
  }, [ready, props.selected]);

  useEffect(() => {
    if (!ready || !map.current) return;
    const feature = props.state.routes.features.find(f => f.properties.trip_id === props.activeTrip);
    (map.current.getSource("route") as GeoJSONSource).setData(feature ? { type: "FeatureCollection", features: [feature] } : EMPTY);
    const coords = feature?.geometry.coordinates;
    (map.current.getSource("endpoints") as GeoJSONSource).setData(coords ? {
      type: "FeatureCollection", features: [
        { type: "Feature", geometry: { type: "Point", coordinates: coords[0] }, properties: { label: "А · " + feature.properties.origin_label } },
        { type: "Feature", geometry: { type: "Point", coordinates: coords[coords.length - 1] }, properties: { label: "Б · " + feature.properties.destination_label } },
      ],
    } : EMPTY);
  }, [ready, props.state, props.activeTrip]);

  useEffect(() => {
    if (!ready || !map.current || !props.focus) return;
    const active = propsRef.current.state.routes.features.find(f => f.properties.trip_id === propsRef.current.activeTrip);
    const personal = propsRef.current.personal;
    const personalCoords = [...(personal?.car_route?.geometry.coordinates || []), ...(personal?.walk_route?.geometry.coordinates || [])];
    const requested = propsRef.current.experiment.routeEnabled ? propsRef.current.experiment.points.filter((p): p is Coordinate => !!p).map(p => [p.lon, p.lat]) : [];
    const geometry = personalCoords.length ? { coordinates: personalCoords } : active?.geometry || (requested.length > 1 ? { coordinates: requested } : propsRef.current.selected?.geometry);
    if (geometry) {
      const bounds = geometry.coordinates.reduce((b, c) => b.extend(c as [number, number]), new maplibregl.LngLatBounds());
      map.current.fitBounds(bounds, { padding: { top: 120, right: 65, bottom: 125, left: 35 }, maxZoom: active ? 15.8 : 16.2, duration: propsRef.current.reducedMotion ? 0 : 550 });
    }
  }, [ready, props.focus]);

  useEffect(() => {
    if (!ready || !map.current) return;
    const instance = map.current;
    const source = instance.getSource("point-guidance") as GeoJSONSource;
    const hint = props.pointGuidance;
    const data: FeatureCollection = hint ? { type: "FeatureCollection", features: [
      { type: "Feature", properties: { kind: "direction" }, geometry: { type: "LineString", coordinates: [[hint.from.lon, hint.from.lat], [hint.to.lon, hint.to.lat]] } },
      { type: "Feature", properties: { kind: "origin" }, geometry: { type: "Point", coordinates: [hint.from.lon, hint.from.lat] } },
    ] } : EMPTY;
    source.setData(data);
    guidanceMarker.current?.remove(); guidanceMarker.current = null;
    if (!hint) return;
    const element = document.createElement("button");
    element.type = "button"; element.className = "point-guidance-target";
    element.setAttribute("aria-label", `Переставить точку ${hint.label} сюда`);
    element.textContent = "+";
    const label = document.createElement("span"); label.textContent = "Сюда"; element.appendChild(label);
    element.addEventListener("click", event => { event.stopPropagation(); if (!propsRef.current.disabled) propsRef.current.onApplyGuidance(); });
    guidanceMarker.current = new maplibregl.Marker({ element }).setLngLat([hint.to.lon, hint.to.lat]).addTo(instance);
    const previousMinZoom = instance.getMinZoom();
    instance.setMinZoom(0);
    const fit = (duration: number) => {
      const height = instance.getContainer().clientHeight;
      const bottom = Math.min(70, height * .4);
      const top = Math.min((guidanceCard.current?.offsetHeight || 140) + 20, Math.max(0, height - bottom - 24));
      instance.fitBounds([[hint.from.lon, hint.from.lat], [hint.to.lon, hint.to.lat]], {
        padding: { top, right: 45, bottom, left: 45 }, maxZoom: 16.5, duration,
      });
    };
    fit(propsRef.current.reducedMotion ? 0 : 450);
    let initialResize = true;
    const observer = new ResizeObserver(() => { if (initialResize) initialResize = false; else fit(0); });
    observer.observe(instance.getContainer());
    return () => {
      observer.disconnect(); guidanceMarker.current?.remove(); guidanceMarker.current = null;
      if (map.current === instance) instance.setMinZoom(previousMinZoom);
    };
  }, [ready, props.pointGuidance]);

  useEffect(() => {
    if (!ready || !map.current || !props.guidanceFocus || propsRef.current.pointGuidance) return;
    map.current.easeTo({ center: [props.guidanceFocus.lon, props.guidanceFocus.lat], zoom: Math.max(14.8, map.current.getZoom()), padding: 0, duration: propsRef.current.reducedMotion ? 0 : 400 });
  }, [ready, props.guidanceFocus]);

  useEffect(() => {
    if (!ready || !props.resetKey) return;
    map.current?.easeTo({ center: propsRef.current.data.center, zoom: 14.8, pitch: 0, bearing: 0, padding: 0, duration: propsRef.current.reducedMotion ? 0 : 350 });
    setPitched(false);
  }, [ready, props.resetKey]);

  // Visual markers do not affect the model. Wait for the worker before scheduling another update.
  useEffect(() => {
    if (!ready || !map.current) return;
    const instance = map.current;
    const source = instance.getSource("cars") as GeoJSONSource;
    if (!playing || props.reducedMotion) { source.setData(EMPTY); return; }
    const prepared = props.state.routes.features.map((feature, index) => {
      const coords = feature.geometry.coordinates;
      const cumulative = [0];
      for (let j = 1; j < coords.length; j++) cumulative.push(cumulative[j - 1] + Math.hypot((coords[j][0] - coords[j - 1][0]) * .73, coords[j][1] - coords[j - 1][1]));
      return { coords, cumulative, total: cumulative[cumulative.length - 1], offset: index * .081,
        markers: Math.min(economy ? 4 : 12, Math.max(1, Math.round(feature.properties.vehicle_count / 15))),
        duration: Math.max(feature.properties.time_s * 50, 10000) };
    }).filter(route => route.total > 0);
    const markers = prepared.flatMap(route => Array.from({ length: route.markers }, (_, index) => ({ route, offset: index / route.markers,
      feature: { type: "Feature" as const, geometry: { type: "Point" as const, coordinates: [0, 0] }, properties: {} } })));
    const frameData: FeatureCollection<Point> = { type: "FeatureCollection", features: markers.map(marker => marker.feature) };
    let stopped = false;
    let pending = false;
    let timer = 0;
    let frame = 0;
    const schedule = () => {
      if (stopped || document.hidden) return;
      timer = window.setTimeout(() => { frame = requestAnimationFrame(tick); }, economy ? 100 : 50);
    };
    const tick = (now: number) => {
      frame = 0;
      if (stopped || document.hidden) return;
      if (instance.isMoving() || propsRef.current.disabled || !source.loaded()) { schedule(); return; }
      for (const { route, offset, feature } of markers) {
        const target = ((now / route.duration + route.offset + offset) % 1) * route.total;
        let lo = 1, hi = route.cumulative.length - 1;
        while (lo < hi) { const mid = (lo + hi) >>> 1; if (route.cumulative[mid] < target) lo = mid + 1; else hi = mid; }
        const span = route.cumulative[lo] - route.cumulative[lo - 1];
        const t = span ? (target - route.cumulative[lo - 1]) / span : 0;
        const a = route.coords[lo - 1], b = route.coords[lo];
        feature.geometry.coordinates[0] = a[0] + (b[0] - a[0]) * t;
        feature.geometry.coordinates[1] = a[1] + (b[1] - a[1]) * t;
      }
      pending = true;
      void source.setData(frameData, true).catch(() => {}).finally(() => { pending = false; schedule(); });
    };
    const visibility = () => {
      clearTimeout(timer); cancelAnimationFrame(frame);
      if (!document.hidden && !pending) schedule();
    };
    schedule();
    document.addEventListener("visibilitychange", visibility);
    return () => { stopped = true; clearTimeout(timer); cancelAnimationFrame(frame); document.removeEventListener("visibilitychange", visibility); };
  }, [ready, playing, props.state, props.reducedMotion, economy]);

  const resetView = () => { map.current?.easeTo({ center: props.data.center, zoom: 14.8, pitch: 0, bearing: 0, padding: 0, duration: props.reducedMotion ? 0 : 350 }); setPitched(false); };

  return <section className="map-panel" aria-label="Интерактивная карта Первой Речки">
    <div className="map-stage">
      <div ref={container} className="map-canvas" />
      {mapError && <SvgFallback data={props.data} state={props.state} selected={props.selected} onSelect={props.onSelect} disabled={props.disabled} activeTrip={props.activeTrip} focus={props.focus} resetKey={props.resetKey} extras={props} />}
      {(!ready || !painted) && !mapError && <div className="map-loading"><span className="spinner" />Загружаем дорожную сеть</div>}
      <div className="map-top">
        <div className="phase-switch" role="group" aria-label="Состояние карты">
          <button className={props.phase === "before" ? "active" : ""} onClick={() => props.onPhase("before")} aria-pressed={props.phase === "before"}>До изменения</button>
          <button className={props.phase === "after" ? "active" : ""} disabled={!props.hasResult} onClick={() => props.onPhase("after")} aria-pressed={props.phase === "after"}>После изменения{props.hasResult && <span className="tiny-dot" />}</button>
        </div>
        <span className="map-location"><span className="live-dot" />ПЕРВАЯ РЕЧКА</span>
      </div>
      <div className="map-label"><span className="map-kicker">ВЛАДИВОСТОК</span><strong>Первая Речка</strong><span>Одно решение. Десятки новых путей.</span></div>
      {props.placement && !props.pointGuidance && <div className="placement-hint" role="status"><span>{props.placement.kind === "road" ? props.drawingRoad?.points.length ? props.drawingRoad.points.length >= 12 ? "Достигнут предел: 12 точек. Нажмите «Готово»" : "Добавляйте повороты и конец дороги, затем нажмите «Готово»" : "Поставьте начало новой дороги рядом с перекрёстком" : props.placement.kind === "demolish" ? "Нажмите на выделенный дом: машины его жителей исчезнут из сценария" : props.placement.kind === "house" ? props.placement.houseId ? "Выберите новое положение дома" : "Нажмите на карту — появится дом с настройками" : props.placement.index === 0 ? "Поставьте точку А на карте" : props.placement.index === props.experiment.points.length - 1 ? "Поставьте точку Б на карте" : `Поставьте точку «Через ${props.placement.index}»`}</span><button onClick={props.onCancelPlacement} aria-label="Отменить выбор точки"><X size={14} /></button></div>}
      {props.pointGuidance && <aside ref={guidanceCard} className="point-guidance-card" role="alert" aria-label="Как переставить точку">
        <div className="point-guidance-heading"><Route size={20} /><strong>Переставьте «{props.pointGuidance.label}»</strong><button className="icon-button" aria-label="Скрыть подсказку" onClick={props.onDismissGuidance}><X size={18} /></button></div>
        <p>{props.pointGuidance.message}</p>
        <div className="point-guidance-legend"><span><i className="guidance-origin-dot" />Сейчас</span><span className="guidance-dashes" aria-hidden="true" /><span><i className="guidance-target-dot" />Сюда · {distance(props.pointGuidance.distance_m)}</span></div>
        <button className="primary-button" disabled={props.disabled} onClick={props.onApplyGuidance}>Переставить сюда<Check size={18} /></button>
      </aside>}
      <div className="map-controls">
        {!mapError && <>
        <div className="control-stack"><button aria-label="Приблизить карту" title="Приблизить" onClick={() => map.current?.zoomIn()}><Plus size={18} /></button><button aria-label="Отдалить карту" title="Отдалить" onClick={() => map.current?.zoomOut()}><Minus size={18} /></button></div>
        <button className="map-control" aria-label="Начальный вид карты" title="Вернуться к Первой Речке" onClick={resetView}><LocateFixed size={18} /></button>
        <button className={`map-control pitch-control ${pitched ? "on" : ""}`} aria-label="Наклонить карту 2.5D" aria-pressed={pitched} onClick={() => { map.current?.easeTo({ pitch: pitched ? 0 : 52, duration: props.reducedMotion ? 0 : 350 }); setPitched(!pitched); }}><Box size={18} /></button>
        </>}
        <button className={`map-control settings-map-control ${showLayers ? "on" : ""}`} aria-label="Настроить слои карты" aria-expanded={showLayers} onClick={() => setShowLayers(!showLayers)}><Layers2 size={18} /></button>
      </div>
      <AppDialog className="map-settings-dialog" open={showLayers} onClose={() => setShowLayers(false)} label="Настройки карты">
        <div className="editor-heading" data-sheet-handle><strong>Настройки карты</strong><button className="icon-button" aria-label="Закрыть слои" onClick={() => setShowLayers(false)}><X size={20} /></button></div>
        <div className="dialog-scroll map-settings-content">
          {!mapError && <div className="settings-map-buttons"><button className="quiet-action" onClick={() => map.current?.zoomOut()} aria-label="Отдалить карту"><Minus size={18} />Меньше</button><button className="quiet-action" onClick={() => map.current?.zoomIn()} aria-label="Приблизить карту"><Plus size={18} />Больше</button><button className="quiet-action" onClick={() => { resetView(); setShowLayers(false); }}><LocateFixed size={18} />Начальный вид карты</button></div>}
        <label><input type="checkbox" checked={showFlow} onChange={e => setShowFlow(e.target.checked)} />Нагрузка на дороги</label>
        <label><input type="checkbox" checked={showBuildings} onChange={e => { setShowBuildings(e.target.checked); map.current?.setLayoutProperty("buildings", "visibility", e.target.checked ? "visible" : "none"); }} />Здания и кварталы</label>
        <label><input type="checkbox" checked={!scheme} onChange={e => { setScheme(!e.target.checked); map.current?.setLayoutProperty("basemap", "visibility", e.target.checked ? "visible" : "none"); }} />Подложка OpenStreetMap</label>
        <label><input type="checkbox" checked={economy} onChange={event => setEconomy(event.target.checked)} />Экономить ресурсы</label>
        <small>Экономный режим уменьшает детализацию и частоту анимации. Схема работает без интернета.</small>

          <label><input type="checkbox" checked={props.experiment.showParkings} onChange={event => props.onDisplayChange({ showParkings: event.target.checked })} />Парковки</label>
          <label><input type="checkbox" checked={props.experiment.showHouses} onChange={event => props.onDisplayChange({ showHouses: event.target.checked })} />Дома в расчёте</label>
          {props.mobile && <button className="quiet-action" disabled={props.reducedMotion} onClick={() => setPlaying(!playing)} aria-label={playing ? "Приостановить анимацию" : "Продолжить анимацию"}>{playing ? <Pause size={18} /> : <Play size={18} />}Анимация машин: {playing ? "включена" : "на паузе"}</button>}
          {props.reducedMotion && <p className="field-hint">Анимация отключена системной настройкой уменьшения движения.</p>}
          <div className="settings-legend"><strong>Нагрузка на дороги</strong><span><i className="legend-dot low" />Свободно</span><span><i className="legend-dot elevated" />Много машин</span><span><i className="legend-dot high" />Плотный поток</span><span><i className="closed-line" />Перекрыто</span></div>
        </div>
      </AppDialog>
      <div className="map-compass" aria-hidden="true"><span>С</span><i /></div>
      {hover && !props.disabled && <div className="map-tooltip" style={{ left: (container.current?.offsetLeft || 0) + Math.min(hover.x + 16, (container.current?.clientWidth || 800) - 235), top: Math.max(hover.y - 60, 70) }}><strong>{hover.name}</strong><span>{hover.direction}</span></div>}
      <div className="map-bottom">{!mapError && !props.mobile ? <button className={`animation-toggle ${playing ? "on" : ""}`} disabled={props.reducedMotion} title={props.reducedMotion ? "Анимация отключена настройкой уменьшения движения" : undefined} onClick={() => setPlaying(!playing)} aria-label={playing ? "Приостановить анимацию" : "Продолжить анимацию"}>{playing ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}<span>{playing ? "Движение машин" : "Анимация на паузе"}</span></button> : mapError ? <span className="map-mode">Схема без WebGL</span> : null}
        <span className="map-mode">{mapError ? "Схема SVG" : scheme ? "Локальная схема" : "Карта OSM"}{tileError && <Check size={12} />}</span></div>
      {props.disabled && <div className="calculation-overlay"><span className="spinner" /><span>Ищем новые пути<span className="loading-dots">…</span></span></div>}
    </div>
      <div className="map-legend"><span className="legend-title">Движение</span><span><i className="legend-dot low" />Свободно</span><span><i className="legend-dot elevated" />Много машин</span><span><i className="legend-dot high" />Плотный поток</span><span><i className="closed-line" />Перекрыто</span></div>
  </section>;
}

// WebGL недоступен: та же реальная геометрия остаётся интерактивной.
function SvgFallback({ data, state, selected, onSelect, disabled, activeTrip, focus, resetKey, extras }: { data: MapData; state: State; selected: Segment | null; onSelect: (id: string) => void; disabled: boolean; activeTrip: string | null; focus: number; resetKey: number; extras: Props }) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [pixelScale, setPixelScale] = useState(1);
  useEffect(() => {
    const element = svg.current; if (!element) return;
    const observer = new ResizeObserver(() => setPixelScale(Math.max(.05, Math.min(element.clientWidth / 1000, element.clientHeight / 850))));
    observer.observe(element); return () => observer.disconnect();
  }, []);
  const coords = data.edges.features.flatMap(f => f.geometry.coordinates);
  const bounds = { minX: Math.min(...coords.map(c => c[0])), maxX: Math.max(...coords.map(c => c[0])), minY: Math.min(...coords.map(c => c[1])), maxY: Math.max(...coords.map(c => c[1])) };
  const xy = (c: number[]) => [((c[0] - bounds.minX) / (bounds.maxX - bounds.minX)) * 1000, (1 - (c[1] - bounds.minY) / (bounds.maxY - bounds.minY)) * 850];
  const project = (c: number[]) => xy(c).join(",");
  const route = state.routes.features.find(f => f.properties.trip_id === activeTrip);
  const labels = [...data.edges.features].sort((a, b) => b.properties.length_m - a.properties.length_m).filter((f, i, all) => f.properties.name !== "Безымянный проезд" && all.findIndex(x => x.properties.name === f.properties.name) === i).slice(0, 16);
  const latest = useRef({ route, selected, xy, personal: extras.personal });
  latest.current = { route, selected, xy, personal: extras.personal };
  useEffect(() => {
    if (!focus) return;
    const personal = latest.current.personal;
    const personalCoordinates = [...(personal?.car_route?.geometry.coordinates || []), ...(personal?.walk_route?.geometry.coordinates || [])];
    const geometry = personalCoordinates.length ? { coordinates: personalCoordinates } : latest.current.route?.geometry || latest.current.selected?.geometry;
    if (!geometry) return;
    const points = geometry.coordinates.map(latest.current.xy);
    const minX = Math.min(...points.map(p => p[0])), maxX = Math.max(...points.map(p => p[0]));
    const minY = Math.min(...points.map(p => p[1])), maxY = Math.max(...points.map(p => p[1]));
    const nextZoom = Math.min(6, Math.max(1, Math.min(750 / (maxX - minX + 1), 580 / (maxY - minY + 1))));
    setZoom(nextZoom);
    setPan({ x: (500 - (minX + maxX) / 2) * nextZoom, y: (425 - (minY + maxY) / 2) * nextZoom });
  }, [focus]);
  useEffect(() => {
    if (!extras.pointGuidance) return;
    const { from, to } = extras.pointGuidance;
    const a = latest.current.xy([from.lon, from.lat]), b = latest.current.xy([to.lon, to.lat]);
    const element = svg.current;
    if (!element) return;
    const width = element.clientWidth, height = element.clientHeight;
    const card = element.closest(".map-stage")?.querySelector(".point-guidance-card")?.getBoundingClientRect().height || 140;
    const bottom = Math.min(70, height * .4), top = Math.min(card + 20, Math.max(0, height - bottom - 24));
    const availableHeight = Math.max(24, height - top - bottom);
    const nextZoom = Math.min(6, Math.max(.05, Math.min((width - 90) / (pixelScale * (Math.abs(a[0] - b[0]) + 1)), availableHeight / (pixelScale * (Math.abs(a[1] - b[1]) + 1)))));
    const offsetY = (height - 850 * pixelScale) / 2;
    const targetY = top + availableHeight / 2;
    setZoom(nextZoom); setPan({ x: (500 - (a[0] + b[0]) / 2) * nextZoom, y: (425 - (a[1] + b[1]) / 2) * nextZoom + (targetY - offsetY) / pixelScale - 425 });
  }, [extras.pointGuidance, pixelScale]);
  useEffect(() => {
    if (!extras.guidanceFocus) return;
    const point = latest.current.xy([extras.guidanceFocus.lon, extras.guidanceFocus.lat]);
    setZoom(3); setPan({ x: (500 - point[0]) * 3, y: (425 - point[1]) * 3 });
  }, [extras.guidanceFocus]);
  useEffect(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, [resetKey]);
  return <><svg ref={svg} className="svg-map" viewBox="0 0 1000 850" aria-label="Локальная дорожная схема" onWheel={e => setZoom(z => Math.min(6, Math.max(1, z * (e.deltaY > 0 ? 0.9 : 1.1))))}
    onClick={e => { if (!extras.placement || disabled) return; const matrix = (e.currentTarget.querySelector("g") as SVGGraphicsElement)?.getScreenCTM(); if (!matrix) return; const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse()); extras.onMapPoint({ lon: bounds.minX + point.x / 1000 * (bounds.maxX - bounds.minX), lat: bounds.maxY - point.y / 850 * (bounds.maxY - bounds.minY) }); }}
    onPointerDown={e => { if (e.target === e.currentTarget && !extras.placement) { drag.current = { x: e.clientX, y: e.clientY, startX: pan.x, startY: pan.y }; e.currentTarget.setPointerCapture(e.pointerId); } }}
    onPointerMove={e => { if (drag.current) setPan({ x: drag.current.startX + (e.clientX - drag.current.x) * 1.5, y: drag.current.startY + (e.clientY - drag.current.y) * 1.5 }); }}
    onPointerUp={() => { drag.current = null; }}>
    <g transform={`translate(${pan.x} ${pan.y}) translate(500 425) scale(${zoom}) translate(-500 -425)`}>
      {data.edges.features.map(f => {
        const load = state.edge_loads[f.properties.edge_id];
        const color = mapColor(load?.status === "closed" ? "#ff6c75" : load?.load_class === "high" ? "#f17f6e" : load?.load_class === "elevated" ? "#e7bb62" : load?.flow ? "#8ab97a" : "#424e49", extras.dark);
        return <polyline key={f.properties.edge_id} points={f.geometry.coordinates.map(project).join(" ")} fill="none" stroke={load?.status === "closed" ? mapColor("#ff6c75", extras.dark) : selected?.segment_id === f.properties.segment_id ? mapColor("#f5f9ed", extras.dark) : color} strokeWidth={selected?.segment_id === f.properties.segment_id ? 7 : 3} strokeDasharray={load?.status === "closed" ? "5 4" : undefined} vectorEffect="non-scaling-stroke" strokeLinecap="round" className="svg-road" onClick={() => !disabled && !extras.placement && onSelect(f.properties.segment_id)}><title>{f.properties.name} · {f.properties.direction}</title></polyline>;
      })}
      {labels.map(f => { const [x, y] = xy(f.geometry.coordinates[Math.floor(f.geometry.coordinates.length / 2)]); return <text key={f.properties.name} x={x} y={y - 5} fill={mapColor("#a1b594", extras.dark)} fontSize="11" textAnchor="middle" paintOrder="stroke" stroke={mapColor("#19241c", extras.dark)} strokeWidth="3" style={{ pointerEvents: "none" }}>{f.properties.name}</text>; })}
      {(!extras.hasResult || extras.phase === "after") && extras.experiment.addedRoads.filter(road => road.road_id !== extras.drawingRoad?.road_id).map(road => {
        const snapshot = extras.hasResult ? extras.addedRoads.find(item => item.road_id === road.road_id) : null;
        const points = snapshot?.geometry.coordinates || road.points.map(point => [point.lon, point.lat]);
        return <polyline key={road.road_id} points={points.map(project).join(" ")} fill="none" stroke={mapColor("#c7ed83", extras.dark)} strokeWidth={5} strokeDasharray={snapshot ? undefined : "7 4"} vectorEffect="non-scaling-stroke" strokeLinecap="round" onClick={event => { if (!extras.placement && !disabled) { event.stopPropagation(); extras.onEditRoad(road.road_id); } }}><title>{road.name} · {road.lanes} полос в каждом направлении</title></polyline>;
      })}
      {extras.drawingRoad && <><polyline points={extras.drawingRoad.points.map(point => project([point.lon, point.lat])).join(" ")} fill="none" stroke={mapColor("#c7ed83", extras.dark)} strokeWidth={4} strokeDasharray="7 4" vectorEffect="non-scaling-stroke" />{extras.drawingRoad.points.map((point, index) => { const [x, y] = xy([point.lon, point.lat]); return <circle key={index} cx={x} cy={y} r={6 / zoom} fill={mapColor(index === extras.drawingErrorIndex ? "#ff6c75" : "#c7ed83", extras.dark)} stroke={mapColor("#141a19", extras.dark)} strokeWidth={2 / zoom} />; })}</>}
      {route && <polyline points={route.geometry.coordinates.map(project).join(" ")} fill="none" stroke={mapColor("#c4d7ff", extras.dark)} strokeWidth="4" strokeDasharray="8 4" vectorEffect="non-scaling-stroke" style={{ pointerEvents: "none" }} />}
      {extras.personal?.car_route && <polyline points={extras.personal.car_route.geometry.coordinates.map(project).join(" ")} fill="none" stroke={mapColor("#b4caff", extras.dark)} strokeWidth="4" vectorEffect="non-scaling-stroke" />}
      {extras.personal?.walk_route && <polyline points={extras.personal.walk_route.geometry.coordinates.map(project).join(" ")} fill="none" stroke={mapColor("#79d9c7", extras.dark)} strokeWidth="3" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />}
      {extras.experiment.showParkings && extras.catalogs?.parkings.map(p => { const [x, y] = xy(p.coordinates); return <g key={p.parking_id} onClick={e => { if (!extras.placement && !disabled) { e.stopPropagation(); extras.onParking(p.parking_id); } }} style={{ cursor: "pointer" }}><circle cx={x} cy={y} r={9 / zoom} fill={mapColor("#233648", extras.dark)} stroke={mapColor("#86bddd", extras.dark)} strokeWidth={1 / zoom} /><text x={x} y={y + 4 / zoom} textAnchor="middle" fill={mapColor("#b7dbf4", extras.dark)} fontSize={11 / zoom}>P</text><title>{p.name}</title></g>; })}
      {extras.experiment.showHouses && extras.catalogs?.houses.map(h => { const [x, y] = xy(h.coordinates); const removed = (!extras.hasResult || extras.hasHouseChanges) && extras.experiment.removedHouses.includes(h.house_id); return <g key={h.house_id} role="button" tabIndex={0} aria-label={`${removed ? "Вернуть" : "Снести"} дом ${h.name}`} onKeyDown={event => { if (event.key === "Enter" && !disabled) extras.onHouse(h.house_id); }} onClick={e => { if ((!extras.placement || extras.placement.kind === "demolish") && !disabled) { e.stopPropagation(); extras.onHouse(h.house_id); } }} style={{ cursor: "pointer" }}><circle cx={x} cy={y} r={(extras.placement?.kind === "demolish" ? 18 : 10) / zoom} fill={mapColor("#273626", extras.dark)} stroke={mapColor(removed ? "#f18b7d" : "#c7ed83", extras.dark)} strokeWidth={2 / zoom} /><text x={x} y={y + 4 / zoom} textAnchor="middle" fill={mapColor("#c7ed83", extras.dark)} fontSize={11 / zoom}>{removed ? "×" : "Д"}</text><title>{h.name} · {h.residents} жителей</title></g>; })}
      {extras.experiment.showHouses && (!extras.hasResult || extras.hasHouseChanges) && extras.experiment.addedHouses.map(h => { const [x, y] = xy([h.coordinates.lon, h.coordinates.lat]); return <g key={h.house_id} role="button" tabIndex={0} aria-label={`Настроить метку дома · ${h.residents} жителей`} onKeyDown={e => { if (e.key === "Enter" && !disabled) extras.onEditHouse(h.house_id); }} onClick={e => { if (!extras.placement && !disabled) { e.stopPropagation(); extras.onEditHouse(h.house_id); } }} style={{ cursor: "pointer" }}><circle cx={x} cy={y} r={13 / zoom} fill={mapColor("#273626", extras.dark)} stroke={mapColor("#88d8c4", extras.dark)} strokeWidth={2 / zoom} /><text x={x} y={y + 4 / zoom} textAnchor="middle" fill={mapColor("#88d8c4", extras.dark)} fontSize={11 / zoom}>Д</text><title>{`Новый дом · ${h.residents} жителей. Нажмите для настройки`}</title></g>; })}
      {extras.experiment.routeEnabled && extras.experiment.points.map((p, index) => { if (!p) return null; const [x, y] = xy([p.lon, p.lat]); return <g key={index}><circle cx={x} cy={y} r={12 / zoom} fill={mapColor("#b4caff", extras.dark)} stroke={mapColor("#172522", extras.dark)} strokeWidth={2 / zoom} /><text x={x} y={y + 4 / zoom} textAnchor="middle" fill={mapColor("#172522", extras.dark)} fontSize={12 / zoom}>{index === 0 ? "А" : index === extras.experiment.points.length - 1 ? "Б" : index}</text></g>; })}
      {extras.pointGuidance && (() => {
        const hint = extras.pointGuidance, a = xy([hint.from.lon, hint.from.lat]), b = xy([hint.to.lon, hint.to.lat]), scale = zoom * pixelScale;
        return <g className="svg-point-guidance">
          <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={mapColor("#f5f9ed", extras.dark)} strokeWidth={3} strokeDasharray="6 6" vectorEffect="non-scaling-stroke" pointerEvents="none" />
          <circle cx={a[0]} cy={a[1]} r={10 / scale} fill={mapColor("#ff6c75", extras.dark)} stroke={mapColor("#141a19", extras.dark)} strokeWidth={2 / scale} pointerEvents="none" />
          <g role="button" tabIndex={0} aria-label={`Переставить точку ${hint.label} сюда`} onClick={event => { event.stopPropagation(); if (!disabled) extras.onApplyGuidance(); }} onKeyDown={event => { if (!disabled && ["Enter", " "].includes(event.key)) { event.preventDefault(); event.stopPropagation(); extras.onApplyGuidance(); } }} style={{ cursor: "pointer" }}>
            <circle cx={b[0]} cy={b[1]} r={22 / scale} fill="transparent" />
            <circle cx={b[0]} cy={b[1]} r={12 / scale} fill={mapColor("#f5f9ed", extras.dark)} stroke={mapColor("#141a19", extras.dark)} strokeWidth={3 / scale} />
            <text x={b[0]} y={b[1] + 32 / scale} textAnchor="middle" fontSize={13 / scale} fontWeight="700" fill={mapColor("#f5f9ed", extras.dark)} stroke={mapColor("#141a19", extras.dark)} strokeWidth={3 / scale} paintOrder="stroke">Сюда</text>
          </g>
        </g>;
      })()}
    </g>
  </svg><span className="svg-attribution">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a></span><div className="map-controls svg-fallback-controls"><div className="control-stack"><button aria-label="Приблизить карту" onClick={() => setZoom(z => Math.min(6, z * 1.3))}><Plus size={18} /></button><button aria-label="Отдалить карту" onClick={() => setZoom(z => Math.max(1, z / 1.3))}><Minus size={18} /></button></div><button className="map-control" aria-label="Начальный вид карты" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}><LocateFixed size={18} /></button></div></>;
}
