# SmartLink Back-end (Node + Express + Prisma + MariaDB 10.4)

## Prerequisites
- Node.js 20+
- MariaDB 10.4

## Setup
1. Create env file from example:
```bash
cp .env.example .env
```

2. Create core schema:
```bash
mysql -u root -p < sql/schema.sql
```

3. Create auth session table:
```bash
mysql -u root -p < sql/auth_sessions.sql
```

4. Install dependencies:
```bash
npm install
```

5. Introspect Prisma models from existing DB:
```bash
npx prisma db pull
```

6. Generate Prisma client:
```bash
npx prisma generate
```

7. Start API:
```bash
npm run dev
```

## Environment Variables
- `HOST=0.0.0.0`
- `PORT=4000`
- `DATABASE_URL=mysql://root:@localhost:3306/smartlink`
- `API_KEY=change_me`
- `JWT_ACCESS_SECRET=replace_with_strong_secret`
- `ACCESS_TOKEN_TTL_MIN=15`
- `REFRESH_TOKEN_TTL_DAYS=7`
- `COOKIE_SECURE=false`
- `COOKIE_DOMAIN=`
- `SERVE_FRONTEND=false`
- `FRONTEND_DIST_PATH=../front-end/dist`
- `PUSH_VAPID_SUBJECT=mailto:alerts@smartlink.local`
- `PUSH_VAPID_PUBLIC_KEY=`
- `PUSH_VAPID_PRIVATE_KEY=`

## Authentication
- `POST /auth/login` (public)
- `POST /auth/refresh` (public; requires refresh cookie)
- `POST /auth/logout` (public; clears refresh cookie)
- `GET /auth/me` (requires `Authorization: Bearer <accessToken>`)

Refresh token behavior:
- Stored in `HttpOnly` cookie `sl_refresh` (path `/auth`, sameSite `lax`)
- Stored in DB as hash (`auth_sessions.refresh_token_hash`)
- Rotated on every `/auth/refresh`
- Revocable via `/auth/logout`

## API Security Model
- `/health` is public.
- `/auth/*` does not require `x-api-key`.
- `/api/*` requires JWT access token.
- Reserve `API_KEY` for explicit server-to-server routes that opt into `requireApiKey`; do not expose it to browser apps.

## Scripts
- `npm run dev` - run with nodemon
- `npm run start` - run with node
- `npm run start:with-ui` - run API and serve `front-end/dist` from Express
- `npm run start:lan` - API + UI on LAN-safe defaults (`HOST=0.0.0.0`, cookies not secure/domain-bound)
- `npm run prisma:pull` - introspect database schema
- `npm run prisma:generate` - generate Prisma client

## Cloudflared / Production Hosting
- Build frontend in `front-end` (`npm run build`).
- Set `SERVE_FRONTEND=true` in backend `.env`.
- Start backend and point Cloudflared ingress to `http://localhost:4000`.
- Full setup guide: `deploy/README.md`.

## Front-end Integration Notes
1. Call `POST /auth/login` with `{ email|phone, password }`.
2. Keep `accessToken` in memory (not localStorage).
3. Add `Authorization: Bearer <accessToken>` to business requests.
4. Use `fetch(..., { credentials: "include" })` so refresh cookie is sent automatically.
5. When access token expires, call `/auth/refresh` (also with `credentials: "include"`), then retry.

## Manual Auth Tests
See `docs/manual-test-auth.md`.

## Demand Anomaly Insights
- Apply migration: `mysql -u root -p < sql/020_demand_anomaly_detection.sql`
- New APIs:
  - `GET /api/stations/:stationPublicId/insights/demand-metrics?window=15m|1h|6h`
  - `GET /api/stations/:stationPublicId/insights/demand-anomalies?from=<ISO>&to=<ISO>`
- Station-level thresholds can be edited from Settings -> Queue Rules:
  - warning/critical z-score
  - EWMA alpha
  - persistence minutes
  - CUSUM enable + threshold
