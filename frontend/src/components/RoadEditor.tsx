"use client";

import { ArrowLeftRight, Check, Pencil, Route, Trash2, X } from "lucide-react";
import { distance, number } from "@/lib/api";
import { plural, roadLength } from "@/lib/roads";
import type { RoadDraft } from "@/lib/types";

type Props = { road: RoadDraft; disabled: boolean; onChange: (patch: Partial<RoadDraft>) => void; onClose: () => void; onApply: () => void; onRemove: () => void; onRedraw: () => void };

export default function RoadEditor({ road, disabled, onChange, onClose, onApply, onRemove, onRedraw }: Props) {
  const valid = road.name.trim().length > 0 && Number.isInteger(road.lanes) && road.lanes >= 1 && road.lanes <= 6;
  const totalLanes = road.lanes * (road.two_way ? 2 : 1);
  return <section className="road-map-editor" aria-label="Настройки новой дороги">
    <div className="house-editor-heading editor-heading" data-sheet-handle><Route size={20} /><div><strong>Настройки дороги</strong><small>{distance(roadLength(road.points))} · черновик до нажатия «Готово»</small></div><button className="icon-button" aria-label="Закрыть настройки дороги" onClick={onClose}><X size={20} /></button></div>
    <div className="editor-scroll">
    <label className="field-label" htmlFor="new-road-name">Название</label><input id="new-road-name" aria-invalid={!road.name.trim()} aria-describedby="road-name-error" maxLength={80} value={road.name} disabled={disabled} onChange={event => onChange({ name: event.target.value })} />
    {!road.name.trim() && <p id="road-name-error" className="field-error">Введите название дороги.</p>}
    <label className="field-label select-label" htmlFor="new-road-lanes">Полос в каждом направлении</label><div className="road-lane-stepper"><button aria-label="Уменьшить число полос" disabled={disabled || road.lanes <= 1} onClick={() => onChange({ lanes: Number.isFinite(road.lanes) ? Math.max(1, road.lanes - 1) : 1 })}>−</button><input id="new-road-lanes" aria-invalid={!Number.isInteger(road.lanes) || road.lanes < 1 || road.lanes > 6} aria-describedby="road-lanes-error" type="number" inputMode="numeric" min={1} max={6} step={1} value={Number.isFinite(road.lanes) ? road.lanes : ""} disabled={disabled} onChange={event => onChange({ lanes: event.target.value === "" ? NaN : Number(event.target.value) })} /><button aria-label="Увеличить число полос" disabled={disabled || road.lanes >= 6} onClick={() => onChange({ lanes: Number.isFinite(road.lanes) ? Math.min(6, road.lanes + 1) : 1 })}>+</button></div>
    {(!Number.isInteger(road.lanes) || road.lanes < 1 || road.lanes > 6) && <p id="road-lanes-error" className="field-error">Введите целое число полос от 1 до 6.</p>}
    <label className="field-label select-label" htmlFor="new-road-direction"><ArrowLeftRight size={14} />Движение</label><select id="new-road-direction" value={road.two_way ? "both" : "one"} disabled={disabled} onChange={event => onChange({ two_way: event.target.value === "both" })}><option value="both">В обе стороны</option><option value="one">Только от начала к концу</option></select>
    <label className="field-label select-label" htmlFor="new-road-speed">Скорость без пробок</label><select id="new-road-speed" value={road.speed_kmh} disabled={disabled} onChange={event => onChange({ speed_kmh: Number(event.target.value) })}>{[10, 20, 30, 40, 50, 60, 70, 80, 90].map(speed => <option key={speed} value={speed}>{speed} км/ч</option>)}</select>
    <p className="field-hint">{valid ? `${number(totalLanes)} ${plural(totalLanes, ["полоса", "полосы", "полос"])} всего. Больше полос — больше машин может проехать. Дорога соединяется с существующими улицами в начале и конце.` : "Укажите название и от 1 до 6 полос в каждом направлении."}</p>
    <button className="quiet-action" disabled={disabled} onClick={onRedraw}><Pencil size={14} />Нарисовать путь заново</button>
    <button className="house-delete-button editor-delete" disabled={disabled} onClick={onRemove}><Trash2 size={16} />Убрать дорогу</button>
    </div>
    <div className="house-editor-actions editor-actions"><button className="editor-cancel" onClick={onClose}>Отмена</button><button className="house-done-button" disabled={disabled || !valid} onClick={onApply}><Check size={17} />Готово</button></div>
  </section>;
}
