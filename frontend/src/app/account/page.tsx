import AccountClient from "@/components/AccountClient";
import { serverIdentity } from "@/lib/server-config";
export const metadata = { title: "Личный кабинет — 402x402", robots: { index: false, follow: false } };
export default async function AccountPage() {
  const user = await serverIdentity();
  return user ? <AccountClient user={user} /> : <div className="service-page"><h1>Аккаунт недоступен</h1><p>Доступ ограничен администратором.</p></div>;
}
