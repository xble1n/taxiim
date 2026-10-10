# Security plan & threat model

## Assets

Owner account and sessions · RED authority · ledger integrity (the KPI) · permission configuration · crypto destination configuration · memory/knowledge (business-sensitive) · provider API keys.

## Owner authentication

| Control | Implementation |
|---|---|
| First-run bootstrap | One-time setup token (env `JARVIS_SETUP_TOKEN` or random, printed once to the server console, never stored). Setup locks permanently after TOTP enrolment. |
| Password | scrypt (N=2¹⁵, r=8, p=1), ≥ 12 chars, NFKC-normalised. |
| Second factor | TOTP (RFC 6238, verified against RFC test vectors). Secret encrypted at rest with AES-256-GCM using `JARVIS_MASTER_KEY`. |
| Replay protection | Each 30-s TOTP step is single-use (`owner.last_totp_step`), across login, RED and password change. |
| Brute force | 5 failures → 15-min lockout; per-IP limit on unauthenticated endpoints. |
| Sessions | 256-bit random token in an `HttpOnly; SameSite=Strict; Secure` (prod) cookie; only its SHA-256 is stored; TTL configurable; list/revoke/revoke-all-others. |
| CSRF | Mutating `/api` calls require `X-Jarvis-Request: 1` (forces CORS preflight) + SameSite=Strict. |
| Headers | Strict CSP (`script-src 'self'`, `frame-ancestors 'none'`), `X-Frame-Options: DENY`, `nosniff`, HSTS in production, `no-store` on API. |

## RED PROTOCOL

- **RED is a mode selector, not a credential.** Activation = authenticated owner session **+** codeword `RED` **+** a fresh, unused TOTP code.
- Bound to the activating session; expires after `red_ttl_minutes` (default 15); "Exit RED" and "Revoke RED on all sessions" are always available.
- Typing `RED` in operator chat never reaches the model: the server returns a step-up challenge and the UI opens the verification dialog.
- **No code path** lets model output, chat text, web pages, documents or emails activate RED; the only entry point is `POST /api/red/activate` on an authenticated session. The agent has no tool for RED, permissions, settings or verification.

RED-gated operations: verify/reject ledger rows · change settings · grant standing authorizations · disengage kill switch · add/verify crypto destinations · approve LEVEL 4 actions · bulk-delete memory · full backup export.

Always available **without** RED (fail-safe direction): engage kill switch, revoke authorizations, revoke sessions, revoke RED, disable crypto destinations, reject approvals.

## Permission levels (enforced in `server/policy/engine.ts`)

| Level | Behaviour |
|---|---|
| L1 READ | Executes. |
| L2 PREPARE | Executes; internal records/drafts only (nothing leaves the system). |
| L3 EXECUTE | Needs a standing authorization (max uses, optional per-use € cap, expiry) or owner approval. |
| L4 PRIVILEGED | Owner approval inside RED; standing grants only with a € cap and ≤ 7-day expiry. |

Plus: kill switch (halts all L3/L4 including approved ones), per-minute rate limit, per-tool timeout, per-turn tool-call budget, monthly LLM budget, approval expiry, input re-validation at approval time, no double execution.

## Threat model (STRIDE, abridged)

| Threat | Mitigation | Residual risk |
|---|---|---|
| Prompt injection via web/doc content tries to make JARVIS act | Untrusted tool results are wrapped and labelled; enforcement is server-side; injected instructions can at most request tools, which pass the same gates. | A model could still *draft* misleading text; drafts are never sent automatically. |
| Stolen session cookie | HttpOnly/Strict cookie, short TTL, revocation; privileged ops need a fresh TOTP (RED). | Attacker with cookie can read data until revoked. Passkeys are planned. |
| Observed TOTP code | Single-use steps. | Real-time phishing of password+code; mitigated later by WebAuthn. |
| Inflating revenue / KPI fraud | Only owner-verified rows count; verification needs RED + evidence; every change audited. | Owner can mis-verify; evidence field is the audit trail. |
| Tampering with audit history | SHA-256 hash chain + daily integrity job + alert. | A DB superuser could rewrite the whole chain; export audit logs off-box for stronger guarantees. |
| Secret leakage | Env-only config; `redact()` on logs/audit/tool results; memory & knowledge refuse credential-like content and seed phrases; backups exclude credentials. | Heuristics can miss novel secret formats. |
| SSRF via URL ingestion | Scheme allow-list; private, loopback, link-local and metadata hosts blocked. | DNS-rebinding to private IPs is not resolved-IP checked yet (TASKS). |
| Crypto misdirection | Address never assumed verified; network+asset confirmed under RED with typed address re-entry; no key material accepted; no signing code exists. | Owner must confirm the deposit network on the exchange. |
| Runaway cost / automation | LLM monthly budget, rate limits, tool-call budget, kill switch. | — |

## Secrets

`JARVIS_MASTER_KEY`, `ANTHROPIC_API_KEY`, `DATABASE_URL` belong in the host's secret manager. Never commit `.env`. Rotating the master key requires re-enrolling TOTP (documented in DEPLOYMENT).
