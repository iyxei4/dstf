# Deploying WattWise Classrooms (mcs)

**Live:** https://wattwise-classrooms.vercel.app

## Architecture (Vercel)

One project, two services (see `vercel.json`):

| Service | Root          | What it is                              | Routing                    |
| ------- | ------------- | --------------------------------------- | -------------------------- |
| `web`   | `mcs/frontend` | Vite build → static files + SPA fallback | everything else `/(.*)`     |
| `api`   | `mcs/backend`  | FastAPI serverless function (`app.main:app`) | `/api/(.*)`            |

The function sees the **original path** (`/api/health` arrives as `/api/health`),
so FastAPI routes need no prefix changes. Cookies are same-origin
(`path=/api`, `samesite=strict`, `secure`) and work across both services.

The backend runs `create_all` + seed eagerly at import (serverless platforms may
never fire FastAPI startup events) — see the end of `mcs/backend/app/main.py`.

## Environment variables (never committed)

Set with `vercel env add <NAME> production` or in the dashboard
(Project → Settings → Environment Variables):

| Name                 | Purpose                                              |
| -------------------- | ---------------------------------------------------- |
| `MCS_DATABASE_URL`   | Postgres URL (Supabase). **See "Database" below.**   |
| `MCS_SESSION_SECRET` | HMAC key for session cookies — random 64-char hex    |
| `MCS_ADMIN_PASSWORD` | Admin login password                                 |
| `MCS_ADMIN_USERNAME` | Admin login name (default `admin`)                   |
| `MCS_SECURE_COOKIES` | `true` on Vercel (HTTPS)                             |

`.gitignore` keeps `.env`, `*.db`, `.vercel/` and `solar-energy/` out of git;
`.vercelignore` keeps them out of deploy uploads.

## Database — read this

- **Now:** no `MCS_DATABASE_URL` → SQLite at `/tmp/wattwise.db`. The app works,
  but **all data resets on every cold start** (each fresh instance re-seeds).
- **For real data:** attach Supabase (free):
  1. supabase.com → new project → Connect → **Transaction pooler** (port 6543)
  2. Format (SQLAlchemy needs the `postgresql+psycopg` scheme):
     `postgresql+psycopg://postgres.<ref>:<password>@aws-0.<region>.pooler.supabase.com:6543/postgres?sslmode=require`
  3. `vercel env rm MCS_DATABASE_URL production` then
     `vercel env add MCS_DATABASE_URL production` (paste the URL)
  4. `vercel deploy --prod`

  First boot against an empty database creates + seeds all tables itself.

## Deploying

```powershell
npm install -g vercel   # once
vercel login           # once (GitHub device flow)
vercel link --project wattwise-classrooms   # once
vercel deploy --prod
```

Local verification before deploying (optional):

```powershell
vercel pull --yes --environment production
vercel build --yes --target production     # needs uv (https://astral.sh/uv)
```

**Auto-deploy on push:** run `vercel git connect` and pick `iyxei4/dstf` —
every push to `main` then deploys automatically.

## Deployment protection

New Vercel projects wall deployments behind Vercel login. This project's wall
was removed via `PATCH /v9/projects/... { "ssoProtection": null }`. If it ever
reappears (dashboard: Settings → Deployment Protection → **Disabled** for
public access), anonymous visitors get a login page instead of the app.

## Alternative: Render + Supabase

`render.yaml` (root) describes the same app as a single Render web service
serving FastAPI + the built frontend — kept as a fallback. It needs
`MCS_DATABASE_URL` (Supabase) and `MCS_ADMIN_PASSWORD` set in the Render
dashboard; see the blueprint for details.
