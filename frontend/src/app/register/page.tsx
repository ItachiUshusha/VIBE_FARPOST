import { Suspense } from "react";
import AuthForm from "@/components/AuthForm";
export const metadata = { title: "Регистрация — Эффект бабочки", robots: { index: false, follow: false } };
export default function RegisterPage() { return <Suspense fallback={<div className="service-page">Загрузка…</div>}><AuthForm registration /></Suspense>; }
