import { z } from "zod";
import { audit, type Actor } from "../audit.ts";
import { HttpError, type AppContext } from "../context.ts";
import { getSettings } from "../settings.ts";

/**
 * Permission engine (spec §11). Enforcement lives here, in the backend —
 * never in the prompt. The model can only *request* a tool; this module
 * decides whether it runs now, waits for approval, or is denied.
 *
 *  L1 READ        run immediately
 *  L2 PREPARE     run immediately (internal drafts/records only, no external effect)
 *  L3 EXECUTE     run only under an active, bounded standing authorization; else queue for approval
 *  L4 PRIVILEGED  always requires owner approval inside an active RED session
 *                 (or a RED-created standing authorization with amount cap + short expiry)
 * Kill switch: halts every L3/L4 execution, including approved ones.
 */
export type Level = 1 | 2 | 3 | 4;

export interface ToolDef<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  level: Level;
  schema: S;
  /** EUR cents at stake, for standing-authorization amount caps. */
  amountCents?: (input: z.output<S>) => number | null;
  summarize: (input: z.output<S>) => string;
  run: (ctx: AppContext, input: z.output<S>, meta: { actor: Actor }) => Promise<unknown>;
  timeoutMs?: number;
}

export type InvokeResult =
  | { status: "executed"; output: unknown }
  | { status: "pending_approval"; approvalId: number; message: string }
  | { status: "denied"; reason: string }
  | { status: "failed"; error: string };

export const LEVEL_NAMES: Record<Level, string> = { 1: "READ", 2: "PREPARE", 3: "EXECUTE", 4: "PRIVILEGED" };

// ----------------------------------------------------------- rate limiting (per actor, sliding minute)
const calls = new Map<string, number[]>();
function rateLimited(key: string, perMinute: number, nowMs: number): boolean {
  const arr = (calls.get(key) ?? []).filter((t) => nowMs - t < 60_000);
  if (arr.length >= perMinute) {
    calls.set(key, arr);
    return true;
  }
  arr.push(nowMs);
  calls.set(key, arr);
  return false;
}
export function resetRateLimits() {
  calls.clear();
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const t = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error(`Tool timed out after ${ms}ms`)), ms); });
  try {
    return await Promise.race([p, t]);
  } finally {
    clearTimeout(timer);
  }
}

export class ToolRegistry {
  private tools = new Map<string, ToolDef>();
  register<S extends z.ZodType>(def: ToolDef<S>) {
    if (this.tools.has(def.name)) throw new Error(`Duplicate tool ${def.name}`);
    this.tools.set(def.name, def as unknown as ToolDef);
    return this;
  }
  get(name: string) {
    return this.tools.get(name);
  }
  list() {
    return [...this.tools.values()];
  }
  /** JSON-schema tool specs for the model. */
  specs() {
    return this.list().map((t) => ({
      name: t.name,
      description: `[LEVEL ${t.level} ${LEVEL_NAMES[t.level]}] ${t.description}`,
      input_schema: z.toJSONSchema(t.schema, { io: "input" }) as Record<string, unknown>,
    }));
  }
}

async function findStandingAuthorization(ctx: AppContext, tool: string, amount: number | null) {
  const rows = await ctx.db.query<{ id: number; max_amount_cents: number | null }>(
    `SELECT id, max_amount_cents FROM standing_authorizations
     WHERE tool = $1 AND revoked_at IS NULL AND expires_at > $2 AND uses < max_uses ORDER BY expires_at LIMIT 5`,
    [tool, ctx.now()]);
  return rows.find((r) => r.max_amount_cents === null || (amount !== null && amount <= Number(r.max_amount_cents))) ?? null;
}

async function consumeAuthorization(ctx: AppContext, id: number): Promise<boolean> {
  const r = await ctx.db.query("UPDATE standing_authorizations SET uses = uses + 1 WHERE id = $1 AND uses < max_uses RETURNING id", [id]);
  return r.length === 1;
}

async function execute(ctx: AppContext, def: ToolDef, input: unknown, actor: Actor): Promise<InvokeResult> {
  try {
    const output = await withTimeout(def.run(ctx, input, { actor }), def.timeoutMs ?? 30_000);
    await audit(ctx.db, { actor, action: `tool.${def.name}`, category: "agent", level: def.level, outcome: "success", detail: { input: input as Record<string, unknown> } });
    return { status: "executed", output };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await audit(ctx.db, { actor, action: `tool.${def.name}`, category: "agent", level: def.level, outcome: "failure", detail: { error: msg } });
    return { status: "failed", error: msg };
  }
}

export async function invokeTool(ctx: AppContext, registry: ToolRegistry, name: string, rawInput: unknown, actor: Actor): Promise<InvokeResult> {
  const def = registry.get(name);
  if (!def) {
    await audit(ctx.db, { actor, action: `tool.${name}`, category: "agent", outcome: "denied", detail: { reason: "unknown_tool" } });
    return { status: "denied", reason: `Unknown tool '${name}'.` };
  }
  const parsed = def.schema.safeParse(rawInput);
  if (!parsed.success) {
    return { status: "denied", reason: `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` };
  }
  const input = parsed.data;
  const settings = await getSettings(ctx.db);
  if (rateLimited(`${actor}`, settings.agent_rate_limit_per_minute, ctx.now().getTime())) {
    await audit(ctx.db, { actor, action: `tool.${name}`, category: "agent", level: def.level, outcome: "denied", detail: { reason: "rate_limited" } });
    return { status: "denied", reason: "Rate limit exceeded; try again shortly." };
  }

  if (def.level <= 2) return execute(ctx, def, input, actor);

  if (settings.kill_switch) {
    await audit(ctx.db, { actor, action: `tool.${name}`, category: "permission", level: def.level, outcome: "denied", detail: { reason: "kill_switch" } });
    return { status: "denied", reason: "Kill switch is engaged: all LEVEL 3/4 execution is halted by the owner." };
  }

  const amount = def.amountCents?.(input) ?? null;
  const auth = await findStandingAuthorization(ctx, def.name, amount);
  if (auth && (await consumeAuthorization(ctx, auth.id))) {
    await audit(ctx.db, { actor, action: `authorization.use`, category: "permission", level: def.level, target: `auth:${auth.id}`, outcome: "success", detail: { tool: def.name } });
    return execute(ctx, def, input, actor);
  }

  const approval = await createApproval(ctx, def, input, actor);
  return {
    status: "pending_approval",
    approvalId: approval.id,
    message: `LEVEL ${def.level} action queued for owner approval (#${approval.id})${def.level === 4 ? " — requires RED PROTOCOL" : ""}. It has NOT been executed.`,
  };
}

async function createApproval(ctx: AppContext, def: ToolDef, input: unknown, actor: Actor) {
  const { approval_ttl_hours } = await getSettings(ctx.db);
  const [row] = await ctx.db.query<{ id: number }>(
    `INSERT INTO approvals (tool, level, input, summary, requested_by, requires_red, expires_at)
     VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7) RETURNING id`,
    [def.name, def.level, JSON.stringify(input), def.summarize(input), actor, def.level === 4, new Date(ctx.now().getTime() + approval_ttl_hours * 3600_000)]);
  await audit(ctx.db, { actor, action: "approval.request", category: "permission", level: def.level, target: `approval:${row.id}`, outcome: "pending", detail: { tool: def.name } });
  return row;
}

/**
 * Owner decision on a queued action. `redActive` must be computed by the
 * caller from the authenticated session — never from request content.
 */
export async function decideApproval(
  ctx: AppContext, registry: ToolRegistry, id: number,
  decision: { approve: boolean; note?: string; redActive: boolean },
) {
  const [a] = await ctx.db.query<{ id: number; tool: string; level: Level; input: unknown; status: string; requires_red: boolean; expires_at: Date }>(
    "SELECT * FROM approvals WHERE id = $1", [id]);
  if (!a) throw new HttpError(404, "not_found", "Approval not found.");
  if (a.status !== "pending") throw new HttpError(409, "not_pending", `Approval is ${a.status}.`);
  if (new Date(a.expires_at) <= ctx.now()) {
    await ctx.db.query("UPDATE approvals SET status = 'expired' WHERE id = $1", [id]);
    throw new HttpError(410, "expired", "Approval request expired.");
  }
  if (!decision.approve) {
    await ctx.db.query("UPDATE approvals SET status = 'rejected', decided_at = $2, decision_note = $3 WHERE id = $1", [id, ctx.now(), decision.note ?? null]);
    await audit(ctx.db, { actor: "owner", action: "approval.reject", category: "permission", level: a.level, target: `approval:${id}`, outcome: "success" });
    return { status: "rejected" as const };
  }
  if (a.requires_red && !decision.redActive) {
    await audit(ctx.db, { actor: "owner", action: "approval.approve", category: "permission", level: a.level, target: `approval:${id}`, outcome: "denied", detail: { reason: "red_required" } });
    throw new HttpError(403, "red_required", "This LEVEL 4 action requires an active RED PROTOCOL session.");
  }
  const settings = await getSettings(ctx.db);
  if (settings.kill_switch) throw new HttpError(423, "kill_switch", "Kill switch engaged — disengage it (RED) before executing approved actions.");
  const def = registry.get(a.tool);
  if (!def) throw new HttpError(400, "unknown_tool", "Tool no longer exists.");
  const parsed = def.schema.safeParse(a.input);
  if (!parsed.success) throw new HttpError(400, "invalid_input", "Stored input no longer validates.");

  await ctx.db.query("UPDATE approvals SET status = 'approved', decided_at = $2, decision_note = $3 WHERE id = $1", [id, ctx.now(), decision.note ?? null]);
  await audit(ctx.db, { actor: "owner", action: "approval.approve", category: "permission", level: a.level, target: `approval:${id}`, outcome: "success" });
  const result = await execute(ctx, def, parsed.data, "owner");
  const status = result.status === "executed" ? "executed" : "failed";
  await ctx.db.query("UPDATE approvals SET status = $2, result = $3::jsonb WHERE id = $1", [id, status, JSON.stringify(result)]);
  return { status, result };
}

export async function expireApprovals(ctx: AppContext) {
  const r = await ctx.db.query("UPDATE approvals SET status = 'expired' WHERE status = 'pending' AND expires_at <= $1 RETURNING id", [ctx.now()]);
  return r.length;
}

export const StandingAuthInput = z.object({
  tool: z.string(),
  max_uses: z.number().int().min(1).max(100),
  max_amount_cents: z.number().int().positive().nullable().optional(),
  expires_in_hours: z.number().int().min(1).max(24 * 30),
  note: z.string().max(500).optional(),
});

/** Created only by the owner (RED-gated at the route). L4 grants must carry an amount cap and ≤ 7 days expiry. */
export async function grantStandingAuthorization(ctx: AppContext, registry: ToolRegistry, raw: z.input<typeof StandingAuthInput>) {
  const v = StandingAuthInput.parse(raw);
  const def = registry.get(v.tool);
  if (!def) throw new HttpError(400, "unknown_tool", "Unknown tool.");
  if (def.level < 3) throw new HttpError(400, "not_needed", "LEVEL 1–2 tools do not need authorization.");
  if (def.level === 4 && (!v.max_amount_cents || v.expires_in_hours > 24 * 7)) {
    throw new HttpError(400, "too_broad", "LEVEL 4 authorizations require a per-use amount cap and expire within 7 days.");
  }
  const [row] = await ctx.db.query<{ id: number }>(
    `INSERT INTO standing_authorizations (tool, level, max_uses, max_amount_cents, expires_at, note) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [def.name, def.level, v.max_uses, v.max_amount_cents ?? null, new Date(ctx.now().getTime() + v.expires_in_hours * 3600_000), v.note ?? null]);
  await audit(ctx.db, { actor: "owner", action: "authorization.grant", category: "permission", level: def.level, target: `auth:${row.id}`, outcome: "success", detail: v });
  return row;
}

export async function revokeStandingAuthorization(ctx: AppContext, id: number) {
  await ctx.db.query("UPDATE standing_authorizations SET revoked_at = $2 WHERE id = $1", [id, ctx.now()]);
  await audit(ctx.db, { actor: "owner", action: "authorization.revoke", category: "permission", target: `auth:${id}`, outcome: "success" });
}
