import { audit } from "../audit.ts";
import { HttpError, type AppContext } from "../context.ts";
import {
  decrypt, encrypt, generateTotpSecret, hashPassword, randomToken, safeEqual, sha256, totpUri, verifyPassword, verifyTotp,
} from "../security/crypto.ts";
import { getSettings } from "../settings.ts";

export interface OwnerRow {
  id: number; display_name: string; password_hash: string; totp_secret_enc: string | null; totp_enabled: boolean;
  failed_logins: number; locked_until: Date | null; last_totp_step: number;
}

export interface SessionRow {
  id: number; token_hash: string; created_at: Date; expires_at: Date; last_seen_at: Date; ip: string | null;
  user_agent: string | null; mfa_verified: boolean; red_until: Date | null; revoked_at: Date | null;
}

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export async function getOwner(ctx: AppContext): Promise<OwnerRow | null> {
  return (await ctx.db.query<OwnerRow>("SELECT * FROM owner WHERE id = 1"))[0] ?? null;
}

export async function setupStatus(ctx: AppContext) {
  const o = await getOwner(ctx);
  return { ownerExists: !!o, totpEnabled: !!o?.totp_enabled, setupComplete: !!o?.totp_enabled };
}

function assertSetupToken(ctx: AppContext, token: string) {
  if (!safeEqual(token, ctx.config.setupToken)) throw new HttpError(403, "bad_setup_token", "Invalid setup token.");
}

/** Step 1 of first-run setup. Only possible until TOTP enrollment is confirmed. */
export async function beginSetup(ctx: AppContext, input: { setupToken: string; displayName: string; password: string }) {
  assertSetupToken(ctx, input.setupToken);
  const existing = await getOwner(ctx);
  if (existing?.totp_enabled) throw new HttpError(409, "already_setup", "Owner already configured.");
  if (input.password.length < 12) throw new HttpError(400, "weak_password", "Password must be at least 12 characters.");
  const secret = generateTotpSecret();
  const hash = await hashPassword(input.password);
  await ctx.db.query(
    `INSERT INTO owner (id, display_name, password_hash, totp_secret_enc, totp_enabled)
     VALUES (1, $1, $2, $3, false)
     ON CONFLICT (id) DO UPDATE SET display_name = $1, password_hash = $2, totp_secret_enc = $3, totp_enabled = false`,
    [input.displayName, hash, encrypt(secret, ctx.config.masterKey)],
  );
  await audit(ctx.db, { actor: "anonymous", action: "owner.setup.begin", category: "security", outcome: "success" });
  return { totpSecret: secret, otpauthUri: totpUri(secret, input.displayName) };
}

/** Step 2: proves the authenticator works. Setup is locked after this. */
export async function confirmSetup(ctx: AppContext, input: { setupToken: string; code: string }) {
  assertSetupToken(ctx, input.setupToken);
  const o = await getOwner(ctx);
  if (!o || !o.totp_secret_enc) throw new HttpError(400, "no_setup", "Run setup first.");
  if (o.totp_enabled) throw new HttpError(409, "already_setup", "Owner already configured.");
  const step = verifyTotp(decrypt(o.totp_secret_enc, ctx.config.masterKey), input.code, ctx.now().getTime());
  if (step === null) throw new HttpError(400, "bad_code", "Authenticator code incorrect.");
  await ctx.db.query("UPDATE owner SET totp_enabled = true, last_totp_step = $1 WHERE id = 1", [step]);
  await audit(ctx.db, { actor: "owner", action: "owner.setup.complete", category: "security", outcome: "success" });
}

/**
 * Consumes a TOTP code. Each 30-second step can be used once, which blocks
 * replay of an observed code (including re-using the login code for RED).
 */
export async function consumeTotp(ctx: AppContext, owner: OwnerRow, code: string): Promise<boolean> {
  if (!owner.totp_secret_enc) return false;
  const step = verifyTotp(decrypt(owner.totp_secret_enc, ctx.config.masterKey), code, ctx.now().getTime());
  if (step === null || step <= Number(owner.last_totp_step)) return false;
  const updated = await ctx.db.query("UPDATE owner SET last_totp_step = $1 WHERE id = 1 AND last_totp_step < $1 RETURNING id", [step]);
  return updated.length === 1;
}

async function registerFailure(ctx: AppContext, owner: OwnerRow, reason: string, ip: string | null) {
  const failed = owner.failed_logins + 1;
  const lock = failed >= MAX_FAILED ? new Date(ctx.now().getTime() + LOCK_MINUTES * 60_000) : null;
  await ctx.db.query("UPDATE owner SET failed_logins = $1, locked_until = COALESCE($2, locked_until) WHERE id = 1", [
    lock ? 0 : failed,
    lock,
  ]);
  await audit(ctx.db, {
    actor: "anonymous", action: "auth.login", category: "security", outcome: "denied", detail: { reason, ip, locked: !!lock },
  });
}

export async function login(
  ctx: AppContext,
  input: { password: string; code: string; ip: string | null; userAgent: string | null },
): Promise<{ token: string; expiresAt: Date }> {
  const owner = await getOwner(ctx);
  if (!owner || !owner.totp_enabled) throw new HttpError(409, "setup_required", "Owner setup is not complete.");
  if (owner.locked_until && owner.locked_until > ctx.now()) {
    await audit(ctx.db, { actor: "anonymous", action: "auth.login", category: "security", outcome: "denied", detail: { reason: "locked", ip: input.ip } });
    throw new HttpError(429, "locked", "Too many failed attempts. Try again later.");
  }
  const pwOk = await verifyPassword(input.password, owner.password_hash);
  if (!pwOk) {
    await registerFailure(ctx, owner, "password", input.ip);
    throw new HttpError(401, "bad_credentials", "Invalid credentials.");
  }
  if (!(await consumeTotp(ctx, owner, input.code))) {
    await registerFailure(ctx, owner, "totp", input.ip);
    throw new HttpError(401, "bad_credentials", "Invalid credentials.");
  }
  await ctx.db.query("UPDATE owner SET failed_logins = 0, locked_until = NULL WHERE id = 1");
  const token = randomToken();
  const expiresAt = new Date(ctx.now().getTime() + ctx.config.sessionTtlHours * 3600_000);
  await ctx.db.query(
    `INSERT INTO sessions (token_hash, expires_at, ip, user_agent, mfa_verified) VALUES ($1,$2,$3,$4,true)`,
    [sha256(token), expiresAt, input.ip, input.userAgent?.slice(0, 300) ?? null],
  );
  await audit(ctx.db, { actor: "owner", action: "auth.login", category: "security", outcome: "success", detail: { ip: input.ip } });
  return { token, expiresAt };
}

export async function resolveSession(ctx: AppContext, token: string | undefined | null): Promise<SessionRow | null> {
  if (!token) return null;
  const rows = await ctx.db.query<SessionRow>(
    "SELECT * FROM sessions WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > $2",
    [sha256(token), ctx.now()],
  );
  const s = rows[0];
  if (!s || !s.mfa_verified) return null;
  await ctx.db.query("UPDATE sessions SET last_seen_at = $1 WHERE id = $2", [ctx.now(), s.id]);
  return s;
}

export function isRedActive(ctx: AppContext, s: SessionRow | null): boolean {
  return !!s?.red_until && new Date(s.red_until) > ctx.now();
}

export async function logout(ctx: AppContext, s: SessionRow) {
  await ctx.db.query("UPDATE sessions SET revoked_at = $1, red_until = NULL WHERE id = $2", [ctx.now(), s.id]);
  await audit(ctx.db, { actor: "owner", action: "auth.logout", category: "security", outcome: "success" });
}

export async function listSessions(ctx: AppContext) {
  return ctx.db.query(
    `SELECT id, created_at, expires_at, last_seen_at, ip, user_agent, red_until, revoked_at
     FROM sessions WHERE revoked_at IS NULL AND expires_at > $1 ORDER BY last_seen_at DESC`,
    [ctx.now()],
  );
}

export async function revokeSession(ctx: AppContext, id: number) {
  await ctx.db.query("UPDATE sessions SET revoked_at = $1, red_until = NULL WHERE id = $2", [ctx.now(), id]);
  await audit(ctx.db, { actor: "owner", action: "auth.session.revoke", category: "security", target: String(id), outcome: "success" });
}

export async function revokeAllOtherSessions(ctx: AppContext, keepId: number) {
  const r = await ctx.db.query("UPDATE sessions SET revoked_at = $1, red_until = NULL WHERE id <> $2 AND revoked_at IS NULL RETURNING id", [ctx.now(), keepId]);
  await audit(ctx.db, { actor: "owner", action: "auth.session.revoke_all", category: "security", outcome: "success", detail: { count: r.length } });
  return r.length;
}

/** Password change requires the current password and a fresh TOTP code. */
export async function changePassword(ctx: AppContext, input: { current: string; next: string; code: string }) {
  const owner = await getOwner(ctx);
  if (!owner) throw new HttpError(409, "setup_required", "No owner.");
  if (input.next.length < 12) throw new HttpError(400, "weak_password", "Password must be at least 12 characters.");
  if (!(await verifyPassword(input.current, owner.password_hash)) || !(await consumeTotp(ctx, owner, input.code))) {
    await audit(ctx.db, { actor: "owner", action: "auth.password.change", category: "security", outcome: "denied" });
    throw new HttpError(401, "bad_credentials", "Invalid credentials.");
  }
  await ctx.db.query("UPDATE owner SET password_hash = $1 WHERE id = 1", [await hashPassword(input.next)]);
  await audit(ctx.db, { actor: "owner", action: "auth.password.change", category: "security", outcome: "success" });
}

export { getSettings };
