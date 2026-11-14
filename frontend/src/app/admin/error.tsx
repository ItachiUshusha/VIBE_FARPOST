"use client";
import Link from "next/link";
export default function AdminError({ reset }: { reset: () => void }) { return <div className="service-page"><main className="auth-card"><h1>Не удалось открыть админку</h1><p>Проверьте соединение с сервером и повторите попытку.</p><button className="service-button" onClick={reset}>Повторить</button><Link href="/account">В кабинет</Link></main></div>; }
