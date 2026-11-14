import Link from "next/link";
import { notFound } from "next/navigation";
import { serverIdentity } from "@/lib/server-config";
import AdminClient from "@/components/AdminClient";
export const metadata = { title: "Администрирование — 402x402", robots: { index: false, follow: false } };
export default async function AdminPage({ params }: { params: Promise<{ path?: string[] }> }) {
  const user = await serverIdentity(true);
  if (!user) return <div className="service-page"><main className="auth-card"><h1>Доступ запрещён</h1><p>Этот раздел доступен только администратору.</p><Link href="/account">Вернуться в кабинет</Link></main></div>;
  const { path = [] } = await params;
  if (path.length > 2 || (path[0] && !["users", "runs", "presets", "datasets", "audit", "traffic"].includes(path[0])) || path.some(part => !/^[A-Za-z0-9_:-]{1,200}$/.test(part))) notFound();
  return <AdminClient key={path.join("/")} section={path[0] || "overview"} recordId={path[1]} user={user} />;
}
