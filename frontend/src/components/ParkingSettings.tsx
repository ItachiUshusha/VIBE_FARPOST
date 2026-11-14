"use client";

import { ChevronDown } from "lucide-react";
import { defaultRangeExtractor, useVirtualizer, type Range } from "@tanstack/react-virtual";
import { memo, useCallback, useDeferredValue, useMemo, useRef, useState } from "react";
import { number } from "@/lib/api";
import type { Experiment, Parking } from "@/lib/types";
import styles from "./ParkingSettings.module.css";

type Props = {
  parkings: Parking[];
  occupancy: Record<string, number>;
  showParkings: boolean;
  disabled: boolean;
  onChange: (patch: Partial<Experiment>) => void;
};

export default memo(function ParkingSettings({ parkings, occupancy, showParkings, disabled, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const query = useDeferredValue(search.trim().toLocaleLowerCase("ru"));
  const searchIndex = useMemo(() => parkings.map(parking => ({ parking,
    text: `${parking.name} ${parking.source_id ?? ""}`.toLocaleLowerCase("ru") })), [parkings]);
  const filtered = useMemo(() => query ? searchIndex.filter(item => item.text.includes(query)).map(item => item.parking) : parkings,
    [query, parkings, searchIndex]);
  const changeOccupancy = useCallback((id: string, value: number) => {
    if (Number.isFinite(value)) onChange({ occupancy: { ...occupancy, [id]: Math.max(0, Math.min(100, value)) } });
  }, [occupancy, onChange]);

  return <details className="scenario-accordion parking-editor" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><span className="parking-letter">P</span><span>Парковки<small>{number(parkings.length)} объектов OpenStreetMap</small></span><ChevronDown size={14} /></summary>
    {open && <div className="accordion-body">
      <label className="check-label"><input type="checkbox" checked={showParkings} onChange={event => onChange({ showParkings: event.target.checked })} />Показать парковки на карте</label>
      <input className="parking-search" type="search" aria-label="Найти парковку" placeholder="Найти по названию или улице" value={search} onChange={event => setSearch(event.target.value)} />
      <p className="field-hint">Парковки из OpenStreetMap. Занятость можно изменить для сценария. Безымянные объекты подписаны по ближайшей улице.</p>
      <p className="field-hint" role="status">Найдено парковок: {number(filtered.length)}</p>
      {filtered.length ? <VirtualParkingList key={query} parkings={filtered} occupancy={occupancy} disabled={disabled} onChange={changeOccupancy} />
        : <p className="field-hint">По этому запросу парковок нет.</p>}
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
    estimateSize: () => 180,
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
          <div><strong>{parking.name}</strong><small>{parking.capacity ? `${parking.capacity} мест по OSM` : "Вместимость в OSM не задана"}{parking.source_tags?.access === "customers" ? " · для клиентов" : ""}</small>
            {parking.source_url && <a className="parking-source-link" href={parking.source_url} target="_blank" rel="noreferrer">Объект на OpenStreetMap ↗</a>}</div>
          <div className="occupancy-controls"><label><span className="sr-only">{`Занятость ${parking.name}`}</span><input type="number" min="0" max="100" step="1" value={value} disabled={disabled} onChange={event => onChange(parking.parking_id, Number(event.target.value))} />%</label>
            {[50, 75, 100].map(preset => <button key={preset} disabled={disabled} aria-label={preset === 100 ? `Заполнить парковку ${parking.name}` : undefined} onClick={() => onChange(parking.parking_id, preset)}>{preset}%</button>)}</div>
          {value === 100 && <span className="full-parking-label">Мест нет</span>}
        </div>;
      })}
    </div>
  </div>;
}
