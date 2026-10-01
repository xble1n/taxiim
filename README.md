# TAXI IM

Internal fleet desk for one company. Dispatchers use the control center. Drivers use the phone layout. It is not a public booking app.

There is no Java, Spring, Maven, or STOMP process in this repository. The server and the interface are one TypeScript application (TanStack Start, React, Vite). Live fleet updates are authenticated HTTP polling, not a held WebSocket. A browser cannot keep GPS running after the phone is locked.

## Requirements

- Node.js 22 or newer
- npm 10 or newer

Postgres is optional. With no `DATABASE_URL`, the app stores data in embedded PGLite and applies `migrations/` on startup.

## Install and run

```bash
cd taxi-im-final
npm install
npm run dev
```

Open http://localhost:8080

The dev server listens on `0.0.0.0:8080`. Do not start Vite directly. `npm run dev` loads `.grok/app-env.json` first.

Other commands:

```bash
npm test
npm run typecheck
npm run build
npm run db:migrate
```

`npm run db:migrate` applies `migrations/*.sql` only when `DATABASE_URL` is set. Without that variable it does nothing, and PGLite migrates itself.

## Configuration

Copy `.env.example` and set values in the environment. Do not put secrets in the example file.

| Name | Role |
|---|---|
| `DATABASE_URL` | Postgres. Unset means embedded PGLite. |
| `MAPBOX_ACCESS_TOKEN` | Optional. Server-only. Traffic-aware routing and Mapbox tiles. |
| `MAP_API_KEY` | Optional alias for the same token. |
| `BETTER_AUTH_SECRET` | Session signing secret for a deployed origin. |
| `BETTER_AUTH_URL` | Public origin, for example `https://your-host`. |
| `VITE_AUTH_ENABLED` | Set to `false` only to force auth off. |

If `MAPBOX_ACCESS_TOKEN` is unset, driving directions use the public OSRM service (road network, no live traffic) and the map uses Esri imagery through `src/routes/api/tiles.ts`. Street search uses Photon, then Nominatim, limited to Vushtrri, Mitrovica, and Prishtina, with a short cache. Borders are in `src/lib/taxi/kosovo-borders.json`.

## Accounts

A fresh local database creates one administrator and the driver roster in `src/lib/taxi/handlers.server.ts`. Those seed passwords are development defaults. Change them before any shared or deployed use. They are not written into `.env`.

Drivers cannot open the administrator desk, change prices, or see other drivers' statistics.

## Map, GPS, and live updates

- Map styles: Map, Satellite, Hybrid. The desk opens on satellite.
- Markers move between real GPS samples only. The timestamp is the sample time.
- The desk refreshes fleet positions on a short poll. This deployment does not keep a WebSocket open.
- The phone sends location only while the page is open and the driver is online.

## PWA

`scripts/grok-pwa-plugin.mjs` and `server/middleware/grok-pwa.ts` serve `/__grok/manifest.webmanifest`, icons under `public/__grok/`, and the install page. The document shell links the manifest from `src/routes/__root.tsx`.

## Database

SQL migrations, in order:

- `migrations/0001_auth.sql`
- `migrations/0002_taxi.sql`
- `migrations/0003_fleet.sql`
- `migrations/0004_offers.sql`

`migrations/auth/0001_auth.sql` is the auth schema reference and is not applied by the app glob.

## What this archive does not contain

- `node_modules`, build output, or IDE caches
- A `.env` file, API keys, or production tokens
- Java sources, `pom.xml`, Maven wrappers, or `application.yml` (none exist in the project)
- A WebSocket/STOMP configuration (none exists; updates are HTTP)

The Grok sandbox preview OAuth client secret is not included. Local email and password sign-in does not need it. Set `GROK_AUTH_CLIENT_SECRET` only if you connect this app to that broker.
