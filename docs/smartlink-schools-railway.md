# SmartLink Schools Railway Test Deployment

Railway failed because it built this repository from `/`, which is a mixed workspace. Deploy SmartLink Schools as three Railway services from the same GitHub repo instead of splitting repositories.

## Services

Create an empty Railway project, then add these services:

| Railway service | Root Directory | Config file path |
| --- | --- | --- |
| `smartlink-schools-api` | `/smartlink-schools/server` | `/smartlink-schools/server/railway.toml` |
| `smartlink-schools-web` | `/smartlink-schools/client` | `/smartlink-schools/client/railway.toml` |
| `timetable-solver` | `/services/timetable-solver` | `/services/timetable-solver/railway.toml` |

Railway's monorepo support expects each isolated app to have its own Root Directory. Do not deploy this repository from `/` for this test app.

## Required Variables

### `smartlink-schools-api`

Set:

```bash
DATABASE_URL=<railway-mysql-connection-url>
JWT_SECRET=<long-random-secret>
CORS_ORIGIN=https://<smartlink-schools-web>.up.railway.app
TIMETABLE_SOLVER_URL=http://timetable-solver.railway.internal:7317
TIMETABLE_SOLVER_INTERNAL_TOKEN=<same-secret-as-solver>
AI_ENABLED=false
SCHOOL_TIMEZONE=Africa/Blantyre
```

Add `GEMINI_API_KEY`, `AI_ENABLED=true`, and the Gemini variables later if you want AI features during testing.

### `smartlink-schools-web`

Set this before building the frontend:

```bash
VITE_SCHOOLS_API_BASE_URL=https://<smartlink-schools-api>.up.railway.app
```

If you change the API domain, redeploy the web service so Vite rebuilds with the new value.

### `timetable-solver`

Set:

```bash
PORT=7317
TIMETABLE_SOLVER_INTERNAL_TOKEN=<same-secret-as-api>
TIMETABLE_SOLVER_LOG_LEVEL=INFO
```

If you name the solver service something other than `timetable-solver`, replace `timetable-solver.railway.internal` with that service's internal Railway hostname.

## Database Setup

The API does not currently auto-run database setup. For a fresh Railway MySQL database, apply the consolidated schema with the helper script:

```bash
cd smartlink-schools/server
DATABASE_URL='mysql://USER:PASSWORD@HOST:PORT/DATABASE' npm run db:apply -- database/schema.sql
```

For a realistic demo, load seed data after the schema:

```bash
DATABASE_URL='mysql://USER:PASSWORD@HOST:PORT/DATABASE' npm run db:apply -- database/seed.sql
```

Use Railway's MySQL connection string from the database service. The helper removes local-only `CREATE DATABASE smartlink_schools` and `USE smartlink_schools` statements so the SQL loads into Railway's actual database.

Do not run demo seed files against production data.

## Why Not Split Repositories?

Splitting is possible, but it is not the best first fix. The API and solver share request contracts and an internal auth token, so keeping them in one repo avoids version drift. Railway already supports this with Root Directory per service.

If Railway still builds from `/`, the service is configured incorrectly. Check the Root Directory first.
