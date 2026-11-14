"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import AuthStatus from "./AuthStatus";
import { trackGoal } from "@/lib/analytics";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowDown, ArrowDownRight, ArrowLeftRight, ArrowRight, ArrowUpRight, Ban, Check, ChevronDown, ChevronRight, CircleHelp, Clock3, Download, Expand, GitBranch, Info, Layers3, MapPin, MousePointer2, Play, RefreshCw, RotateCcw, Route, Search, SlidersHorizontal, Sparkles, TrafficCone, TrendingUp, Users, X, Zap } from "lucide-react";
import { api, distance, number, shortTime, time, timeChange } from "@/lib/api";
import { nearestJunction, plural, roadLanes, roadLength, trafficLabel } from "@/lib/roads";
import { firstMisplacedPoint, suggestPoint, suggestRoadPoint } from "@/lib/point-guidance";
import type { Delta, MapData, Preset, Run, ScenarioType, Segment, State } from "@/lib/types";
import type { Catalogs, Coordinate, Experiment, HouseDraft, Placement, PointGuidance, RoadDraft, ScenarioRoad } from "@/lib/types";
import ExperimentPanel, { ExperimentHelp, initialExperiment, WEATHER_NAMES } from "./ExperimentPanel";
import PersonalResult from "./PersonalResult";
import HouseEditor from "./HouseEditor";
import RoadEditor from "./RoadEditor";
import AppDialog from "./AppDialog";
import { House as HouseIcon, Map as MapIcon, Moon, Sun, ChevronUp, PanelBottom, BarChart3, Navigation, Trash2, Undo2, Plus } from "lucide-react";
import * as m from "motion/react-m";
import { AdaptiveSheet, AppPreloader, DesignProvider, MapSkeleton, MobileToolbar, notify, useAppEnvironment } from "./DesignSystem";

const RoadMap = dynamic(() => import("./RoadMap"), { ssr: false, loading: () => <MapSkeleton message="Готовим карту Первой Речки" /> });
const NO_ADDED_ROADS: ScenarioRoad[] = [];
type PanelView = "map" | "scenario" | "result";
const useClientLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function Butterfly({ className = "" }: { className?: string }) {
  return <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M23 22C9 2 1 12 10 23 0 36 13 43 23 27M25 22C39 2 47 12 38 23 48 36 35 43 25 27" fill="currentColor" /><path d="M24 18v15" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>;
}

function PlusIcon() {
  return <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M8 2v12M2 8h12" /></svg>;
}

const TYPES: { id: ScenarioType; label: string; icon: typeof Ban; description: string }[] = [
  { id: "none", label: "Не менять", icon: Route, description: "Сохранить существующие дороги" },
  { id: "closure", label: "Перекрытие", icon: Ban, description: "Полностью закрыть участок" },
  { id: "capacity_reduction", label: "Сужение", icon: SlidersHorizontal, description: "Уменьшить количество машин, которое может проехать" },
  { id: "demand_increase", label: "Час пик", icon: TrendingUp, description: "Добавить машины на все направления" },
];

export default function Simulator() {
  return <DesignProvider><SimulatorWorkspace /></DesignProvider>;
}

function SimulatorWorkspace() {
  const { mobile, dark, reducedMotion, toggleTheme } = useAppEnvironment();
  const [panelView, setPanelView] = useState<PanelView>("map");
  const panelScrollRef = useRef<HTMLDivElement>(null);
  const panelPositions = useRef({ scenario: 0, result: 0 });
  const lastResultId = useRef<string | null>(null);
  const [data, setData] = useState<MapData | null>(null);
  const [baseline, setBaseline] = useState<State | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [catalogs, setCatalogs] = useState<Catalogs | null>(null);
  const [experiment, setExperiment] = useState<Experiment>(initialExperiment);
  const [placement, setPlacement] = useState<Placement>(null);
  const [editingHouse, setEditingHouse] = useState<HouseDraft | null>(null);
  const [editingRoad, setEditingRoad] = useState<RoadDraft | null>(null);
  const editorReturn = useRef<PanelView>("map");
  const repositionDraft = useRef<HouseDraft | null>(null);
  const roadReturn = useRef<PanelView>("map");
  const [drawingRoad, setDrawingRoad] = useState<RoadDraft | null>(null);
  const [roadError, setRoadError] = useState<{ text: string; index: number | null } | null>(null);
  const [pointGuidance, setPointGuidance] = useState<PointGuidance | null>(null);
  const [guidanceFocus, setGuidanceFocus] = useState<Coordinate | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [baselineBusy, setBaselineBusy] = useState(false);
  const [baselineRetry, setBaselineRetry] = useState(0);
  const [initialError, setInitialError] = useState("");
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<Segment | null>(null);
  const [inspectSegment, setInspectSegment] = useState<Segment | null>(null);
  const [scenarioType, setScenarioType] = useState<ScenarioType>("none");
  const [factor, setFactor] = useState(0.5);
  const [demand, setDemand] = useState(1.4);
  const [run, setRun] = useState<Run | null>(null);
  const [phase, setPhase] = useState<"before" | "after">("before");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [activeTrip, setActiveTrip] = useState<string | null>(null);
  const [focus, setFocus] = useState(0);
  const [resetKey, setResetKey] = useState(0);
  const currentRunId = useRef<string | null>(null);
  currentRunId.current = run?.run_id || null;
  const [analysis, setAnalysis] = useState<{ text: string; source: string } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [editScenario, setEditScenario] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setInitialError("");
    Promise.all([
      api<MapData>("/map", undefined, controller.signal),
      api<{ scenarios: Preset[] }>("/scenarios", undefined, controller.signal),
      api<Catalogs>("/catalogs", undefined, controller.signal),
    ]).then(async ([mapData, scenarios, catalogData]) => {
      const initialState = await api<State & { dataset_version: string }>(`/baseline?vehicle_count=${catalogData.config.default_vehicle_count}`, undefined, controller.signal);
      if (mapData.dataset_version !== initialState.dataset_version) throw new Error("Версии карты и расчёта не совпали. Обновите данные.");
      setData(mapData); setBaseline(initialState); setPresets(scenarios.scenarios); setCatalogs(catalogData);
      setExperiment({ ...initialExperiment(), vehicleCount: catalogData.config.default_vehicle_count });
    }).catch(e => { if (!controller.signal.aborted) setInitialError(e.message); });
    return () => controller.abort();
  }, [retry]);

  const resetResult = useCallback(() => {
    currentRunId.current = null;
    setEditScenario(false);
    setRun(null); setPhase("before"); setActiveTrip(null); setAnalysis(null); setAnalysisError(""); setError(""); setInspectSegment(null);
  }, []);

  const countValid = !!catalogs && Number.isInteger(experiment.vehicleCount) && experiment.vehicleCount >= catalogs.config.min_vehicle_count && experiment.vehicleCount <= catalogs.config.max_vehicle_count;
  const pendingBaseline = baselineBusy || !!baseline && baseline.metrics.vehicle_count !== experiment.vehicleCount;
  useEffect(() => {
    if (!data || !catalogs || !countValid || baseline?.metrics.vehicle_count === experiment.vehicleCount) { setBaselineBusy(false); return; }
    const controller = new AbortController();
    setBaselineBusy(true);
    const timer = setTimeout(() => {
      api<State>(`/baseline?vehicle_count=${experiment.vehicleCount}`, undefined, controller.signal)
        .then(value => { if (!controller.signal.aborted) { setBaseline(value); setBaselineBusy(false); } })
        .catch(e => { if (!controller.signal.aborted) { setError(e.message); setBaselineBusy(false); } });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [data, catalogs, experiment.vehicleCount, countValid, baseline?.metrics.vehicle_count, baselineRetry]);

  const changeExperiment = useCallback((patch: Partial<Experiment>) => {
    setExperiment(previous => ({ ...previous, ...patch }));
    if (Object.keys(patch).some(key => key !== "showParkings" && key !== "showHouses")) { resetResult(); setPointGuidance(null); }
  }, [resetResult]);

  const beginPlacement = (action: Placement) => {
    setPointGuidance(null);
    if (action?.kind !== "road") setRoadError(null);
    if (action?.kind === "house" && action.houseId && editingHouse) repositionDraft.current = editingHouse;
    else if (action?.kind === "house") { editorReturn.current = panelView; repositionDraft.current = null; }
    setPlacement(action);
    if (action) { setEditingHouse(null); setEditingRoad(null); }
    if (action) setPanelView("map");
    setActionsOpen(false);
  };
  const startRoad = (previous?: RoadDraft) => {
    setPointGuidance(null); setRoadError(null);
    if (drawingRoad && !previous) { setPlacement({ kind: "road" }); setPanelView("map"); setActionsOpen(false); return; }
    if (drawingRoad && previous && drawingRoad.road_id !== previous.road_id) { notify("Сначала завершите или отмените сохранённый черновик дороги."); return; }
    if (busyRef.current || !data || (!previous && experiment.addedRoads.length >= 5)) return;
    if (!previous) roadReturn.current = panelView;
    else roadReturn.current = editorReturn.current;
    setDrawingRoad(previous ? { ...previous, points: [] } : { road_id: "user-" + crypto.randomUUID(), name: `Новая дорога ${experiment.addedRoads.length + 1}`, points: [], lanes: 1, speed_kmh: 40, two_way: true });
    setRoadError(null); setActionsOpen(false);
    setEditingHouse(null); setEditingRoad(null); setPlacement({ kind: "road" }); setPanelView("map");
  };
  const finishRoad = () => {
    if (!drawingRoad || drawingRoad.points.length < 2 || !data || !catalogs || busyRef.current) return;
    const radius = catalogs.config.snap_radius_m;
    const start = nearestJunction(data, drawingRoad.points[0], radius), end = nearestJunction(data, drawingRoad.points.at(-1)!, radius);
    if (!start || !end) {
      const index = !start ? 0 : drawingRoad.points.length - 1;
      setPointGuidance(suggestRoadPoint(data, drawingRoad, drawingRoad.points[index], index, index ? start?.nodeId : undefined));
      setRoadError({ text: `Выберите ${!start ? "начало" : "конец"} не дальше ${radius} м от перекрёстка.`, index }); return;
    }
    if (start.nodeId === end.nodeId) {
      setPointGuidance(suggestRoadPoint(data, drawingRoad, drawingRoad.points.at(-1)!, drawingRoad.points.length - 1, start.nodeId));
      setRoadError({ text: "Начало и конец совпали. Соедините два разных перекрёстка.", index: drawingRoad.points.length - 1 }); return;
    }
    const road = { ...drawingRoad, points: [start.point, ...drawingRoad.points.slice(1, -1), end.point] };
    if (roadLength(road.points) < 10 || roadLength(road.points) > 10000) {
      setPointGuidance(suggestRoadPoint(data, drawingRoad, drawingRoad.points.at(-1)!, drawingRoad.points.length - 1, start.nodeId));
      setRoadError({ text: "Длина дороги должна быть от 10 м до 10 км. Измените последнюю точку или уберите лишние повороты.", index: drawingRoad.points.length - 1 }); return;
    }
    editorReturn.current = roadReturn.current;
    setDrawingRoad(null); setRoadError(null); setPointGuidance(null); setPlacement(null); setEditingRoad(road);
  };
  const editRoad = (id: string) => {
    const road = experiment.addedRoads.find(item => item.road_id === id);
    if (!road) return;
    editorReturn.current = panelView;
    setEditingRoad({ ...road, points: [...road.points] }); setEditingHouse(null); setPlacement(null);
  };
  const closeRoad = (apply = false) => {
    if (apply && editingRoad) {
      if (!editingRoad.name.trim() || !Number.isInteger(editingRoad.lanes) || editingRoad.lanes < 1 || editingRoad.lanes > 6) return;
      const exists = experiment.addedRoads.some(item => item.road_id === editingRoad.road_id);
      changeExperiment({ addedRoads: exists ? experiment.addedRoads.map(item => item.road_id === editingRoad.road_id ? editingRoad : item) : [...experiment.addedRoads, editingRoad] });
    }
    setEditingRoad(null); setPanelView(editorReturn.current);
  };
  const closeHouse = (apply = false) => {
    if (apply && editingHouse) {
      if (!Number.isInteger(editingHouse.residents) || editingHouse.residents < 1 || editingHouse.residents > 20000) return;
      const hint = data && catalogs ? suggestPoint(data, editingHouse.coordinates, { kind: "house", houseId: editingHouse.house_id }, "Выезд из дома", catalogs.config.snap_radius_m, "origin") : null;
      if (hint) {
        repositionDraft.current = editingHouse; setEditingHouse(null); setPlacement({ kind: "house", houseId: editingHouse.house_id });
        setPointGuidance(hint); setPanelView("map"); return;
      }
      const exists = experiment.addedHouses.some(item => item.house_id === editingHouse.house_id);
      changeExperiment({ addedHouses: exists ? experiment.addedHouses.map(item => item.house_id === editingHouse.house_id ? editingHouse : item) : [...experiment.addedHouses, editingHouse], showHouses: true });
    }
    repositionDraft.current = null;
    setEditingHouse(null); setPanelView(editorReturn.current);
  };
  const cancelPlacement = () => {
    setPointGuidance(null);
    if (placement?.kind === "house" && placement.houseId && repositionDraft.current) {
      const original = experiment.addedHouses.find(house => house.house_id === placement.houseId);
      if (original) setEditingHouse({ ...repositionDraft.current, coordinates: original.coordinates });
      else repositionDraft.current = null;
    }
    if (placement?.kind === "road") { setDrawingRoad(null); setRoadError(null); setPanelView(roadReturn.current); }
    setPlacement(null);
  };
  const demolishHouse = (id: string) => {
    if (busyRef.current) return;
    const house = catalogs?.houses.find(item => item.house_id === id);
    if (!house) return;
    const restore = experiment.removedHouses.includes(id);
    changeExperiment({ removedHouses: restore ? experiment.removedHouses.filter(item => item !== id) : [...experiment.removedHouses, id], showHouses: true });
    setPlacement(null); setPanelView("scenario");
    notify(restore ? "Дом возвращён в сценарий" : `Дом снесён в сценарии: на ${number(house.residents)} машин меньше`);
  };
  const mapPoint = useCallback((point: Coordinate) => {
    if (busyRef.current || !placement) return;
    if (placement.kind === "demolish") return;
    if (placement.kind === "road") {
      let nextPoint = point;
      if (drawingRoad && !drawingRoad.points.length && data && catalogs) {
        const connection = nearestJunction(data, point, catalogs.config.snap_radius_m);
        if (!connection) {
          setPointGuidance(suggestRoadPoint(data, drawingRoad, point, 0));
          setRoadError({ text: `Выберите начало ближе к перекрёстку — в пределах ${catalogs.config.snap_radius_m} м.`, index: null }); return;
        }
        nextPoint = connection.point;
      }
      if (drawingRoad && drawingRoad.points.length >= 12) { setRoadError({ text: "Можно поставить до 12 точек. Завершите дорогу или уберите последнюю точку.", index: drawingRoad.points.length - 1 }); return; }
      setRoadError(null); setPointGuidance(null);
      setDrawingRoad(previous => previous && previous.points.length < 12 ? { ...previous, points: [...previous.points, nextPoint] } : previous);
      return;
    } else if (placement.kind === "route") {
      const points = [...experiment.points]; points[placement.index] = point;
      changeExperiment({ points, routeEnabled: true });
      const index = placement.index, end = index === points.length - 1;
      const hint = data && catalogs && !(end && experiment.parkingMode !== "none") ? suggestPoint(data, point, { kind: "route", index }, index === 0 ? "А" : end ? "Б" : `Через ${index}`, catalogs.config.snap_radius_m, index === 0 ? "origin" : end ? "destination" : "via") : null;
      if (hint) { setPointGuidance(hint); setPanelView("map"); return; }
      setPlacement(placement.index === 0 && !points[points.length - 1] ? { kind: "route", index: points.length - 1 } : null);
      if (!(placement.index === 0 && !points[points.length - 1])) setPanelView("scenario");
    } else {
      if (!catalogs) return;
      const id = placement.houseId || "user-" + crypto.randomUUID();
      if (!placement.houseId && experiment.addedHouses.length >= 10) { setError("В один сценарий можно добавить до 10 домов."); setPlacement(null); return; }
      const previous = placement.houseId ? repositionDraft.current || experiment.addedHouses.find(h => h.house_id === id) : null;
      const draft = previous ? { ...previous, coordinates: point } : { house_id: id, coordinates: point, residents: 40 };
      const hint = data ? suggestPoint(data, point, { kind: "house", houseId: id }, "Выезд из дома", catalogs.config.snap_radius_m, "origin") : null;
      if (hint) {
        repositionDraft.current = previous || draft; setPlacement({ kind: "house", houseId: id }); setPointGuidance(hint); return;
      }
      setPointGuidance(null); setEditingHouse(draft);
      setPlacement(null);
    }
  }, [placement, experiment.points, experiment.addedHouses, experiment.parkingMode, catalogs, data, drawingRoad, changeExperiment]);
  const changeHouse = useCallback((id: string, patch: Partial<HouseDraft>) => {
    if (busyRef.current) return;
    changeExperiment({ addedHouses: experiment.addedHouses.map(h => h.house_id === id ? { ...h, ...patch } : h) });
    if (patch.coordinates && data && catalogs) {
      const hint = suggestPoint(data, patch.coordinates, { kind: "house", houseId: id }, "Выезд из дома", catalogs.config.snap_radius_m, "origin");
      setPointGuidance(hint);
      if (hint) { setPanelView("map"); setPlacement({ kind: "house", houseId: id }); }
    }
  }, [experiment.addedHouses, changeExperiment, data, catalogs]);
  const editHouse = (id: string) => {
    const house = experiment.addedHouses.find(item => item.house_id === id);
    if (!house) return;
    editorReturn.current = panelView;
    setEditingHouse({ ...house }); setEditingRoad(null); setPlacement(null);
  };
  const moveRoutePoint = useCallback((index: number, point: Coordinate) => {
    if (busyRef.current) return;
    const points = [...experiment.points]; points[index] = point; changeExperiment({ points });
    const end = index === points.length - 1;
    const hint = data && catalogs && !(end && experiment.parkingMode !== "none") ? suggestPoint(data, point, { kind: "route", index }, index === 0 ? "А" : end ? "Б" : `Через ${index}`, catalogs.config.snap_radius_m, index === 0 ? "origin" : end ? "destination" : "via") : null;
    setPointGuidance(hint); setPlacement(hint ? { kind: "route", index } : null);
  }, [experiment.points, experiment.parkingMode, catalogs, data, changeExperiment]);
  const revealPointGuidance = (hint: PointGuidance) => {
    setPointGuidance(hint); setEditingHouse(null); setEditingRoad(null); setPanelView("map");
    if (hint.target.kind === "route") setPlacement({ kind: "route", index: hint.target.index });
    else if (hint.target.kind === "house") setPlacement({ kind: "house", houseId: hint.target.houseId });
    else {
      if (drawingRoad?.road_id !== hint.target.roadId) {
        const roadId = hint.target.roadId;
        const road = experiment.addedRoads.find(road => road.road_id === roadId);
        if (road) { setDrawingRoad({ ...road, points: [...road.points] }); roadReturn.current = panelView; }
      }
      setPlacement({ kind: "road" });
    }
  };
  const applyPointGuidance = () => {
    if (!pointGuidance || busyRef.current) return;
    const { target, to } = pointGuidance;
    setGuidanceFocus({ ...to });
    setPointGuidance(null); setRoadError(null); setError("");
    if (target.kind === "route") {
      const points = [...experiment.points];
      if (target.index >= points.length) return;
      points[target.index] = to; changeExperiment({ points });
      setPlacement(target.index === 0 && !points.at(-1) ? { kind: "route", index: points.length - 1 } : null);
    } else if (target.kind === "house") {
      if (repositionDraft.current?.house_id === target.houseId) setEditingHouse({ ...repositionDraft.current, coordinates: to });
      else changeExperiment({ addedHouses: experiment.addedHouses.map(house => house.house_id === target.houseId ? { ...house, coordinates: to } : house) });
      setPlacement(null);
    } else if (drawingRoad?.road_id === target.roadId) {
      const points = [...drawingRoad.points]; points[target.index] = to;
      setDrawingRoad({ ...drawingRoad, points }); setPlacement({ kind: "road" });
    }
    notify(`Точка «${pointGuidance.label}» переставлена`);
  };
  const resetAll = () => {
    setSelected(null); setScenarioType("none"); setPlacement(null); setEditingHouse(null); setEditingRoad(null); setDrawingRoad(null); setRoadError(null); setFactor(.5); setDemand(1.4);
    setExperiment({ ...initialExperiment(), vehicleCount: catalogs?.config.default_vehicle_count || 1000 });
    setResetKey(k => k + 1); setPointGuidance(null); setGuidanceFocus(null); resetResult();
    setPanelView("map");
  };

  const selectSegment = useCallback((id: string) => {
    if (busyRef.current) return;
    const segment = data?.segments.find(s => s.segment_id === id);
    if (segment) { setSelected(segment); if (scenarioType === "none") setScenarioType("closure"); resetResult(); setPanelView("scenario"); }
  }, [data, resetResult, scenarioType]);

  const simulate = async (preset?: Preset) => {
    if (busyRef.current || !data) return;
    const type = preset?.scenario_type || scenarioType;
    const segment = preset ? data.segments.find(s => s.segment_id === preset.segment_id) : selected;
    if (!countValid || pendingBaseline) return;
    if ((type === "closure" || type === "capacity_reduction") && (!segment || !segment.can_close)) return;
    if (experiment.routeEnabled && experiment.points.some(p => !p)) { setError("Поставьте точки А, Б и все промежуточные точки на карте."); return; }
    const invalidHouse = experiment.addedHouses.find(h => !Number.isInteger(h.residents) || h.residents < 1 || h.residents > 20000);
    if (invalidHouse) { setError("Укажите для нового дома целое число жильцов от 1 до 20 000."); editHouse(invalidHouse.house_id); return; }
    const invalidRoad = experiment.addedRoads.find(road => !road.name.trim() || !Number.isInteger(road.lanes) || road.lanes < 1 || road.lanes > 6);
    if (invalidRoad) { setError("Укажите название новой дороги и от 1 до 6 полос в каждом направлении."); editRoad(invalidRoad.road_id); return; }
    const misplaced = catalogs ? firstMisplacedPoint(data, experiment, catalogs.config.snap_radius_m) : null;
    if (misplaced) { revealPointGuidance(misplaced); return; }
    if (preset) { setSelected(segment || null); setScenarioType(type); }
    busyRef.current = true;
    setBusy(true); resetResult(); setPanelView("result");
    try {
      const payload = { scenario_type: "composite", vehicle_count: experiment.vehicleCount, weather: experiment.weather,
        road_change: type === "closure" || type === "capacity_reduction" ? { scenario_type: type, segment_id: segment!.segment_id, ...(type === "capacity_reduction" ? { factor: preset?.parameters?.factor ?? factor } : {}) } : null,
        demand_factor: type === "demand_increase" ? preset?.parameters?.factor ?? demand : 1,
        personal_route: experiment.routeEnabled ? { origin: experiment.points[0], destination: experiment.points[experiment.points.length - 1], via: experiment.points.slice(1, -1), parking_mode: experiment.parkingMode, parking_id: experiment.parkingMode === "manual" ? experiment.parkingId : null } : null,
        parking_occupancy: experiment.occupancy, housing: { add: experiment.addedHouses.map(({ house_id, coordinates, residents }) => ({ house_id, coordinates, residents })), remove: experiment.removedHouses }, added_roads: experiment.addedRoads };
      const result = await api<Run>("/simulate", payload);
      setRun(result); setPhase("after");
      trackGoal("simulation_success");
      setActiveTrip(result.personal_route ? null : result.comparison.changed_trip_ids[0] || null);
      setPlacement(null);
      setEditingHouse(null); setEditingRoad(null);
      setFocus(f => f + 1);
      if (catalogs && result.personal_route?.after.status === "unreachable" && result.personal_route.snapped_points.destination_error) {
        const end = experiment.points.at(-1);
        const hint = end ? suggestPoint(data, end, { kind: "route", index: experiment.points.length - 1 }, "Б", catalogs.config.snap_radius_m, "destination") : null;
        if (hint) revealPointGuidance(hint);
      }
      notify("Сценарий рассчитан");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось выполнить расчёт. Повторите попытку.");
      setPanelView("scenario");
    } finally {
      busyRef.current = false; setBusy(false);
    }
  };

  const explain = async () => {
    if (!run || analyzing) return;
    setAnalyzing(true); setAnalysisError("");
    const runId = run.run_id;
    try {
      const response = await api<{ text: string; source: string }>("/analyze", { run_id: runId });
      if (currentRunId.current === runId) setAnalysis(response);
    } catch (e) { if (currentRunId.current === runId) setAnalysisError(e instanceof Error ? e.message : "Не удалось получить объяснение."); }
    finally { setAnalyzing(false); }
  };

  const exportResult = () => {
    if (!run) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(run, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = `butterfly-${run.run_id.slice(0, 8)}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  const currentState = run ? run[phase] : baseline;
  const selectedLoads = selected && currentState ? selected.edge_ids.map(id => currentState.edge_loads[id]).filter(Boolean) : [];
  const selectedRatio = selectedLoads.length ? Math.max(...selectedLoads.map(l => l.ratio)) : 0;
  const selectedFlow = selectedLoads.reduce((sum, l) => sum + l.flow, 0);
  const isClosed = selectedLoads.some(l => l.status === "closed");
  const routeIncomplete = experiment.routeEnabled && experiment.points.some(point => !point);
  const submitDisabled = busy || pendingBaseline || !data || !countValid || routeIncomplete || ((scenarioType === "closure" || scenarioType === "capacity_reduction") && (!selected || !selected.can_close));
  const appliedRoad = run?.applied_settings?.road_change;
  const appliedTitle = run?.personal_route ? "Ваша поездка и район" : appliedRoad ? data?.segments.find(s => s.segment_id === appliedRoad.segment_id)?.name : "Сценарий района";
  const routeFeatures = run ? [...new Map([...run.before.routes.features, ...run.after.routes.features].map(f => [f.properties.trip_id, f])).values()] : [];
  const showChangedRoad = (segmentId: string) => {
    const original = data?.segments.find(segment => segment.segment_id === segmentId);
    const added = run?.added_roads?.find(road => road.segment_id === segmentId);
    setInspectSegment(original || (added ? { segment_id: added.segment_id, edge_ids: added.edge_ids, name: added.name,
      length_m: added.length_m, speed_kmh: added.speed_kmh, can_close: false, direction: added.two_way ? "Оба направления" : "От начала к концу",
      disabled_reason: null, geometry: added.geometry, lane_count: added.lanes * (added.two_way ? 2 : 1) } : null));
    setActiveTrip(null); setFocus(value => value + 1); setPanelView("map");
  };

  const activePanel = panelView === "map" ? "scenario" : panelView;
  const editingHouseId = editingHouse?.house_id || null;
  const mapExperiment = useMemo(() => editingHouse ? { ...experiment, addedHouses: experiment.addedHouses.some(h => h.house_id === editingHouse.house_id)
    ? experiment.addedHouses.map(h => h.house_id === editingHouse.house_id ? editingHouse : h) : [...experiment.addedHouses, editingHouse] } : experiment, [experiment, editingHouse]);
  const showMap = () => setPanelView("map");
  const showPersonal = () => { setActiveTrip(null); setInspectSegment(null); setFocus(f => f + 1); showMap(); };
  const resultEmpty = activePanel === "result" && !run && !busy;
  const panelOpen = panelView !== "map" && !editingHouse && !editingRoad;
  useClientLayoutEffect(() => {
    if (activePanel === "result" && (run?.run_id || null) !== lastResultId.current) {
      panelPositions.current.result = 0;
      lastResultId.current = run?.run_id || null;
    }
    const scroll = panelScrollRef.current;
    if (!scroll || mobile && !panelOpen) return;
    const position = panelPositions.current[activePanel];
    scroll.scrollTop = position;
    // Framework7 changes sheet visibility after React commits the open state.
    const frame = requestAnimationFrame(() => { scroll.scrollTop = position; });
    return () => cancelAnimationFrame(frame);
  }, [activePanel, run?.run_id, mobile, panelOpen]);

  return <div className="app-shell" data-panel={panelView} data-mobile={mobile} data-guidance={panelView === "map" && !!pointGuidance || undefined} data-tool={panelView === "map" ? placement?.kind || undefined : undefined}>
    <header className="app-header">
      <Link className="brand" href="/" aria-label="402x402 — главная"><span className="brand-mark"><Butterfly /></span><span><strong>402x402</strong></span></Link>
      <div className="model-status" role="status"><span className={`live-dot ${!baseline || pendingBaseline ? "waiting" : ""}`} /><span>{pendingBaseline && countValid ? "Обновляем количество машин" : baseline ? "Можно рассчитать изменения" : initialError ? "Нет соединения с моделью" : "Подключаем модель"}<small className="status-sub">{baseline ? `${baseline.metrics.trip_count} направлений · ${number(baseline.metrics.vehicle_count)} машин в расчёте` : "Реальная карта · выбранное число машин"}</small></span></div>
      <div className="header-actions"><AuthStatus /><button className="icon-button theme-button" onClick={toggleTheme} aria-label={dark ? "Включить светлую тему" : "Включить тёмную тему"}>{dark ? <Sun size={19} /> : <Moon size={19} />}</button><button className="icon-button" onClick={() => setHelpOpen(true)} aria-label="Как это работает"><CircleHelp size={20} /></button></div>
    </header>

    <main className="map-workspace" aria-label="Симулятор дорожных изменений">
      {data && currentState ? <RoadMap data={data} state={currentState} selected={inspectSegment || (scenarioType === "demand_increase" || scenarioType === "none" ? null : selected)} onSelect={selectSegment} phase={phase} onPhase={setPhase} hasResult={!!run} activeTrip={activeTrip} focus={focus} resetKey={resetKey} disabled={busy} catalogs={catalogs} experiment={mapExperiment} placement={panelView === "map" ? placement : null} onMapPoint={mapPoint} onMovePoint={moveRoutePoint} onCancelPlacement={cancelPlacement} onParking={id => { changeExperiment({ parkingMode: "manual", parkingId: id, routeEnabled: true }); setPanelView("scenario"); }} onHouse={demolishHouse} drawingRoad={drawingRoad} drawingErrorIndex={roadError?.index ?? null} pointGuidance={panelView === "map" ? pointGuidance : null} guidanceFocus={guidanceFocus} onApplyGuidance={applyPointGuidance} onDismissGuidance={() => { setPointGuidance(null); setRoadError(null); }} onDisplayChange={changeExperiment} addedRoads={run?.added_roads || NO_ADDED_ROADS} onEditRoad={editRoad} editingHouseId={editingHouseId} onEditHouse={editHouse} onChangeHouse={changeHouse} onCloseHouse={() => closeHouse()} onRemoveHouse={id => { changeExperiment({ addedHouses: experiment.addedHouses.filter(h => h.house_id !== id) }); setEditingHouse(null); }} onRepositionHouse={id => beginPlacement({ kind: "house", houseId: id })} personal={run?.personal_route?.[phase] || null} parkingOccupancy={run?.applied_settings?.[phase === "before" ? "parking_occupancy_before" : "parking_occupancy_after"] || experiment.occupancy} hasHouseChanges={phase === "after" && !!run} mobile={mobile} dark={dark} reducedMotion={reducedMotion} /> : <MapSkeleton failed={!!initialError} message={initialError ? "Не удалось подключить модель" : "Подключаем модель района"} />}

      <button className="mobile-actions-trigger" hidden={panelView !== "map" || !!placement || !!editingHouse || !!editingRoad} disabled={busy || !data} onClick={() => setActionsOpen(true)} aria-haspopup="dialog"><Plus size={20} />Действия</button>
      <div className={`map-task-toolbar desktop-map-actions ${(panelView === "map" && !!placement || mobile && (panelOpen || editingHouse || editingRoad)) ? "is-covered" : ""}`} aria-label="Действия на карте"><button aria-label="Мой маршрут" disabled={busy || !data} onClick={() => { changeExperiment({ routeEnabled: true }); beginPlacement({ kind: "route", index: 0 }); }}><Navigation size={17} />Маршрут</button><button aria-label="Добавить дом" disabled={busy || !data || experiment.addedHouses.length >= 10} onClick={() => { changeExperiment({ showHouses: true }); beginPlacement({ kind: "house" }); }}><HouseIcon size={17} />Добавить дом</button><button disabled={busy || !data || experiment.addedRoads.length >= 5} onClick={() => startRoad()}><Plus size={17} />Своя дорога</button><button aria-label="Снести дом" disabled={busy || !catalogs?.houses.length} onClick={() => { changeExperiment({ showHouses: true }); beginPlacement({ kind: "demolish" }); }}><Trash2 size={17} />Снести дом</button><button className="toolbar-demo" disabled={busy || !catalogs} onClick={() => { if (!catalogs) return; const demo = catalogs.demo_personal_route; changeExperiment({ routeEnabled: true, points: [demo.origin, ...demo.via, demo.destination], parkingMode: "auto" }); setPanelView("scenario"); }}><Route size={17} />Пример А → Б + P</button></div>
      {drawingRoad && placement?.kind !== "road" && panelView === "map" && <button className="resume-road quiet-action" onClick={() => setPlacement({ kind: "road" })}><Route size={18} />Продолжить дорогу · {drawingRoad.points.length} точек</button>}


      <div className={`overview-strip ${(panelView === "map" && !!placement || mobile && (panelOpen || editingHouse || editingRoad)) ? "is-covered" : ""}`} aria-label="Показатели выбранного состояния"><div className="overview-place"><MapPin size={16} /><span>Первая Речка<small className="summary-caption">{phase === "after" ? "После изменения" : "Исходное движение"}</small></span></div><div className="overview-metric"><Clock3 size={17} /><span><strong>{currentState ? shortTime(currentState.metrics.average_time_s) : "—"}</strong><small>среднее время</small></span></div><div className="overview-metric"><Route size={17} /><span><strong>{currentState ? distance(currentState.metrics.average_length_m) : "—"}</strong><small>средняя длина</small></span></div><div className="overview-metric"><Users size={17} /><span><strong>{currentState ? number(currentState.metrics.vehicle_count) : "—"}</strong><small>машин в расчёте</small></span></div><button className="overview-open icon-button" aria-label="Открыть настройки сценария" onClick={() => setPanelView("scenario")}><ChevronUp size={21} /></button></div>

      {initialError && <section className="connection-error" role="alert"><span className="empty-illustration"><Activity size={28} /></span><h2>Модель пока не подключена</h2><p>{initialError}</p><button className="primary-button" onClick={() => setRetry(r => r + 1)}><RefreshCw size={16} />Повторить подключение</button></section>}
      {panelView === "map" && placement?.kind === "road" && drawingRoad && <div className="road-draw-controls" aria-label="Рисование дороги"><span><Route size={17} /><strong>{drawingRoad.points.length < 2 ? "Поставьте начало и конец" : `${distance(roadLength(drawingRoad.points))} · ${drawingRoad.points.length} точек`}</strong></span>{roadError && !pointGuidance && <p className="road-tool-error" role="alert">{roadError.text}</p>}<div><button className="quiet-action" disabled={!drawingRoad.points.length} onClick={() => { setPointGuidance(null); setRoadError(null); setDrawingRoad(previous => previous ? { ...previous, points: previous.points.slice(0, -1) } : null); }}><Undo2 size={16} />Назад</button><button className="primary-button" disabled={drawingRoad.points.length < 2} onClick={finishRoad}><Check size={17} />Готово</button></div><button className="road-cancel text-button" onClick={cancelPlacement}>Отменить рисование</button></div>}
    </main>

    <AdaptiveSheet className="control-sheet" label={activePanel === "scenario" ? "Настройки сценария" : "Результат сценария"} open={panelOpen} mobile={mobile} onClose={() => setPanelView("map")}>
      <div className="sheet-drag-zone" aria-hidden="true"><span /></div>
      <div className="panel-navigation"><strong className="mobile-panel-title">{activePanel === "scenario" ? "Сценарий" : "Результат"}</strong><div className="panel-tabs" role="tablist" aria-label="Панель управления"><button role="tab" aria-selected={activePanel === "scenario"} onClick={() => setPanelView("scenario")}><SlidersHorizontal size={16} />Сценарий</button><button role="tab" aria-selected={activePanel === "result"} onClick={() => setPanelView("result")}><BarChart3 size={16} />Результат{run && <span className="result-dot" />}</button></div><button className="icon-button panel-close" aria-label="Свернуть панель и показать карту" onClick={showMap}><X size={19} /></button></div>
      <div className="panel-scroll" ref={panelScrollRef} onScroll={event => { if (!mobile || panelOpen) panelPositions.current[activePanel] = event.currentTarget.scrollTop; }}>
        <div className="scenario-content" hidden={activePanel !== "scenario"} role="tabpanel" aria-label="Настройки сценария">
          <div className="panel-intro"><div><span className="eyebrow">ГОРОД — ЭТО СВЯЗИ</span><h1>Что изменим?</h1><p>Одно решение. Новые маршруты.</p></div><button className="text-button reset-button" disabled={busy} onClick={resetAll}><RotateCcw size={14} />Сбросить</button></div>
          {catalogs && <p className="scenario-current"><strong>{TYPES.find(type => type.id === scenarioType)?.label}</strong> · {WEATHER_NAMES[experiment.weather]}{experiment.routeEnabled ? " · личная поездка" : " · весь район"}{experiment.addedHouses.length > 0 ? ` · домов: ${experiment.addedHouses.length}` : ""}{experiment.addedRoads.length > 0 ? ` · своих дорог: ${experiment.addedRoads.length}` : ""}</p>}
          {!catalogs ? <div className="panel-skeleton" aria-hidden="true"><div /><div /><div /><div /></div> : <>
          <ExperimentPanel part="traffic" catalogs={catalogs} value={experiment} onChange={changeExperiment} placement={placement} onPlace={beginPlacement} onEditHouse={editHouse} onStartRoad={() => startRoad()} onEditRoad={editRoad} disabled={busy} />
          <div className="control-section"><div className="section-label"><Route size={16} /><span>Дорожная сеть</span></div><div className="scenario-types" role="group" aria-label="Тип сценария">{TYPES.map(({ id, label, icon: Icon, description }) => <m.button whileTap={{ scale: .97 }} key={id} className={scenarioType === id ? "active" : ""} title={description} aria-pressed={scenarioType === id} disabled={busy} onClick={() => { setScenarioType(id); resetResult(); }}><Icon size={18} />{label}</m.button>)}</div>
          {scenarioType === "none" ? <p className="field-hint road-unchanged">Существующие дороги остаются открыты. Можно добавить свою дорогу, дома и изменить погоду.</p> : scenarioType === "demand_increase" ? <div className="demand-card"><Users size={20} /><span><strong>Больше машин во всём районе</strong><small>Больше машин по привычным маршрутам</small></span></div> : selected ? <div className="selected-road"><div className="selected-road-heading"><span className="road-icon"><Route size={18} /></span><strong>{selected.name}</strong><button className="icon-button" aria-label="Показать выбранный участок" disabled={busy} onClick={() => { setActiveTrip(null); setInspectSegment(null); setFocus(f => f + 1); showMap(); }}><Expand size={17} /></button></div><p className="road-direction"><ArrowRight size={14} />{selected.direction}</p><div className="road-properties"><span><small>Длина</small>{number(selected.length_m)} м</span><span><small>Скорость без пробок</small>{number(selected.speed_kmh)} км/ч</span><span><small>Движение</small><b className={isClosed ? "tone-red" : selectedRatio >= 1 ? "tone-red" : selectedRatio >= .7 ? "tone-amber" : "tone-green"}>{trafficLabel(selectedRatio, isClosed)}</b></span></div><div className="road-lanes-card"><div><span>Полосы движения</span><strong>{roadLanes(selected)}</strong></div>{selected.lane_max && <div className={`lane-diagram ${scenarioType === "closure" ? "will-close" : ""}`} aria-hidden="true">{Array.from({ length: Math.min(selected.lane_max, 8) }, (_, index) => <i key={index}><ArrowRight size={15} /></i>)}</div>}<small>{selected.lane_min ? `${selected.oneway ? "В указанном направлении" : "Всего на участке, оба направления"} · OpenStreetMap` : "В исходной карте нет данных о полосах; число не подставляется."}</small>{selected.lane_min !== selected.lane_max && selected.lane_min && <small>Количество полос меняется вдоль участка.</small>}{scenarioType === "closure" && <p>После перекрытия: проезд закрыт во всех полосах.</p>}{scenarioType === "capacity_reduction" && <p>Сужение: дорога сможет пропускать на {number((1 - factor) * 100)}% меньше машин.</p>}</div>{!selected.can_close && <p className="inline-notice"><Info size={14} />{selected.disabled_reason}</p>}</div> : <button className="empty-selection" onClick={showMap}><MousePointer2 size={22} /><span><strong>Выберите дорогу на карте</strong><small>Нажмите на участок для изменения</small></span><ArrowUpRight size={18} /></button>}
          {scenarioType === "capacity_reduction" && <div className="factor-field"><label htmlFor="capacity-factor">Сколько машин сможет проехать<strong>{number(factor * 100)}% от обычного</strong></label><input id="capacity-factor" type="range" min="0.1" max="0.9" step="0.1" value={factor} disabled={busy} onChange={e => { setFactor(+e.target.value); resetResult(); }} /><div><span>10%</span><span>90%</span></div></div>}
          {scenarioType === "demand_increase" && <div className="factor-field"><label htmlFor="demand-factor">Больше автомобилей<strong>+{number((demand - 1) * 100)}%</strong></label><input id="demand-factor" type="range" min="1.1" max="3" step="0.1" value={demand} disabled={busy} onChange={e => { setDemand(+e.target.value); resetResult(); }} /><div><span>На 10% больше</span><span>В 3 раза больше</span></div></div>}
          </div>
          <ExperimentPanel segments={data?.segments} part="settings" catalogs={catalogs} value={experiment} onChange={changeExperiment} placement={placement} onPlace={beginPlacement} onEditHouse={editHouse} onStartRoad={() => startRoad()} onEditRoad={editRoad} disabled={busy} />
          <button className="demo-button" onClick={() => simulate(presets[0])} disabled={busy || pendingBaseline || !countValid || !presets.length}><span className="demo-icon"><Zap size={19} /></span><span>Демо-сценарий<small>{presets[0]?.name || "Нет доступных шаблонов"}</small></span><ArrowUpRight size={19} /></button>
          {presets.length > 1 && <details className="scenario-accordion"><summary><Route size={16} />Шаблоны сценариев<ChevronDown size={14} /></summary><div className="accordion-body">{presets.slice(1).map(preset => <button key={preset.preset_id} className="quiet-action" disabled={busy || pendingBaseline || !countValid} onClick={() => simulate(preset)}>{preset.name}</button>)}</div></details>}
          <p className="model-note"><Info size={13} />Реальная карта, выбранное вами количество машин</p>
          </>}
        </div>

        <div className="result-section" hidden={activePanel !== "result"} ref={resultRef} role="tabpanel" aria-label="Результат сценария" aria-live="polite" aria-busy={busy}>
          {busy ? <div className="result-loading" key="calculating"><AppPreloader /><h2>Ищем новые пути</h2><p>Сравниваем время поездки и количество машин на дорогах</p><div className="panel-skeleton" aria-hidden="true"><div /><div /><div /></div></div> : run ? <>
            <div className="result-title"><div><span className="eyebrow">РЕЗУЛЬТАТ ЭКСПЕРИМЕНТА</span><h2>{run.personal_route ? "Ваша поездка" : "Эффект изменения"}</h2></div><button className="icon-button" aria-label="Скачать результат расчёта" onClick={exportResult}><Download size={19} /></button></div>
            <div className="result-status"><span className="check-circle"><Check size={12} /></span><strong>Сравнение готово</strong></div>
            <div className="applied-scenario"><strong>{appliedTitle}</strong><small>{appliedRoad?.scenario_type === "closure" ? "Перекрытие · " : appliedRoad?.scenario_type === "capacity_reduction" ? "Сужение · " : ""}{WEATHER_NAMES[run.applied_settings?.weather_after || "dry"]} · {number(run.after.metrics.vehicle_count)} авто</small><button className="text-button" onClick={() => setPanelView("scenario")}>Изменить<ChevronRight size={14} /></button></div>
            {!run.personal_route && <button className="show-personal-route" onClick={showMap}><MapIcon size={18} />Показать изменения на карте<ArrowRight size={16} /></button>}{run.personal_route && <PersonalResult result={run.personal_route} phase={phase} onShow={showPersonal} />}
            {run.house_changes && (run.house_changes.added.length > 0 || run.house_changes.removed.length > 0) && <p className="housing-impact"><HouseIcon size={16} /><span>Машин от жителей: +{number(run.house_changes.added.reduce((s, h) => s + (h.vehicle_count || 0), 0))} / −{number(run.house_changes.removed.reduce((s, h) => s + (h.vehicle_count || 0), 0))} авто</span></p>}
            {!!run.added_roads?.length && <section className="new-roads-result"><h3><Route size={17} />Добавленные дороги</h3>{run.added_roads.map(road => <button key={road.road_id} onClick={() => { setPhase("after"); showChangedRoad(road.segment_id); }}><span><strong>{road.name}</strong><small>{distance(road.length_m)} · {road.lanes * (road.two_way ? 2 : 1)} {plural(road.lanes * (road.two_way ? 2 : 1), ["полоса", "полосы", "полос"])} · {road.two_way ? "в обе стороны" : "в одну сторону"}</small><small>Других машин на дороге: около {number(road.edge_ids.reduce((total, id) => total + (run.after.edge_loads[id]?.flow || 0), 0))}</small></span><ArrowUpRight size={16} /></button>)}<p>Ниже показано, как изменилось время поездок после появления дороги.</p></section>}
            <h3 className="district-result-title">Весь район</h3><div className="comparison-header"><span>Показатель</span><span>До</span><span>После</span></div>
            <ComparisonRow icon={Clock3} label="Время поездки" delta={run.comparison.average_time_s} format={time} />
            <ComparisonRow icon={Route} label="Длина маршрута" delta={run.comparison.average_length_m} format={distance} />
            <ComparisonRow icon={TrafficCone} label="Перегруженные участки" delta={run.comparison.congested_road_count || run.comparison.high_load_edges} format={n => n === null ? "—" : number(n)} integer />
            <ComparisonRow icon={Ban} label="Не могут доехать, авто" delta={run.comparison.unreachable_vehicle_count} format={n => n === null ? "—" : number(n)} integer />
            <p className="comparison-footnote"><ArrowLeftRight size={14} />Сравниваем одни и те же направления для {number(run.comparison.matched_vehicle_count)} машин</p>
            {run.applied_settings && <div className="conditions-strip"><span>Погода: {WEATHER_NAMES[run.applied_settings.weather_before]} → {WEATHER_NAMES[run.applied_settings.weather_after]}</span><span>Машин на дорогах: {number(run.before.metrics.vehicle_count)} → {number(run.after.metrics.vehicle_count)} авто</span></div>}
            {run.comparison.matched_trip_count === 0 && <p className="inline-notice">Нет направлений, по которым можно проехать и до, и после изменения. Сравнить среднее время не получится.</p>}
            <p className="field-hint">Машин без доступного маршрута: {number(run.before.metrics.unreachable_vehicle_count)} → {number(run.after.metrics.unreachable_vehicle_count)} авто.</p>
            <details className="result-detail"><summary><GitBranch size={16} />Где станет больше машин<ChevronDown size={16} /></summary><div className="growth-list">{run.comparison.top_increased_edges.length ? run.comparison.top_increased_edges.map((edge, i) => <button className="growth-row" key={edge.edge_id} onClick={() => showChangedRoad(edge.segment_id)}><span className="growth-number">{i + 1}</span><span className="growth-road">{edge.name}<small>{trafficLabel(edge.ratio_before)} → {trafficLabel(edge.ratio_after)}</small></span><strong>+{number(edge.absolute || 0)}<small>авто</small></strong><ArrowUpRight size={15} /></button>) : <p className="field-hint">Ни на одной дороге машин не стало больше.</p>}</div></details>
            <details className="result-detail routes-details"><summary><Route size={16} />Поездки по району<span>{run.comparison.matched_trip_count}</span><ChevronDown size={16} /></summary><div className="routes-list">{routeFeatures.map(f => { const tid = f.properties.trip_id; const current = run[phase].trip_metrics[tid]; return <button key={tid} className={`trip-row ${activeTrip === tid ? "active" : ""}`} onClick={() => { setActiveTrip(tid); setInspectSegment(null); setFocus(n => n + 1); showMap(); }}><i className={run.comparison.changed_trip_ids.includes(tid) ? "trip-dot changed" : "trip-dot"} /><span>{f.properties.label}<small>{number(current?.vehicle_count || 0)} авто · {!run.before.trip_metrics[tid] ? "Новый дом" : run.comparison.changed_trip_ids.includes(tid) ? "Новый маршрут" : "Маршрут сохранился"}</small></span><b>{current ? time(current.time_s) : run[phase].unreachable_trips.some(t => t.trip_id === tid) ? "Нет пути" : "Машины больше не выезжают"}</b><ArrowUpRight size={15} /></button>; })}</div></details>
            <div className="explanation-section">{analysis ? <><div className="explanation-heading"><Sparkles size={17} /><strong>Почему так произошло</strong></div><p>{analysis.text}</p><span className="template-label"><Check size={12} />Объяснение по данным расчёта</span></> : <button className="explain-button" onClick={explain} disabled={analyzing}><Sparkles size={18} /><span>{analyzing ? "Готовим объяснение…" : "Объяснить результат"}</span>{analyzing ? <AppPreloader small /> : <ChevronRight size={16} />}</button>}{analysisError && <p className="request-error" role="alert">{analysisError}</p>}</div>
          </> : <div className="result-empty"><m.span className="empty-illustration" initial={{ opacity: 0, scale: .95 }} animate={{ opacity: 1, scale: 1 }}><BarChart3 size={32} /></m.span><h2>У каждого решения<br />есть последствия</h2><p>Создайте сценарий, чтобы сравнить время поездок и движение на дорогах.</p></div>}
        </div>
      </div>
      <div className="panel-footer"><div className="footer-error" role={error ? "alert" : undefined}>{error && <><Info size={15} /><span>{error}</span>{pendingBaseline && countValid && !baselineBusy && <button className="text-button" onClick={() => { setError(""); setBaselineRetry(r => r + 1); }}>Повторить</button>}</>}</div><button className="primary-button calculate-button" onClick={() => (activePanel === "result" && run) || resultEmpty ? setPanelView("scenario") : simulate()} disabled={resultEmpty || (activePanel === "result" && run) ? false : submitDisabled}>{busy || pendingBaseline ? <AppPreloader small /> : activePanel === "result" && run ? <SlidersHorizontal size={17} /> : <Play size={16} fill="currentColor" />}<span>{busy ? "Рассчитываем…" : pendingBaseline ? "Обновляем поток…" : resultEmpty ? "Создать сценарий" : activePanel === "result" && run ? "Изменить сценарий" : "Рассчитать"}</span><ArrowRight size={17} /></button><p aria-live="polite">{!countValid ? "Укажите допустимое количество машин" : pendingBaseline ? "Расчёт станет доступен после обновления потока" : routeIncomplete ? "Выберите А, Б и все точки «Через» на карте" : !busy && submitDisabled ? "Выберите доступный участок дороги на карте" : drawingRoad ? "Незавершённая дорога сохранена в черновике" : "Сравнение сценариев, а не прогноз пробок"}</p></div>
    </AdaptiveSheet>

    <AppDialog className="house-sheet editor-dialog" open={!!editingHouse} label="Редактор дома" onClose={() => closeHouse()}>
      {editingHouse && catalogs && <HouseEditor house={editingHouse} disabled={busy}
        onChange={patch => setEditingHouse(previous => previous ? { ...previous, ...patch } : null)}
        onClose={() => closeHouse()} onApply={() => closeHouse(true)}
        onRemove={() => { changeExperiment({ addedHouses: experiment.addedHouses.filter(h => h.house_id !== editingHouse.house_id) }); closeHouse(); }}
        onReposition={() => beginPlacement({ kind: "house", houseId: editingHouse.house_id })} />}
    </AppDialog>
    <AppDialog className="road-sheet editor-dialog" open={!!editingRoad} label="Редактор дороги" onClose={() => closeRoad()}>
      {editingRoad && <RoadEditor road={editingRoad} disabled={busy}
        onChange={patch => setEditingRoad(previous => previous ? { ...previous, ...patch } : null)}
        onClose={() => closeRoad()} onApply={() => closeRoad(true)}
        onRemove={() => { changeExperiment({ addedRoads: experiment.addedRoads.filter(road => road.road_id !== editingRoad.road_id) }); closeRoad(); }}
        onRedraw={() => startRoad(editingRoad)} />}
    </AppDialog>

    <MobileToolbar bottom tabbar className="mobile-tabbar">{([
      { id: "map", label: "Карта", Icon: MapIcon }, { id: "scenario", label: "Сценарий", Icon: SlidersHorizontal }, { id: "result", label: "Результат", Icon: BarChart3 },
    ] as const).map(({ id, label, Icon }) => <button key={id} aria-label={label} aria-pressed={panelView === id} className={panelView === id ? "active" : ""} onClick={() => setPanelView(id)}><Icon size={23} /><span>{label}{id === "result" && run && <i />}</span></button>)}</MobileToolbar>

    <AppDialog className="actions-dialog" label="Действия на карте" open={actionsOpen} onClose={() => setActionsOpen(false)}>
      <div className="editor-heading" data-sheet-handle><strong>Действия на карте</strong><button className="icon-button" aria-label="Закрыть действия" onClick={() => setActionsOpen(false)}><X size={20} /></button></div>
      <div className="dialog-scroll action-list">
        <button aria-label="Мой маршрут" disabled={busy || !data} onClick={() => { changeExperiment({ routeEnabled: true }); beginPlacement({ kind: "route", index: 0 }); }}><Navigation size={22} /><span>Мой маршрут<small>Выберите начало А и конец Б</small></span><ChevronRight size={18} /></button>
        <button aria-label="Добавить дом" disabled={busy || !data || experiment.addedHouses.length >= 10} onClick={() => { changeExperiment({ showHouses: true }); beginPlacement({ kind: "house" }); }}><HouseIcon size={22} /><span>Добавить дом<small>Укажите жителей — направления распределятся автоматически</small></span><ChevronRight size={18} /></button>
        <button aria-label={drawingRoad ? "Продолжить дорогу" : "Своя дорога"} disabled={busy || !data || !drawingRoad && experiment.addedRoads.length >= 5} onClick={() => { if (drawingRoad) { setPlacement({ kind: "road" }); setPanelView("map"); setActionsOpen(false); } else startRoad(); }}><Route size={22} /><span>{drawingRoad ? "Продолжить дорогу" : "Своя дорога"}<small>{drawingRoad ? `${drawingRoad.points.length} точек в черновике` : "Соедините два перекрёстка"}</small></span><ChevronRight size={18} /></button>
        <button aria-label="Снести дом" disabled={busy || !catalogs?.houses.length} onClick={() => { changeExperiment({ showHouses: true }); beginPlacement({ kind: "demolish" }); }}><Trash2 size={22} /><span>Снести дом<small>Убрать машины жителей из сценария</small></span><ChevronRight size={18} /></button>
      </div>
    </AppDialog>

    <AppDialog className="help-dialog" open={helpOpen} label="Как это работает" onClose={() => setHelpOpen(false)}>
      <div className="editor-heading" data-sheet-handle><strong>Как это работает</strong><button className="dialog-close icon-button" aria-label="Закрыть описание" onClick={() => setHelpOpen(false)}><X size={21} /></button></div>
      <div className="help-content dialog-scroll"><span className="help-brand"><Butterfly /></span><span className="eyebrow">402x402</span><h2>Город — это связи</h2><p>Измените условия на карте и проследите, как одно решение меняет маршруты всего района.</p><ol className="help-steps"><li><span>1</span><div><strong>Выберите машины и маршрут</strong><p>Выберите количество авто и поставьте точки поездки.</p></div></li><li><span>2</span><div><strong>Соедините условия</strong><p>Погода, парковки, дома и дороги работают вместе.</p></div></li><li><span>3</span><div><strong>Сравните результат</strong><p>Личная поездка и район показывают «До / После».</p></div></li></ol><div className="help-model"><Info size={18} /><p>Карта — OpenStreetMap. Количество машин, занятость парковок и вместимость дорог заданы для эксперимента. Это эксперимент, а не прогноз реальных пробок.</p></div><ExperimentHelp catalogs={catalogs} /><button className="primary-button" onClick={() => setHelpOpen(false)}>Начать эксперимент<ArrowRight size={17} /></button></div>
    </AppDialog>
  </div>;
}

function ComparisonRow({ icon: Icon, label, delta, format, integer = false }: { icon: typeof Clock3; label: string; delta: Delta; format: (n: number | null) => string; integer?: boolean }) {
  const difference = delta.absolute !== null && Math.abs(delta.absolute) < .5 ? 0 : delta.absolute;
  const tone = difference === null || difference === 0 ? "neutral" : difference > 0 ? "negative" : "positive";
  const change = difference === null ? "Нельзя сравнить" : label === "Время поездки" ? timeChange(difference) : difference === 0 ? "Без изменений" : integer ? `На ${number(Math.abs(difference))} ${difference > 0 ? "больше" : "меньше"}` : `На ${distance(Math.abs(difference))} ${difference > 0 ? "длиннее" : "короче"}`;
  return <div className="comparison-row"><div className="comparison-name"><Icon size={15} /><span>{label}</span></div><span className="comparison-before">{format(delta.before)}</span><strong className="comparison-after">{format(delta.after)}</strong><span className={`delta-badge ${tone}`}>{change}</span></div>;
}
