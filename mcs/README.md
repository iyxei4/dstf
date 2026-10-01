# WattWise Classrooms

A classroom electricity monitoring app for recording appliance run time, estimating energy use and cost, and comparing sections month by month. Built with React + Vite, FastAPI, and SQLAlchemy/SQLite, following the structure of the neighboring solar-energy app.

## Run locally

Start the API from `mcs/backend`:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload
```

In a second terminal, start the frontend from `mcs/frontend`:

```powershell
npm install
npm run dev
```

Open the Vite URL, usually `http://localhost:5173`. The database file is created at `backend/wattwise.db` and seeded with sample sections and appliances on first run.

## Access

- User: an administrator provisions a username and password in **Admin → User activity**. Users sign in with those credentials. Appliance **ON/OFF** controls time a run locally; switching OFF submits elapsed hours and estimated kWh.
- Admin: choose **Admin**. Local demo credentials are `admin` / `mcs2026`.

Set `MCS_ADMIN_USERNAME`, `MCS_ADMIN_PASSWORD`, and `MCS_SESSION_SECRET` before deployment. User passwords are stored as salted PBKDF2 hashes; admins can reset credentials from User activity. Set `MCS_ELECTRICITY_RATE` to the local PHP/kWh tariff (default `12`). For HTTPS deployments, set `MCS_SECURE_COOKIES=true`.

## Energy estimate

The API calculates each record as `appliance wattage × hours ÷ 1000`. Estimated cost is the resulting kWh multiplied by the configured electricity rate. These are estimates, not smart-meter readings.
