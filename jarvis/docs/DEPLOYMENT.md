# Deployment

JARVIS is a single long-running Node process (API + dashboard + scheduler). It is **not** a fit for the serverless Vercel project that hosts TAXI IM; deploy it to a small VM or container host (Fly.io, Railway, Render, a Hetzner VPS, …) behind HTTPS.

## Requirements

- Node ≥ 22.12, or the provided `Dockerfile`
- PostgreSQL 15+ recommended for production (`DATABASE_URL`); PGlite on a persistent volume works for a single node
- HTTPS termination (the session cookie is `Secure` in production)

## Environment

| Variable | Required | Notes |
|---|---|---|
| `NODE_ENV=production` | yes | Enables Secure cookies + HSTS; requires `JARVIS_MASTER_KEY`. |
| `JARVIS_MASTER_KEY` | yes | 32 random bytes, base64. Encrypts the TOTP secret. |
| `JARVIS_SETUP_TOKEN` | first run | Otherwise a random token is printed to logs once. |
| `DATABASE_URL` | recommended | Unset → PGlite under `JARVIS_DATA_DIR`. |
| `JARVIS_DATA_DIR` | with PGlite | Must be a persistent volume. |
| `ANTHROPIC_API_KEY` | for chat/research | Model defaults to `claude-opus-5-5`, effort `medium`. |
| `HOST` / `PORT` | | Use `HOST=0.0.0.0` in containers. |
| `JARVIS_SCHEDULER=off` | multi-instance | Run the scheduler on exactly one node. |

## Steps

```bash
cd jarvis
npm ci
npm run build
NODE_ENV=production JARVIS_MASTER_KEY=... DATABASE_URL=... HOST=0.0.0.0 npm start
```

Migrations in `migrations/` are applied automatically at boot, once each, inside a transaction.

Docker:

```bash
docker build -t jarvis jarvis/
docker run -p 8787:8787 --env-file jarvis.env -v jarvis-data:/app/.data jarvis
```

## Backups & recovery

- **Managed Postgres:** enable provider point-in-time recovery (PITR) and daily snapshots. This is the primary backup.
- **PGlite:** the `local_backup` job writes a daily JSON snapshot to `$JARVIS_DATA_DIR/backups` (keeps 14). Also snapshot the volume.
- **Owner export:** Settings → Backup (RED) downloads a full logical export (no credentials).
- **Restore drill:** start a fresh instance against a restored database; verify `GET /api/audit/verify` returns `ok: true` and the dashboard KPIs match the last export.

## Monitoring

- `GET /api/health` for uptime checks (public, returns `{ ok: true }` only).
- System events (errors, job failures) and notifications in the dashboard; the `audit_integrity` job alerts on chain breaks.
- LLM spend: Operations → LLM usage; hard cap via `llm_monthly_budget_usd`.

## Rollback

Deploy immutable images tagged by git SHA. Roll back by redeploying the previous tag. Migrations are additive; never deploy a destructive migration without a tested backup and a down-path.

## Rotating the master key

1. Engage the kill switch. 2. Set a new `JARVIS_MASTER_KEY`. 3. Run first-run setup again with a new setup token to re-enrol TOTP: the old encrypted secret can no longer be decrypted, and setup re-opens only by clearing `owner.totp_enabled` directly in the database, which is a deliberate, out-of-band owner action.
