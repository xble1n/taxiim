import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRegistry } from "../server/agent/tools.ts";
import { invokeTool } from "../server/policy/engine.ts";
import { setSetting } from "../server/settings.ts";
import { enterRed, makeCtx, setupOwner } from "./helpers.ts";

const invoice = { number: "INV-1", client_name: "Acme Fleet", issue_date: "2026-09-15", due_date: "2026-09-30", amount_cents: 250_000 };

test("LEVEL 1/2 tools execute immediately", async () => {
  const { ctx } = await makeCtx();
  const reg = buildRegistry();
  const r1 = await invokeTool(ctx, reg, "list_leads", {}, "jarvis");
  assert.equal(r1.status, "executed");
  const r2 = await invokeTool(ctx, reg, "create_lead", { company: "Vushtrri Taxi Co", source: "referral from owner" }, "jarvis");
  assert.equal(r2.status, "executed");
});

test("unknown tools and invalid input are denied", async () => {
  const { ctx } = await makeCtx();
  const reg = buildRegistry();
  assert.equal((await invokeTool(ctx, reg, "activate_red_protocol", {}, "jarvis")).status, "denied");
  assert.equal((await invokeTool(ctx, reg, "create_lead", { company: "x" }, "jarvis")).status, "denied");
});

test("LEVEL 3 queues for approval; owner approval executes it", async () => {
  const { ctx, app, clock } = await makeCtx();
  const { client } = await setupOwner(app, clock);
  const r = await invokeTool(ctx, buildRegistry(), "issue_invoice", invoice, "jarvis");
  assert.equal(r.status, "pending_approval");
  assert.equal((await ctx.db.query("SELECT * FROM invoices")).length, 0, "nothing executed yet");
  const id = (r as { approvalId: number }).approvalId;
  const d = await client.post(`/api/approvals/${id}/decide`, { approve: true });
  assert.equal(d.status, 200);
  assert.equal(d.json.status, "executed");
  const [inv] = await ctx.db.query<{ status: string }>("SELECT status FROM invoices");
  assert.equal(inv.status, "sent");
  assert.equal((await client.post(`/api/approvals/${id}/decide`, { approve: true })).status, 409, "no double execution");
});

test("standing authorization: bounded by uses and amount", async () => {
  const { ctx, app, clock } = await makeCtx();
  const { client, secret } = await setupOwner(app, clock);
  assert.equal((await client.post("/api/permissions/authorizations", { tool: "issue_invoice", max_uses: 1, max_amount_cents: 300_000, expires_in_hours: 24 })).status, 403, "granting needs RED");
  await enterRed(client, secret, clock);
  assert.equal((await client.post("/api/permissions/authorizations", { tool: "issue_invoice", max_uses: 1, max_amount_cents: 300_000, expires_in_hours: 24 })).status, 200);
  const reg = buildRegistry();
  assert.equal((await invokeTool(ctx, reg, "issue_invoice", { ...invoice, number: "INV-big", amount_cents: 900_000 }, "jarvis")).status, "pending_approval", "over cap");
  assert.equal((await invokeTool(ctx, reg, "issue_invoice", invoice, "jarvis")).status, "executed", "within cap");
  assert.equal((await invokeTool(ctx, reg, "issue_invoice", { ...invoice, number: "INV-2" }, "jarvis")).status, "pending_approval", "uses exhausted");
});

test("LEVEL 4 approval requires RED; L4 grants must be capped and short", async () => {
  const { ctx, app, clock } = await makeCtx();
  const { client, secret } = await setupOwner(app, clock);
  const [dest] = await ctx.db.query<{ id: number }>("INSERT INTO crypto_destinations (address, network, asset, status) VALUES ('0x00000000000000000000000000000000000000aa','ethereum','USDT','verified') RETURNING id");
  const r = await invokeTool(ctx, buildRegistry(), "prepare_crypto_payout", { destination_id: dest.id, amount_cents_eur: 10_000, asset: "USDT", reason: "test payout" }, "jarvis");
  assert.equal(r.status, "pending_approval");
  const id = (r as { approvalId: number }).approvalId;
  assert.equal((await client.post(`/api/approvals/${id}/decide`, { approve: true })).status, 403);
  await enterRed(client, secret, clock);
  const ok = await client.post(`/api/approvals/${id}/decide`, { approve: true });
  assert.equal(ok.json.status, "executed");
  assert.equal(ok.json.result.output.executed_onchain, false, "never moves funds itself");
  const bad = await client.post("/api/permissions/authorizations", { tool: "prepare_crypto_payout", max_uses: 5, expires_in_hours: 24 * 30 });
  assert.equal(bad.status, 400);
});

test("kill switch halts LEVEL 3/4 even with authorization, and blocks approved execution", async () => {
  const { ctx, app, clock } = await makeCtx();
  const { client } = await setupOwner(app, clock);
  const reg = buildRegistry();
  const pending = await invokeTool(ctx, reg, "issue_invoice", invoice, "jarvis");
  await setSetting(ctx.db, "kill_switch", true);
  assert.equal((await invokeTool(ctx, reg, "issue_invoice", { ...invoice, number: "X" }, "jarvis")).status, "denied");
  assert.equal((await invokeTool(ctx, reg, "list_leads", {}, "jarvis")).status, "executed", "reads continue");
  const d = await client.post(`/api/approvals/${(pending as { approvalId: number }).approvalId}/decide`, { approve: true });
  assert.equal(d.status, 423);
});

test("outreach release refused without lawful contact basis", async () => {
  const { ctx, app, clock } = await makeCtx();
  const { client } = await setupOwner(app, clock);
  const reg = buildRegistry();
  const lead = await invokeTool(ctx, reg, "create_lead", { company: "Cold Prospect", source: "web directory" }, "jarvis");
  const leadId = (lead as any).output.id;
  const draft = await invokeTool(ctx, reg, "draft_document", { kind: "outreach", lead_id: leadId, title: "Intro", body: "Hello" }, "jarvis");
  const rel = await invokeTool(ctx, reg, "release_outreach", { draft_id: (draft as any).output.id }, "jarvis");
  const d = await client.post(`/api/approvals/${(rel as any).approvalId}/decide`, { approve: true });
  assert.equal(d.json.status, "failed");
  assert.match(d.json.result.error, /lawful contact basis/);
});

test("rate limit caps agent tool calls per minute", async () => {
  const { ctx } = await makeCtx();
  await setSetting(ctx.db, "agent_rate_limit_per_minute", 3);
  const reg = buildRegistry();
  const statuses = [];
  for (let i = 0; i < 5; i++) statuses.push((await invokeTool(ctx, reg, "list_leads", {}, "jarvis")).status);
  assert.deepEqual(statuses, ["executed", "executed", "executed", "denied", "denied"]);
});

test("every agent action lands in the audit log", async () => {
  const { ctx } = await makeCtx();
  await invokeTool(ctx, buildRegistry(), "list_leads", {}, "jarvis");
  const rows = await ctx.db.query<{ action: string; actor: string }>("SELECT action, actor FROM audit_log");
  assert.ok(rows.some((r) => r.action === "tool.list_leads" && r.actor === "jarvis"));
});
