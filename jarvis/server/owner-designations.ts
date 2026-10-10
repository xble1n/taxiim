/**
 * Values the owner designated in the JARVIS specification. Public data only.
 * The wallet is a configured destination, NOT verified: its network, asset and
 * deposit instructions must be confirmed by the owner under RED before use.
 */
export const DESIGNATED_WALLET = process.env.JARVIS_DESIGNATED_WALLET ?? "0x3ddab2dd97a234e72d09bcbda77d0519e351ecae";
