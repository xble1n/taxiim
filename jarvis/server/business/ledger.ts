import { z } from "zod";
import { audit, type Actor } from "../audit.ts";
import { HttpError, type AppContext } from "../context.ts";
import { num } from "../db.ts";
import { getSettings } from "../settings.ts";

export const TX_TYPES = ["payment_received", "expense", "refund", "chargeback", "internal_transfer", "adjustment"] as const;

export const TransactionInput = z
  .object({
    occurred_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    type: z.enum(TX_TYPES),
    amount_cents: z.number().int().positive(),
    currency: z.string().regex(/^[A-Z]{3,5}$/).default("EUR"),
    fx_rate_to_eur: z.number().positive().optional(),
    counterparty: z.string().max(200).default(""),
    description: z.string().max(2000).default(""),
    invoice_id: z.number().int().positive().nullable().optional(),
    recurring: z.boolean().default(false),
    payment_method: z.enum(["bank", "card", "crypto", "cash", "other"]).default("bank"),
    tx_hash: z.string().max(200).nullable().optional(),
    network: z.string().max(50).nullable().optional(),
    confirmations: z.number().int().nonnegative().nullable().optional(),
  })
  .superRefine((v, c) => {
    if (v.currency !== "EUR" && v.fx_rate_to_eur === undefined) {
      c.addIssue({ code: "custom", message: "Non-EUR amounts need an explicit fx_rate_to_eur (no silent conversion).", path: ["fx_rate_to_eur"] });
    }
    if (v.payment_method === "crypto" && (!v.tx_hash || !v.network)) {
      c.addIssue({ code: "custom", message: "Crypto transactions require tx_hash and network.", path: ["tx_hash"] });
    }
  });
export type TransactionInput = z.input<typeof TransactionInput>;

/** Creates a ledger row. Rows are always created UNVERIFIED — verification is a separate owner act. */
export async function createTransaction(ctx: AppContext, raw: TransactionInput, actor: Actor) {
  const v = TransactionInput.parse(raw);
  const fx = v.currency === "EUR" ? 1 : v.fx_rate_to_eur!;
  const eur = Math.round(v.amount_cents * fx);
  const [row] = await ctx.db.query<{ id: number }>(
    `INSERT INTO transactions (occurred_on, type, amount_cents, currency, fx_rate_to_eur, eur_cents, counterparty, description,
       invoice_id, recurring, payment_method, tx_hash, network, confirmations, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
    [v.occurred_on, v.type, v.amount_cents, v.currency, fx, eur, v.counterparty, v.description, v.invoice_id ?? null,
      v.recurring, v.payment_method, v.tx_hash ?? null, v.network ?? null, v.confirmations ?? null, actor],
  );
  await audit(ctx.db, { actor, action: "ledger.create", category: "finance", target: `tx:${row.id}`, outcome: "success", detail: { type: v.type, eur_cents: eur } });
  return row;
}

export const VerifyInput = z.object({
  method: z.enum(["bank_statement", "processor_dashboard", "onchain_explorer", "receipt", "other"]),
  evidence: z.string().min(3).max(1000),
});

/** Owner-only (RED-gated at the route). The single path by which money becomes "verified". */
export async function verifyTransaction(ctx: AppContext, id: number, raw: z.input<typeof VerifyInput>) {
  const v = VerifyInput.parse(raw);
  const [tx] = await ctx.db.query<{ payment_method: string; confirmations: number | null; verification_status: string }>(
    "SELECT payment_method, confirmations, verification_status FROM transactions WHERE id = $1", [id]);
  if (!tx) throw new HttpError(404, "not_found", "Transaction not found.");
  if (tx.payment_method === "crypto" && (tx.confirmations ?? 0) < 1) {
    throw new HttpError(400, "unconfirmed", "On-chain payment has no recorded confirmations yet.");
  }
  await ctx.db.query(
    `UPDATE transactions SET verification_status = 'verified', verification_method = $2, verification_evidence = $3, verified_at = $4 WHERE id = $1`,
    [id, v.method, v.evidence, ctx.now()],
  );
  await audit(ctx.db, { actor: "owner", action: "ledger.verify", category: "finance", target: `tx:${id}`, outcome: "success", detail: { method: v.method } });
}

export async function rejectTransaction(ctx: AppContext, id: number, reason: string) {
  await ctx.db.query(`UPDATE transactions SET verification_status = 'rejected', verification_evidence = $2, verified_at = $3 WHERE id = $1`, [id, reason, ctx.now()]);
  await audit(ctx.db, { actor: "owner", action: "ledger.reject", category: "finance", target: `tx:${id}`, outcome: "success" });
}

export async function listTransactions(ctx: AppContext, month?: string) {
  if (month) {
    return ctx.db.query(`SELECT * FROM transactions WHERE to_char(occurred_on, 'YYYY-MM') = $1 ORDER BY occurred_on DESC, id DESC`, [month]);
  }
  return ctx.db.query(`SELECT * FROM transactions ORDER BY occurred_on DESC, id DESC LIMIT 500`);
}

export const monthOf = (d: Date) => d.toISOString().slice(0, 7);

export interface MonthKpis {
  month: string;
  target_cents: number;
  invoiced_cents: number;
  received_verified_cents: number;
  received_unverified_cents: number;
  refunds_cents: number;
  verified_revenue_cents: number; // the KPI: verified cash received − refunds − chargebacks
  expenses_cents: number;
  net_operating_profit_cents: number;
  recurring_revenue_cents: number;
  outstanding_receivables_cents: number;
  cash_available_cents: number;
  remaining_cents: number;
  progress: number;
}

/**
 * KPI rules (spec §4):
 *  - Revenue = owner-VERIFIED payment_received in the month, minus verified refunds and chargebacks.
 *  - Never counted: unverified/rejected rows, invoices, projections, internal transfers.
 *  - Expenses count when not rejected (conservative: unverified expenses still reduce profit).
 */
export async function computeMonthKpis(ctx: AppContext, month: string): Promise<MonthKpis> {
  const settings = await getSettings(ctx.db);
  const cycle = (await ctx.db.query<{ target_cents: number }>("SELECT target_cents FROM monthly_cycles WHERE month = $1", [month]))[0];
  const target = cycle ? num(cycle.target_cents) : settings.monthly_target_cents;

  const [m] = await ctx.db.query<Record<string, unknown>>(
    `SELECT
       COALESCE(SUM(eur_cents) FILTER (WHERE type='payment_received' AND verification_status='verified'),0) AS recv_v,
       COALESCE(SUM(eur_cents) FILTER (WHERE type='payment_received' AND verification_status='unverified'),0) AS recv_u,
       COALESCE(SUM(eur_cents) FILTER (WHERE type IN ('refund','chargeback') AND verification_status='verified'),0) AS refunds,
       COALESCE(SUM(eur_cents) FILTER (WHERE type='expense' AND verification_status<>'rejected'),0) AS expenses,
       COALESCE(SUM(eur_cents) FILTER (WHERE type='payment_received' AND verification_status='verified' AND recurring),0) AS recurring
     FROM transactions WHERE to_char(occurred_on, 'YYYY-MM') = $1`,
    [month],
  );
  const [inv] = await ctx.db.query<Record<string, unknown>>(
    `SELECT COALESCE(SUM(amount_cents),0) AS invoiced FROM invoices
     WHERE status IN ('sent','paid') AND currency='EUR' AND to_char(issue_date,'YYYY-MM') = $1`, [month]);
  const [ar] = await ctx.db.query<Record<string, unknown>>(
    `SELECT COALESCE(SUM(i.amount_cents - COALESCE(p.paid,0)),0) AS outstanding
     FROM invoices i
     LEFT JOIN (SELECT invoice_id, SUM(eur_cents) AS paid FROM transactions
                WHERE type='payment_received' AND verification_status='verified' GROUP BY invoice_id) p ON p.invoice_id = i.id
     WHERE i.status = 'sent'`);
  const [cash] = await ctx.db.query<Record<string, unknown>>(
    `SELECT COALESCE(SUM(CASE
        WHEN type='payment_received' AND verification_status='verified' THEN eur_cents
        WHEN type IN ('refund','chargeback') AND verification_status='verified' THEN -eur_cents
        WHEN type='expense' AND verification_status<>'rejected' THEN -eur_cents
        WHEN type='adjustment' AND verification_status='verified' THEN eur_cents
        ELSE 0 END),0) AS cash
     FROM transactions WHERE to_char(occurred_on,'YYYY-MM') <= $1`, [month]);

  const verifiedRevenue = num(m.recv_v) - num(m.refunds);
  const expenses = num(m.expenses);
  return {
    month,
    target_cents: target,
    invoiced_cents: num(inv.invoiced),
    received_verified_cents: num(m.recv_v),
    received_unverified_cents: num(m.recv_u),
    refunds_cents: num(m.refunds),
    verified_revenue_cents: verifiedRevenue,
    expenses_cents: expenses,
    net_operating_profit_cents: verifiedRevenue - expenses,
    recurring_revenue_cents: num(m.recurring),
    outstanding_receivables_cents: Math.max(0, num(ar.outstanding)),
    cash_available_cents: num(cash.cash),
    remaining_cents: Math.max(0, target - verifiedRevenue),
    progress: target > 0 ? Math.max(0, verifiedRevenue) / target : 0,
  };
}

/** Daily cumulative verified revenue for charts. */
export async function dailyRevenueSeries(ctx: AppContext, month: string) {
  const rows = await ctx.db.query<{ day: string; revenue: unknown; expenses: unknown }>(
    `SELECT to_char(occurred_on,'YYYY-MM-DD') AS day,
       COALESCE(SUM(CASE WHEN type='payment_received' AND verification_status='verified' THEN eur_cents
                         WHEN type IN ('refund','chargeback') AND verification_status='verified' THEN -eur_cents ELSE 0 END),0) AS revenue,
       COALESCE(SUM(eur_cents) FILTER (WHERE type='expense' AND verification_status<>'rejected'),0) AS expenses
     FROM transactions WHERE to_char(occurred_on,'YYYY-MM') = $1 GROUP BY 1 ORDER BY 1`, [month]);
  return rows.map((r) => ({ day: r.day, revenue_cents: num(r.revenue), expenses_cents: num(r.expenses) }));
}

/** Month-by-month history for the last N months. */
export async function monthlyHistory(ctx: AppContext, months = 6) {
  const now = ctx.now();
  const out: MonthKpis[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(await computeMonthKpis(ctx, monthOf(d)));
  }
  return out;
}
