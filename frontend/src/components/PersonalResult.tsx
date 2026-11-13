"use client";

import { AlertTriangle, ArrowRight, Car, ChevronDown, Clock3, Footprints, Navigation } from "lucide-react";
import { distance, number, time, timeChange } from "@/lib/api";
import type { PersonalComparison } from "@/lib/types";
import * as m from "motion/react-m";

export default function PersonalResult({ result, phase, onShow }: { result: PersonalComparison; phase: "before" | "after"; onShow: () => void }) {
  const { before, after, comparison } = result;
  const current = result[phase];
  return <m.section className="personal-result" aria-label="Результат личной поездки" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .22 }}><div className="personal-result-heading"><Navigation size={16} /><strong>Ваша поездка</strong><span>А → Б</span></div>
    <div className="personal-time-comparison"><div><small>До</small><b>{time(before.total_time_s)}</b><small className="personal-time-scope">{before.parking_included ? "с парковкой и пешком" : "дорога до Б"}</small></div><ArrowRight size={18} /><div><small>После</small><b>{time(after.total_time_s)}</b><small className="personal-time-scope">{after.parking_included ? "с парковкой и пешком" : "дорога до Б"}</small></div></div>
    <div className={`personal-delta ${comparison.absolute === null ? "tone-muted" : comparison.absolute > 0 ? "tone-red" : "tone-green"}`}>{timeChange(comparison.absolute)}</div>
    <button className="show-personal-route" onClick={onShow}><Navigation size={13} />Показать поездку на карте<ArrowRight size={13} /></button>
    {before.status !== "ok" && <p className="personal-status" role="status">До: {before.message}</p>}{after.status !== "ok" && <p className="personal-status" role="status">После: {after.message}</p>}
    {current.parking_message && <div className="personal-parking-warning" role="status"><AlertTriangle size={17} /><div><strong>Парковка · {phase === "before" ? "до изменения" : "после изменения"}</strong><p>{current.parking_message}</p>{current.car_route && <small>Маршрут до Б показан на карте. Итог — только время в пути.</small>}</div></div>}
    {result.comparison_note && <p className="field-hint personal-comparison-note">{result.comparison_note}</p>}
    <div className="personal-breakdown"><div className="personal-breakdown-header"><span>Из чего складывается</span><span>До</span><span>После</span></div>{[
      { label: "Дорога", Icon: Car, before: before.drive_time_s, after: after.drive_time_s },
      { label: "Поиск места", Icon: Clock3, before: before.search_time_s, after: after.search_time_s },
      { label: "Пешком", Icon: Footprints, before: before.walk_time_s, after: after.walk_time_s },
    ].map(row => <div className="personal-breakdown-row" key={row.label}><span><row.Icon size={13} />{row.label}</span><span>{time(row.before)}</span><strong>{time(row.after)}</strong></div>)}</div>
    <p className="personal-distance">По дороге: {distance(before.length_m)} → {distance(after.length_m)}</p>
    {(before.parking || after.parking) && <div className="chosen-parking"><span className="parking-letter">P</span><div><strong>До: {before.parking?.name || "—"}</strong><strong>После: {after.parking?.name || "—"}</strong><small>{current.parking_included ? `Пешком ${number(current.walk_distance_m || 0)} м по прямой` : "Парковка не учтена в текущем маршруте"}</small>{current.parking?.source_url && <a className="parking-source-link" href={current.parking.source_url} target="_blank" rel="noreferrer">Исходный объект OpenStreetMap ↗</a>}</div></div>}
    {!!current.alternatives.length && <details className="parking-alternatives"><summary>Варианты парковки · {phase === "before" ? "до" : "после"}<ChevronDown size={13} /></summary>{current.alternatives.map(a => <div className={`parking-alternative ${current.parking?.parking_id === a.parking.parking_id ? "chosen" : ""}`} key={a.parking.parking_id}><span><strong>{a.parking.name}</strong><small>{a.parking.is_demo ? "Демо · " : "OSM · "}{number(a.parking.occupancy_percent ?? 0)}% занято</small></span><b>{a.status === "ok" ? time(a.total_time_s) : a.status === "full" ? "Мест нет" : "Нет пути"}</b></div>)}</details>}
    <p className="field-hint">Время вашей поездки учитывает остальные машины на дороге. Сам маршрут не добавляет ещё одну машину в расчёт.</p>
  </m.section>;
}
