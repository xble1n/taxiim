import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { z, ZodError } from "zod";
import { audit } from "./audit.ts";
import { verifyAuditChain } from "./audit.ts";
import { HttpError, type AppContext } from "./context.ts";
import { num } from "./db.ts";
import { logEvent } from "./events.ts";
import * as owner from "./auth/owner.ts";
import { activateRed, deactivateRed, requireRed, revokeAllRed } from "./auth/red.ts";
import { buildRegistry } from "./agent/tools.ts";
import { chat, conversationTranscript, deleteConversation, listConversations } from "./agent/orchestrator.ts";
import * as crm from "./business/crm.ts";
import * as ledger from "./business/ledger.ts";
import * as opps from "./business/opportunities.ts";
import * as cycle from "./business/cycle.ts";
import * as crypto from "./business/crypto.ts";
import * as memory from "./memory.ts";
import * as knowledge from "./knowledge.ts";
import { listResearch, startResearch } from "./research.ts";
import { decideApproval, grantStandingAuthorization, LEVEL_NAMES, revokeStandingAuthorization } from "./policy/engine.ts";
import { getSettings, setSetting, DEFAULT_SETTINGS, type SettingKey } from "./settings.ts";
import { integrationHealth } from "./health.ts";
import { exportAll } from "./backup.ts";
import { JOBS, runJob } from "./scheduler.ts";
import { redactString } from "./security/redact.ts";

type Vars = { session: owner.SessionRow | null };
const COOKIE = "jarvis_session";

const id = (c: Context) => {
  const n = Number(c.req.param("id"));
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, "bad_id", "Invalid id.");
  return n;
};
async function body<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try { raw = await c.req.json(); } catch { throw new HttpError(400, "bad_json", "Request body must be JSON."); }
  return schema.parse(raw);
}
const anyBody = z.record(z.string(), z.unknown());

// Simple per-IP limiter for unauthenticated endpoints.
const ipHits = new Map<string, number[]>();
export function resetIpLimits() {
  ipHits.clear();
}
function ipLimit(ip: string, max: number) {
  const now = Date.now();
  const arr = (ipHits.get(ip) ?? []).filter((t) => now - t < 60_000);
  arr.push(now);
  ipHits.set(ip, arr);
  if (arr.length > max) throw new HttpError(429, "rate_limited", "Too many requests.");
}
const clientIp = (c: Context) => c.req.header("x-forwarded-for")?.split(",")[0].trim() || c.req.header("x-real-ip") || "local";

export function createApp(ctx: AppContext) {
  const registry = buildRegistry();
  const app = new Hono<{ Variables: Vars }>();
  const secureCookie = ctx.config.env === "production";

  // ------------------------------------------------------------ cross-cutting middleware
  app.use("*", async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Frame-Options", "DENY");
    c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    c.header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (secureCookie) c.header("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
    if (c.req.path.startsWith("/api/")) c.header("Cache-Control", "no-store");
  });

  // CSRF: every state-changing API call must carry a custom header (forces a CORS preflight cross-origin).
  app.use("/api/*", async (c, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method) && c.req.header("x-jarvis-request") !== "1") {
      throw new HttpError(403, "csrf", "Missing request header.");
    }
    c.set("session", await owner.resolveSession(ctx, getCookie(c, COOKIE)));
    await next();
  });

  app.onError(async (err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.code, message: err.message }, err.status as 400);
    if (err instanceof ZodError) return c.json({ error: "validation", message: err.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") }, 400);
    await logEvent(ctx.db, "error", "http", `${c.req.method} ${c.req.path}: ${err.message}`, { stack: err.stack?.split("\n").slice(0, 6) });
    return c.json({ error: "internal", message: "Internal error. Logged to system events." }, 500);
  });

  const requireOwner = (c: Context<{ Variables: Vars }>) => {
    const s = c.get("session");
    if (!s) throw new HttpError(401, "unauthenticated", "Owner authentication required.");
    return s;
  };
  const red = async (c: Context<{ Variables: Vars }>, action: string) => {
    const s = requireOwner(c);
    await requireRed(ctx, s, action);
    return s;
  };

  // ------------------------------------------------------------ public
  app.get("/api/health", (c) => c.json({ ok: true }));
  app.get("/api/status", async (c) => {
    const s = c.get("session");
    return c.json({ setup: await owner.setupStatus(ctx), authenticated: !!s });
  });
  app.post("/api/setup", async (c) => {
    ipLimit(clientIp(c), 10);
    const b = await body(c, z.object({ setupToken: z.string(), displayName: z.string().min(1).max(80), password: z.string().max(200) }));
    return c.json(await owner.beginSetup(ctx, b));
  });
  app.post("/api/setup/confirm", async (c) => {
    ipLimit(clientIp(c), 10);
    const b = await body(c, z.object({ setupToken: z.string(), code: z.string() }));
    await owner.confirmSetup(ctx, b);
    return c.json({ ok: true });
  });
  app.post("/api/auth/login", async (c) => {
    ipLimit(clientIp(c), 10);
    const b = await body(c, z.object({ password: z.string().max(200), code: z.string().max(10) }));
    const { token, expiresAt } = await owner.login(ctx, { ...b, ip: clientIp(c), userAgent: c.req.header("user-agent") ?? null });
    setCookie(c, COOKIE, token, { httpOnly: true, sameSite: "Strict", secure: secureCookie, path: "/", expires: expiresAt });
    return c.json({ ok: true, expiresAt });
  });

  // ------------------------------------------------------------ session & RED
  app.post("/api/auth/logout", async (c) => {
    await owner.logout(ctx, requireOwner(c));
    deleteCookie(c, COOKIE, { path: "/" });
    return c.json({ ok: true });
  });
  app.get("/api/me", async (c) => {
    const s = requireOwner(c);
    const o = await owner.getOwner(ctx);
    const settings = await getSettings(ctx.db);
    return c.json({
      displayName: o?.display_name,
      sessionId: s.id,
      redActive: owner.isRedActive(ctx, s),
      redUntil: owner.isRedActive(ctx, s) ? s.red_until : null,
      killSwitch: settings.kill_switch,
      performanceReview: await cycle.inPerformanceReview(ctx),
      llm: { available: ctx.llm.available(), model: ctx.llm.model, reason: ctx.llm.unavailableReason() },
    });
  });
  app.post("/api/red/activate", async (c) => {
    const s = requireOwner(c);
    ipLimit(`red:${clientIp(c)}`, 6);
    const b = await body(c, z.object({ codeword: z.string(), code: z.string() }));
    return c.json(await activateRed(ctx, s, b));
  });
  app.post("/api/red/deactivate", async (c) => {
    await deactivateRed(ctx, requireOwner(c));
    return c.json({ ok: true });
  });
  app.post("/api/red/revoke-all", async (c) => {
    requireOwner(c);
    await revokeAllRed(ctx);
    return c.json({ ok: true });
  });
  app.post("/api/auth/password", async (c) => {
    requireOwner(c);
    await owner.changePassword(ctx, await body(c, z.object({ current: z.string(), next: z.string(), code: z.string() })));
    return c.json({ ok: true });
  });
  app.get("/api/sessions", async (c) => {
    const s = requireOwner(c);
    return c.json({ current: s.id, sessions: await owner.listSessions(ctx) });
  });
  app.delete("/api/sessions/:id", async (c) => {
    requireOwner(c);
    await owner.revokeSession(ctx, id(c));
    return c.json({ ok: true });
  });
  app.post("/api/sessions/revoke-others", async (c) => {
    const s = requireOwner(c);
    return c.json({ revoked: await owner.revokeAllOtherSessions(ctx, s.id) });
  });

  // ------------------------------------------------------------ dashboard aggregate
  app.get("/api/dashboard", async (c) => {
    requireOwner(c);
    const month = ledger.monthOf(ctx.now());
    await cycle.ensureCycle(ctx, month);
    const [cyc] = await ctx.db.query("SELECT * FROM monthly_cycles WHERE month = $1", [month]);
    const [pending] = await ctx.db.query<{ n: unknown }>("SELECT COUNT(*) AS n FROM approvals WHERE status = 'pending'");
    return c.json({
      month,
      kpis: await ledger.computeMonthKpis(ctx, month),
      history: await ledger.monthlyHistory(ctx, 6),
      daily: await ledger.dailyRevenueSeries(ctx, month),
      cycle: cyc,
      pipeline: await crm.pipelineSummary(ctx),
      opportunities: (await opps.listOpportunities(ctx)).slice(0, 5),
      pendingApprovals: num(pending.n),
      projects: await ctx.db.query("SELECT p.*, (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status <> 'done') AS open_tasks FROM projects p WHERE status = 'active' ORDER BY priority LIMIT 6"),
      research: await ctx.db.query("SELECT id, question, status, created_at FROM research_reports ORDER BY created_at DESC LIMIT 5"),
      jobs: await ctx.db.query("SELECT * FROM jobs ORDER BY name"),
      integrations: await integrationHealth(ctx),
      notifications: await ctx.db.query("SELECT * FROM notifications WHERE read_at IS NULL ORDER BY created_at DESC LIMIT 10"),
      events: await ctx.db.query("SELECT * FROM system_events WHERE severity IN ('warning','error') ORDER BY ts DESC LIMIT 10"),
      security: await ctx.db.query("SELECT id, ts, actor, action, outcome FROM audit_log WHERE category IN ('security','permission') ORDER BY id DESC LIMIT 10"),
    });
  });

  // ------------------------------------------------------------ operator chat
  app.post("/api/chat", async (c) => {
    requireOwner(c);
    const b = await body(c, z.object({ conversationId: z.number().int().positive().nullable().optional(), message: z.string().max(20_000) }));
    return c.json(await chat(ctx, registry, b));
  });
  app.get("/api/conversations", async (c) => { requireOwner(c); return c.json(await listConversations(ctx)); });
  app.get("/api/conversations/:id", async (c) => { requireOwner(c); return c.json(await conversationTranscript(ctx, id(c))); });
  app.delete("/api/conversations/:id", async (c) => { requireOwner(c); await deleteConversation(ctx, id(c)); return c.json({ ok: true }); });

  // ------------------------------------------------------------ memory
  app.get("/api/memories", async (c) => { requireOwner(c); return c.json(await memory.searchMemories(ctx, c.req.query("q"), 200)); });
  app.get("/api/memories/export", async (c) => {
    requireOwner(c);
    c.header("Content-Disposition", `attachment; filename="jarvis-memories-${ctx.now().toISOString().slice(0, 10)}.json"`);
    return c.json(await memory.exportMemories(ctx));
  });
  app.post("/api/memories", async (c) => { requireOwner(c); return c.json(await memory.addMemory(ctx, await body(c, anyBody) as never, "owner")); });
  app.patch("/api/memories/:id", async (c) => { requireOwner(c); await memory.updateMemory(ctx, id(c), await body(c, anyBody) as never); return c.json({ ok: true }); });
  app.delete("/api/memories/:id", async (c) => { requireOwner(c); await memory.deleteMemory(ctx, id(c)); return c.json({ ok: true }); });
  app.delete("/api/memories", async (c) => { await red(c, "memory.delete_all"); return c.json({ deleted: await memory.deleteAllMemories(ctx) }); });

  // ------------------------------------------------------------ knowledge & research
  app.get("/api/knowledge/documents", async (c) => { requireOwner(c); return c.json(await knowledge.listDocuments(ctx)); });
  app.get("/api/knowledge/search", async (c) => { requireOwner(c); return c.json(await knowledge.searchKnowledge(ctx, c.req.query("q") ?? "", 20)); });
  app.post("/api/knowledge/notes", async (c) => { requireOwner(c); return c.json(await knowledge.addDocument(ctx, await body(c, anyBody) as never, "owner")); });
  app.post("/api/knowledge/ingest", async (c) => {
    requireOwner(c);
    const b = await body(c, z.object({ url: z.string().url() }));
    return c.json(await knowledge.ingestUrl(ctx, b.url, "owner"));
  });
  app.delete("/api/knowledge/documents/:id", async (c) => { requireOwner(c); await knowledge.deleteDocument(ctx, id(c)); return c.json({ ok: true }); });
  app.get("/api/research", async (c) => { requireOwner(c); return c.json(await listResearch(ctx)); });
  app.post("/api/research", async (c) => {
    requireOwner(c);
    const b = await body(c, z.object({ question: z.string().min(5).max(4000) }));
    return c.json(await startResearch(ctx, b.question));
  });

  // ------------------------------------------------------------ CRM & business
  app.get("/api/leads", async (c) => { requireOwner(c); return c.json(await crm.listLeads(ctx, { stage: c.req.query("stage"), q: c.req.query("q") })); });
  app.post("/api/leads", async (c) => { requireOwner(c); return c.json(await crm.createLead(ctx, await body(c, anyBody) as never, "owner")); });
  app.get("/api/leads/:id", async (c) => { requireOwner(c); return c.json(await crm.leadDetail(ctx, id(c))); });
  app.patch("/api/leads/:id", async (c) => { requireOwner(c); await crm.updateLead(ctx, id(c), await body(c, anyBody) as never, "owner"); return c.json({ ok: true }); });
  app.delete("/api/leads/:id", async (c) => { requireOwner(c); await crm.deleteLead(ctx, id(c)); return c.json({ ok: true }); });
  app.post("/api/leads/:id/activities", async (c) => {
    requireOwner(c);
    const b = await body(c, z.object({ kind: z.enum(["note", "email", "call", "meeting"]), summary: z.string().min(1).max(4000) }));
    await crm.addActivity(ctx, id(c), b.kind, b.summary, "owner");
    return c.json({ ok: true });
  });
  app.get("/api/pipeline", async (c) => { requireOwner(c); return c.json(await crm.pipelineSummary(ctx)); });

  app.get("/api/opportunities", async (c) => { requireOwner(c); return c.json(await opps.listOpportunities(ctx)); });
  app.post("/api/opportunities", async (c) => { requireOwner(c); return c.json(await opps.createOpportunity(ctx, await body(c, anyBody) as never, "owner")); });
  app.patch("/api/opportunities/:id", async (c) => { requireOwner(c); await opps.updateOpportunity(ctx, id(c), await body(c, anyBody) as never, "owner"); return c.json({ ok: true }); });

  app.get("/api/drafts", async (c) => { requireOwner(c); return c.json(await crm.listDrafts(ctx)); });
  app.post("/api/drafts", async (c) => { requireOwner(c); return c.json(await crm.createDraft(ctx, await body(c, anyBody) as never, "owner")); });
  app.patch("/api/drafts/:id", async (c) => {
    requireOwner(c);
    const b = await body(c, z.object({ status: z.enum(["draft", "approved", "sent", "discarded"]) }));
    await crm.setDraftStatus(ctx, id(c), b.status, "owner");
    return c.json({ ok: true });
  });

  app.get("/api/invoices", async (c) => { requireOwner(c); return c.json(await crm.listInvoices(ctx)); });
  app.post("/api/invoices", async (c) => { requireOwner(c); return c.json(await crm.createInvoice(ctx, await body(c, anyBody) as never, "owner")); });
  app.patch("/api/invoices/:id/status", async (c) => {
    requireOwner(c);
    const b = await body(c, z.object({ status: z.enum(["draft", "sent", "paid", "void"]) }));
    await crm.setInvoiceStatus(ctx, id(c), b.status, "owner");
    return c.json({ ok: true });
  });

  app.get("/api/transactions", async (c) => { requireOwner(c); return c.json(await ledger.listTransactions(ctx, c.req.query("month"))); });
  app.post("/api/transactions", async (c) => { requireOwner(c); return c.json(await ledger.createTransaction(ctx, await body(c, anyBody) as never, "owner")); });
  app.post("/api/transactions/:id/verify", async (c) => {
    await red(c, "ledger.verify");
    await ledger.verifyTransaction(ctx, id(c), await body(c, anyBody) as never);
    return c.json({ ok: true });
  });
  app.post("/api/transactions/:id/reject", async (c) => {
    await red(c, "ledger.reject");
    const b = await body(c, z.object({ reason: z.string().min(3).max(1000) }));
    await ledger.rejectTransaction(ctx, id(c), b.reason);
    return c.json({ ok: true });
  });
  app.get("/api/kpis", async (c) => { requireOwner(c); return c.json(await ledger.computeMonthKpis(ctx, c.req.query("month") ?? ledger.monthOf(ctx.now()))); });
  app.get("/api/cycles", async (c) => { requireOwner(c); return c.json(await cycle.listCycles(ctx)); });
  app.post("/api/cycles/:month/refresh", async (c) => { requireOwner(c); return c.json(await cycle.refreshPlan(ctx, c.req.param("month"))); });
  app.post("/api/cycles/:month/recovery-plan", async (c) => {
    requireOwner(c);
    const b = await body(c, z.object({ plan: z.string().min(10).max(20_000), acknowledge: z.boolean().default(false) }));
    await cycle.saveRecoveryPlan(ctx, c.req.param("month"), b.plan, b.acknowledge);
    return c.json({ ok: true });
  });

  // ------------------------------------------------------------ projects
  app.get("/api/projects", async (c) => { requireOwner(c); return c.json(await crm.listProjects(ctx)); });
  app.post("/api/projects", async (c) => { requireOwner(c); return c.json(await crm.createProject(ctx, await body(c, anyBody) as never, "owner")); });
  app.patch("/api/projects/:id", async (c) => { requireOwner(c); await crm.updateProject(ctx, id(c), await body(c, anyBody) as never, "owner"); return c.json({ ok: true }); });
  app.post("/api/tasks", async (c) => { requireOwner(c); return c.json(await crm.createTask(ctx, await body(c, anyBody) as never, "owner")); });
  app.patch("/api/tasks/:id", async (c) => { requireOwner(c); await crm.updateTask(ctx, id(c), await body(c, anyBody) as never, "owner"); return c.json({ ok: true }); });

  // ------------------------------------------------------------ approvals & permissions
  app.get("/api/approvals", async (c) => {
    requireOwner(c);
    const st = c.req.query("status");
    return c.json(st ? await ctx.db.query("SELECT * FROM approvals WHERE status = $1 ORDER BY id DESC LIMIT 200", [st]) : await ctx.db.query("SELECT * FROM approvals ORDER BY id DESC LIMIT 200"));
  });
  app.post("/api/approvals/:id/decide", async (c) => {
    const s = requireOwner(c);
    const b = await body(c, z.object({ approve: z.boolean(), note: z.string().max(1000).optional() }));
    return c.json(await decideApproval(ctx, registry, id(c), { ...b, redActive: owner.isRedActive(ctx, s) }));
  });
  app.get("/api/permissions", async (c) => {
    requireOwner(c);
    return c.json({
      tools: registry.list().map((t) => ({ name: t.name, level: t.level, levelName: LEVEL_NAMES[t.level], description: t.description })),
      authorizations: await ctx.db.query("SELECT * FROM standing_authorizations ORDER BY id DESC"),
    });
  });
  app.post("/api/permissions/authorizations", async (c) => {
    await red(c, "authorization.grant");
    return c.json(await grantStandingAuthorization(ctx, registry, await body(c, anyBody) as never));
  });
  app.delete("/api/permissions/authorizations/:id", async (c) => {
    requireOwner(c); // revoking privileges never needs RED
    await revokeStandingAuthorization(ctx, id(c));
    return c.json({ ok: true });
  });

  // ------------------------------------------------------------ settings & kill switch
  app.get("/api/settings", async (c) => { requireOwner(c); return c.json({ values: await getSettings(ctx.db), defaults: DEFAULT_SETTINGS }); });
  app.patch("/api/settings", async (c) => {
    await red(c, "settings.update");
    const b = await body(c, anyBody);
    for (const [k, v] of Object.entries(b)) {
      if (k === "kill_switch") continue; // dedicated endpoint
      await setSetting(ctx.db, k as SettingKey, v as never);
    }
    await audit(ctx.db, { actor: "owner", action: "settings.update", category: "permission", outcome: "success", detail: { keys: Object.keys(b) } });
    return c.json(await getSettings(ctx.db));
  });
  app.post("/api/kill-switch", async (c) => {
    const s = requireOwner(c);
    const b = await body(c, z.object({ engaged: z.boolean() }));
    // Engaging is always allowed (fail-safe). Disengaging re-enables execution, so it needs RED.
    if (!b.engaged) await requireRed(ctx, s, "kill_switch.disengage");
    await setSetting(ctx.db, "kill_switch", b.engaged);
    await audit(ctx.db, { actor: "owner", action: b.engaged ? "kill_switch.engage" : "kill_switch.disengage", category: "security", outcome: "success" });
    return c.json({ killSwitch: b.engaged });
  });

  // ------------------------------------------------------------ crypto destinations
  app.get("/api/crypto/destinations", async (c) => { requireOwner(c); return c.json(await crypto.listDestinations(ctx)); });
  app.post("/api/crypto/destinations", async (c) => { await red(c, "crypto.destination.add"); return c.json(await crypto.addDestination(ctx, await body(c, anyBody) as never)); });
  app.post("/api/crypto/destinations/:id/verify", async (c) => {
    await red(c, "crypto.destination.verify");
    await crypto.verifyDestination(ctx, id(c), await body(c, anyBody) as never);
    return c.json({ ok: true });
  });
  app.post("/api/crypto/destinations/:id/disable", async (c) => { requireOwner(c); await crypto.disableDestination(ctx, id(c)); return c.json({ ok: true }); });

  // ------------------------------------------------------------ audit, events, notifications, jobs, backup
  app.get("/api/audit", async (c) => {
    requireOwner(c);
    const cat = c.req.query("category");
    const limit = Math.min(500, Number(c.req.query("limit") ?? 200));
    return c.json(cat ? await ctx.db.query("SELECT * FROM audit_log WHERE category = $1 ORDER BY id DESC LIMIT $2", [cat, limit]) : await ctx.db.query("SELECT * FROM audit_log ORDER BY id DESC LIMIT $1", [limit]));
  });
  app.get("/api/audit/verify", async (c) => { requireOwner(c); return c.json(await verifyAuditChain(ctx.db)); });
  app.get("/api/events", async (c) => { requireOwner(c); return c.json(await ctx.db.query("SELECT * FROM system_events ORDER BY ts DESC LIMIT 200")); });
  app.get("/api/notifications", async (c) => { requireOwner(c); return c.json(await ctx.db.query("SELECT * FROM notifications ORDER BY created_at DESC LIMIT 100")); });
  app.post("/api/notifications/:id/read", async (c) => { requireOwner(c); await ctx.db.query("UPDATE notifications SET read_at = now() WHERE id = $1", [id(c)]); return c.json({ ok: true }); });
  app.post("/api/notifications/read-all", async (c) => { requireOwner(c); await ctx.db.query("UPDATE notifications SET read_at = now() WHERE read_at IS NULL"); return c.json({ ok: true }); });
  app.get("/api/integrations", async (c) => { requireOwner(c); return c.json(await integrationHealth(ctx)); });
  app.get("/api/llm-usage", async (c) => {
    requireOwner(c);
    return c.json(await ctx.db.query(`SELECT to_char(ts,'YYYY-MM-DD') AS day, purpose, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
      SUM(est_cost_usd) AS cost_usd, COUNT(*) AS calls, SUM(CASE WHEN ok THEN 0 ELSE 1 END) AS failures FROM llm_usage GROUP BY 1,2 ORDER BY 1 DESC LIMIT 90`));
  });
  app.get("/api/jobs", async (c) => { requireOwner(c); return c.json(await ctx.db.query("SELECT * FROM jobs ORDER BY name")); });
  app.post("/api/jobs/:name/run", async (c) => {
    requireOwner(c);
    const name = c.req.param("name");
    if (!JOBS.some((j) => j.name === name)) throw new HttpError(404, "not_found", "Unknown job.");
    await audit(ctx.db, { actor: "owner", action: "job.run", category: "general", target: name, outcome: "success" });
    return c.json(await runJob(ctx, name));
  });
  app.patch("/api/jobs/:name", async (c) => {
    requireOwner(c);
    const b = await body(c, z.object({ enabled: z.boolean() }));
    await ctx.db.query("UPDATE jobs SET enabled = $2 WHERE name = $1", [c.req.param("name"), b.enabled]);
    await audit(ctx.db, { actor: "owner", action: "job.toggle", category: "general", target: c.req.param("name"), outcome: "success", detail: b });
    return c.json({ ok: true });
  });
  app.get("/api/backup", async (c) => {
    await red(c, "backup.export");
    await audit(ctx.db, { actor: "owner", action: "backup.export", category: "data", outcome: "success" });
    c.header("Content-Disposition", `attachment; filename="jarvis-backup-${ctx.now().toISOString().slice(0, 10)}.json"`);
    return c.json(await exportAll(ctx));
  });

  app.all("/api/*", (c) => c.json({ error: "not_found", message: `No route ${redactString(c.req.path)}` }, 404));
  return app;
}
