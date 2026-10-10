# JARVIS

Private, owner-operated AI operations system: operator chat with permission-gated tools, persistent memory, cited web research, a verified-revenue business engine, and an owner dashboard — all behind owner authentication with a **RED PROTOCOL** master-control mode.

It lives in `jarvis/`, deliberately separate from the TAXI IM app at the repository root: it handles money, credentials and privileged operations, so it is deployed and secured on its own.

## Quick start (local)

```bash
cd jarvis
npm install
npm run build          # dashboard → web/dist
npm start              # API + dashboard on http://127.0.0.1:8787
```

On first start the console prints a **one-time setup token**. Open the dashboard, enter it, choose a password (≥ 12 chars), and enrol an authenticator app (TOTP). Then sign in with password + code.

Development with hot reload: `npm run dev` (API on :8787 with watch, Vite on :5173 proxying `/api`).

| Command | Purpose |
|---|---|
| `npm test` | 44 tests: auth, RED, permissions, KPIs, audit tampering, agent loop |
| `npm run typecheck` | TypeScript over server, tests and dashboard |
| `npm run build` | Production dashboard bundle |

Configuration is environment-only — see [`.env.example`](.env.example). Without `ANTHROPIC_API_KEY`, chat and web research report "not configured"; everything else works.

## What works today

| Area | Status |
|---|---|
| Owner auth (scrypt + TOTP, lockout, replay protection, session revocation) | ✅ implemented & tested |
| RED PROTOCOL (codeword + fresh TOTP step-up, session-bound, auto-expiry, revoke-all) | ✅ implemented & tested |
| Permission engine L1–L4, approvals, bounded standing authorizations, kill switch, rate limits | ✅ implemented & tested |
| Hash-chained, redacted audit log + integrity job | ✅ implemented & tested |
| Ledger with verification evidence; KPI rules (verified cash only) | ✅ implemented & tested |
| Monthly cycle, data-derived plan, non-destructive Performance Review Mode | ✅ implemented & tested |
| CRM (leads, contact basis, activities), opportunities model, drafts, invoices, projects | ✅ implemented |
| Memory (inspect / edit / pin / export / delete) with secret refusal | ✅ implemented & tested |
| Knowledge base: URL ingestion (SSRF-guarded), notes, full-text RAG with sources | ✅ implemented & tested |
| Operator chat (Claude tool loop) + web research pipeline | ✅ implemented; **live calls untested — no API key in build environment** (loop tested with a scripted provider) |
| Crypto destination workflow (unverified → RED verification; proposals only, no signing) | ✅ implemented & tested |
| Scheduler, JSON backups, integration health, LLM cost tracking | ✅ implemented |
| Dashboard (12 sections, dark UI, charts, searchable tables, mobile) | ✅ browser-verified desktop + 390px |

See [docs/TASKS.md](docs/TASKS.md) for in-progress and blocked items, and the other docs:
[ARCHITECTURE](docs/ARCHITECTURE.md) · [SECURITY](docs/SECURITY.md) · [DEPLOYMENT](docs/DEPLOYMENT.md) · [BUSINESS-PLAN](docs/BUSINESS-PLAN.md).
