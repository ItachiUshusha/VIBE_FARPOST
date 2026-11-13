"use client";

import { Car, Check, House, MapPin, Trash2, X } from "lucide-react";
import { number } from "@/lib/api";
import type { Catalogs, HouseDraft } from "@/lib/types";

type Props = {
  house: HouseDraft;
  catalogs: Catalogs;
  disabled: boolean;
  onChange: (patch: Partial<HouseDraft>) => void;
  onClose: () => void;
  onRemove: () => void;
  onReposition: () => void;
};

export default function HouseEditor({ house, catalogs, disabled, onChange, onClose, onRemove, onReposition }: Props) {
  const valid = Number.isInteger(house.residents) && house.residents >= 1 && house.residents <= 20000;
  return <section className="house-map-editor" aria-label="Настройки нового дома">
    <div className="house-editor-heading"><House size={18} /><div><strong>Новый дом</strong><small>Метка уже добавлена в сценарий</small></div><button className="icon-button" aria-label="Закрыть настройки дома" onClick={onClose} disabled={!valid}><X size={16} /></button></div>
    <label className="field-label" htmlFor="house-residents">Количество жильцов</label>
    <div className="house-residents-input"><input id="house-residents" type="number" inputMode="numeric" min="1" max="20000" step="1" value={Number.isFinite(house.residents) ? house.residents : ""} aria-invalid={!valid} disabled={disabled} onChange={e => onChange({ residents: e.target.value === "" ? NaN : Number(e.target.value) })} /><span>человек</span></div>
    <div className="house-car-count"><Car size={15} /><strong>{valid ? number(house.residents) : "—"} машин в расчёте</strong><span>1 житель = 1 авто</span></div>
    <p className="field-error house-validation" aria-live="polite">{!valid ? "Введите целое число от 1 до 20 000." : ""}</p>
    <label className="field-label select-label" htmlFor="house-terminal">Куда поедут жители</label>
    <select id="house-terminal" value={house.terminal_id} disabled={disabled} onChange={e => onChange({ terminal_id: e.target.value })}>{catalogs.terminals.map(t => <option key={t.terminal_id} value={t.terminal_id}>{t.label}</option>)}</select>
    <button className="house-position-button" disabled={disabled} onClick={onReposition}><MapPin size={13} /><span>{house.coordinates.lat.toFixed(5)}, {house.coordinates.lon.toFixed(5)}<small>Переставить на карте · метку также можно перетаскивать</small></span></button>
    <div className="house-editor-actions"><button className="house-delete-button" disabled={disabled} onClick={onRemove}><Trash2 size={14} />Убрать дом</button><button className="house-done-button" disabled={disabled || !valid} onClick={onClose}><Check size={14} />Готово</button></div>
  </section>;
}
