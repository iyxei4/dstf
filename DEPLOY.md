# Deploying WattWise MCS (Render + Supabase)

One Render web service builds the React frontend, serves it from FastAPI, and
stores data in Supabase Postgres. **No secrets live in this repository** — every
sensitive value is a `sync: false` or generated env var in `render.yaml`.

## 1. Create the Supabase database (free)

1. Sign in at <https://supabase.com> → **New project** (choose a region near
   your Render region, e.g. Singapore).
2. Save the database password it asks for (this is the only DB secret).
3. **Project Settings → Database → Connection string → Transaction pooler**:
   - Host: `aws-0....pooler.supabase.com`
   - Port: `6543`
   - Database: `postgres`
4. Build the URL Render will use (add the `+psycopg` driver):

   ```
   postgresql+psycopg://postgres.<project-ref>:<db-password>@aws-0....pooler.supabase.com:6543/postgres?sslmode=require
   ```

No migration step needed: on first boot the app runs `create_all` and its seed
data into the empty database automatically.

## 2. Create the Render service (free)

1. <https://dashboard.render.com> → **New → Blueprint** → connect the
   `iyxei4/dstf` repo. Render reads `render.yaml` at the repo root.
2. Before the first deploy, set the env vars Render marks as pending:
   - `MCS_DATABASE_URL` — the Supabase URL from step 1
   - `MCS_ADMIN_PASSWORD` — a strong admin password (local default `mcs2026`
     is only a fallback; override it here)
   - `MCS_SESSION_SECRET` — left as `generateValue: true` (Render stores it)
3. Deploy. Build = `npm ci && npm run build` (frontend) + `pip install`
   (backend); start = `uvicorn` serving both API and UI from one origin.

## 3. Verify

- `GET /api/health` → `{"status":"ok"}`
- `GET /mcs`, `/mcs/user`, `/mcs/admin` → the React app
- Sign in to `/mcs/admin` with `MCS_ADMIN_USERNAME` / `MCS_ADMIN_PASSWORD`
- Submit one usage record as a user, then check **Buildings & rooms** shows the
  room's numbers (data now persists in Supabase)

## Notes

- **Local dev is unchanged**: no `MCS_DATABASE_URL` ⇒ SQLite file at
  `mcs/backend/wattwise.db`, `uvicorn --reload --port 8001` + Vite on 5174.
- `MCS_SECURE_COOKIES` must be the string `true` (it is, via `render.yaml`);
  cookies are `samesite=strict` and scoped to `/api`, same-origin by design.
- SSL: Supabase URL must include `?sslmode=require`.
- Free-tier note: Render free services spin down after idle; the first request
  after idle takes ~30s. Data lives in Supabase, so redeploys never lose it.
