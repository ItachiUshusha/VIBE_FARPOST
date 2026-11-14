"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { accountApi, type User } from "@/lib/account-api";

type Row = { id: string; [key: string]: unknown };
type Listing = { items: Row[]; total: number; page: number; page_size: number };
type Overview = { metrics: Record<string, number | null>; registrations: { date: string; count: number }[]; login_methods: Record<string, number> };
type Traffic = { status: string; message?: string; report_url: string; rows: Record<string, number | string>[]; missing_goals?: string[] };
type Action = { title: string; description: string; path: string; method: string; body: unknown };
const SECTIONS: Record<string, string> = { overview: "Обзор", users: "Пользователи", runs: "Расчёты", presets: "Шаблоны", datasets: "Дорожные данные", audit: "Журнал изменений", traffic: "Источники и конверсии" };
const FIELDS: Record<string, [string, string][]> = {
  users: [["display_name", "Пользователь"], ["username", "Логин"], ["registration_method", "Регистрация"], ["role", "Роль"], ["status", "Статус"], ["created_at", "Дата регистрации"]],
  runs: [["id", "Расчёт"], ["created_at", "Дата"], ["scenario_type", "Сценарий"], ["calculation_ms", "Расчёт, мс"], ["archived", "В архиве"]],
  presets: [["name", "Название"], ["scenario_type", "Тип"], ["dataset_version", "Версия дорог"], ["archived", "В архиве"]],
  datasets: [["version", "Версия"], ["nodes_count", "Перекрёстки"], ["edges_count", "Направленные участки"], ["trips_count", "Направления поездок"]],
  audit: [["created_at", "Когда"], ["actor_id", "Кто"], ["action", "Действие"], ["target_id", "Запись"], ["status", "Результат"]],
};
const LABELS: Record<string, string> = { active: "Активен", blocked: "Заблокирован", user: "Пользователь", admin: "Администратор", local: "Пароль", yandex: "Яндекс ID", vk: "VK ID",
  closure: "Перекрытие", capacity_reduction: "Сужение", demand_increase: "Час пик", composite: "Составной", applied: "Применено", pending: "В процессе", failed: "Ошибка" };
function display(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  if (typeof value === "number") return value.toLocaleString("ru", { maximumFractionDigits: 1 });
  if (typeof value === "string") return /^\d{4}-\d{2}-\d{2}T/.test(value) ? new Date(value).toLocaleString("ru", { timeZone: "Asia/Vladivostok" }) : LABELS[value] || value;
  return JSON.stringify(value);
}
function day(offset = 0) { const date = new Date(Date.now() + 10 * 3600000 + offset * 86400000); return date.toISOString().slice(0, 10); }

export default function AdminClient({ section, recordId, user }: { section: string; recordId?: string; user: User }) {
  const router = useRouter();
  const creating = section === "presets" && recordId === "new";
  const [data, setData] = useState<Listing | Overview | Traffic | Row | null>(null);
  const [loading, setLoading] = useState(!creating);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [method, setMethod] = useState("");
  const [sort, setSort] = useState(section === "presets" ? "name" : section === "datasets" ? "version" : "created_at");
  const [direction, setDirection] = useState("desc");
  const [from, setFrom] = useState(day(-29));
  const [to, setTo] = useState(day());
  const [retry, setRetry] = useState(0);
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (creating) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true); setError("");
      const params = new URLSearchParams({ page: String(page), q, status, method, sort, direction, from, to });
      const path = recordId ? `/admin/${section}/${encodeURIComponent(recordId)}` : `/admin/${section}?${params}`;
      accountApi<Listing | Overview | Traffic | Row>(path, "GET", undefined, controller.signal)
        .then(value => { if (!controller.signal.aborted) setData(value); }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, q ? 250 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [section, recordId, creating, page, q, status, method, sort, direction, from, to, retry]);
  const confirm = async () => {
    if (!action || busy) return; setBusy(true); setError("");
    try {
      const result = await accountApi<{ id?: string }>(action.path, action.method, action.body);
      setAction(null);
      if (creating && result.id) { router.push(`/admin/presets/${result.id}`); return; }
      setRetry(value => value + 1);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Изменение не сохранено"); setAction(null); }
    finally { setBusy(false); }
  };
  const listing = !recordId && ["users", "runs", "presets", "datasets", "audit"].includes(section);
  const rows = listing && data ? data as Listing : null;
  return <div className="service-page admin-page"><div className="admin-layout">
    <aside className="admin-sidebar"><Link href="/" className="service-brand">↗ 402x402</Link><span className="service-eyebrow">Администрирование</span><nav aria-label="Администрирование">{Object.entries(SECTIONS).map(([key, title]) => <Link href={key === "overview" ? "/admin" : `/admin/${key}`} key={key} aria-current={section === key ? "page" : undefined}>{title}</Link>)}</nav><Link href="/account" className="service-link">← {user.display_name}</Link></aside>
    <main className="admin-content"><header className="admin-heading"><div><span className="service-eyebrow">Рабочее пространство</span><h1>{creating ? "Новый шаблон" : recordId ? "Детали записи" : SECTIONS[section]}</h1><p className="service-muted">{recordId || "Данные приложения и сохранённые операции"}</p></div>{section === "presets" && !recordId && <Link className="service-button" href="/admin/presets/new">Создать шаблон</Link>}</header>
      {!recordId && ["overview", "traffic", "users", "runs", "audit"].includes(section) && <div className="admin-period"><label>С даты<input aria-label="Начало периода" type="date" value={from} onChange={event => { setFrom(event.target.value); setPage(1); }} /></label><label>По дату<input aria-label="Конец периода" type="date" value={to} onChange={event => { setTo(event.target.value); setPage(1); }} /></label><span className="service-muted">Время Владивостока, UTC+10</span></div>}
      {error && <div className="service-error" role="alert">{error} <button onClick={() => setRetry(value => value + 1)}>Повторить</button></div>}
      {loading && <p className="service-loading" role="status">Загрузка данных…</p>}
      {listing && <><div className="admin-filters"><input type="search" aria-label="Поиск записей" placeholder="Поиск" value={q} onChange={event => { setQ(event.target.value); setPage(1); }} />
        {["users", "runs", "presets"].includes(section) && <select aria-label="Фильтр статуса" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="">Все статусы</option><option value="active">Активные</option><option value={section === "users" ? "blocked" : "archived"}>{section === "users" ? "Заблокированные" : "В архиве"}</option></select>}
        {section === "users" && <select aria-label="Способ регистрации" value={method} onChange={event => { setMethod(event.target.value); setPage(1); }}><option value="">Все способы регистрации</option><option value="local">Пароль</option><option value="yandex">Яндекс ID</option><option value="vk">VK ID</option></select>}
        <select aria-label="Сортировать по" value={sort} onChange={event => { setSort(event.target.value); setPage(1); }}>{(section === "datasets" ? [["version", "Версия"]] : section === "presets" ? [["name", "Название"], ["created_at", "Дата"]] : section === "users" ? [["created_at", "Дата"], ["username", "Логин"], ["role", "Роль"]] : section === "runs" ? [["created_at", "Дата"], ["calculation_ms", "Время расчёта"]] : [["created_at", "Дата"]]).map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select>
        <select aria-label="Порядок сортировки" value={direction} onChange={event => setDirection(event.target.value)}><option value="desc">По убыванию</option><option value="asc">По возрастанию</option></select></div>
        {rows && <section className="service-card admin-table-card" aria-busy={loading}>{!rows.items.length ? <div className="service-empty">Записей по выбранным условиям нет</div> : <div className="service-table-scroll"><table className="service-table"><thead><tr>{FIELDS[section].map(([key, title]) => <th key={key}>{title}</th>)}<th>Детали</th></tr></thead><tbody>{rows.items.map(row => <tr key={row.id}>{FIELDS[section].map(([key]) => <td key={key}>{display(row[key])}</td>)}<td><Link className="service-link" href={`/admin/${section}/${encodeURIComponent(row.id)}`}>Открыть →</Link></td></tr>)}</tbody></table></div>}
          <div className="service-pagination"><button disabled={page <= 1 || loading} onClick={() => setPage(value => value - 1)}>Назад</button><span>Страница {page} из {Math.max(1, Math.ceil(rows.total / rows.page_size))} · всего {rows.total}</span><button disabled={page * rows.page_size >= rows.total || loading} onClick={() => setPage(value => value + 1)}>Далее</button></div></section>}
      </>}
      {section === "overview" && data && <OverviewView data={data as Overview} />}
      {section === "traffic" && data && <TrafficView data={data as Traffic} />}
      {creating && <PresetEditor onAction={setAction} />}
      {recordId && !creating && data && <Details key={`${recordId}:${retry}`} section={section} row={data as Row} onAction={setAction} />}
      {action && <ConfirmDialog action={action} busy={busy} onConfirm={confirm} onCancel={() => { if (!busy) setAction(null); }} />}
    </main>
  </div></div>;
}

function OverviewView({ data }: { data: Overview }) {
  const titles: Record<string, string> = { new_users: "Регистраций за период", users_total: "Всего пользователей", blocked_users: "Заблокировано сейчас", runs: "Расчётов за период", presets: "Активных шаблонов", datasets: "Версий дорожных данных", average_calculation_ms: "Среднее время расчёта, мс" };
  const maximum = Math.max(1, ...data.registrations.map(item => item.count));
  return <><div className="admin-metrics">{Object.entries(titles).map(([key, title]) => <section key={key} className="service-card"><span>{title}</span><strong>{display(data.metrics[key])}</strong></section>)}</div>
    <div className="admin-chart-grid"><section className="service-card"><h2>Динамика регистраций</h2>{data.metrics.new_users === 0 && <p className="service-muted">За выбранный период новых регистраций нет.</p>}
      <div className="registration-chart" role="img" aria-label={`Регистраций за период: ${data.metrics.new_users}`}>
        {data.registrations.map(item => <div key={item.date} title={`${item.date}: ${item.count}`} style={{ height: `${Math.max(1, item.count / maximum * 100)}%` }} />)}
      </div><div className="chart-range"><span>{data.registrations[0]?.date}</span><span>{data.registrations.at(-1)?.date}</span></div>
    </section><section className="service-card"><h2>Успешные входы</h2><p className="service-muted">За выбранный период</p>{Object.entries(data.login_methods).map(([method, count]) => <div className="method-stat" key={method}><span>{LABELS[method]}</span><strong>{count}</strong></div>)}</section></div>
  </>;
}

function TrafficView({ data }: { data: Traffic }) {
  return <section className="service-card"><h2>Яндекс Метрика</h2><span className="service-badge">{data.status === "connected" ? "Подключена" : data.status === "error" ? "Недоступна" : "Не настроена"}</span>
    {data.message && <p className="service-notice">{data.message}</p>}<p><a className="service-link" href={data.report_url} target="_blank" rel="noreferrer">Открыть отчёты Метрики ↗</a></p>
    {!!data.missing_goals?.length && <p className="service-muted">Для всех конверсий задайте числовые ID целей на сервере.</p>}
    {data.status === "connected" && (!data.rows.length ? <p className="service-empty">За этот период данных нет</p> : <div className="service-table-scroll"><table className="service-table"><thead><tr><th>Источник</th><th>Визиты</th><th>Посетители</th><th>Регистрация, %</th><th>Вход, %</th><th>Расчёт, %</th></tr></thead><tbody>{data.rows.map((row, i) => <tr key={i}>{["source", "visits", "users", "registration_conversion_percent", "login_conversion_percent", "simulation_conversion_percent"].map(key => <td key={key}>{display(row[key])}</td>)}</tr>)}</tbody></table></div>)}
  </section>;
}

function Details({ section, row, onAction }: { section: string; row: Row; onAction: (action: Action) => void }) {
  const [role, setRole] = useState(String(row.role || "user"));
  const [status, setStatus] = useState(String(row.status || "active"));
  const [note, setNote] = useState(String(row.admin_note || ""));
  return <><Link className="service-link" href={`/admin/${section}`}>← К списку</Link>
    {section === "users" && <section className="service-card"><h2>{String(row.display_name)}</h2><dl className="record-summary"><dt>Логин</dt><dd>{display(row.username)}</dd><dt>Email</dt><dd>{display(row.email)}</dd><dt>Регистрация</dt><dd>{display(row.created_at)}</dd><dt>Привязанные провайдеры</dt><dd>{Array.isArray(row.providers) ? row.providers.map(display).join(", ") || "Нет" : "—"}</dd><dt>Расчётов</dt><dd>{display(row.runs_count)}</dd></dl>
      {row.role === "admin" && <p className="service-notice">Блокировка и снятие прав администратора выполняются локально на сервере. Это защищает доступ владельца.</p>}
      <form className="service-form" onSubmit={event => { event.preventDefault(); onAction({ title: "Изменить права пользователя?", description: `Аккаунт ${row.display_name}: роль «${LABELS[String(row.role)]}» → «${LABELS[role]}», статус «${LABELS[String(row.status)]}» → «${LABELS[status]}». ${status === "blocked" ? "Все сессии этого пользователя будут завершены." : role === "admin" ? "Пользователь получит доступ к управлению сервисом." : "Аккаунт сможет пользоваться личным кабинетом."}`, path: `/admin/users/${row.id}`, method: "PATCH", body: { role, status, version: row.version } }); }}>
        <label>Роль<select aria-label="Роль" value={role} onChange={event => setRole(event.target.value)} disabled={row.role === "admin"}><option value="user">Пользователь</option><option value="admin">Администратор</option></select></label>
        <label>Статус<select aria-label="Статус" value={status} onChange={event => setStatus(event.target.value)} disabled={row.role === "admin"}><option value="active">Активен</option><option value="blocked">Заблокирован</option></select></label><button className="service-button" disabled={row.role === "admin"}>Сохранить права и статус</button>
      </form></section>}
    {section === "runs" && <section className="service-card"><h2>Расчёт сценария</h2><p>Дата: {display(row.created_at)}</p><p>Версия дорог: {display(row.dataset_version)}</p><p>В архиве: {display(row.archived || false)}</p><button className="service-button secondary" onClick={() => onAction({ title: row.archived ? "Вернуть расчёт?" : "Архивировать расчёт?", description: row.archived ? "Расчёт снова появится в личном списке владельца." : "Расчёт будет скрыт из личного списка владельца. Сохранённые данные останутся в базе.", path: `/admin/runs/${row.id}`, method: "PATCH", body: { archived: !row.archived } })}>{row.archived ? "Вернуть из архива" : "Архивировать"}</button></section>}
    {section === "datasets" && <section className="service-card"><h2>Версия {display(row.version)}</h2><p className="service-muted">Дорожная геометрия версионируется. Здесь можно изменить описание, не затрагивая расчётную сеть.</p><form className="service-form" onSubmit={event => { event.preventDefault(); onAction({ title: "Сохранить описание версии?", description: `Изменится описание версии ${row.version}. Геометрия и существующие расчёты сохранятся.`, path: `/admin/datasets/${row.id}`, method: "PATCH", body: { admin_note: note } }); }}><label>Описание<textarea value={note} onChange={event => setNote(event.target.value)} maxLength={1000} /></label><button className="service-button">Сохранить описание</button></form></section>}
    {section === "presets" && <PresetEditor row={row} onAction={onAction} />}
    <details className="service-card record-json"><summary>Данные записи</summary><pre>{JSON.stringify(row, null, 2)}</pre></details>
  </>;
}

function PresetEditor({ row, onAction }: { row?: Row; onAction: (action: Action) => void }) {
  const [name, setName] = useState(String(row?.name || ""));
  const [description, setDescription] = useState(String(row?.description || ""));
  const [type, setType] = useState(String(row?.scenario_type || "closure"));
  const [segment, setSegment] = useState(String(row?.segment_id || ""));
  const [factor, setFactor] = useState(Number((row?.parameters as { factor?: number } | undefined)?.factor ?? .5));
  const [archived, setArchived] = useState(!!row?.archived);
  const [segments, setSegments] = useState<{ segment_id: string; name: string; direction: string }[]>([]);
  const [error, setError] = useState("");
  useEffect(() => { accountApi<{ items: typeof segments }>("/admin/segments").then(data => setSegments(data.items)).catch(failure => setError(failure.message)); }, []);
  return <section className="service-card"><h2>{row ? "Настройки шаблона" : "Создать шаблон сценария"}</h2>{error && <p className="service-error" role="alert">{error}</p>}
    <form className="service-form" onSubmit={event => { event.preventDefault(); onAction({ title: row ? "Сохранить шаблон?" : "Создать шаблон?", description: archived ? "Шаблон будет сохранён в архиве и не будет доступен в публичном списке." : "Шаблон появится в списке сценариев для посетителей. Дорожные данные и сохранённые расчёты не изменятся.", path: row ? `/admin/presets/${row.id}` : "/admin/presets", method: row ? "PATCH" : "POST", body: { name, description, scenario_type: type, segment_id: type === "demand_increase" ? null : segment, factor: type === "closure" ? null : factor, archived } }); }}>
      <label>Название<input value={name} onChange={event => setName(event.target.value)} maxLength={100} required /></label><label>Описание<textarea value={description} onChange={event => setDescription(event.target.value)} maxLength={500} /></label>
      <label>Тип сценария<select aria-label="Тип сценария" value={type} onChange={event => { setType(event.target.value); setFactor(event.target.value === "demand_increase" ? 1.4 : .5); }}><option value="closure">Перекрытие</option><option value="capacity_reduction">Сужение</option><option value="demand_increase">Час пик</option></select></label>
      {type !== "demand_increase" && <label>Участок дороги<select aria-label="Участок дороги" value={segment} onChange={event => setSegment(event.target.value)} required><option value="">Выберите участок</option>{segments.map(item => <option key={item.segment_id} value={item.segment_id}>{item.name} · {item.direction} · {item.segment_id.slice(-8)}</option>)}</select></label>}
      {type !== "closure" && <label>{type === "demand_increase" ? "Множитель количества машин" : "Оставшаяся доля вместимости"}<input type="number" step="0.01" min={type === "demand_increase" ? 1.01 : .01} max={type === "demand_increase" ? 3 : .99} value={factor} onChange={event => setFactor(Number(event.target.value))} required /></label>}
      <label className="service-check"><input type="checkbox" checked={archived} onChange={event => setArchived(event.target.checked)} /><span>Хранить в архиве</span></label><button className="service-button">{row ? "Сохранить шаблон" : "Создать шаблон"}</button>
    </form></section>;
}

function ConfirmDialog({ action, busy, onConfirm, onCancel }: { action: Action; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="service-confirm" onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}><h2>{action.title}</h2><p>{action.description}</p><div className="cookie-actions"><button className="service-button secondary" disabled={busy} onClick={onCancel}>Отмена</button><button className="service-button" disabled={busy} onClick={onConfirm}>{busy ? "Сохраняем…" : "Подтвердить"}</button></div></dialog>;
}
