export type User = { id: string; username: string | null; display_name: string; email: string | null; role: "user" | "admin"; status: string; created_at: string; version: number };
let csrfPromise: Promise<string> | null = null;
let csrfValidUntil = 0;
async function csrfToken() {
  if (Date.now() >= csrfValidUntil) { csrfPromise = null; csrfValidUntil = Date.now() + 3600000; }
  csrfPromise ??= fetch("/api/auth/csrf", { cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(10000) })
    .then(async response => {
      if (!response.ok) throw new Error("csrf");
      const token = (await response.json()).csrf_token;
      if (typeof token !== "string" || token.length < 32) throw new Error("csrf");
      return token;
    })
    .catch(() => { csrfPromise = null; throw new Error("Не удалось подготовить безопасный запрос. Проверьте соединение и повторите попытку."); });
  return csrfPromise;
}
export async function accountApi<T>(path: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (method !== "GET") headers["X-CSRF-Token"] = await csrfToken();
  let response: Response;
  try {
    const timeout = AbortSignal.timeout(20000);
    response = await fetch(`/api${path}`, { method, headers, credentials: "same-origin", cache: "no-store", signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error("Не удалось соединиться с сервером. Повторите попытку позже.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 403) csrfPromise = null;
    throw new Error(typeof data.detail === "string" ? data.detail : "Запрос не выполнен. Повторите попытку.");
  }
  return data;
}
export async function csrfHeaders() { return { "X-CSRF-Token": await csrfToken() }; }
