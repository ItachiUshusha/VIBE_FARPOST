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
  onApply: () => void;
  onRemove: () => void;
  onReposition: () => void;
};

export default function HouseEditor({ house, catalogs, disabled, onChange, onClose, onApply, onRemove, onReposition }: Props) {
  const valid = Number.isInteger(house.residents) && house.residents >= 1 && house.residents <= 20000;
  return <section className="house-map-editor" aria-label="Настройки нового дома">
    <div className="house-editor-heading editor-heading" data-sheet-handle><House size={20} /><div><strong>Настройки дома</strong><small>Изменения применятся по кнопке «Готово»</small></div><button className="icon-button" aria-label="Закрыть настройки дома" onClick={onClose}><X size={20} /></button></div>
    <div className="editor-scroll">
    <label className="field-label" htmlFor="house-residents">Количество жильцов</label>
    <div className="house-residents-input"><input id="house-residents" type="number" inputMode="numeric" min="1" max="20000" step="1" value={Number.isFinite(house.residents) ? house.residents : ""} aria-invalid={!valid} aria-describedby="house-residents-error" disabled={disabled} onChange={e => onChange({ residents: e.target.value === "" ? NaN : Number(e.target.value) })} /><span>человек</span></div>
    <div className="house-car-count"><Car size={15} /><strong>{valid ? number(house.residents) : "—"} машин в расчёте</strong><span>1 житель = 1 авто</span></div>
    <p id="house-residents-error" className="field-error house-validation" aria-live="polite">{!valid ? "Введите целое число от 1 до 20 000." : ""}</p>
    <label className="field-label select-label" htmlFor="house-terminal">Куда поедут жители</label>
    <select id="house-terminal" value={house.terminal_id} disabled={disabled} onChange={e => onChange({ terminal_id: e.target.value })}>{catalogs.terminals.map(t => <option key={t.terminal_id} value={t.terminal_id}>{t.label}</option>)}</select>
    <button className="house-position-button" disabled={disabled} onClick={onReposition}><MapPin size={13} /><span>{house.coordinates.lat.toFixed(5)}, {house.coordinates.lon.toFixed(5)}<small>Переставить на карте · метку также можно перетаскивать</small></span></button>
    <button className="house-delete-button editor-delete" disabled={disabled} onClick={onRemove}><Trash2 size={16} />Убрать дом</button>
    </div>
    <div className="house-editor-actions editor-actions"><button className="editor-cancel" onClick={onClose}>Отмена</button><button className="house-done-button" disabled={disabled || !valid} onClick={onApply}><Check size={17} />Готово</button></div>
  </section>;
}
