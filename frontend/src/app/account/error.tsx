"use client";
import Link from "next/link";
export default function AccountError({ reset }: { reset: () => void }) { return <div className="service-page"><main className="auth-card"><h1>Кабинет временно недоступен</h1><p>Не удалось проверить сессию или загрузить данные. Попробуйте ещё раз.</p><button className="service-button" onClick={reset}>Повторить</button><Link href="/login">Войти заново</Link></main></div>; }
