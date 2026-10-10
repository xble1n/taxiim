import assert from "node:assert/strict";
import { test } from "node:test";
import { audit, verifyAuditChain } from "../server/audit.ts";
import { addDestination, seedDesignatedDestination } from "../server/business/crypto.ts";
import { addDocument, assertPublicUrl, chunkText, ingestUrl, searchKnowledge } from "../server/knowledge.ts";
import { addMemory, searchMemories } from "../server/memory.ts";
import { enterRed, makeCtx, setupOwner } from "./helpers.ts";

test("audit chain verifies and detects tampering and deletion", async () => {
  const { ctx } = await makeCtx();
  for (let i = 0; i < 5; i++) await audit(ctx.db, { actor: "system", action: `t${i}`, outcome: "success", detail: { i } });
  assert.deepEqual(await verifyAuditChain(ctx.db), { ok: true, entries: 5 });
  await ctx.db.query("UPDATE audit_log SET detail = '{\"i\":99}'::jsonb WHERE action = 't2'");
  const r = await verifyAuditChain(ctx.db);
  assert.equal(r.ok, false);
  const { ctx: ctx2 } = await makeCtx();
  for (let i = 0; i < 3; i++) await audit(ctx2.db, { actor: "system", action: `t${i}`, outcome: "success" });
  await ctx2.db.query("DELETE FROM audit_log WHERE action = 't1'");
  assert.equal((await verifyAuditChain(ctx2.db)).ok, false);
});

test("audit details are redacted", async () => {
  const { ctx } = await makeCtx();
  await audit(ctx.db, { actor: "system", action: "x", outcome: "success", detail: { token: "abc", note: "sk-ant-zzzzzzzzzzzzzzzzzz" } });
  const [row] = await ctx.db.query<{ detail: any }>("SELECT detail FROM audit_log");
  assert.equal(row.detail.token, "[REDACTED]");
  assert.doesNotMatch(row.detail.note, /sk-ant-z/);
});

test("memory: store, search, edit, export, delete; secrets refused", async () => {
  const { ctx, app, clock } = await makeCtx();
  const { client, secret } = await setupOwner(app, clock);
  await addMemory(ctx, { kind: "preference", content: "Owner prefers reports in euros with net profit shown" }, "owner");
  await assert.rejects(addMemory(ctx, { kind: "config", content: "anthropic key sk-ant-aaaaaaaaaaaaaaaaaaaaa" }, "jarvis"), /secret|credential/i);
  const found = await searchMemories(ctx, "reports euros");
  assert.equal(found.length, 1);
  const m = (await client.get("/api/memories")).json[0];
  assert.equal((await client.patch(`/api/memories/${m.id}`, { pinned: true })).status, 200);
  const exp = await client.get("/api/memories/export");
  assert.equal(exp.json.count, 1);
  assert.equal((await client.del("/api/memories")).status, 403, "bulk delete needs RED");
  await enterRed(client, secret, clock);
  assert.equal((await client.del("/api/memories")).json.deleted, 1);
});

test("knowledge: chunking, full-text retrieval with sources", async () => {
  const { ctx } = await makeCtx();
  const long = Array.from({ length: 60 }, (_, i) => `Paragraph ${i} about fleet dispatch software pricing in Kosovo.`).join("\n\n");
  assert.ok(chunkText(long).length > 1);
  await addDocument(ctx, { title: "Dispatch market notes", content: long, source_url: "https://example.org/notes" }, "owner");
  const hits = await searchKnowledge(ctx, "dispatch pricing");
  assert.ok(hits.length > 0);
  assert.equal(hits[0].source_url, "https://example.org/notes");
});

test("ingestion blocks SSRF targets and parses HTML", async () => {
  const { ctx } = await makeCtx();
  for (const u of ["http://localhost/x", "http://127.0.0.1/", "http://10.0.0.5/", "http://169.254.169.254/latest", "file:///etc/passwd"]) {
    assert.throws(() => assertPublicUrl(new URL(u)), u);
  }
  const fakeFetch = (async () => new Response("<html><head><title>Fleet Report</title></head><body><script>evil()</script><p>Taxi fleets need GPS dispatch.</p></body></html>", { headers: { "content-type": "text/html" } })) as typeof fetch;
  const r = await ingestUrl(ctx, "https://news.example.com/a", "owner", fakeFetch);
  assert.equal(r.chunks, 1);
  const hits = await searchKnowledge(ctx, "GPS dispatch");
  assert.equal(hits[0].title, "Fleet Report");
  assert.doesNotMatch(hits[0].snippet, /evil/);
});

test("crypto destination: seeded unverified; verify needs RED + typed match; key material refused", async () => {
  const { ctx, app, clock } = await makeCtx();
  const { client, secret } = await setupOwner(app, clock);
  await seedDesignatedDestination(ctx, "0x3ddab2dd97a234e72d09bcbda77d0519e351ecae");
  const [d] = (await client.get("/api/crypto/destinations")).json;
  assert.equal(d.status, "unverified");
  assert.equal(d.network, null, "network never assumed");
  const payload = { confirm_address: d.address, network: "bsc", asset: "USDT", deposit_instructions_confirmed: true };
  assert.equal((await client.post(`/api/crypto/destinations/${d.id}/verify`, payload)).status, 403);
  await enterRed(client, secret, clock);
  assert.equal((await client.post(`/api/crypto/destinations/${d.id}/verify`, { ...payload, confirm_address: "0x3ddab2dd97a234e72d09bcbda77d0519e351ecaf" })).status, 400);
  assert.equal((await client.post(`/api/crypto/destinations/${d.id}/verify`, { ...payload, private_key: "x" })).status, 400);
  assert.equal((await client.post(`/api/crypto/destinations/${d.id}/verify`, payload)).status, 200);
  await assert.rejects(addDestination(ctx, { address: "0x1234", label: "bad" }));
});

test("backup excludes credentials and requires RED", async () => {
  const { app, clock } = await makeCtx();
  const { client, secret } = await setupOwner(app, clock);
  assert.equal((await client.get("/api/backup")).status, 403);
  await enterRed(client, secret, clock);
  const b = await client.get("/api/backup");
  assert.equal(b.status, 200);
  assert.equal(b.json.format, "jarvis-backup/1");
  const text = JSON.stringify(b.json);
  assert.ok(!("owner" in b.json.tables) && !("sessions" in b.json.tables));
  assert.doesNotMatch(text, /scrypt\$/);
});
