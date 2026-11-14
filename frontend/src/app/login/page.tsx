import { Suspense } from "react";
import AuthForm from "@/components/AuthForm";
export const metadata = { title: "Вход — 402x402", robots: { index: false, follow: false } };
export default function LoginPage() { return <Suspense fallback={<div className="service-page">Загрузка…</div>}><AuthForm /></Suspense>; }
