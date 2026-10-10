export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type Listener = () => void;
const authListeners = new Set<Listener>();
export const onAuthLost = (fn: Listener) => { authListeners.add(fn); return () => { authListeners.delete(fn); }; };
const changeListeners = new Set<Listener>();
/** Lets views refresh after any mutation (e.g. header mode badge after RED). */
export const onMutation = (fn: Listener) => { changeListeners.add(fn); return () => { changeListeners.delete(fn); }; };

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: { "content-type": "application/json", "x-jarvis-request": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { message: text }; }
  if (!res.ok) {
    if (res.status === 401 && json?.error === "unauthenticated") authListeners.forEach((f) => f());
    throw new ApiError(res.status, json?.error ?? "error", json?.message ?? `HTTP ${res.status}`);
  }
  if (method !== "GET") changeListeners.forEach((f) => f());
  return json as T;
}

export const get = <T = any>(p: string) => api<T>("GET", p);
export const post = <T = any>(p: string, b: unknown = {}) => api<T>("POST", p, b);
export const patch = <T = any>(p: string, b: unknown = {}) => api<T>("PATCH", p, b);
export const del = <T = any>(p: string) => api<T>("DELETE", p);

export const eur = (cents: number | string | null | undefined, digits = 0) =>
  `€${(Number(cents ?? 0) / 100).toLocaleString("en-IE", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
export const toCents = (euros: string) => Math.round(parseFloat(euros.replace(",", ".")) * 100);
export const dt = (v: string | null | undefined) => (v ? new Date(v).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—");
export const d = (v: string | null | undefined) => (v ? new Date(v).toLocaleDateString("en-GB", { dateStyle: "medium" }) : "—");
