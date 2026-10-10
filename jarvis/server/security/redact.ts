/**
 * Secret hygiene. Everything that is logged, audited, or returned to the
 * model passes through redact(). detectSecret() blocks secrets from being
 * stored in memory/knowledge in the first place.
 */
const SENSITIVE_KEY = /pass(word)?|secret|token|api[_-]?key|authorization|cookie|totp|otp|private[_-]?key|seed|mnemonic|signing/i;

const SECRET_PATTERNS: [RegExp, string][] = [
  [/sk-ant-[A-Za-z0-9_-]{10,}/g, "[REDACTED:anthropic-key]"],
  [/\bsk-[A-Za-z0-9]{20,}/g, "[REDACTED:api-key]"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, "[REDACTED:github-token]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED:aws-key]"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED:private-key]"],
  [/\b(xox[abpr]-[A-Za-z0-9-]{10,})/g, "[REDACTED:slack-token]"],
  [/\b(postgres(ql)?:\/\/[^:\s]+:)[^@\s]+@/g, "$1[REDACTED]@"],
];

export function redactString(s: string): string {
  let out = s;
  for (const [re, rep] of SECRET_PATTERNS) out = out.replace(re, rep);
  return out;
}

export function redact<T>(value: T, depth = 0): T {
  if (depth > 8) return "[TRUNCATED]" as T;
  if (typeof value === "string") return redactString(value) as T;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1)) as T;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? "[REDACTED]" : redact(v, depth + 1);
    }
    return out as T;
  }
  return value;
}

/** Heuristic detection of secrets that must never be persisted as memory/knowledge. */
export function detectSecret(text: string): string | null {
  if (redactString(text) !== text) return "credential-like token";
  // A 12/24-word lowercase phrase is the shape of a BIP-39 seed phrase.
  if (/\b(seed|mnemonic|recovery)\s*(phrase|words)?\s*[:=]/i.test(text)) return "seed phrase";
  const words = text.trim().split(/\s+/);
  if ((words.length === 12 || words.length === 24) && words.every((w) => /^[a-z]{3,8}$/.test(w))) {
    return "possible seed phrase";
  }
  if (/\bprivate\s*key\b[^\n]{0,20}\b(0x)?[0-9a-fA-F]{64}\b/i.test(text)) return "private key";
  return null;
}
