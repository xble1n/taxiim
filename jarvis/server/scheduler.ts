import { writeFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { verifyAuditChain } from "./audit.ts";
import type { AppContext } from "./context.ts";
import { closePastCycles, ensureCycle } from "./business/cycle.ts";
import { overdueFollowUps } from "./business/crm.ts";
import { logEvent, notify } from "./events.ts";
import { exportAll } from "./backup.ts";
import { expireApprovals } from "./policy/engine.ts";

/**
 * In-process scheduler. Jobs are internal LEVEL 1–2 maintenance only;
 * nothing here performs externally consequential actions.
 */
interface Job { name: string; description: string; interval: number; run: (ctx: AppContext) => Promise<string> }

export const JOBS: Job[] = [
  {
    name: "monthly_cycle", interval: 3600, description: "Open the current month's revenue cycle; close past months (met / PERFORMANCE REVIEW).",
    run: async (ctx) => {
      const closed = await closePastCycles(ctx);
      await ensureCycle(ctx);
      return closed.length ? `closed ${closed.map((c) => `${c.month}:${c.status}`).join(", ")}` : "cycle current";
    },
  },
  {
    name: "followup_reminders", interval: 6 * 3600, description: "Notify about overdue lead follow-ups.",
    run: async (ctx) => {
      const overdue = await overdueFollowUps(ctx);
      if (overdue.length) await notify(ctx.db, "warning", `${overdue.length} overdue follow-up(s)`, overdue.slice(0, 5).map((l) => String((l as { company: string }).company)).join(", "), "/pipeline");
      return `${overdue.length} overdue`;
    },
  },
  {
    name: "approval_expiry", interval: 900, description: "Expire stale approval requests.",
    run: async (ctx) => `${await expireApprovals(ctx)} expired`,
  },
  {
    name: "audit_integrity", interval: 24 * 3600, description: "Verify the audit log hash chain; alert on tampering.",
    run: async (ctx) => {
      const r = await verifyAuditChain(ctx.db);
      if (!r.ok) {
        await notify(ctx.db, "critical", "Audit log integrity failure", `Chain broken at entry #${r.brokenAt}.`, "/security");
        await logEvent(ctx.db, "error", "audit", `Audit chain broken at ${r.brokenAt}`);
      }
      return r.ok ? `ok (${r.entries} entries)` : `BROKEN at ${r.brokenAt}`;
    },
  },
  {
    name: "local_backup", interval: 24 * 3600, description: "Write a JSON snapshot to the data directory (keeps 14). Not a substitute for off-site backups.",
    run: async (ctx) => {
      if (ctx.config.databaseUrl) return "skipped: managed Postgres — use provider backups (see docs/DEPLOYMENT.md)";
      const dir = path.join(ctx.config.dataDir, "backups");
      mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `jarvis-${ctx.now().toISOString().replace(/[:.]/g, "-")}.json`);
      writeFileSync(file, JSON.stringify(await exportAll(ctx)), { mode: 0o600 });
      const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
      for (const f of files.slice(0, Math.max(0, files.length - 14))) unlinkSync(path.join(dir, f));
      return `wrote ${path.basename(file)}`;
    },
  },
];

export async function registerJobs(ctx: AppContext) {
  for (const j of JOBS) {
    await ctx.db.query(
      `INSERT INTO jobs (name, description, interval_seconds) VALUES ($1,$2,$3)
       ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, interval_seconds = EXCLUDED.interval_seconds`,
      [j.name, j.description, j.interval]);
  }
}

export async function runJob(ctx: AppContext, name: string) {
  const job = JOBS.find((j) => j.name === name);
  if (!job) throw new Error(`Unknown job ${name}`);
  const t0 = Date.now();
  try {
    const msg = await job.run(ctx);
    await ctx.db.query(
      "UPDATE jobs SET last_run_at = $2, next_run_at = $3, last_status = 'ok', last_error = $4, last_duration_ms = $5 WHERE name = $1",
      [name, ctx.now(), new Date(ctx.now().getTime() + job.interval * 1000), msg, Date.now() - t0]);
    return { ok: true, message: msg };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await ctx.db.query(
      "UPDATE jobs SET last_run_at = $2, next_run_at = $3, last_status = 'error', last_error = $4, last_duration_ms = $5 WHERE name = $1",
      [name, ctx.now(), new Date(ctx.now().getTime() + Math.min(job.interval, 900) * 1000), msg, Date.now() - t0]);
    await logEvent(ctx.db, "error", `job:${name}`, msg);
    return { ok: false, message: msg };
  }
}

export async function tick(ctx: AppContext) {
  const due = await ctx.db.query<{ name: string }>("SELECT name FROM jobs WHERE enabled AND next_run_at <= $1", [ctx.now()]);
  for (const d of due) await runJob(ctx, d.name);
}

export function startScheduler(ctx: AppContext, everyMs = 60_000) {
  let running = false;
  const loop = async () => {
    if (running) return;
    running = true;
    try { await tick(ctx); } catch (e) { console.error("[jarvis:scheduler]", e); } finally { running = false; }
  };
  void loop();
  const h = setInterval(loop, everyMs);
  h.unref();
  return () => clearInterval(h);
}
