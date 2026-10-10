import type { Db } from "./db.ts";

/** Typed, defaulted runtime settings stored in the `settings` table. */
export const DEFAULT_SETTINGS = {
  monthly_target_cents: 1_500_000, // €15,000
  red_ttl_minutes: 15,
  kill_switch: false, // true => all LEVEL 3/4 execution and automation halted
  approval_ttl_hours: 72,
  agent_max_tool_calls: 12,
  agent_rate_limit_per_minute: 30,
  llm_monthly_budget_usd: 50,
  owner_timezone: "Europe/Belgrade",
} as const;

export type Settings = { -readonly [K in keyof typeof DEFAULT_SETTINGS]: (typeof DEFAULT_SETTINGS)[K] extends boolean ? boolean : (typeof DEFAULT_SETTINGS)[K] extends number ? number : string };
export type SettingKey = keyof Settings;

export async function getSettings(db: Db): Promise<Settings> {
  const rows = await db.query<{ key: string; value: unknown }>("SELECT key, value FROM settings");
  const out = { ...DEFAULT_SETTINGS } as Settings;
  for (const r of rows) if (r.key in out) (out as Record<string, unknown>)[r.key] = r.value;
  return out;
}

export async function setSetting<K extends SettingKey>(db: Db, key: K, value: Settings[K]): Promise<void> {
  if (!(key in DEFAULT_SETTINGS)) throw new Error(`Unknown setting ${key}`);
  const expected = typeof DEFAULT_SETTINGS[key];
  if (typeof value !== expected) throw new Error(`Setting ${key} must be a ${expected}`);
  await db.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}
