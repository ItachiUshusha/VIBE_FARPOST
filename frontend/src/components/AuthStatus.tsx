"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { UserRound } from "lucide-react";
import { accountApi, type User } from "@/lib/account-api";
export default function AuthStatus() {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => { accountApi<{ user: User | null }>("/auth/me").then(data => setUser(data.user)).catch(() => {}); }, []);
  return <Link className="account-nav" href={user ? "/account" : "/login"} aria-label={user ? "Личный кабинет" : "Войти в аккаунт"}><UserRound size={18} /><span>{user ? "Кабинет" : "Войти"}</span></Link>;
}
