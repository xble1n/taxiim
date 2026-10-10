import { z } from "zod";
import { audit, type Actor } from "../audit.ts";
import type { AppContext } from "../context.ts";
import { num } from "../db.ts";

export const OpportunityInput = z.object({
  title: z.string().min(3).max(200),
  segment: z.string().min(2).max(120),
  description: z.string().max(4000).default(""),
  price_cents: z.number().int().nonnegative().default(0),
  recurring_monthly_cents: z.number().int().nonnegative().default(0),
  acquisition_cost_cents: z.number().int().nonnegative().default(0),
  delivery_cost_cents: z.number().int().nonnegative().default(0),
  probability: z.number().min(0).max(1).default(0.1),
  time_to_revenue_days: z.number().int().min(1).max(730).default(30),
  conversion_assumptions: z.string().max(2000).default(""),
  evidence: z.string().max(4000).default(""),
  risks: z.string().max(4000).default(""),
  status: z.enum(["idea", "validating", "active", "paused", "dropped"]).default("idea"),
});
export type OpportunityInput = z.input<typeof OpportunityInput>;

export interface OpportunityModel {
  first_year_revenue_cents: number;
  gross_margin: number;
  expected_value_cents: number;
  time_factor: number;
  score: number;
  evidence_strength: "none" | "weak" | "documented";
}

/**
 * Financial model + priority score.
 *  R  = price + 12 × recurring           (first-year revenue per customer)
 *  GM = (R − acquisition − delivery) / R
 *  EV = R × probability
 *  TF = 30 / (30 + time_to_revenue_days) (faster cash scores higher)
 *  score = EV(€) × max(GM,0) × TF × evidence multiplier (0.5 none, 0.8 weak, 1.0 documented)
 * Evidence matters: an idea with no documented demand is deliberately penalised.
 */
export function modelOpportunity(o: {
  price_cents: unknown; recurring_monthly_cents: unknown; acquisition_cost_cents: unknown; delivery_cost_cents: unknown;
  probability: unknown; time_to_revenue_days: unknown; evidence?: unknown;
}): OpportunityModel {
  const R = num(o.price_cents) + 12 * num(o.recurring_monthly_cents);
  const cost = num(o.acquisition_cost_cents) + num(o.delivery_cost_cents);
  const gm = R > 0 ? (R - cost) / R : 0;
  const ev = R * num(o.probability);
  const tf = 30 / (30 + num(o.time_to_revenue_days));
  const ev_text = String(o.evidence ?? "").trim();
  const strength: OpportunityModel["evidence_strength"] = ev_text.length === 0 ? "none" : ev_text.length < 80 ? "weak" : "documented";
  const mult = strength === "none" ? 0.5 : strength === "weak" ? 0.8 : 1;
  return {
    first_year_revenue_cents: R,
    gross_margin: Number(gm.toFixed(4)),
    expected_value_cents: Math.round(ev),
    time_factor: Number(tf.toFixed(4)),
    score: Number(((ev / 100) * Math.max(gm, 0) * tf * mult).toFixed(2)),
    evidence_strength: strength,
  };
}

export async function createOpportunity(ctx: AppContext, raw: OpportunityInput, actor: Actor) {
  const v = OpportunityInput.parse(raw);
  const [row] = await ctx.db.query<{ id: number }>(
    `INSERT INTO opportunities (title, segment, description, price_cents, recurring_monthly_cents, acquisition_cost_cents,
      delivery_cost_cents, probability, time_to_revenue_days, conversion_assumptions, evidence, risks, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [v.title, v.segment, v.description, v.price_cents, v.recurring_monthly_cents, v.acquisition_cost_cents, v.delivery_cost_cents,
      v.probability, v.time_to_revenue_days, v.conversion_assumptions, v.evidence, v.risks, v.status, actor],
  );
  await audit(ctx.db, { actor, action: "opportunity.create", category: "data", target: `opp:${row.id}`, outcome: "success" });
  return row;
}

export async function updateOpportunity(ctx: AppContext, id: number, raw: Partial<OpportunityInput>, actor: Actor) {
  const v = OpportunityInput.partial().parse(raw);
  const keys = Object.keys(v).filter((k) => (v as Record<string, unknown>)[k] !== undefined);
  if (!keys.length) return;
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
  await ctx.db.query(`UPDATE opportunities SET ${sets}, updated_at = now() WHERE id = $1`, [id, ...keys.map((k) => (v as Record<string, unknown>)[k])]);
  await audit(ctx.db, { actor, action: "opportunity.update", category: "data", target: `opp:${id}`, outcome: "success", detail: { fields: keys } });
}

export interface OpportunityRow {
  id: number; title: string; segment: string; status: string; [k: string]: unknown;
  price_cents: unknown; recurring_monthly_cents: unknown; acquisition_cost_cents: unknown; delivery_cost_cents: unknown;
  probability: unknown; time_to_revenue_days: unknown; evidence: unknown;
}

export async function listOpportunities(ctx: AppContext) {
  const rows = await ctx.db.query<OpportunityRow>("SELECT * FROM opportunities ORDER BY created_at DESC");
  return rows
    .map((r) => ({ ...r, model: modelOpportunity(r) }))
    .sort((a, b) => b.model.score - a.model.score);
}
