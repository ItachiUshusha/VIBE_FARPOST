import type { Coordinate, Experiment, MapData, PointGuidance, PointTarget, RoadDraft } from "./types";
import { metresBetween, nearestJunction, roadLength } from "./roads";

type Role = "origin" | "destination" | "via";

export function suggestPoint(data: MapData, from: Coordinate, target: PointTarget, label: string, radius: number, role: Role): PointGuidance | null {
  // Do not guess direction eligibility when talking to an older API.
  const nodes = data.snap_nodes;
  if (!nodes) return null;
  let best: { point: Coordinate; gap: number; id: string } | null = null;
  for (const node of nodes) {
    if (!(role === "origin" ? node.outgoing : role === "destination" ? node.incoming : node.incoming && node.outgoing)) continue;
    const point = { lon: node.coordinates[0], lat: node.coordinates[1] };
    const gap = metresBetween(from, point);
    if (!best || gap < best.gap || gap === best.gap && node.node_id < best.id) best = { point, gap, id: node.node_id };
  }
  if (!best || best.gap <= radius) return null;
  return { from, to: best.point, target, label, distance_m: best.gap,
    message: `Точка «${label}» дальше ${radius} м от подходящей дороги. Пунктир ведёт к месту, куда её можно переставить.` };
}

export function suggestRoadPoint(data: MapData, road: RoadDraft, from: Coordinate, index: number, excludedNode?: string): PointGuidance | null {
  const candidates = (data.junctions || []).filter(node => node.node_id !== excludedNode).map(node => {
    const to = { lon: node.coordinates[0], lat: node.coordinates[1] };
    return { to, gap: metresBetween(from, to), id: node.node_id };
  }).sort((a, b) => a.gap - b.gap || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const best = candidates.find(candidate => {
    if (road.points.length < 2) return true;
    const points = road.points.map((point, i) => i === index ? candidate.to : point);
    const length = roadLength(points);
    const other = nearestJunction(data, points[index === 0 ? points.length - 1 : 0], Infinity);
    return length >= 10 && length <= 10000 && other?.nodeId !== candidate.id;
  });
  if (!best) return null;
  const label = index === 0 ? "Начало дороги" : "Конец дороги";
  return { from, to: best.to, distance_m: best.gap, label, target: { kind: "road", roadId: road.road_id, index },
    message: excludedNode ? "Соедините разные перекрёстки. Пунктир показывает другой подходящий конец дороги." : "Переставьте точку на выделенный перекрёсток. Нарисованная линия сохранена." };
}

export function firstMisplacedPoint(data: MapData, experiment: Experiment, radius: number): PointGuidance | null {
  for (const house of experiment.addedHouses) {
    const hint = suggestPoint(data, house.coordinates, { kind: "house", houseId: house.house_id }, "Выезд из дома", radius, "origin");
    if (hint) return hint;
  }
  if (experiment.routeEnabled) {
    for (let index = 0; index < experiment.points.length; index++) {
      const point = experiment.points[index];
      const end = index === experiment.points.length - 1;
      // With parking, B may intentionally be off the road: the last leg is on foot.
      if (!point || end && experiment.parkingMode !== "none") continue;
      const hint = suggestPoint(data, point, { kind: "route", index }, index === 0 ? "А" : end ? "Б" : `Через ${index}`, radius, index === 0 ? "origin" : end ? "destination" : "via");
      if (hint) return hint;
    }
  }
  for (const road of experiment.addedRoads) {
    const start = nearestJunction(data, road.points[0], radius);
    const end = nearestJunction(data, road.points.at(-1)!, radius);
    if (!start) return suggestRoadPoint(data, road, road.points[0], 0);
    if (!end || end.nodeId === start.nodeId) return suggestRoadPoint(data, road, road.points.at(-1)!, road.points.length - 1, start.nodeId);
  }
  return null;
}
