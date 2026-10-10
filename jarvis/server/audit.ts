import type { Db } from "./db.ts";
import { sha256 } from "./security/crypto.ts";
import { redact } from "./security/redact.ts";

export type Actor = "owner" | "jarvis" | "system" | "scheduler" | "anonymous";
export type AuditCategory = "security" | "permission" | "finance" | "agent" | "data" | "general";

export interface AuditInput {
  actor: Actor;
  action: string;
  category?: AuditCategory;
  level?: number | null;
  target?: string | null;
  outcome: "success" | "denied" | "pending" | "failure";
  detail?: Record<string, unknown>;
}

export function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(",")}}`;
}

const GENESIS = "0".repeat(64);

function entryHash(prev: string, e: Record<string, unknown>): string {
  return sha256(prev + canonical(e));
}

/** Appends an entry to the hash-chained audit log. Details are always redacted. */
export async function audit(db: Db, input: AuditInput): Promise<void> {
  const entry = {
    ts: new Date().toISOString(),
    actor: input.actor,
    action: input.action,
    category: input.category ?? "general",
    level: input.level ?? null,
    target: input.target ?? null,
    outcome: input.outcome,
    detail: redact(input.detail ?? {}),
  };
  await db.tx(async (t) => {
    // Serialise writers so the chain stays linear across processes.
    await t.query("SELECT pg_advisory_xact_lock(424242)");
    const last = await t.query<{ hash: string }>("SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1");
    const prev = last[0]?.hash ?? GENESIS;
    const hash = entryHash(prev, entry);
    await t.query(
      `INSERT INTO audit_log (ts, actor, action, category, level, target, outcome, detail, prev_hash, hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`,
      [entry.ts, entry.actor, entry.action, entry.category, entry.level, entry.target, entry.outcome, JSON.stringify(entry.detail), prev, hash],
    );
  });
}

/** Recomputes the whole chain. Any edited, deleted or reordered row breaks it. */
export async function verifyAuditChain(db: Db): Promise<{ ok: boolean; entries: number; brokenAt?: number }> {
  const rows = await db.query<{
    id: number; ts: Date | string; actor: string; action: string; category: string; level: number | null;
    target: string | null; outcome: string; detail: Record<string, unknown>; prev_hash: string; hash: string;
  }>("SELECT * FROM audit_log ORDER BY id ASC");
  let prev = GENESIS;
  for (const r of rows) {
    const entry = {
      ts: new Date(r.ts).toISOString(),
      actor: r.actor, action: r.action, category: r.category, level: r.level, target: r.target,
      outcome: r.outcome, detail: r.detail,
    };
    if (r.prev_hash !== prev || entryHash(prev, entry) !== r.hash) return { ok: false, entries: rows.length, brokenAt: r.id };
    prev = r.hash;
  }
  return { ok: true, entries: rows.length };
}
