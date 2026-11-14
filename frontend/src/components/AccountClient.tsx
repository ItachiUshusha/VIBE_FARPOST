"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { accountApi, type User } from "@/lib/account-api";
import { trackGoal } from "@/lib/analytics";
import { useConsent } from "./SiteServices";

type RunList = { items: { run_id: string; created_at: string; scenario_type: string }[]; page: number; total: number; page_size: number };
export default function AccountClient({ user }: { user: User }) {
  const router = useRouter();
  const consent = useConsent();
  const [runs, setRuns] = useState<RunList | null>(null);
  const [page, setPage] = useState(1);
  const [pending, setPending] = useState<{ provider: string; display_name: string } | null>(null);
  const [providers, setProviders] = useState<string[]>([]);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [hasPassword, setHasPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      accountApi<RunList>(`/account/runs?page=${page}`, "GET", undefined, controller.signal),
      accountApi<{ pending: typeof pending }>("/auth/pending-link", "GET", undefined, controller.signal),
      accountApi<{ providers: string[]; has_password: boolean }>("/auth/me", "GET", undefined, controller.signal),
      accountApi<{ providers: Record<string, boolean> }>("/site/config", "GET", undefined, controller.signal),
    ]).then(([list, link, me, config]) => { if (!controller.signal.aborted) { setRuns(list); setPending(link.pending); setProviders(me.providers); setHasPassword(me.has_password); setEnabled(config.providers); } })
      .catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [page, retry]);
  useEffect(() => {
    if (!consent.resolved) return;
    accountApi<{ outcome: { kind: "registration_success" | "login_success"; method: "local" | "yandex" | "vk" } | null }>("/auth/outcome", "POST")
      .then(({ outcome }) => { if (outcome && consent.analytics) trackGoal(outcome.kind, outcome.method); }).catch(() => {});
  }, [consent.resolved, consent.analytics]);
  const act = async (callback: () => Promise<void>) => { setBusy(true); setError(""); try { await callback(); } catch (failure) { setError(failure instanceof Error ? failure.message : "Действие не выполнено"); } finally { setBusy(false); } };
  return <div className="service-page"><main className="account-layout">
    <header className="service-topbar"><Link href="/" className="service-brand">↗ 402x402</Link><button className="service-button secondary" disabled={busy} onClick={() => act(async () => { await accountApi("/auth/logout", "POST"); router.replace("/"); router.refresh(); })}>Выйти</button></header>
    <span className="service-eyebrow">Личный кабинет</span><h1>{user.display_name}</h1><p className="service-muted">Ваши расчёты и способы входа</p>
    {user.role === "admin" && <Link className="service-button admin-entry" href="/admin">Открыть администрирование →</Link>}
    {error && <div className="service-error" role="alert">{error} <button onClick={() => { setError(""); setRetry(value => value + 1); }}>Повторить</button></div>}
    {notice && <p className="service-notice" role="status">{notice}</p>}
    <section className="service-card"><h2>Способы входа</h2><p className="service-muted">Привязка требует недавнего входа и отдельного подтверждения. Email не объединяет аккаунты автоматически.</p>
      <div className="account-identities">{(["yandex", "vk"] as const).map(provider => <div key={provider}><strong>{provider === "yandex" ? "Яндекс ID" : "VK ID"}</strong>
        {providers.includes(provider) ? <span className="service-badge">Привязан</span> : enabled[provider] ? <a className="service-link" href={`/api/auth/oauth/${provider}/start?intent=link`}>Привязать аккаунт</a> : <span className="service-muted">Пока не подключён</span>}</div>)}</div>
      <Link href="/login" className="service-link">Подтвердить вход повторно</Link>
      {pending && <div className="link-confirmation"><h3>Подтвердите привязку</h3><p>Профиль {pending.display_name} ({pending.provider === "yandex" ? "Яндекс ID" : "VK ID"}) сможет входить в этот аккаунт. Другой аккаунт приложения объединён не будет.</p><button className="service-button" disabled={busy} onClick={() => act(async () => { await accountApi("/auth/confirm-link", "POST"); setPending(null); setRetry(value => value + 1); setNotice("Способ входа привязан"); })}>Подтвердить привязку к моему аккаунту</button></div>}
    </section>
    <section className="service-card"><h2>Сохранённые расчёты</h2><p className="service-muted">Здесь показываются расчёты, выполненные после входа в аккаунт.</p>
      {!runs ? <p role="status">Загрузка расчётов…</p> : !runs.items.length ? <div className="service-empty">У вас пока нет сохранённых расчётов. <Link href="/">Начать эксперимент</Link></div> : <>
        <ul className="account-runs">{runs.items.map(run => <li key={run.run_id}><Link href={`/account/runs/${run.run_id}`}><span>Расчёт сценария<small>{new Date(run.created_at).toLocaleString("ru", { timeZone: "Asia/Vladivostok" })}</small></span><span>Открыть →</span></Link></li>)}</ul>
        <div className="service-pagination"><button disabled={page === 1} onClick={() => setPage(value => value - 1)}>Назад</button><span>{page} / {Math.max(1, Math.ceil(runs.total / runs.page_size))}</span><button disabled={page * runs.page_size >= runs.total} onClick={() => setPage(value => value + 1)}>Далее</button></div>
      </>}
    </section>
    {hasPassword && <section className="service-card"><h2>Сменить пароль</h2><form className="service-form" onSubmit={event => { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); void act(async () => { await accountApi("/auth/password", "POST", { current_password: data.get("current_password"), new_password: data.get("new_password") }); form.reset(); setNotice("Пароль изменён. Остальные сессии завершены."); }); }}>
      <label>Текущий пароль<input type="password" name="current_password" autoComplete="current-password" required maxLength={128} /></label><label>Новый пароль<input type="password" name="new_password" autoComplete="new-password" required minLength={12} maxLength={128} /></label><button className="service-button" disabled={busy}>Сменить пароль и завершить другие сессии</button>
    </form></section>}
  </main></div>;
}
