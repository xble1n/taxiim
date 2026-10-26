# TAXI IM

Internal fleet desk for one company. Dispatchers use the control center. Drivers use the phone layout. It is not a public booking app.

There is no Java, Spring, Maven, or STOMP process in this repository. The server and the interface are one TypeScript application (TanStack Start, React, Vite). Live fleet updates are authenticated HTTP polling, not a held WebSocket. A browser cannot keep GPS running after the phone is locked.

## Requirements

- Node.js 22 or newer
- npm 10 or newer

Postgres is optional. With no `DATABASE_URL`, the app stores data in embedded PGLite and applies `migrations/` on startup.

## Install and run

```bash
cd taxiim
npm install
npm run dev
```

Open http://localhost:8080

The dev server listens on `0.0.0.0:8080`. Do not start Vite directly. `npm run dev` loads `.grok/app-env.json` first.

Other commands:

```bash
npm test              # app unit tests
npm run test:platform # Grok template tooling tests (some assert the blank template's defaults)
npm run typecheck
npm run lint
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
| `BETTER_AUTH_TRUSTED_ORIGINS` | Optional extra sign-in origins, comma separated. |
| `TAXI_ADMIN_EMAIL` | Administrator login. Required with `DATABASE_URL`. |
| `TAXI_ADMIN_PASSWORD` | Administrator password (8–72 chars, a letter and a number). Required with `DATABASE_URL`. |
| `TAXI_ADMIN_NAME` | Optional administrator display name. |
| `TAXI_DRIVER_LOGINS` | Optional JSON `[{"name","email","password"}]`. Sets those drivers' login email/password once per change (matched by email, else by name; missing drivers are created). |
| `TAXI_DEMO_PASSWORD` | Optional. Creates the sample driver logins with this password. Leave empty in production. |
| `VITE_AUTH_ENABLED` | Set to `false` only to force auth off. |

If `MAPBOX_ACCESS_TOKEN` is unset, driving directions use the public OSRM service (road network, no live traffic) and the map uses Esri imagery through `src/routes/api/tiles.ts`. Street search uses Photon, then Nominatim, limited to Vushtrri, Mitrovica, and Prishtina, with a short cache. Borders are in `src/lib/taxi/kosovo-borders.json`.

## Accounts

A fresh local database (PGLite, no `DATABASE_URL`) creates the administrator `admin@taxiim.local` / `Admin-dev-2026` and five sample drivers (`gazmend@taxiim.local`, `florim@`, `altin@`, `liridon@`, `almedin@`, password `Fleet-demo-26`) with sample orders. These development logins exist only on a local embedded database, never on a deploy.

Public sign-up is disabled. Every staff login is created by an administrator under **Accounts**, or from `TAXI_ADMIN_*` on the server.

With `DATABASE_URL` set (production), nothing is seeded except the administrator from `TAXI_ADMIN_EMAIL` / `TAXI_ADMIN_PASSWORD`. Sign in with that account, then add real drivers under **Accounts**. Changing `TAXI_ADMIN_PASSWORD` and redeploying resets the administrator password.

## Deploy to Vercel

1. Create a Postgres database (Neon, Supabase, Vercel Postgres, …) and copy its connection string.
2. In the Vercel project, set `DATABASE_URL`, `BETTER_AUTH_SECRET` (`openssl rand -hex 32`), `BETTER_AUTH_URL` (e.g. `https://www.taxiim.online`), `TAXI_ADMIN_EMAIL` and `TAXI_ADMIN_PASSWORD`. Optionally `MAPBOX_ACCESS_TOKEN`.
3. Deploy. `npm run build` applies `migrations/*.sql` to the database when `DATABASE_URL` is available at build time.
4. Open the site, sign in as the administrator, and create driver accounts under **Accounts**. Drivers open the same site on their phones.

Drivers cannot open the administrator desk, change prices, or see other drivers' statistics.

## Driver-registered rides

Drivers open **Orders → Register direct ride** for a passenger they picked up themselves. Pickup can come from the phone's GPS ("Use my current location as pickup"), a search suggestion, a typed address or a saved price-book destination. Tick **The passenger already got out** to record a finished trip (also possible while another ride is open); otherwise the ride starts live. The order is saved as source `DIRECT` under the signed-in driver, priced with the desk's fare rules, and raises an admin alert and an activity entry. Admins see it in **Orders** as "Driver-registered" (filter: All sources → Driver-registered), in reports and on the dashboard. Each form carries one request id, so double taps and retries cannot create a second order.

## Windows, Android and iOS apps

See [`apps/README.md`](apps/README.md). GitHub Actions (**Native apps**) builds the Windows installer, Android APK/AAB and an unsigned iOS archive.

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
