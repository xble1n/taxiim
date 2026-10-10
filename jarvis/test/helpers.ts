import { randomBytes } from "node:crypto";
import { loadConfig } from "../server/config.ts";
import { PGlite } from "@electric-sql/pglite";
import { migrate, wrapPglite } from "../server/db.ts";
import type { AppContext } from "../server/context.ts";
import { createApp, resetIpLimits } from "../server/app.ts";
import type { LlmProvider, LlmRequest, LlmResponse } from "../server/llm/provider.ts";
import { UnavailableProvider } from "../server/llm/provider.ts";
import { totpAt, totpStep } from "../server/security/crypto.ts";
import { resetRateLimits } from "../server/policy/engine.ts";

export class Clock {
  t: number;
  constructor(iso = "2026-09-15T10:00:00Z") { this.t = Date.parse(iso); }
  now = () => new Date(this.t);
  advance(ms: number) { this.t += ms; }
  set(iso: string) { this.t = Date.parse(iso); }
}

/** Scripted provider: deterministic responses for orchestrator tests (never used at runtime). */
export class ScriptedProvider implements LlmProvider {
  name = "scripted"; model = "scripted-test";
  calls: LlmRequest[] = [];
  private script: ((req: LlmRequest) => Partial<LlmResponse>)[];
  constructor(script: ((req: LlmRequest) => Partial<LlmResponse>)[]) { this.script = script; }
  available() { return true; }
  unavailableReason() { return null; }
  async complete(req: LlmRequest): Promise<LlmResponse> {
    this.calls.push(structuredClone(req));
    const step = this.script.shift();
    if (!step) throw new Error("script exhausted");
    const r = step(req);
    return { content: [], text: "", toolCalls: [], stopReason: "end_turn", sources: [], usage: { input_tokens: 10, output_tokens: 5, web_searches: 0 }, model: this.model, ...r };
  }
}

// One migrated in-memory database per test file; each test gets a fast clone.
let tpl: Promise<PGlite> | null = null;
function template() {
  tpl ??= (async () => {
    const pg = new PGlite();
    await migrate(wrapPglite(pg));
    return pg;
  })();
  return tpl;
}

export async function makeCtx(opts: { llm?: LlmProvider; clock?: Clock } = {}) {
  resetRateLimits();
  resetIpLimits();
  const clock = opts.clock ?? new Clock();
  const db = wrapPglite(await (await template()).clone());
  const config = loadConfig({ masterKey: randomBytes(32), setupToken: "test-setup-token", env: "test", dataDir: "/nonexistent", databaseUrl: null });
  const ctx: AppContext = { db, config, llm: opts.llm ?? new UnavailableProvider("no key in tests"), now: clock.now };
  return { ctx, clock, app: createApp(ctx) };
}

export function codeFor(secret: string, clock: Clock, offsetSteps = 0) {
  return totpAt(secret, totpStep(clock.t) + offsetSteps);
}

type App = ReturnType<typeof createApp>;
export class Client {
  cookie = "";
  private app: App;
  constructor(app: App) { this.app = app; }
  async req(method: string, path: string, body?: unknown, opts: { csrf?: boolean } = {}) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (opts.csrf !== false) headers["x-jarvis-request"] = "1";
    if (this.cookie) headers.cookie = this.cookie;
    const res = await this.app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, json, headers: res.headers };
  }
  get(p: string) { return this.req("GET", p); }
  post(p: string, b: unknown = {}) { return this.req("POST", p, b); }
  patch(p: string, b: unknown = {}) { return this.req("PATCH", p, b); }
  del(p: string) { return this.req("DELETE", p); }
}

export const PASSWORD = "correct horse battery staple";

/** Completes setup and logs in. Returns the TOTP secret for later step-ups. */
export async function setupOwner(app: App, clock: Clock) {
  const c = new Client(app);
  const s = await c.post("/api/setup", { setupToken: "test-setup-token", displayName: "Owner", password: PASSWORD });
  if (s.status !== 200) throw new Error(`setup failed ${JSON.stringify(s.json)}`);
  const secret = s.json.totpSecret as string;
  const conf = await c.post("/api/setup/confirm", { setupToken: "test-setup-token", code: codeFor(secret, clock) });
  if (conf.status !== 200) throw new Error("confirm failed");
  clock.advance(30_000);
  const l = await c.post("/api/auth/login", { password: PASSWORD, code: codeFor(secret, clock) });
  if (l.status !== 200) throw new Error(`login failed ${JSON.stringify(l.json)}`);
  return { client: c, secret };
}

export async function enterRed(c: Client, secret: string, clock: Clock) {
  clock.advance(30_000); // each TOTP step is single-use
  const r = await c.post("/api/red/activate", { codeword: "RED", code: codeFor(secret, clock) });
  if (r.status !== 200) throw new Error(`RED failed ${JSON.stringify(r.json)}`);
}
