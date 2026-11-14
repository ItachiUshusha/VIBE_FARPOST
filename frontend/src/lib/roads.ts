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

/** A local street label from the existing OSM geometry; no geocoder request. */
export function pointStreetName(point: Coordinate, segments: Segment[], radius: number) {
  const scaleX = 111195 * Math.cos(point.lat * Math.PI / 180);
  let nearest = radius;
  let name: string | null = null;
  for (const segment of segments) {
    if (!segment.name || segment.name === "Безымянный проезд") continue;
    const coordinates = segment.geometry.coordinates;
    for (let index = 1; index < coordinates.length; index++) {
      const [a, b] = [coordinates[index - 1], coordinates[index]];
      const ax = (a[0] - point.lon) * scaleX, ay = (a[1] - point.lat) * 111195;
      const dx = (b[0] - a[0]) * scaleX, dy = (b[1] - a[1]) * 111195;
      const fraction = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
      const gap = Math.hypot(ax + fraction * dx, ay + fraction * dy);
      if (gap < nearest) { nearest = gap; name = segment.name; }
    }
  }
  return name;
}

export function nearestJunction(data: MapData, point: Coordinate, radius: number) {
  const junctions = data.junctions || [];
  let nearest: { point: Coordinate; distance: number; nodeId: string } | null = null;
  for (const junction of junctions) {
    const candidate = { lon: junction.coordinates[0], lat: junction.coordinates[1] };
    const distance = metresBetween(point, candidate);
    if (distance <= radius && (!nearest || distance < nearest.distance || distance === nearest.distance && junction.node_id < nearest.nodeId)) nearest = { point: candidate, distance, nodeId: junction.node_id };
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
