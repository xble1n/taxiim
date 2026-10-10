# Architecture

## Environment assessment (Phase 1)

| Found | Implication |
|---|---|
| Repo `taxiim` = **TAXI IM**, a live TanStack Start fleet-dispatch app deployed on Vercel (`taxiim.online`) | JARVIS is built as a **separate service** in `jarvis/` so a money/permission system never shares a deploy, auth realm or attack surface with a public taxi app used by drivers. TAXI IM is also JARVIS's strongest product asset (see BUSINESS-PLAN). |
| Node 22, npm, outbound HTTPS, no system Postgres server, Docker CLI | TypeScript on Node 22 (native type stripping, no build step for the server); embedded **PGlite** (real Postgres in WASM) locally, standard Postgres via `DATABASE_URL` in production. |
| No LLM API key, no email/payment/CRM credentials | Integrations are implemented behind interfaces and report `not_configured` honestly. Nothing is mocked at runtime. |

## Stack (chosen for the simplest thing that meets the requirements)

- **Server:** Node 22 + TypeScript, Hono (HTTP), zod (validation), `@anthropic-ai/sdk`.
- **Database:** PostgreSQL schema (`migrations/`); PGlite for local/single-node, `pg` pool for managed Postgres. Full-text search via `tsvector` (no extra search service).
- **Dashboard:** React 19 + Vite + Tailwind v4 + Recharts, served by the same process in production.
- **Tests:** `node:test`, in-memory PGlite cloned from a migrated template per test.

## Components (spec §9 → code)

| # | Component | Where |
|---|---|---|
| 1 | Reasoning & orchestration | `server/agent/orchestrator.ts` (manual tool loop, `pause_turn` handling, append-only history) |
| 2 | LLM provider integration | `server/llm/provider.ts` (interface) · `server/llm/anthropic.ts` (Claude, `web_search_20260209`, server-side refusal fallback) |
| 3 | Web search & research | `server/research.ts` (cited reports: facts / assessments / assumptions / unknowns) |
| 4 | Tool execution & permissions | `server/policy/engine.ts` · `server/agent/tools.ts` |
| 5 | Memory & knowledge retrieval | `server/memory.ts` · `server/knowledge.ts` |
| 6 | Projects & tasks | `server/business/crm.ts` |
| 7 | Business engine | `server/business/opportunities.ts`, `cycle.ts` |
| 8 | CRM & pipeline | `server/business/crm.ts` |
| 9 | Revenue analytics | `server/business/ledger.ts` |
| 10 | Owner auth & RED | `server/auth/owner.ts`, `server/auth/red.ts`, `server/security/crypto.ts` |
| 11 | Audit & security monitoring | `server/audit.ts` (hash chain), `server/events.ts`, `audit_integrity` job |
| 12 | Owner dashboard | `web/src/` |
| 13 | Notifications & approvals | `notifications` table, `approvals` + `decideApproval()` |
| 14 | Scheduled tasks | `server/scheduler.ts` |
| 15 | Backup, recovery, config | `server/backup.ts`, `local_backup` job, `server/settings.ts`, `server/config.ts` |

## Request flow: a tool call

```
owner → POST /api/chat ─► orchestrator ─► LLM provider (tools = registry.specs())
                                   ◄── tool_use(name, input)
          invokeTool(): unknown? ─► denied
                        schema    ─► denied (invalid input)
                        rate      ─► denied
                        L1/L2     ─► execute → audit
                        kill sw.  ─► denied (L3/L4)
                        standing authorization (uses, amount, expiry) ─► execute
                        else      ─► approvals row (pending; L4 requires RED to approve)
          tool_result ─► LLM … final text ─► owner
```

The model never receives a tool that can change permissions, settings, RED state, or verification status. Those exist only as authenticated HTTP routes.

## Data model highlights

- Money is integer **cents**; EUR is the reporting currency; non-EUR rows require an owner-supplied FX rate.
- `transactions.verification_status` is the single gate for revenue. Rows created by JARVIS are always `unverified`.
- `audit_log` rows carry `prev_hash`/`hash` (SHA-256 over canonical JSON), serialized with a Postgres advisory lock.
- Chat history stores provider content blocks verbatim and append-only (required for correct replay of thinking/tool blocks).

## Retrieval

Postgres full-text (`simple` config, `websearch_to_tsquery`, `ts_rank`, `ts_headline`) over 1.8k-char chunks with overlap. **Planned:** pgvector + an embeddings provider for semantic retrieval (PGlite ships a `vector` extension, so the upgrade path does not change the database). Not built yet because no embeddings provider is configured.

## Scaling notes

The in-process scheduler and rate limiter assume a single instance (correct for a single-owner system). For multiple instances, set `JARVIS_SCHEDULER=off` on all but one node, or drive `runJob` from an external cron; the audit chain is already multi-process safe.
