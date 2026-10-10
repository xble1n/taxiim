import { audit } from "../audit.ts";
import { HttpError, type AppContext } from "../context.ts";
import { num } from "../db.ts";
import { notify } from "../events.ts";
import { getSettings } from "../settings.ts";
import { overdueFollowUps, pipelineSummary } from "./crm.ts";
import { computeMonthKpis, monthOf, type MonthKpis } from "./ledger.ts";
import { listOpportunities } from "./opportunities.ts";

const eur = (c: number) => `€${(c / 100).toLocaleString("en-IE", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

function daysInMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Builds the evidence-based monthly plan (spec §4 steps 2–5). Deterministic:
 * every recommendation is derived from data in the system, never invented.
 */
export async function buildPlan(ctx: AppContext, month: string) {
  const kpis = await computeMonthKpis(ctx, month);
  const pipeline = await pipelineSummary(ctx);
  const opps = (await listOpportunities(ctx)).filter((o) => !["dropped", "paused"].includes(String(o.status)));
  const overdue = await overdueFollowUps(ctx);
  const now = ctx.now();
  const dim = daysInMonth(month);
  const dayOfMonth = monthOf(now) === month ? now.getUTCDate() : month < monthOf(now) ? dim : 0;
  const daysLeft = Math.max(1, dim - dayOfMonth + (dayOfMonth === 0 ? 0 : 1));
  const coverage = kpis.remaining_cents > 0 ? pipeline.open_weighted_cents / kpis.remaining_cents : null;

  const actions: { priority: number; action: string; rationale: string }[] = [];
  if (kpis.received_unverified_cents > 0) {
    actions.push({ priority: 1, action: `Verify ${eur(kpis.received_unverified_cents)} of recorded but unverified payments`, rationale: "Unverified cash does not count toward the KPI until you confirm it against a statement." });
  }
  if (kpis.outstanding_receivables_cents > 0) {
    actions.push({ priority: 1, action: `Collect ${eur(kpis.outstanding_receivables_cents)} in outstanding receivables`, rationale: "Collecting issued invoices is the fastest path to verified cash." });
  }
  if (overdue.length) {
    actions.push({ priority: 2, action: `Complete ${overdue.length} overdue follow-up(s)`, rationale: "Stalled follow-ups are the most common cause of lost deals." });
  }
  if (!opps.length) {
    actions.push({ priority: 1, action: "Define at least one priced offer with documented demand evidence", rationale: "No active opportunity exists; the business engine has nothing to sell." });
  } else if (opps.every((o) => o.model.evidence_strength === "none")) {
    actions.push({ priority: 2, action: "Validate demand for the top opportunity (5 discovery conversations)", rationale: "No opportunity has documented demand evidence." });
  }
  if (coverage !== null && coverage < 3) {
    const avgDeal = opps[0] ? Math.max(1, opps[0].model.first_year_revenue_cents) : 150_000;
    const gap = Math.max(0, 3 * kpis.remaining_cents - pipeline.open_weighted_cents);
    actions.push({
      priority: 1,
      action: `Grow weighted pipeline by ${eur(gap)} (≈${Math.ceil(gap / (avgDeal * 0.2))} qualified leads at 20% probability)`,
      rationale: `Pipeline coverage is ${coverage.toFixed(2)}× the remaining target; 3× is a common minimum for B2B services.`,
    });
  }
  actions.sort((a, b) => a.priority - b.priority);

  return {
    generated_at: now.toISOString(),
    target_cents: kpis.target_cents,
    verified_revenue_cents: kpis.verified_revenue_cents,
    remaining_cents: kpis.remaining_cents,
    days_left: daysLeft,
    required_daily_cents: Math.ceil(kpis.remaining_cents / daysLeft),
    pipeline_weighted_cents: pipeline.open_weighted_cents,
    pipeline_coverage: coverage,
    top_opportunities: opps.slice(0, 5).map((o) => ({ id: o.id, title: o.title, score: o.model.score, expected_value_cents: o.model.expected_value_cents, evidence: o.model.evidence_strength })),
    actions,
    disclaimer: "Plan derived from recorded data only. The €15,000 target is an objective, not a forecast or guarantee.",
  };
}

/** Ensures the current month has a cycle (spec §4 step 1). Idempotent. */
export async function ensureCycle(ctx: AppContext, month = monthOf(ctx.now())) {
  const existing = await ctx.db.query("SELECT * FROM monthly_cycles WHERE month = $1", [month]);
  if (existing.length) return existing[0];
  const { monthly_target_cents } = await getSettings(ctx.db);
  await ctx.db.query("INSERT INTO monthly_cycles (month, target_cents) VALUES ($1,$2) ON CONFLICT DO NOTHING", [month, monthly_target_cents]);
  const plan = await buildPlan(ctx, month);
  await ctx.db.query("UPDATE monthly_cycles SET plan = $2::jsonb WHERE month = $1", [month, JSON.stringify(plan)]);
  await audit(ctx.db, { actor: "system", action: "cycle.open", category: "finance", target: month, outcome: "success", detail: { target_cents: monthly_target_cents } });
  await notify(ctx.db, "info", `Monthly cycle ${month} opened`, `Target ${eur(monthly_target_cents)}. ${plan.actions.length} recommended actions.`, "/overview");
  return (await ctx.db.query("SELECT * FROM monthly_cycles WHERE month = $1", [month]))[0];
}

export async function refreshPlan(ctx: AppContext, month: string) {
  const plan = await buildPlan(ctx, month);
  const r = await ctx.db.query("UPDATE monthly_cycles SET plan = $2::jsonb WHERE month = $1 RETURNING month", [month, JSON.stringify(plan)]);
  if (!r.length) throw new HttpError(404, "not_found", "No cycle for that month.");
  return plan;
}

function buildReview(k: MonthKpis, pipeline: Awaited<ReturnType<typeof pipelineSummary>>, plan: Record<string, unknown>) {
  const shortfall = k.target_cents - k.verified_revenue_cents;
  const findings: string[] = [];
  if (k.verified_revenue_cents <= 0) findings.push("No verified revenue was recorded this month.");
  if (k.received_unverified_cents > 0) findings.push(`${eur(k.received_unverified_cents)} was recorded but never verified, so it is excluded.`);
  if (k.outstanding_receivables_cents > 0) findings.push(`${eur(k.outstanding_receivables_cents)} remained uncollected in receivables.`);
  if (k.invoiced_cents < k.target_cents) findings.push(`Invoicing (${eur(k.invoiced_cents)}) was below target, so even full collection could not meet it.`);
  if (pipeline.win_rate !== null) findings.push(`Win rate on closed deals: ${(pipeline.win_rate * 100).toFixed(0)}%.`);
  if (pipeline.open_count < 10) findings.push(`Only ${pipeline.open_count} open leads — top-of-funnel volume is insufficient.`);
  if (k.expenses_cents > k.verified_revenue_cents) findings.push("Expenses exceeded verified revenue (operating loss).");
  return {
    generated_at: new Date().toISOString(),
    shortfall_cents: shortfall,
    kpis: k,
    findings,
    planned_actions: (plan.actions as unknown[]) ?? [],
    recovery_plan: null as string | null, // written by the owner or drafted by JARVIS for owner approval
    note: "PERFORMANCE REVIEW MODE: analysis and recovery planning only. No data, infrastructure or funds are affected.",
  };
}

/**
 * Closes every past cycle still marked active. Missed targets enter
 * PERFORMANCE REVIEW MODE — an analysis state, never a destructive one.
 */
export async function closePastCycles(ctx: AppContext) {
  const current = monthOf(ctx.now());
  const past = await ctx.db.query<{ month: string; plan: Record<string, unknown> }>(
    "SELECT month, plan FROM monthly_cycles WHERE status = 'active' AND month < $1 ORDER BY month", [current]);
  const results: { month: string; status: string }[] = [];
  for (const c of past) {
    const k = await computeMonthKpis(ctx, c.month);
    if (k.verified_revenue_cents >= k.target_cents) {
      await ctx.db.query("UPDATE monthly_cycles SET status = 'met', closed_at = $2 WHERE month = $1", [c.month, ctx.now()]);
      await notify(ctx.db, "info", `Target met for ${c.month}`, `Verified revenue ${eur(k.verified_revenue_cents)}.`);
      results.push({ month: c.month, status: "met" });
    } else {
      const review = buildReview(k, await pipelineSummary(ctx), c.plan ?? {});
      await ctx.db.query("UPDATE monthly_cycles SET status = 'review', review = $2::jsonb, closed_at = $3 WHERE month = $1", [c.month, JSON.stringify(review), ctx.now()]);
      await notify(ctx.db, "critical", `PERFORMANCE REVIEW MODE — ${c.month}`, `Shortfall ${eur(review.shortfall_cents)}. Review findings and approve a recovery plan.`, "/revenue");
      results.push({ month: c.month, status: "review" });
    }
    await audit(ctx.db, { actor: "system", action: "cycle.close", category: "finance", target: c.month, outcome: "success", detail: { verified_cents: k.verified_revenue_cents } });
  }
  return results;
}

export async function saveRecoveryPlan(ctx: AppContext, month: string, plan: string, acknowledge: boolean) {
  const [c] = await ctx.db.query<{ review: Record<string, unknown> | null; status: string }>("SELECT review, status FROM monthly_cycles WHERE month = $1", [month]);
  if (!c || c.status !== "review") throw new HttpError(400, "not_in_review", "Cycle is not in performance review.");
  const review = { ...(c.review ?? {}), recovery_plan: plan, recovery_plan_saved_at: ctx.now().toISOString() };
  await ctx.db.query("UPDATE monthly_cycles SET review = $2::jsonb, status = $3 WHERE month = $1", [month, JSON.stringify(review), acknowledge ? "closed" : "review"]);
  await audit(ctx.db, { actor: "owner", action: "cycle.recovery_plan", category: "finance", target: month, outcome: "success", detail: { acknowledged: acknowledge } });
}

export async function listCycles(ctx: AppContext) {
  const rows = await ctx.db.query<Record<string, unknown>>("SELECT * FROM monthly_cycles ORDER BY month DESC LIMIT 24");
  return rows.map((r) => ({ ...r, target_cents: num(r.target_cents) }));
}

export async function inPerformanceReview(ctx: AppContext) {
  const r = await ctx.db.query<{ month: string }>("SELECT month FROM monthly_cycles WHERE status = 'review' ORDER BY month");
  return r.map((x) => x.month);
}
