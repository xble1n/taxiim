import { z } from "zod";
import { audit, type Actor } from "../audit.ts";
import { HttpError, type AppContext } from "../context.ts";

export const STAGES = ["new", "qualified", "contacted", "meeting", "proposal", "negotiation", "won", "lost"] as const;
export const CONSENT = ["none", "inbound", "existing_relationship", "legitimate_interest_b2b", "explicit_consent"] as const;

export const LeadInput = z.object({
  company: z.string().min(2).max(200),
  contact_name: z.string().max(200).nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  website: z.string().url().nullable().optional(),
  segment: z.string().max(120).nullable().optional(),
  source: z.string().min(2).max(500),
  consent_basis: z.enum(CONSENT).default("none"),
  stage: z.enum(STAGES).default("new"),
  est_value_cents: z.number().int().nonnegative().default(0),
  probability: z.number().min(0).max(1).default(0.1),
  opportunity_id: z.number().int().positive().nullable().optional(),
  next_action: z.string().max(500).nullable().optional(),
  next_action_due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  notes: z.string().max(8000).default(""),
});
export type LeadInput = z.input<typeof LeadInput>;

function updateSql(table: string, id: number, v: Record<string, unknown>) {
  const keys = Object.keys(v).filter((k) => v[k] !== undefined);
  return {
    keys,
    sql: `UPDATE ${table} SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1`,
    params: [id, ...keys.map((k) => v[k])],
  };
}

export async function createLead(ctx: AppContext, raw: LeadInput, actor: Actor) {
  const v = LeadInput.parse(raw);
  const [row] = await ctx.db.query<{ id: number }>(
    `INSERT INTO leads (company, contact_name, email, phone, website, segment, source, consent_basis, stage, est_value_cents,
      probability, opportunity_id, next_action, next_action_due, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
    [v.company, v.contact_name ?? null, v.email ?? null, v.phone ?? null, v.website ?? null, v.segment ?? null, v.source,
      v.consent_basis, v.stage, v.est_value_cents, v.probability, v.opportunity_id ?? null, v.next_action ?? null,
      v.next_action_due ?? null, v.notes, actor],
  );
  await addActivity(ctx, row.id, "note", `Lead created (source: ${v.source})`, actor);
  await audit(ctx.db, { actor, action: "lead.create", category: "data", target: `lead:${row.id}`, outcome: "success" });
  return row;
}

export async function updateLead(ctx: AppContext, id: number, raw: Partial<LeadInput>, actor: Actor) {
  const v = LeadInput.partial().parse(raw);
  const [before] = await ctx.db.query<{ stage: string }>("SELECT stage FROM leads WHERE id = $1", [id]);
  if (!before) throw new HttpError(404, "not_found", "Lead not found.");
  const u = updateSql("leads", id, v as Record<string, unknown>);
  if (!u.keys.length) return;
  await ctx.db.query(u.sql, u.params);
  if (v.stage && v.stage !== before.stage) await addActivity(ctx, id, "stage_change", `${before.stage} → ${v.stage}`, actor);
  await audit(ctx.db, { actor, action: "lead.update", category: "data", target: `lead:${id}`, outcome: "success", detail: { fields: u.keys } });
}

export async function deleteLead(ctx: AppContext, id: number) {
  await ctx.db.query("DELETE FROM leads WHERE id = $1", [id]);
  await audit(ctx.db, { actor: "owner", action: "lead.delete", category: "data", target: `lead:${id}`, outcome: "success" });
}

export async function addActivity(ctx: AppContext, leadId: number, kind: string, summary: string, actor: Actor) {
  await ctx.db.query("INSERT INTO lead_activities (lead_id, kind, summary, actor) VALUES ($1,$2,$3,$4)", [leadId, kind, summary, actor]);
}

export async function listLeads(ctx: AppContext, filter: { stage?: string; q?: string } = {}) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.stage) { params.push(filter.stage); where.push(`stage = $${params.length}`); }
  if (filter.q) { params.push(`%${filter.q}%`); where.push(`(company ILIKE $${params.length} OR contact_name ILIKE $${params.length} OR segment ILIKE $${params.length})`); }
  return ctx.db.query(`SELECT * FROM leads ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY updated_at DESC LIMIT 500`, params);
}

export async function leadDetail(ctx: AppContext, id: number) {
  const [lead] = await ctx.db.query("SELECT * FROM leads WHERE id = $1", [id]);
  if (!lead) throw new HttpError(404, "not_found", "Lead not found.");
  const activities = await ctx.db.query("SELECT * FROM lead_activities WHERE lead_id = $1 ORDER BY created_at DESC", [id]);
  const drafts = await ctx.db.query("SELECT * FROM drafts WHERE lead_id = $1 ORDER BY created_at DESC", [id]);
  return { lead, activities, drafts };
}

export async function pipelineSummary(ctx: AppContext) {
  const rows = await ctx.db.query<{ stage: string; n: unknown; value: unknown; weighted: unknown }>(
    `SELECT stage, COUNT(*) AS n, COALESCE(SUM(est_value_cents),0) AS value,
            COALESCE(SUM(est_value_cents * probability),0) AS weighted
     FROM leads GROUP BY stage`);
  const by = Object.fromEntries(STAGES.map((s) => [s, { count: 0, value_cents: 0, weighted_cents: 0 }]));
  for (const r of rows) by[r.stage] = { count: Number(r.n), value_cents: Number(r.value), weighted_cents: Math.round(Number(r.weighted)) };
  const open = STAGES.filter((s) => s !== "won" && s !== "lost");
  return {
    stages: by,
    open_weighted_cents: open.reduce((a, s) => a + by[s].weighted_cents, 0),
    open_count: open.reduce((a, s) => a + by[s].count, 0),
    won: by.won.count,
    lost: by.lost.count,
    win_rate: by.won.count + by.lost.count > 0 ? by.won.count / (by.won.count + by.lost.count) : null,
  };
}

export async function overdueFollowUps(ctx: AppContext) {
  return ctx.db.query(
    `SELECT id, company, next_action, next_action_due FROM leads
     WHERE next_action_due IS NOT NULL AND next_action_due < $1::date AND stage NOT IN ('won','lost') ORDER BY next_action_due`,
    [ctx.now().toISOString().slice(0, 10)]);
}

// ------------------------------------------------------------ drafts (LEVEL 2 — never sent by creation)
export const DraftInput = z.object({
  kind: z.enum(["outreach", "proposal", "contract", "other"]),
  lead_id: z.number().int().positive().nullable().optional(),
  title: z.string().min(2).max(300),
  body: z.string().min(1).max(50_000),
});

export async function createDraft(ctx: AppContext, raw: z.input<typeof DraftInput>, actor: Actor) {
  const v = DraftInput.parse(raw);
  const [row] = await ctx.db.query<{ id: number }>(
    "INSERT INTO drafts (kind, lead_id, title, body, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id",
    [v.kind, v.lead_id ?? null, v.title, v.body, actor]);
  if (v.lead_id) await addActivity(ctx, v.lead_id, `${v.kind}_draft`, `Draft created: ${v.title}`, actor);
  await audit(ctx.db, { actor, action: "draft.create", category: "data", target: `draft:${row.id}`, outcome: "success", level: 2 });
  return row;
}

export async function listDrafts(ctx: AppContext) {
  return ctx.db.query("SELECT d.*, l.company FROM drafts d LEFT JOIN leads l ON l.id = d.lead_id ORDER BY d.created_at DESC LIMIT 200");
}

export async function setDraftStatus(ctx: AppContext, id: number, status: "draft" | "approved" | "sent" | "discarded", actor: Actor) {
  await ctx.db.query("UPDATE drafts SET status = $2 WHERE id = $1", [id, status]);
  await audit(ctx.db, { actor, action: "draft.status", category: "data", target: `draft:${id}`, outcome: "success", detail: { status } });
}

// ------------------------------------------------------------ invoices
export const InvoiceInput = z.object({
  number: z.string().min(1).max(50),
  lead_id: z.number().int().positive().nullable().optional(),
  client_name: z.string().min(2).max(200),
  issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount_cents: z.number().int().positive(),
  currency: z.string().regex(/^[A-Z]{3}$/).default("EUR"),
  notes: z.string().max(4000).default(""),
});

export async function createInvoice(ctx: AppContext, raw: z.input<typeof InvoiceInput>, actor: Actor) {
  const v = InvoiceInput.parse(raw);
  const [row] = await ctx.db.query<{ id: number }>(
    `INSERT INTO invoices (number, lead_id, client_name, issue_date, due_date, amount_cents, currency, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [v.number, v.lead_id ?? null, v.client_name, v.issue_date, v.due_date, v.amount_cents, v.currency, v.notes]);
  await audit(ctx.db, { actor, action: "invoice.create", category: "finance", target: `inv:${row.id}`, outcome: "success" });
  return row;
}

export async function setInvoiceStatus(ctx: AppContext, id: number, status: "draft" | "sent" | "paid" | "void", actor: Actor) {
  const r = await ctx.db.query("UPDATE invoices SET status = $2 WHERE id = $1 RETURNING id", [id, status]);
  if (!r.length) throw new HttpError(404, "not_found", "Invoice not found.");
  await audit(ctx.db, { actor, action: "invoice.status", category: "finance", target: `inv:${id}`, outcome: "success", detail: { status } });
}

export async function listInvoices(ctx: AppContext) {
  return ctx.db.query(
    `SELECT i.*, COALESCE(p.paid,0) AS paid_cents FROM invoices i
     LEFT JOIN (SELECT invoice_id, SUM(eur_cents) AS paid FROM transactions
                WHERE type='payment_received' AND verification_status='verified' GROUP BY invoice_id) p ON p.invoice_id = i.id
     ORDER BY i.issue_date DESC`);
}

// ------------------------------------------------------------ projects & tasks
export const ProjectInput = z.object({
  name: z.string().min(2).max(200),
  description: z.string().max(4000).default(""),
  status: z.enum(["active", "paused", "done", "dropped"]).default("active"),
  priority: z.number().int().min(1).max(5).default(3),
});
export const TaskInput = z.object({
  project_id: z.number().int().positive().nullable().optional(),
  title: z.string().min(2).max(300),
  status: z.enum(["todo", "in_progress", "blocked", "done"]).default("todo"),
  priority: z.number().int().min(1).max(5).default(3),
  due_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  blocked_reason: z.string().max(1000).nullable().optional(),
});

export async function createProject(ctx: AppContext, raw: z.input<typeof ProjectInput>, actor: Actor) {
  const v = ProjectInput.parse(raw);
  const [row] = await ctx.db.query<{ id: number }>(
    "INSERT INTO projects (name, description, status, priority) VALUES ($1,$2,$3,$4) RETURNING id", [v.name, v.description, v.status, v.priority]);
  await audit(ctx.db, { actor, action: "project.create", category: "data", target: `project:${row.id}`, outcome: "success" });
  return row;
}
export async function updateProject(ctx: AppContext, id: number, raw: Partial<z.input<typeof ProjectInput>>, actor: Actor) {
  const v = ProjectInput.partial().parse(raw) as Record<string, unknown>;
  const keys = Object.keys(v).filter((k) => v[k] !== undefined);
  if (!keys.length) return;
  await ctx.db.query(`UPDATE projects SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE id = $1`, [id, ...keys.map((k) => v[k])]);
  await audit(ctx.db, { actor, action: "project.update", category: "data", target: `project:${id}`, outcome: "success", detail: { fields: keys } });
}
export async function createTask(ctx: AppContext, raw: z.input<typeof TaskInput>, actor: Actor) {
  const v = TaskInput.parse(raw);
  const [row] = await ctx.db.query<{ id: number }>(
    "INSERT INTO tasks (project_id, title, status, priority, due_on, blocked_reason, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
    [v.project_id ?? null, v.title, v.status, v.priority, v.due_on ?? null, v.blocked_reason ?? null, actor]);
  await audit(ctx.db, { actor, action: "task.create", category: "data", target: `task:${row.id}`, outcome: "success" });
  return row;
}
export async function updateTask(ctx: AppContext, id: number, raw: Partial<z.input<typeof TaskInput>>, actor: Actor) {
  const v = TaskInput.partial().parse(raw);
  const u = updateSql("tasks", id, v as Record<string, unknown>);
  if (!u.keys.length) return;
  await ctx.db.query(u.sql, u.params);
  await audit(ctx.db, { actor, action: "task.update", category: "data", target: `task:${id}`, outcome: "success", detail: { fields: u.keys } });
}
export async function listProjects(ctx: AppContext) {
  const projects = await ctx.db.query("SELECT * FROM projects ORDER BY priority, created_at DESC");
  const tasks = await ctx.db.query("SELECT * FROM tasks ORDER BY status = 'done', priority, due_on NULLS LAST, id");
  return { projects, tasks };
}
