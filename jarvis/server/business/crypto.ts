import { z } from "zod";
import { audit } from "../audit.ts";
import { HttpError, type AppContext } from "../context.ts";

/**
 * Owner-designated crypto destinations (spec §5).
 * - An address is a CONFIGURED destination, not proof of ownership.
 * - Network + asset must be confirmed by the owner under RED with a typed
 *   re-entry of the address before the destination is marked verified.
 * - Nothing here signs or broadcasts transactions; no keys or seed phrases
 *   are accepted or stored anywhere in the system.
 */
export const EVM_NETWORKS = ["ethereum", "bsc", "polygon", "arbitrum", "optimism", "base", "avalanche-c"] as const;

export function isEvmAddress(a: string) {
  return /^0x[0-9a-fA-F]{40}$/.test(a);
}

const FORBIDDEN_KEYS = /private|seed|mnemonic|secret|keystore/i;

export function assertNoKeyMaterial(body: unknown) {
  if (body && typeof body === "object") {
    for (const k of Object.keys(body as object)) {
      if (FORBIDDEN_KEYS.test(k)) throw new HttpError(400, "key_material_refused", "JARVIS never accepts private keys, seed phrases or keystores.");
    }
  }
}

export const DestinationInput = z.object({
  address: z.string().refine(isEvmAddress, "Must be a 0x-prefixed 40-hex-character EVM address."),
  label: z.string().max(100).default(""),
  notes: z.string().max(1000).default(""),
});

export async function addDestination(ctx: AppContext, raw: z.input<typeof DestinationInput>) {
  assertNoKeyMaterial(raw);
  const v = DestinationInput.parse(raw);
  const [row] = await ctx.db.query<{ id: number }>(
    "INSERT INTO crypto_destinations (address, label, notes) VALUES ($1,$2,$3) ON CONFLICT (address) DO UPDATE SET label = EXCLUDED.label RETURNING id",
    [v.address.toLowerCase(), v.label, v.notes]);
  await audit(ctx.db, { actor: "owner", action: "crypto.destination.add", category: "finance", target: v.address.toLowerCase(), outcome: "success" });
  return row;
}

export const VerifyDestinationInput = z.object({
  confirm_address: z.string(),
  network: z.enum(EVM_NETWORKS),
  asset: z.string().regex(/^[A-Z0-9]{2,10}$/),
  deposit_instructions_confirmed: z.literal(true),
});

/** RED-gated at the route. */
export async function verifyDestination(ctx: AppContext, id: number, raw: z.input<typeof VerifyDestinationInput>) {
  assertNoKeyMaterial(raw);
  const v = VerifyDestinationInput.parse(raw);
  const [d] = await ctx.db.query<{ address: string }>("SELECT address FROM crypto_destinations WHERE id = $1", [id]);
  if (!d) throw new HttpError(404, "not_found", "Destination not found.");
  if (v.confirm_address.trim().toLowerCase() !== d.address) {
    await audit(ctx.db, { actor: "owner", action: "crypto.destination.verify", category: "finance", target: d.address, outcome: "denied", detail: { reason: "address_mismatch" } });
    throw new HttpError(400, "address_mismatch", "Typed address does not match the configured address.");
  }
  await ctx.db.query("UPDATE crypto_destinations SET network = $2, asset = $3, status = 'verified', verified_at = $4 WHERE id = $1", [id, v.network, v.asset, ctx.now()]);
  await audit(ctx.db, { actor: "owner", action: "crypto.destination.verify", category: "finance", target: d.address, outcome: "success", detail: { network: v.network, asset: v.asset } });
}

export async function disableDestination(ctx: AppContext, id: number) {
  await ctx.db.query("UPDATE crypto_destinations SET status = 'disabled' WHERE id = $1", [id]);
  await audit(ctx.db, { actor: "owner", action: "crypto.destination.disable", category: "finance", target: String(id), outcome: "success" });
}

export async function listDestinations(ctx: AppContext) {
  return ctx.db.query("SELECT * FROM crypto_destinations ORDER BY created_at");
}

/** Seeds the owner-designated address from spec §5 as UNVERIFIED (no network assumed). */
export async function seedDesignatedDestination(ctx: AppContext, address: string | undefined) {
  if (!address || !isEvmAddress(address)) return;
  await ctx.db.query(
    `INSERT INTO crypto_destinations (address, label, notes) VALUES ($1, 'Owner-designated proceeds wallet',
      'Described by owner as a Binance wallet. Network and deposit instructions NOT yet confirmed — do not send funds until verified.')
     ON CONFLICT (address) DO NOTHING`, [address.toLowerCase()]);
}
