import type { Coordinate, MapData, Segment } from "./types";
import { number } from "./api";

export function metresBetween(a: Coordinate, b: Coordinate) {
  const rad = Math.PI / 180;
  const latitude = (b.lat - a.lat) * rad, longitude = (b.lon - a.lon) * rad;
  const h = Math.sin(latitude / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(longitude / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

export function roadLength(points: Coordinate[]) {
  return points.slice(1).reduce((sum, point, index) => sum + metresBetween(points[index], point), 0);
}

export function nearestJunction(data: MapData, point: Coordinate, radius: number) {
  const junctions = data.junctions || [];
  let nearest: { point: Coordinate; distance: number; nodeId: string } | null = null;
  for (const junction of junctions) {
    const candidate = { lon: junction.coordinates[0], lat: junction.coordinates[1] };
    const distance = metresBetween(point, candidate);
    if (distance <= radius && (!nearest || distance < nearest.distance)) nearest = { point: candidate, distance, nodeId: junction.node_id };
  }
  return nearest;
}

export function roadLanes(segment: Pick<Segment, "lane_count" | "lane_min" | "lane_max">) {
  if (segment.lane_count) return `${number(segment.lane_count)} ${plural(segment.lane_count, ["полоса", "полосы", "полос"])}`;
  if (segment.lane_min && segment.lane_max) return `${segment.lane_min}–${segment.lane_max} полос`;
  return "В OSM не указано";
}

export function plural(value: number, words: [string, string, string]) {
  const n = Math.abs(Math.round(value));
  return words[n % 100 >= 11 && n % 100 <= 14 ? 2 : n % 10 === 1 ? 0 : n % 10 >= 2 && n % 10 <= 4 ? 1 : 2];
}

export function trafficLabel(ratio: number, closed = false) {
  return closed ? "Перекрыто" : ratio >= 1 ? "Плотный поток" : ratio >= .7 ? "Много машин" : "Свободно";
}
