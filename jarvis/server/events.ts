import type { Db } from "./db.ts";
import { redact, redactString } from "./security/redact.ts";

export async function logEvent(
  db: Db,
  severity: "debug" | "info" | "warning" | "error",
  source: string,
  message: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  try {
    await db.query("INSERT INTO system_events (severity, source, message, detail) VALUES ($1,$2,$3,$4::jsonb)", [
      severity, source, redactString(message), JSON.stringify(redact(detail)),
    ]);
  } catch (e) {
    console.error("[jarvis] failed to log event", redactString(String(e)));
  }
  if (severity === "error" || severity === "warning") console.error(`[jarvis:${source}] ${redactString(message)}`);
}

export async function notify(
  db: Db,
  severity: "info" | "warning" | "critical",
  title: string,
  body = "",
  link: string | null = null,
): Promise<void> {
  await db.query("INSERT INTO notifications (severity, title, body, link) VALUES ($1,$2,$3,$4)", [
    severity, title, redactString(body), link,
  ]);
}
