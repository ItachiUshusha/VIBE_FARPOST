const BASE = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

export async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  const timeout = AbortSignal.timeout(20_000);
  const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    response = await fetch(`${BASE}/api${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: combinedSignal,
      cache: "no-store",
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error("Не удалось связаться с сервером. Проверьте, что API и MongoDB запущены, и попробуйте ещё раз.");
  }
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(typeof error.detail === "string" ? error.detail : "Не удалось выполнить запрос. Попробуйте ещё раз.");
  }
  return response.json();
}

export const number = (n: number, digits = 0) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits }).format(n);
export const shortTime = (s: number | null) => s === null ? "—" : s < 60 ? `${number(s)} с` : s < 3600 ? `${number(Math.ceil(s / 60))} мин` : `${number(Math.floor(s / 3600))} ч ${number(Math.floor(s % 3600 / 60))} мин`;
export const time = (s: number | null) => {
  if (s === null) return "—";
  const total = Math.max(0, Math.round(s)), hours = Math.floor(total / 3600), minutes = Math.floor(total % 3600 / 60), seconds = total % 60;
  if (hours) return `${hours} ч${minutes ? ` ${minutes} мин` : ""}`;
  if (minutes) return `${minutes} мин${seconds ? ` ${seconds} с` : ""}`;
  return `${seconds} с`;
};
export const timeChange = (seconds: number | null) => seconds === null ? "Нельзя сравнить" : Math.round(seconds) === 0 ? "Время не изменилось" : `На ${time(Math.abs(seconds))} ${seconds > 0 ? "дольше" : "быстрее"}`;
export const distance = (m: number | null) => m === null ? "—" : m < 1000 ? `${number(m)} м` : `${number(m / 1000, 2)} км`;
