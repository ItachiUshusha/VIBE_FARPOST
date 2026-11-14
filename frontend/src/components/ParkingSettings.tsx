"use client";

import { ChevronDown, Search } from "lucide-react";
import { defaultRangeExtractor, useVirtualizer, type Range } from "@tanstack/react-virtual";
import { memo, useCallback, useDeferredValue, useMemo, useRef, useState } from "react";
import { number } from "@/lib/api";
import type { Coordinate, Experiment, Parking } from "@/lib/types";
import styles from "./ParkingSettings.module.css";

type Props = {
  parkings: Parking[];
  destination?: Coordinate | null;
  occupancy: Record<string, number>;
  showParkings: boolean;
  disabled: boolean;
  onChange: (patch: Partial<Experiment>) => void;
};

export default memo(function ParkingSettings({ parkings, occupancy, showParkings, disabled, onChange, destination }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const query = useDeferredValue(search.trim().toLocaleLowerCase("ru"));
  const searchIndex = useMemo(() => parkings.map(parking => ({ parking,
    text: `${parking.name} ${parking.source_id ?? ""}`.toLocaleLowerCase("ru") })), [parkings]);
  const filtered = useMemo(() => {
    const found = query ? searchIndex.filter(item => item.text.includes(query)).map(item => item.parking) : [...parkings];
    if (destination) {
      const gap = (parking: Parking) => Math.hypot((parking.coordinates[0] - destination.lon) * Math.cos(destination.lat * Math.PI / 180), parking.coordinates[1] - destination.lat);
      found.sort((a, b) => gap(a) - gap(b));
    }
    return found;
  }, [query, parkings, searchIndex, destination]);
  const selected = filtered.find(parking => parking.parking_id === selectedId) || filtered[0];
  const changeOccupancy = useCallback((id: string, value: number) => {
    if (Number.isFinite(value)) onChange({ occupancy: { ...occupancy, [id]: Math.max(0, Math.min(100, value)) } });
  }, [occupancy, onChange]);

  return <details className="scenario-accordion parking-editor" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><span className="parking-letter">P</span><span>Парковки<small>{Object.keys(occupancy).length ? `Изменена занятость: ${Object.keys(occupancy).length}` : `${number(parkings.length)} объектов · поиск и занятость`}</small></span><ChevronDown size={14} /></summary>
    {open && <div className="accordion-body">
      <label className="check-label"><input type="checkbox" checked={showParkings} onChange={event => onChange({ showParkings: event.target.checked })} />Показать парковки на карте</label>
      <input className="parking-search" type="search" aria-label="Найти парковку" placeholder="Найти по названию или улице" value={search} onChange={event => setSearch(event.target.value)} />
      <p className="field-hint">{destination ? "Сначала парковки рядом с Б. " : ""}Выберите объект для изменения занятости. Данные и названия — OpenStreetMap.</p>
      <p className="field-hint" role="status">Найдено парковок: {number(filtered.length)}</p>
      {filtered.length ? <>
        <label className="field-label select-label" htmlFor="parking-settings-select">Парковка для настройки</label>
        <select id="parking-settings-select" value={selected?.parking_id || ""} disabled={disabled} onChange={event => setSelectedId(event.target.value)}>{filtered.map(parking => <option key={parking.parking_id} value={parking.parking_id}>{parking.name}</option>)}</select>
        {selected && !catalogOpen && <div className="parking-setting selected-parking-card"><ParkingRow key={selected.parking_id} parking={selected} value={occupancy[selected.parking_id] ?? selected.baseline_occupancy_percent} disabled={disabled} onChange={changeOccupancy} /></div>}
        <button className="quiet-action parking-catalog-toggle" aria-expanded={catalogOpen} onClick={() => setCatalogOpen(!catalogOpen)}><Search size={17} />{catalogOpen ? "Свернуть полный каталог" : "Открыть полный каталог"}</button>
        {catalogOpen && <><p className="field-hint">Расширенный режим: несколько парковок. Прокрутите список, чтобы загрузить следующие объекты.</p><VirtualParkingList key={query} parkings={filtered} occupancy={occupancy} disabled={disabled} onChange={changeOccupancy} /></>}
      </> : <p className="field-hint">По этому запросу парковок нет. Измените название или очистите поиск.</p>}

    </div>}
  </details>;
});

function VirtualParkingList({ parkings, occupancy, disabled, onChange }: {
  parkings: Parking[]; occupancy: Record<string, number>; disabled: boolean; onChange: (id: string, value: number) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const focusedIndex = useMemo(() => parkings.findIndex(parking => parking.parking_id === focusedId), [parkings, focusedId]);
  const rangeExtractor = useCallback((range: Range) => {
    const indices = defaultRangeExtractor(range);
    // Keep the edited row mounted when it leaves the viewport, preserving keyboard focus.
    if (focusedIndex >= 0 && !indices.includes(focusedIndex)) indices.push(focusedIndex);
    return indices.sort((a, b) => a - b);
  }, [focusedIndex]);
  const virtualizer = useVirtualizer({
    count: parkings.length,
    getScrollElement: () => viewport.current,
    estimateSize: () => 230,
    getItemKey: useCallback((index: number) => parkings[index].parking_id, [parkings]),
    overscan: 3,
    rangeExtractor,
  });

  return <div ref={viewport} className={`parking-settings ${styles.viewport}`} role="list" aria-label="Настройки парковок" tabIndex={0}
    onFocusCapture={event => {
      const row = (event.target as HTMLElement).closest<HTMLElement>("[data-parking-id]");
      setFocusedId(row?.dataset.parkingId ?? null);
    }}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusedId(null); }}>
    <div className={styles.space} style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map(item => {
        const parking = parkings[item.index];
        const value = occupancy[parking.parking_id] ?? parking.baseline_occupancy_percent;
        return <div key={item.key} ref={virtualizer.measureElement} data-index={item.index} data-parking-id={parking.parking_id}
          role="listitem" aria-posinset={item.index + 1} aria-setsize={parkings.length}
          className={`parking-setting ${styles.row}`} style={{ transform: `translateY(${item.start}px)` }}>
          <ParkingRow parking={parking} value={value} disabled={disabled} onChange={onChange} />
        </div>;
      })}
    </div>
  </div>;
}

function ParkingRow({ parking, value, disabled, onChange }: {
  parking: Parking; value: number; disabled: boolean; onChange: (id: string, value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const current = draft === null ? value : Number(draft);
  const valid = draft !== "" && Number.isFinite(current) && current >= 0 && current <= 100;
  return <>
    <div><strong>{parking.name}</strong><small>{parking.capacity ? `${parking.capacity} мест по OSM` : "Вместимость в OSM не задана"}{parking.source_tags?.access === "customers" ? " · для клиентов" : ""}</small>
      {parking.source_url && <a className="parking-source-link" href={parking.source_url} target="_blank" rel="noreferrer">Объект на OpenStreetMap ↗</a>}</div>
    <div className="occupancy-controls"><label><span className="sr-only">{`Занятость ${parking.name}`}</span><input type="number" inputMode="numeric" min="0" max="100" step="1" value={draft ?? value} aria-invalid={!valid} disabled={disabled}
      onChange={event => { const raw = event.target.value; setDraft(raw); const next = Number(raw); if (raw !== "" && Number.isFinite(next) && next >= 0 && next <= 100) onChange(parking.parking_id, next); }} onBlur={() => setDraft(null)} />% занято</label>
      {[0, 50, 75, 100].map(preset => <button key={preset} disabled={disabled} aria-pressed={value === preset} aria-label={preset === 100 ? `Заполнить парковку ${parking.name}` : `${preset}% занято: ${parking.name}`} onClick={() => { setDraft(null); onChange(parking.parking_id, preset); }}>{preset}%</button>)}</div>
    {!valid && <span className="field-error">Укажите число от 0 до 100. Пустое поле не применяется.</span>}
    {value === 100 && <span className="full-parking-label">Мест нет</span>}
  </>;
}
