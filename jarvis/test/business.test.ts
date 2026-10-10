import assert from "node:assert/strict";
import { test } from "node:test";
import { closePastCycles, ensureCycle } from "../server/business/cycle.ts";
import { computeMonthKpis, createTransaction, verifyTransaction } from "../server/business/ledger.ts";
import { modelOpportunity } from "../server/business/opportunities.ts";
import { createInvoice, setInvoiceStatus } from "../server/business/crm.ts";
import { enterRed, makeCtx, setupOwner } from "./helpers.ts";

const pay = (amount_cents: number, extra = {}) => ({ occurred_on: "2026-09-10", type: "payment_received" as const, amount_cents, ...extra });

test("only VERIFIED cash counts; refunds subtract; transfers & invoices never count", async () => {
  const { ctx } = await makeCtx();
  const a = await createTransaction(ctx, pay(400_000), "owner");
  await createTransaction(ctx, pay(900_000), "jarvis"); // unverified
  const t = await createTransaction(ctx, { occurred_on: "2026-09-11", type: "internal_transfer", amount_cents: 5_000_000 }, "owner");
  const r = await createTransaction(ctx, { occurred_on: "2026-09-12", type: "refund", amount_cents: 50_000 }, "owner");
  await createTransaction(ctx, { occurred_on: "2026-09-12", type: "expense", amount_cents: 30_000, description: "hosting" }, "owner");
  await verifyTransaction(ctx, a.id, { method: "bank_statement", evidence: "stmt line 14" });
  await verifyTransaction(ctx, t.id, { method: "bank_statement", evidence: "own transfer" });
  await verifyTransaction(ctx, r.id, { method: "processor_dashboard", evidence: "refund re_1" });
  const inv = await createInvoice(ctx, { number: "I-1", client_name: "Client C", issue_date: "2026-09-01", due_date: "2026-09-30", amount_cents: 700_000 }, "owner");
  await setInvoiceStatus(ctx, inv.id, "sent", "owner");

  const k = await computeMonthKpis(ctx, "2026-09");
  assert.equal(k.received_verified_cents, 400_000);
  assert.equal(k.received_unverified_cents, 900_000);
  assert.equal(k.refunds_cents, 50_000);
  assert.equal(k.verified_revenue_cents, 350_000);
  assert.equal(k.invoiced_cents, 700_000);
  assert.equal(k.outstanding_receivables_cents, 700_000);
  assert.equal(k.expenses_cents, 30_000);
  assert.equal(k.net_operating_profit_cents, 320_000);
  assert.equal(k.target_cents, 1_500_000);
  assert.equal(k.remaining_cents, 1_150_000);
});

test("non-EUR requires explicit FX; crypto needs hash + confirmations before verification", async () => {
  const { ctx } = await makeCtx();
  await assert.rejects(createTransaction(ctx, pay(1000, { currency: "USD" }), "owner"));
  const usd = await createTransaction(ctx, pay(10_000, { currency: "USD", fx_rate_to_eur: 0.9 }), "owner");
  const [row] = await ctx.db.query<{ eur_cents: number }>("SELECT eur_cents FROM transactions WHERE id = $1", [usd.id]);
  assert.equal(Number(row.eur_cents), 9_000);
  await assert.rejects(createTransaction(ctx, pay(1000, { payment_method: "crypto" }), "owner"));
  const c = await createTransaction(ctx, pay(1000, { payment_method: "crypto", tx_hash: "0xabc", network: "ethereum", confirmations: 0 }), "owner");
  await assert.rejects(verifyTransaction(ctx, c.id, { method: "onchain_explorer", evidence: "etherscan" }), /confirmations/);
});

test("verifying revenue over HTTP requires RED", async () => {
  const { ctx, app, clock } = await makeCtx();
  const { client, secret } = await setupOwner(app, clock);
  const tx = await client.post("/api/transactions", pay(100_000));
  assert.equal((await client.post(`/api/transactions/${tx.json.id}/verify`, { method: "bank_statement", evidence: "line 3" })).status, 403);
  await enterRed(client, secret, clock);
  assert.equal((await client.post(`/api/transactions/${tx.json.id}/verify`, { method: "bank_statement", evidence: "line 3" })).status, 200);
  assert.equal((await computeMonthKpis(ctx, "2026-09")).verified_revenue_cents, 100_000);
});

test("monthly cycle: missed target enters PERFORMANCE REVIEW (non-destructive)", async () => {
  const { ctx, clock } = await makeCtx();
  await ensureCycle(ctx); // 2026-09
  const p = await createTransaction(ctx, pay(500_000), "owner");
  await verifyTransaction(ctx, p.id, { method: "bank_statement", evidence: "bank statement" });
  const before = (await ctx.db.query("SELECT COUNT(*) AS n FROM transactions"))[0];
  clock.set("2026-10-01T08:00:00Z");
  const res = await closePastCycles(ctx);
  assert.deepEqual(res, [{ month: "2026-09", status: "review" }]);
  const [c] = await ctx.db.query<{ review: any }>("SELECT review FROM monthly_cycles WHERE month = '2026-09'");
  assert.equal(c.review.shortfall_cents, 1_000_000);
  assert.ok(c.review.findings.length > 0);
  assert.deepEqual((await ctx.db.query("SELECT COUNT(*) AS n FROM transactions"))[0], before, "no data touched");
  const n = await ctx.db.query<{ severity: string; title: string }>("SELECT severity, title FROM notifications WHERE title LIKE 'PERFORMANCE%'");
  assert.equal(n[0].severity, "critical");
});

test("monthly cycle: target met is recorded as met", async () => {
  const { ctx, clock } = await makeCtx();
  await ensureCycle(ctx);
  const p = await createTransaction(ctx, pay(1_600_000), "owner");
  await verifyTransaction(ctx, p.id, { method: "bank_statement", evidence: "bank statement" });
  clock.set("2026-10-02T00:00:00Z");
  assert.deepEqual(await closePastCycles(ctx), [{ month: "2026-09", status: "met" }]);
});

test("plan recommends concrete, data-derived actions", async () => {
  const { ctx } = await makeCtx();
  await createTransaction(ctx, pay(200_000), "jarvis");
  const c = await ensureCycle(ctx) as { plan: { actions: { action: string }[]; remaining_cents: number } };
  const actions = c.plan.actions.map((a) => a.action).join(" | ");
  assert.match(actions, /Verify €2,000/);
  assert.match(actions, /priced offer/);
  assert.equal(c.plan.remaining_cents, 1_500_000);
});

test("opportunity model: margin, EV, and evidence penalty", () => {
  const base = { price_cents: 300_000, recurring_monthly_cents: 10_000, acquisition_cost_cents: 20_000, delivery_cost_cents: 100_000, probability: 0.25, time_to_revenue_days: 30 };
  const m = modelOpportunity({ ...base, evidence: "" });
  assert.equal(m.first_year_revenue_cents, 420_000);
  assert.equal(m.expected_value_cents, 105_000);
  assert.equal(m.gross_margin, 0.7143);
  assert.equal(m.evidence_strength, "none");
  const m2 = modelOpportunity({ ...base, evidence: "x".repeat(100) });
  assert.ok(m2.score > m.score * 1.9);
});
