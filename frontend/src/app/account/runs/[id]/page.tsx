import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { serverIdentity } from "@/lib/server-config";
import { time, number } from "@/lib/api";
import type { Run } from "@/lib/types";
export const metadata = { title: "Сохранённый расчёт", robots: { index: false, follow: false } };
export default async function SavedRun({ params }: { params: Promise<{ id: string }> }) {
  const user = await serverIdentity();
  if (!user) return <div className="service-page">Доступ ограничен</div>;
  const { id } = await params;
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) notFound();
  const token = (await cookies()).get("fp_session")?.value || "";
  const response = await fetch(`${process.env.API_PROXY_URL || "http://127.0.0.1:8000"}/api/runs/${id}`, { headers: { Cookie: `fp_session=${encodeURIComponent(token)}` }, cache: "no-store" });
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error("Не удалось загрузить расчёт");
  const run: Run = await response.json();
  return <div className="service-page"><main className="account-layout"><Link href="/account" className="service-link">← Личный кабинет</Link><h1>Сохранённый расчёт</h1><p className="service-muted">{new Date(run.created_at).toLocaleString("ru", { timeZone: "Asia/Vladivostok" })}</p>
    <section className="service-card"><table className="service-table"><thead><tr><th>Показатель</th><th>До</th><th>После</th></tr></thead><tbody>
      <tr><td>Среднее время</td><td>{time(run.before.metrics.average_time_s)}</td><td>{time(run.after.metrics.average_time_s)}</td></tr>
      <tr><td>Автомобилей</td><td>{number(run.before.metrics.vehicle_count)}</td><td>{number(run.after.metrics.vehicle_count)}</td></tr>
      <tr><td>Нет маршрута, авто</td><td>{number(run.before.metrics.unreachable_vehicle_count)}</td><td>{number(run.after.metrics.unreachable_vehicle_count)}</td></tr>
    </tbody></table></section><p className="service-notice">Демонстрационная модель. Значения не являются прогнозом реальных пробок.</p></main></div>;
}
