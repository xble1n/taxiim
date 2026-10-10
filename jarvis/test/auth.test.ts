import assert from "node:assert/strict";
import { test } from "node:test";
import { Client, codeFor, enterRed, makeCtx, PASSWORD, setupOwner } from "./helpers.ts";

test("setup requires the one-time token and locks after completion", async () => {
  const { app, clock } = await makeCtx();
  const c = new Client(app);
  assert.equal((await c.post("/api/setup", { setupToken: "nope", displayName: "x", password: PASSWORD })).status, 403);
  assert.equal((await c.post("/api/setup", { setupToken: "test-setup-token", displayName: "x", password: "short" })).status, 400);
  await setupOwner(app, clock);
  const again = await c.post("/api/setup", { setupToken: "test-setup-token", displayName: "attacker", password: PASSWORD });
  assert.equal(again.status, 409);
});

test("API is closed without a session; CSRF header is mandatory on writes", async () => {
  const { app, clock } = await makeCtx();
  const anon = new Client(app);
  for (const p of ["/api/me", "/api/dashboard", "/api/memories", "/api/audit", "/api/transactions"]) {
    assert.equal((await anon.get(p)).status, 401, p);
  }
  const { client } = await setupOwner(app, clock);
  assert.equal((await client.get("/api/me")).status, 200);
  const noCsrf = await client.req("POST", "/api/memories", { kind: "fact", content: "hello world" }, { csrf: false });
  assert.equal(noCsrf.status, 403);
  assert.equal(noCsrf.json.error, "csrf");
});

test("login needs password AND a fresh TOTP; repeated failures lock the account", async () => {
  const { app, clock } = await makeCtx();
  const { secret } = await setupOwner(app, clock);
  const c = new Client(app);
  clock.advance(30_000);
  assert.equal((await c.post("/api/auth/login", { password: "wrong password!!", code: codeFor(secret, clock) })).status, 401);
  assert.equal((await c.post("/api/auth/login", { password: PASSWORD, code: "000000" })).status, 401);
  for (let i = 0; i < 3; i++) await c.post("/api/auth/login", { password: "bad", code: "123456" });
  clock.advance(30_000);
  const locked = await c.post("/api/auth/login", { password: PASSWORD, code: codeFor(secret, clock) });
  assert.equal(locked.status, 429);
  clock.advance(16 * 60_000);
  const ok = await c.post("/api/auth/login", { password: PASSWORD, code: codeFor(secret, clock) });
  assert.equal(ok.status, 200);
});

test("a TOTP code cannot be replayed", async () => {
  const { app, clock } = await makeCtx();
  const { secret } = await setupOwner(app, clock);
  const c = new Client(app);
  clock.advance(30_000);
  const code = codeFor(secret, clock);
  assert.equal((await c.post("/api/auth/login", { password: PASSWORD, code })).status, 200);
  const c2 = new Client(app);
  assert.equal((await c2.post("/api/auth/login", { password: PASSWORD, code })).status, 401);
});

test("logout and session revocation invalidate access", async () => {
  const { app, clock } = await makeCtx();
  const { client, secret } = await setupOwner(app, clock);
  const other = new Client(app);
  clock.advance(30_000);
  await other.post("/api/auth/login", { password: PASSWORD, code: codeFor(secret, clock) });
  assert.equal((await other.get("/api/me")).status, 200);
  const r = await client.post("/api/sessions/revoke-others");
  assert.equal(r.json.revoked, 1);
  assert.equal((await other.get("/api/me")).status, 401);
  await client.post("/api/auth/logout");
  assert.equal((await client.get("/api/me")).status, 401);
});

test("RED: codeword alone is insufficient; needs fresh TOTP; expires; can be revoked", async () => {
  const { app, clock } = await makeCtx();
  const { client, secret } = await setupOwner(app, clock);
  // Re-using the login code (same step) must fail.
  assert.equal((await client.post("/api/red/activate", { codeword: "RED", code: codeFor(secret, clock) })).status, 401);
  clock.advance(30_000);
  assert.equal((await client.post("/api/red/activate", { codeword: "red", code: codeFor(secret, clock) })).status, 400);
  assert.equal((await client.patch("/api/settings", { red_ttl_minutes: 5 })).status, 403);
  await enterRed(client, secret, clock);
  assert.equal((await client.get("/api/me")).json.redActive, true);
  assert.equal((await client.patch("/api/settings", { red_ttl_minutes: 5 })).status, 200);
  clock.advance(16 * 60_000); // default TTL 15 min (new TTL applies to next activation)
  assert.equal((await client.get("/api/me")).json.redActive, false);
  assert.equal((await client.patch("/api/settings", { red_ttl_minutes: 10 })).status, 403);
  await enterRed(client, secret, clock);
  await client.post("/api/red/revoke-all");
  assert.equal((await client.get("/api/me")).json.redActive, false);
});

test("kill switch: engaging needs only a session, disengaging needs RED", async () => {
  const { app, clock } = await makeCtx();
  const { client, secret } = await setupOwner(app, clock);
  assert.equal((await client.post("/api/kill-switch", { engaged: true })).status, 200);
  assert.equal((await client.post("/api/kill-switch", { engaged: false })).status, 403);
  await enterRed(client, secret, clock);
  assert.equal((await client.post("/api/kill-switch", { engaged: false })).status, 200);
});

test("security headers are present", async () => {
  const { app } = await makeCtx();
  const r = await new Client(app).get("/api/health");
  assert.match(r.headers.get("content-security-policy")!, /frame-ancestors 'none'/);
  assert.equal(r.headers.get("x-frame-options"), "DENY");
  assert.equal(r.headers.get("cache-control"), "no-store");
});

test("unauthenticated endpoints are rate limited per IP", async () => {
  const { app } = await makeCtx();
  const c = new Client(app);
  const statuses: number[] = [];
  for (let i = 0; i < 12; i++) statuses.push((await c.post("/api/auth/login", { password: "x", code: "000000" })).status);
  assert.equal(statuses.at(-1), 429);
});
