const ZONE = "Europe/Belgrade";

export function when(iso?: string | null, withTime = true): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const opts: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "short",
    timeZone: ZONE,
  };
  if (withTime) {
    opts.hour = "2-digit";
    opts.minute = "2-digit";
  }
  return new Intl.DateTimeFormat("en-GB", opts).format(d);
}

export function clockTime(date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone: ZONE,
  }).format(date);
}

export function todayLabel(date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: ZONE,
  }).format(date);
}

export function todayISO(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function eur(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR" }).format(n);
}

export function kmText(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(1);
}

export function speedText(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return String(Math.round(n));
}

export function isFail(v: unknown): v is { success: false; message: string; code: string } {
  return Boolean(v && typeof v === "object" && "success" in v && (v as { success: boolean }).success === false);
}

export function errText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Could not reach the control system.";
}
