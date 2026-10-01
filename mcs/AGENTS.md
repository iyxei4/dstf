# WattWise MCS Agent Notes

## Project

WattWise Classrooms is a classroom electricity monitoring app. The app is a React 19 + Vite frontend backed by a FastAPI and SQLAlchemy API, with SQLite by default. Keep changes inside this `mcs` project unless explicitly asked to modify the neighboring `solar-energy` project.

## Routes and surfaces

- `/mcs`: role chooser.
- `/mcs/user`: credential sign-in, assigned-room appliance log, timed ON/OFF usage, and recent submissions.
- `/mcs/admin`: admin dashboard, six-month reports, buildings/rooms map, user credentials and room assignment, and catalog management.

## Data rules

- Admin credentials default locally to `admin` / `mcs2026`; deployment should set `MCS_ADMIN_USERNAME`, `MCS_ADMIN_PASSWORD`, and `MCS_SESSION_SECRET`.
- Admins issue user credentials from Admin > User activity. Passwords are PBKDF2-SHA256 hashes. Keep user and admin APIs session-protected.
- A user has at most one assigned room. User usage submissions must target that assigned room; the backend enforces this.
- Rooms are seeded as 3 buildings × 4 floors × 5 rooms. Room number `403` means floor 4, room 3 from the left.
- Room consumption and unique appliance counts use the trailing 30 days. A room is high-use at 1.5× its building's per-room average; otherwise it is average-use.
- Energy is estimated as appliance watts × hours ÷ 1000. Keep the estimate disclaimer; this app has no physical appliance control or meter telemetry.
- Do not delete an appliance with usage history. Keep the backend conflict response and surface it in the UI.

## Frontend conventions

- Reuse the existing React components and CSS tokens in `frontend/src/App.jsx` and `frontend/src/styles.css`.
- The light/dark preference is stored as `wattwise-theme` in localStorage and applied with `document.documentElement.dataset.theme`; keep all routes readable in both modes.
- Appliance ON/OFF timers are local browser timers, keyed by user account. Stopping sends elapsed hours and the assigned room to the API.

## Local development and checks

From `mcs/backend`, activate a Python environment, install `requirements.txt`, then run `uvicorn app.main:app --reload --port 8001` when port 8000 is occupied by the neighboring app.

From `mcs/frontend`, run `npm install`, `npm run dev -- --port 5174`, `npm run lint`, and `npm run build`. Vite proxies `/api` to `127.0.0.1:8001`.
