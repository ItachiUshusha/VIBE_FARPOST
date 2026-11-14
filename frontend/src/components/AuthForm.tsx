"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { accountApi } from "@/lib/account-api";

type AuthConfig = { providers: { yandex: boolean; vk: boolean }; legal_published: boolean; legal_version: string; local: boolean };
const ERRORS: Record<string, string> = { state: "Ссылка входа истекла или уже использована. Попробуйте снова.", cancelled: "Вы отменили вход. Можно выбрать другой способ.",
  provider: "Провайдер не завершил вход. Повторите попытку позже.", conflict: "Этот профиль уже связан с другим аккаунтом.",
  link_required: "Найден аккаунт с таким email. Войдите в него для привязки или создайте отдельный аккаунт через подтверждённый внешний профиль.", reauth: "Подтвердите вход повторно и начните привязку заново.",
  blocked: "Аккаунт заблокирован администратором.", registration_closed: "Регистрация откроется после публикации правовых документов.", terms: "Условия изменились. Обновите страницу и подтвердите текущую редакцию." };

export default function AuthForm({ registration = false }: { registration?: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [separate, setSeparate] = useState(false);
  useEffect(() => { accountApi<AuthConfig>("/site/config").then(setConfig).catch(() => setError("Не удалось загрузить способы входа. Обновите настройки.")); }, [retry]);
  useEffect(() => { if (params.get("error") === "link_required") accountApi<{ pending: unknown }>("/auth/pending-signin").then(data => setSeparate(!!data.pending)).catch(() => {}); }, [params]);
  const registrationEnabled = !!config && (config.local || config.legal_published);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy) return; setBusy(true); setError("");
    try {
      await accountApi(registration ? "/auth/register" : "/auth/login", "POST", registration ? { username, password, email: email || null, accept_terms: accepted, terms_version: config?.legal_version || "" } : { username, password });
      router.replace("/account"); router.refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Не удалось войти"); }
    finally { setBusy(false); }
  };
  return <div className="service-page"><main className="auth-card">
    <Link href="/" className="service-brand">↗ 402x402</Link><span className="service-eyebrow">Личный кабинет</span>
    <h1>{registration ? "Создать аккаунт" : "С возвращением"}</h1><p className="service-muted">Сохраняйте расчёты и возвращайтесь к своим экспериментам.</p>
    {(error || ERRORS[params.get("error") || ""]) && <p className="service-error" role="alert">{error || ERRORS[params.get("error") || ""]}</p>}
    {separate && <button className="service-button secondary" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { await accountApi("/auth/continue-separate", "POST"); router.replace("/account"); router.refresh(); } catch (failure) { setError(failure instanceof Error ? failure.message : "Вход не завершён"); } finally { setBusy(false); } }}>Создать отдельный аккаунт через внешний профиль</button>}
    {!config && <button className="service-link" onClick={() => { setError(""); setRetry(value => value + 1); }}>Обновить настройки входа</button>}
    {config?.local && !config.legal_published && <p className="service-notice">Локальный режим. Правовые документы подготовлены к утверждению и ещё не опубликованы.</p>}
    {registration && config && !registrationEnabled && <p className="service-notice">Регистрация откроется после публикации правовых документов владельцем.</p>}
    <form onSubmit={submit} className="service-form">
      <label>{registration ? "Логин" : "Логин или email"}<input name="username" autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} required minLength={registration ? 3 : 1} maxLength={registration ? 40 : 254} pattern={registration ? "[a-zA-Z0-9_-]+" : undefined} /></label>
      {registration && <label>Email, необязательно<input name="email" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} maxLength={254} /><small>Привязка внешнего профиля всегда требует отдельного подтверждения.</small></label>}
      <label>Пароль<input name="password" aria-label="Пароль" type="password" autoComplete={registration ? "new-password" : "current-password"} value={password} onChange={event => setPassword(event.target.value)} required minLength={registration ? 12 : 1} maxLength={128} />{registration && <small>От 12 символов. Не используйте пароль от другого сервиса.</small>}</label>
      {(registration || config?.providers.yandex || config?.providers.vk) && <label className="service-check"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} />
        <span>{config?.legal_published ? <>При создании аккаунта принимаю <Link href="/offer">условия сервиса</Link> и ознакомился с <Link href="/privacy">политикой конфиденциальности</Link>.</> : "Подтверждаю создание аккаунта в локальном режиме, если его ещё нет."}</span></label>}
      <button className="service-button" disabled={busy || (registration && (!accepted || !registrationEnabled))}>{busy ? "Подождите…" : registration ? "Зарегистрироваться" : "Войти"}</button>
    </form>
    <div className="auth-divider">или через внешний аккаунт</div>
    <div className="oauth-buttons">{(["yandex", "vk"] as const).map(provider => {
      const enabled = !!config?.providers[provider] && accepted;
      return <a key={provider} aria-disabled={!enabled} className={`oauth-button ${provider}`} href={enabled ? `/api/auth/oauth/${provider}/start?accept_terms=true&terms_version=${encodeURIComponent(config?.legal_version || "")}` : undefined}
        onClick={event => { if (!enabled) event.preventDefault(); }}>{provider === "yandex" ? "Я" : "VK"}<span>{provider === "yandex" ? "Яндекс ID" : "VK ID"}</span><small>{config?.providers[provider] ? accepted ? "Продолжить" : "Подтвердите условия выше" : "Подключение готовится"}</small></a>;
    })}</div>
    <p className="auth-switch">{registration ? "Уже есть аккаунт?" : "Первый раз здесь?"} <Link href={registration ? "/login" : "/register"}>{registration ? "Войти" : "Зарегистрироваться"}</Link></p>
    <Link href="/" className="service-link">Вернуться к карте</Link>
  </main></div>;
}
