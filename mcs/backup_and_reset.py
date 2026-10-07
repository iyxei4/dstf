"""Back up what the production admin API exposes, then (optionally) reset.

Usage:
    python backup_and_reset.py backup
    python backup_and_reset.py reset
"""
import json
import sys
from datetime import datetime
from pathlib import Path

import httpx

BASE = "https://wattwise-classrooms.vercel.app"
ADMIN = {"username": "admin", "password": "mcs2026"}

# The approved appliance table, in watts. Classroom set used for verification:
# 2 x Electric fan + 1 x TV + 1 x Water Dispenser = 2(55)+100+500 = 710 W,
# giving 2.84 / 5.68 / 8.52 kWh over 4 h / 8 h / 12 h.
TABLE = [
    ("Electric fan", 55),
    ("TV", 100),
    ("Printer", 100),
    ("Water Dispenser", 500),
    ("Linear Fluorescent Light", 40),
    ("Desktop Computer", 135),
]
KEEP_USERS = ["bernoulli", "11aristotle"]

OUT_DIR = Path(__file__).resolve().parent


def login(client: httpx.Client) -> None:
    response = client.post(f"{BASE}/api/admin/login", json=ADMIN)
    response.raise_for_status()


def backup() -> None:
    with httpx.Client(timeout=60, follow_redirects=True) as client:
        login(client)
        payload = {}
        for name, path in (
            ("dashboard", "/api/admin/dashboard"),
            ("rooms", "/api/admin/rooms"),
            ("sections", "/api/sections"),
            ("appliances", "/api/appliances"),
        ):
            payload[name] = client.get(f"{BASE}{path}").json()
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        target = OUT_DIR / f"production-backup-{stamp}.json"
        target.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        print("backup written:", target)
        print("users:", [u["username"] for u in payload["dashboard"]["users"]])
        print("appliances:", [a["name"] for a in payload["appliances"]])
        print("records this month:", payload["dashboard"]["record_count"])


def reset() -> None:
    body = {
        "keep_users": KEEP_USERS,
        "wipe_records": True,
        "replace_appliances": True,
        "appliances": [
            {"name": name, "wattage": watts, "quantity": 1}
            for name, watts in TABLE
        ],
    }
    with httpx.Client(timeout=120, follow_redirects=True) as client:
        login(client)
        response = client.post(f"{BASE}/api/admin/maintenance/reset", json=body)
        print("status:", response.status_code)
        print(json.dumps(response.json(), indent=2))
        response.raise_for_status()

        after = client.get(f"{BASE}/api/admin/dashboard").json()
        print()
        print("remaining users:", [u["username"] for u in after["users"]])
        print("remaining records this month:", after["record_count"])
        print("appliances now:")
        for appliance in client.get(f"{BASE}/api/appliances").json():
            print(f"  {appliance['name']:28} {appliance['wattage']:>7} W")


if __name__ == "__main__":
    action = sys.argv[1] if len(sys.argv) > 1 else "backup"
    {"backup": backup, "reset": reset}[action]()
