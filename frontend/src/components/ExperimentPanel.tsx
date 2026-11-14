"use client";

import { ArrowDown, ArrowUp, Car, ChevronDown, CloudRain, House, MapPin, Navigation, Plus, Route, Snowflake, Sun, Trash2, Users, X } from "lucide-react";
import { useMemo } from "react";
import ParkingSettings from "./ParkingSettings";
import { distance, number } from "@/lib/api";
import { plural, pointStreetName, roadLength } from "@/lib/roads";
import type { Catalogs, Experiment, Placement, Segment, Weather } from "@/lib/types";

export const WEATHER_NAMES: Record<Weather, string> = { dry: "Сухо", rain: "Дождь", snow: "Снег" };
export const initialExperiment = (): Experiment => ({ vehicleCount: 1000, weather: "dry", routeEnabled: false,
  points: [null, null], parkingMode: "none", parkingId: "", occupancy: {}, addedHouses: [], removedHouses: [], addedRoads: [],
  showParkings: true, showHouses: true });

type Props = {
  catalogs: Catalogs; value: Experiment; onChange: (patch: Partial<Experiment>) => void;
  placement: Placement; onPlace: (action: Placement) => void; disabled: boolean;
  onEditHouse: (id: string) => void;
  onStartRoad: () => void; onEditRoad: (id: string) => void;
  part?: "traffic" | "settings";
  segments?: Segment[];
};

export default function ExperimentPanel({ catalogs, value: exp, onChange, placement, onPlace, onEditHouse, onStartRoad, onEditRoad, disabled, part, segments }: Props) {
  const config = catalogs.config;
  const pointNames = useMemo(() => exp.points.map(point => point && segments ? pointStreetName(point, segments, config.snap_radius_m) : null), [exp.points, segments, config.snap_radius_m]);
  const manualParkings = useMemo(() => {
    if (part === "traffic") return [];
    const end = exp.points.at(-1);
    const ranked = catalogs.parkings.map(p => ({ parking: p, gap: end ? Math.hypot((p.coordinates[0] - end.lon) * 111195 * Math.cos(end.lat * Math.PI / 180), (p.coordinates[1] - end.lat) * 111195) : 0 }));
    if (end) ranked.sort((a, b) => a.gap - b.gap || a.parking.parking_id.localeCompare(b.parking.parking_id));
    const nearby = end ? ranked.filter(p => p.gap <= config.parking_radius_m) : ranked.slice(0, 40);
    const options = (nearby.length ? nearby : ranked.slice(0, 1)).map(p => p.parking);
    const selected = catalogs.parkings.find(p => p.parking_id === exp.parkingId);
    if (selected && !options.some(p => p.parking_id === selected.parking_id)) options.unshift(selected);
    return options;
  }, [catalogs.parkings, exp.points, exp.parkingId, config.parking_radius_m, part]);
  const countValid = Number.isInteger(exp.vehicleCount) && exp.vehicleCount >= config.min_vehicle_count && exp.vehicleCount <= config.max_vehicle_count;
  const setPoints = (points: Experiment["points"]) => { onChange({ points }); onPlace(null); };
  const movePoint = (index: number, direction: number) => {
    const points = [...exp.points];
    [points[index], points[index + direction]] = [points[index + direction], points[index]];
    setPoints(points);
  };
  return <div className="experiment-panel">
    {part !== "settings" && <section className="traffic-picker" aria-label="Количество автомобилей">
      <div className="traffic-heading"><label htmlFor="vehicle-count"><Users size={15} />Автомобилей в районе</label><span>в этом расчёте</span></div>
      <div className="vehicle-number"><Car size={21} /><input id="vehicle-count" aria-invalid={!countValid} type="number" inputMode="numeric" min={config.min_vehicle_count} max={config.max_vehicle_count} step="1" value={Number.isFinite(exp.vehicleCount) ? exp.vehicleCount : ""} disabled={disabled} onChange={e => onChange({ vehicleCount: e.target.value === "" ? NaN : Number(e.target.value) })} /><span>машин</span></div>
      <input className="vehicle-slider" aria-label="Количество авто ползунком" type="range" min={config.min_vehicle_count} max={config.max_vehicle_count} step="1" value={countValid ? exp.vehicleCount : config.min_vehicle_count} disabled={disabled} onChange={e => onChange({ vehicleCount: Number(e.target.value) })} />
      <div className="vehicle-presets">{[100, 500, 1000, 2500, 5000].map(n => <button key={n} aria-pressed={exp.vehicleCount === n} className={exp.vehicleCount === n ? "active" : ""} disabled={disabled} onClick={() => onChange({ vehicleCount: n })}>{number(n)}</button>)}</div>
      {!countValid ? <p className="field-error">Введите целое число от {config.min_vehicle_count} до {number(config.max_vehicle_count)}.</p> : <p className="traffic-hint">В исходном числе учтены {catalogs.houses.reduce((sum, h) => sum + h.residents, 0)} авто существующих домов. Новые дома добавляют машины: 1 житель = 1 авто.</p>}
    </section>}

    {part !== "traffic" && <>

    <details className="scenario-accordion route-editor" open={exp.routeEnabled || undefined}>
      <summary><Navigation size={16} /><span>Мой маршрут<small>{exp.routeEnabled ? `Выбрано точек: ${exp.points.filter(Boolean).length} из ${exp.points.length}` : "А → через → Б · личная поездка"}</small></span><ChevronDown size={14} /></summary>
      <div className="accordion-body"><label className="check-label"><input type="checkbox" checked={exp.routeEnabled} disabled={disabled} onChange={e => { onChange({ routeEnabled: e.target.checked }); if (e.target.checked && !exp.points[0]) onPlace({ kind: "route", index: 0 }); else onPlace(null); }} />Рассчитать личную поездку</label>
        <button className="quiet-action route-demo-button" disabled={disabled} onClick={() => { const demo = catalogs.demo_personal_route; onChange({ routeEnabled: true, points: [demo.origin, ...demo.via, demo.destination], parkingMode: "auto" }); onPlace(null); }}><MapPin size={13} />Пример маршрута с парковкой</button>
        {exp.routeEnabled && <><div className="point-list">{exp.points.map((point, index) => {
          const label = index === 0 ? "А" : index === exp.points.length - 1 ? "Б" : String(index);
          const title = index === 0 ? "Начало А" : index === exp.points.length - 1 ? "Конец Б" : `Через ${index}`;
          return <div className={`point-row ${placement?.kind === "route" && placement.index === index ? "placing" : ""}`} key={index}><b>{label}</b><button className="point-coordinate" aria-label={`Изменить точку ${label}`} disabled={disabled} onClick={() => onPlace({ kind: "route", index })}><span>{point ? pointNames[index] || title : `Выбрать ${title.toLocaleLowerCase("ru")} на карте`}</span><small>{placement?.kind === "route" && placement.index === index ? "Нажмите на карту — выбор ещё не завершён" : point ? `${title} · ${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}` : "Нажмите и укажите место на карте"}</small></button>{index > 0 && index < exp.points.length - 1 && <div className="point-actions"><button aria-label={`Поднять точку Через ${index}`} disabled={disabled || index === 1} onClick={() => movePoint(index, -1)}><ArrowUp size={12} /></button><button aria-label={`Опустить точку Через ${index}`} disabled={disabled || index === exp.points.length - 2} onClick={() => movePoint(index, 1)}><ArrowDown size={12} /></button></div>}<button className="icon-button" aria-label={`Удалить точку ${label}`} disabled={disabled || !point && (index === 0 || index === exp.points.length - 1)} onClick={() => { if (index === 0 || index === exp.points.length - 1) { const points = [...exp.points]; points[index] = null; setPoints(points); } else setPoints(exp.points.filter((_, i) => i !== index)); }}><X size={13} /></button></div>;
        })}</div><button className="quiet-action" disabled={disabled || !exp.points[0] || !exp.points.at(-1)} onClick={() => setPoints([...exp.points].reverse())}><ArrowDown size={16} />Поменять А и Б</button><button className="quiet-action" disabled={disabled || exp.points.length >= 7} onClick={() => { const points = [...exp.points.slice(0, -1), null, exp.points[exp.points.length - 1]]; onChange({ points }); onPlace({ kind: "route", index: points.length - 2 }); }}><Plus size={13} />Добавить точку «Через»</button>
          <p className="field-hint">Точки привязываются к дороге в пределах {config.snap_radius_m} м. Метки можно перетащить.</p>
          <label className="field-label select-label" htmlFor="parking-mode">Парковка у точки Б</label><select id="parking-mode" value={exp.parkingMode} disabled={disabled} onChange={e => onChange({ parkingMode: e.target.value as Experiment["parkingMode"], parkingId: e.target.value === "manual" ? exp.parkingId || manualParkings[0]?.parking_id || "" : "", showParkings: true })}><option value="none">Без парковки</option><option value="auto">Самый быстрый вариант</option><option value="manual">Выбрать парковку вручную</option></select>
          {exp.parkingMode === "manual" && <select aria-label="Выбранная парковка" value={exp.parkingId} disabled={disabled} onChange={e => onChange({ parkingId: e.target.value })}>{manualParkings.map(p => <option value={p.parking_id} key={p.parking_id}>{p.name}</option>)}</select>}
          {exp.parkingMode !== "none" && <p className="field-hint">Поиск в радиусе {config.parking_radius_m} м от Б. Если места нет, построим маршрут до Б и предупредим отдельно. Пешком — оценка по прямой, {number(config.walking_speed_kmh, 1)} км/ч.</p>}
        </>}
      </div>
    </details>

    <h3 className="group-heading">Дополнительные условия</h3>
    <section className="weather-picker"><span className="field-label">Погода после изменения</span><div className="weather-options">{([{ id: "dry", Icon: Sun }, { id: "rain", Icon: CloudRain }, { id: "snow", Icon: Snowflake }] as const).map(({ id, Icon }) => <button key={id} disabled={disabled} className={exp.weather === id ? "active" : ""} aria-pressed={exp.weather === id} onClick={() => onChange({ weather: id })}><Icon size={16} />{WEATHER_NAMES[id]}<small>{id === "dry" ? "Обычная скорость" : `На ${number((1 - config.weather_factors[id]) * 100)}% медленнее`}</small></button>)}</div></section>

    <ParkingSettings destination={exp.routeEnabled ? exp.points.at(-1) : null} parkings={catalogs.parkings} occupancy={exp.occupancy} showParkings={exp.showParkings} disabled={disabled} onChange={onChange} />

    <details className="scenario-accordion roads-editor" open={exp.addedRoads.length > 0 || undefined}><summary><Route size={16} /><span>Свои дороги<small>{exp.addedRoads.length ? `${exp.addedRoads.length} добавлено в сценарий` : "Соедините улицы и сравните время поездки"}</small></span><ChevronDown size={14} /></summary><div className="accordion-body">{exp.addedRoads.map(road => <div className="house-card custom-road-card" key={road.road_id}><Route size={16} /><button className="house-card-edit" disabled={disabled} onClick={() => onEditRoad(road.road_id)}><strong>{road.name || "Новая дорога"}</strong><small>{distance(roadLength(road.points))} · {Number.isFinite(road.lanes) ? `${road.lanes} ${plural(road.lanes, ["полоса", "полосы", "полос"])} ${road.two_way ? "в каждую сторону" : "в одну сторону"}` : "Укажите число полос"} · {road.speed_kmh} км/ч</small></button><button className="icon-button" aria-label={`Убрать дорогу ${road.name}`} disabled={disabled} onClick={() => onChange({ addedRoads: exp.addedRoads.filter(item => item.road_id !== road.road_id) })}><X size={15} /></button></div>)}<button className="quiet-action" disabled={disabled || exp.addedRoads.length >= 5} onClick={onStartRoad}><Plus size={14} />Нарисовать дорогу на карте</button><p className="field-hint">Поставьте начало, добавьте повороты и конец, затем нажмите «Готово». Начало и конец соединяются с ближайшими перекрёстками в пределах {config.snap_radius_m} м. Дорога начнёт работать в сценарии «После». Можно добавить до пяти дорог.</p></div></details>
    <details className="scenario-accordion housing-editor" open={exp.addedHouses.length > 0 || exp.removedHouses.length > 0 || undefined}><summary><House size={16} /><span>Жилые дома<small>1 житель = 1 машина</small></span><ChevronDown size={14} /></summary><div className="accordion-body"><label className="check-label"><input type="checkbox" checked={exp.showHouses} onChange={e => onChange({ showHouses: e.target.checked })} />Показать дома, учтённые в расчёте</label>
      {catalogs.houses.map(h => <div className={`house-card ${exp.removedHouses.includes(h.house_id) ? "removed" : ""}`} key={h.house_id}><House size={16} /><span><strong>{h.name}</strong><small>{h.residents} жителей в расчёте · {number(h.residents * config.k_auto, 1)} авто</small><small>{exp.removedHouses.includes(h.house_id) ? "Снесён в сценарии — машины жителей убраны" : "Жители этого дома уже учтены в исходном числе машин"}</small></span><button className="house-demolish-button" disabled={disabled} title={exp.removedHouses.includes(h.house_id) ? "Вернуть дом" : "Снести дом"} aria-label={exp.removedHouses.includes(h.house_id) ? `Вернуть дом ${h.name}` : `Снести дом ${h.name}`} onClick={() => onChange({ removedHouses: exp.removedHouses.includes(h.house_id) ? exp.removedHouses.filter(id => id !== h.house_id) : [...exp.removedHouses, h.house_id] })}>{exp.removedHouses.includes(h.house_id) ? <Plus size={15} /> : <Trash2 size={15} />}{exp.removedHouses.includes(h.house_id) ? "Вернуть" : "Снести"}</button></div>)}
      {exp.addedHouses.map(h => <div className="house-card added" key={h.house_id}><House size={16} /><button className="house-card-edit" disabled={disabled} aria-label={`Настроить дом ${h.house_id}`} onClick={() => onEditHouse(h.house_id)}><strong>Новый дом · {Number.isFinite(h.residents) ? h.residents : "—"} жителей</strong><small>+{Number.isFinite(h.residents) ? number(h.residents) : "—"} машин · настроить</small></button><button className="icon-button" disabled={disabled} aria-label={`Удалить новый дом ${h.house_id}`} onClick={() => onChange({ addedHouses: exp.addedHouses.filter(x => x.house_id !== h.house_id) })}><X size={14} /></button></div>)}
      <button className="quiet-action danger-action" disabled={disabled || !catalogs.houses.length} onClick={() => { onChange({ showHouses: true }); onPlace({ kind: "demolish" }); }}><Trash2 size={14} />Снести дом на карте</button><p className="field-hint">Для сноса выберите дом с фиолетовой меткой. Число машин уменьшится на количество его жителей. Другие здания показаны только как подложка.</p><button className={`quiet-action ${placement?.kind === "house" ? "active" : ""}`} disabled={disabled || exp.addedHouses.length >= 10} onClick={() => { onChange({ showHouses: true }); onPlace({ kind: "house" }); }}><MapPin size={13} />Поставить новый дом на карте</button><p className="field-hint">Нажмите на карту — метка появится сразу. Настройте жильцов и направление, затем нажмите «Готово». Отмена не добавит дом в расчёт. Для повторного редактирования нажмите на метку.</p>
    </div></details></>}
  </div>;
}

export function ExperimentHelp({ catalogs }: { catalogs: Catalogs | null }) {
  if (!catalogs) return null;
  const c = catalogs.config;
  return <div className="extended-help"><h3>Машины и дома</h3><p>Выберите, сколько машин участвует в расчёте. На каждую машину приходится одна поездка по одному из направлений. Новый дом добавляет по одной машине на жителя. Снос дома убирает машины его жителей. Снести можно выделенные дома, которые уже учтены в расчёте; остальные здания служат подложкой карты.</p>
    <h3>Полосы и свои дороги</h3><p>Число полос существующей дороги берётся из сохранённых данных OpenStreetMap. Если сведений нет, это указано в карточке. При перекрытии проезд закрывается полностью. Сужение уменьшает количество машин, которое дорога может пропустить.</p><p>Чтобы добавить дорогу, поставьте её начало, повороты и конец. Начало и конец соединяются с ближайшими перекрёстками не дальше {c.snap_radius_m} м. Выберите число полос, скорость и направление движения. Новая дорога доступна только в сценарии «После» и участвует в поиске более быстрого пути. В пересечениях с другими улицами дополнительные съезды автоматически не создаются.</p>
    <h3>Время и загруженность</h3><p>«Время поездки» — сколько в среднем едут машины по одним и тем же направлениям до и после изменения. «Длина маршрута» — средняя длина этих поездок. «Перегруженные участки» — дороги, где машин больше расчётной вместимости. «Не могут доехать» — машины, для которых не осталось открытого маршрута. Их время не включается в среднее.</p>
    <h3>Ваша поездка</h3><p>Поставьте А, Б и до пяти точек «Через». Метки можно перетаскивать. Точки соединяются с ближайшей подходящей дорогой не дальше {c.snap_radius_m} м. Время учитывает остальные машины, но ваша личная поездка не добавляет ещё одну машину в расчёт.</p>
    <h3>Парковка и путь пешком</h3><p>Все {number(catalogs.parkings.length)} парковок взяты из OpenStreetMap; у каждой есть ссылка на источник. Вы задаёте, сколько мест занято. В автоматическом режиме выбирается парковка не дальше {c.parking_radius_m} м от Б, с которой сумма времени за рулём, поиска места и пешего пути будет наименьшей.</p><p>Чем меньше свободных мест, тем дольше поиск: при 50% занятых мест — около минуты, при 75% — около трёх. Полностью занятые парковки не используются. Если места нет, останется маршрут до Б и отдельное предупреждение. Пеший путь оценивается по прямой при скорости {number(c.walking_speed_kmh, 1)} км/ч.</p>
    <h3>Погода и час пик</h3><p>До изменения всегда сухо. В дождь скорость в расчёте ниже на {number((1 - c.weather_factors.rain) * 100)}%, в снег — на {number((1 - c.weather_factors.snow) * 100)}%. В час пик вы выбираете, на сколько увеличить число машин.</p><p>Улицы и парковки взяты из реальных данных. Число жителей, занятость, скорость и вместимость дорог заданы для эксперимента. Результат помогает сравнить решения и не является прогнозом реальных пробок.</p></div>;
}
