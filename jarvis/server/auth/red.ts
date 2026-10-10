import { audit } from "../audit.ts";
import { HttpError, type AppContext } from "../context.ts";
import { getSettings } from "../settings.ts";
import { consumeTotp, getOwner, isRedActive, type SessionRow } from "./owner.ts";

/**
 * RED PROTOCOL — privileged master-control mode.
 *
 * "RED" only *selects* the mode. Activation additionally requires:
 *   1. an authenticated owner session (password + TOTP at login), and
 *   2. a fresh, never-before-used TOTP code (step-up verification).
 * The mode expires after `red_ttl_minutes` and is bound to one session.
 * There is no code path by which model output, chat content, documents,
 * emails or web pages can activate it: the only entry point is the
 * authenticated HTTP endpoint that calls activateRed().
 */
export const RED_CODEWORD = "RED";

export async function activateRed(ctx: AppContext, session: SessionRow, input: { codeword: string; code: string }) {
  if (input.codeword !== RED_CODEWORD) {
    await audit(ctx.db, { actor: "owner", action: "red.activate", category: "security", outcome: "denied", detail: { reason: "codeword" } });
    throw new HttpError(400, "bad_codeword", "Codeword not recognised.");
  }
  const owner = await getOwner(ctx);
  if (!owner || !(await consumeTotp(ctx, owner, input.code))) {
    await audit(ctx.db, { actor: "owner", action: "red.activate", category: "security", outcome: "denied", detail: { reason: "totp" } });
    throw new HttpError(401, "bad_code", "Verification failed. Use a new authenticator code (each code works once).");
  }
  const { red_ttl_minutes } = await getSettings(ctx.db);
  const until = new Date(ctx.now().getTime() + red_ttl_minutes * 60_000);
  await ctx.db.query("UPDATE sessions SET red_until = $1 WHERE id = $2", [until, session.id]);
  await audit(ctx.db, {
    actor: "owner", action: "red.activate", category: "security", outcome: "success", detail: { session: session.id, until: until.toISOString() },
  });
  return { redUntil: until };
}

export async function deactivateRed(ctx: AppContext, session: SessionRow) {
  await ctx.db.query("UPDATE sessions SET red_until = NULL WHERE id = $1", [session.id]);
  await audit(ctx.db, { actor: "owner", action: "red.deactivate", category: "security", outcome: "success" });
}

/** Revokes RED on every session (owner panic button). */
export async function revokeAllRed(ctx: AppContext) {
  await ctx.db.query("UPDATE sessions SET red_until = NULL WHERE red_until IS NOT NULL");
  await audit(ctx.db, { actor: "owner", action: "red.revoke_all", category: "security", outcome: "success" });
}

export async function requireRed(ctx: AppContext, session: SessionRow | null, action: string) {
  if (!isRedActive(ctx, session)) {
    await audit(ctx.db, { actor: "owner", action, category: "security", outcome: "denied", detail: { reason: "red_required" } });
    throw new HttpError(403, "red_required", "RED PROTOCOL authentication required for this operation.");
  }
}
