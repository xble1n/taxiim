# Task list

## Completed
- [x] Environment discovery and architecture (docs/ARCHITECTURE.md)
- [x] Schema and migrations; PGlite / Postgres driver abstraction
- [x] Owner auth: scrypt, TOTP enrolment, lockout, replay protection, sessions, CSRF, security headers
- [x] RED PROTOCOL with step-up TOTP, expiry, revoke-all; chat `RED` interception
- [x] Permission engine L1–L4, approvals, standing authorizations, kill switch, rate limits, timeouts
- [x] Hash-chained audit log + integrity job; redaction; system events; notifications
- [x] Ledger, verification, KPI rules, monthly cycle, plan, Performance Review Mode
- [x] CRM, opportunities model, drafts, invoices, projects/tasks
- [x] Memory CRUD/export/delete with secret refusal; knowledge base (URL ingest + FTS RAG)
- [x] Anthropic provider, agent tool loop, research pipeline (tested with a scripted provider)
- [x] Crypto destination workflow (unverified seed, RED verification, payout proposals only)
- [x] Scheduler, backups, integration health, LLM cost tracking and budget
- [x] Dashboard: 12 sections, verified in a real browser (desktop + 390 px, no console errors)
- [x] 44 automated tests passing; typecheck and production build passing

## Blocked (needs owner input or credentials)
- [ ] **Live LLM verification**: needs `ANTHROPIC_API_KEY`. The chat and research code paths are implemented but have not been exercised against the live API.
- [ ] **Crypto destination network**: the owner must confirm the exact network and asset (e.g. USDT on BSC or Ethereum) from the exchange deposit page, then verify it under RED.
- [ ] **Outbound email**: choose a provider (Postmark, SES, or SMTP) and supply credentials. Until then approved drafts are sent manually.
- [ ] **Payments import**: Stripe or bank feed credentials to import (still owner-verified) transactions.
- [ ] **Production hosting**: pick a host and provision Postgres + HTTPS (docs/DEPLOYMENT.md).

## Next (prioritised)
1. Passkeys (WebAuthn) as an additional or alternative second factor for login and RED.
2. SSRF hardening: resolve DNS and block private IPs after resolution (DNS rebinding).
3. Semantic retrieval: pgvector + embeddings provider.
4. Email integration as a LEVEL 3 tool behind the existing approval gate.
5. Streaming chat responses in the dashboard.
6. Off-box audit log shipping (append-only bucket) for stronger tamper evidence.
7. LLM-drafted Performance Review narrative and recovery-plan proposal, kept as a draft for owner approval.
8. Invoice PDF generation, reusing the TAXI IM report-pdf approach.
