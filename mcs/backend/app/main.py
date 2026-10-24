from calendar import day_name, monthrange
from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import os
from pathlib import Path
import re
import secrets
import sys
import threading
import time
from typing import Literal

from urllib.parse import quote, urlencode

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy import String, cast, delete, func, inspect, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, load_only, selectinload

from app.database import Base, SessionLocal, engine
from app.db_models import Appliance, ClassroomRoom, ClassroomSection, ClassroomUser, UsageRecord, utc_now

app = FastAPI(title="WattWise Classroom Energy API", version="1.0.0")
app.add_middleware(GZipMiddleware, minimum_size=500)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    """Apply baseline browser hardening to every response.

    React escapes rendered values, so this CSP blocks injected inline scripts
    and foreign origins while still allowing the bundled app and its styles.
    """
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault(
        "Permissions-Policy", "camera=(), microphone=(), geolocation=()"
    )
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; img-src 'self' data:; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src 'self' data: https://fonts.gstatic.com; script-src 'self'; "
        "connect-src 'self' ws: wss:; frame-ancestors 'self'; "
        "base-uri 'self'; form-action 'self'",
    )
    return response


# Independent read queries run concurrently, each on its own session, so a
# dashboard no longer pays for its queries one after the other.
_read_pool = ThreadPoolExecutor(max_workers=6, thread_name_prefix="wattwise-read")
ADMIN_USERNAME = os.getenv("MCS_ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.getenv("MCS_ADMIN_PASSWORD", "mcs2026")
# Demo admins that can sign in alongside the env-configured account above.
ADMIN_ACCOUNTS = {
    ADMIN_USERNAME: ADMIN_PASSWORD,
    "dstf": "123",
    "dstf-live": "123",
    "interactive-admin": "123",
}
SESSION_SECRET = os.getenv("MCS_SESSION_SECRET", "development-secret-change-before-deploy")
ELECTRICITY_RATE = float(os.getenv("MCS_ELECTRICITY_RATE", "12"))
SESSION_COOKIE = "wattwise_admin"
USER_SESSION_COOKIE = "wattwise_user"
SESSION_SECONDS = 8 * 60 * 60
PASSWORD_ITERATIONS = 310_000

# OAuth configuration
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
GITHUB_CLIENT_ID = os.getenv("GITHUB_CLIENT_ID", "")
GITHUB_CLIENT_SECRET = os.getenv("GITHUB_CLIENT_SECRET", "")
FRONTEND_URL = os.getenv("MCS_FRONTEND_URL", "http://localhost:5174")

# OAuth provider endpoints
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"
GITHUB_AUTH_URL = "https://github.com/login/oauth/authorize"
GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"
GITHUB_USERINFO_URL = "https://api.github.com/user"
# Single source of truth for energy precision. kWh is rounded once to this many
# decimals and every bill is derived from that already-rounded value, so a
# client showing "0.1875 kWh x 12" always gets the ₱2.25 the API reports.
KWH_PRECISION = 4
# Extended-use / anomaly thresholds. A session counts as extended-use at or
# above a full school day; it counts as unusual past twice the appliance's
# all-time mean, requiring a minimum history before the comparison applies.
EXTENDED_USE_HOURS = 8.0
UNUSUAL_USE_MULTIPLE = 2.0
UNUSUAL_USE_MIN_SESSIONS = 3


def _run_parallel(tasks: list[Callable[[], object]]) -> list[object]:
    """Run independent read queries at the same time and collect the results.

    SQLite runs in WAL mode, so several readers can work at once while a
    writer commits. Each task therefore opens its own session; they never
    share one, which is what makes them safe to overlap. The pool is shared
    across requests so a burst of dashboards does not spawn a thread per task.
    """
    if len(tasks) == 1:
        return [tasks[0]()]
    futures = [_read_pool.submit(task) for task in tasks]
    return [future.result() for future in futures]


class _SingleFlight:
    """Collapse concurrent identical reads onto one computation.

    When several admins open the console at once, or a dashboard and a report
    request the same month, the identical aggregate is computed once and the
    other callers wait for that single result instead of each running their
    own full set of queries.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._pending: dict[str, list[object]] = {}

    def get(self, key: str, factory: Callable[[], object]) -> object:
        with self._lock:
            entry = self._pending.get(key)
            leader = False
            if entry is None:
                # [event, holder] - the holder carries the shared result.
                entry = [threading.Event(), []]
                self._pending[key] = entry
                leader = True
        event, holder = entry
        if not leader:
            event.wait(timeout=30)
            if holder:
                return holder[0]
            # The leader failed; this caller does the work itself.
            return factory()
        try:
            result = factory()
        except Exception:
            with self._lock:
                self._pending.pop(key, None)
            event.set()
            raise
        holder.append(result)
        with self._lock:
            self._pending.pop(key, None)
        event.set()
        return result


_dashboard_flight = _SingleFlight()
_reports_flight = _SingleFlight()


def _appliance_hour_stats(
    db: Session,
    appliance_ids: Iterable[int] | None = None,
) -> dict[int, tuple[float, int]]:
    """Map appliance_id -> (mean hours, session count) over history.

    Pass the appliance ids actually being displayed to keep the aggregate off
    a full-table scan; each mean still spans that appliance's entire history.
    """
    stmt = (
        select(
            UsageRecord.appliance_id,
            func.avg(UsageRecord.hours),
            func.count(UsageRecord.id),
        )
        .group_by(UsageRecord.appliance_id)
    )
    if appliance_ids is not None:
        ids = {item for item in appliance_ids if item is not None}
        if not ids:
            return {}
        stmt = stmt.where(UsageRecord.appliance_id.in_(ids))
    rows = db.execute(stmt).all()
    return {row[0]: (float(row[1] or 0), int(row[2])) for row in rows}


def _usage_flags(hours: float, stats: tuple[float, int] | None) -> list[str]:
    flags: list[str] = []
    if hours >= EXTENDED_USE_HOURS:
        flags.append("extended-use")
    if stats is not None:
        mean, count = stats
        if count >= UNUSUAL_USE_MIN_SESSIONS and mean > 0 and hours > UNUSUAL_USE_MULTIPLE * mean:
            flags.append("unusual-duration")
    return flags


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=200)


class UserCredentialsRequest(BaseModel):
    username: str = Field(min_length=2, max_length=80)
    password: str = Field(min_length=3, max_length=200)
    assigned_room_id: int | None = Field(default=None, gt=0)


class RoomAssignmentRequest(BaseModel):
    room_id: int | None = Field(default=None, gt=0)


class AdminLoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=200)


class SectionRequest(BaseModel):
    grade: str = Field(min_length=1, max_length=2, pattern=r"^\d{1,2}$")
    section_name: str = Field(min_length=2, max_length=40)


class RegisterRequest(BaseModel):
    username: str = Field(min_length=2, max_length=80)
    password: str = Field(min_length=8, max_length=200)
    section_id: int = Field(gt=0)


class SectionAssignmentRequest(BaseModel):
    section_id: int | None = Field(default=None, gt=0)


class ApplianceRequest(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    wattage: float = Field(gt=0, le=100_000)
    # How many identical units this row covers; the connected load is
    # wattage x quantity.
    quantity: int = Field(default=1, ge=1, le=999)


class UsageRequest(BaseModel):
    # Accepted for older clients but ignored: the account's own section
    # (chosen at registration) is authoritative for every submission.
    section_id: int | None = Field(default=None, gt=0)
    appliance_id: int = Field(gt=0)
    hours: float = Field(gt=0, le=24)
    room_id: int | None = Field(default=None, gt=0)
    occupants: int | None = Field(default=None, ge=0, le=500)
    started_at: datetime | None = None


class RoomUpdateRequest(BaseModel):
    room_type: Literal["classroom", "office", "custom"]
    custom_type: str | None = Field(default=None, max_length=64)
    room_name: str | None = Field(default=None, max_length=80)


class OAuthUserInfo(BaseModel):
    id: str | None = None
    email: str | None = None
    name: str | None = None
    username: str | None = None
    picture: str | None = None


class WorkspaceUpdate(BaseModel):
    workspace_name: str
    description: str | None = None


class BuildingSummary(BaseModel):
    building_code: str
    building_name: str
    floor_count: int
    room_count: int


class BuildingDetail(BaseModel):
    building_code: str = Field(min_length=1, max_length=16)
    building_name: str = Field(min_length=1, max_length=64)


class FloorSummary(BaseModel):
    floor: int
    room_count: int


class FloorDetail(BaseModel):
    floor: int


class RoomSummary(BaseModel):
    room_index: int
    room_number: int
    room_name: str | None
    room_type: str


class RoomDetail(BaseModel):
    room_index: int = Field(ge=1)
    room_number: int | None = Field(default=None, ge=0)
    room_name: str | None = Field(default=None, max_length=80)
    room_type: str = Field(default="classroom", max_length=20)
    custom_type: str | None = Field(default=None, max_length=64)
    wattage: float | None = None


class RegisterOwnerRequest(BaseModel):
    full_name: str = Field(min_length=1, max_length=120)
    email: str = Field(
        min_length=5,
        max_length=255,
        pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$",
    )
    password: str = Field(min_length=8, max_length=200)
    workspace_name: str = Field(min_length=1, max_length=255)
    # Optional so existing clients keep working. The username is the first
    # segment of a campus URL, so it is sanitized before it is stored.
    username: str | None = Field(default=None, max_length=80)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _token_signature(payload: str) -> str:
    return hmac.new(SESSION_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()


def _hash_user_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PASSWORD_ITERATIONS)
    return f"pbkdf2_sha256${PASSWORD_ITERATIONS}${salt.hex()}${digest.hex()}"


def _verify_user_password(password: str, encoded: str) -> bool:
    try:
        algorithm, iterations, salt_hex, digest_hex = encoded.split("$")
        if algorithm != "pbkdf2_sha256":
            return False
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(digest_hex)
        actual = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, int(iterations))
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def _session_payload(subject: str) -> str:
    return f"{subject}:{int(time.time()) + SESSION_SECONDS}"


def _read_session_subject(request: Request, cookie_name: str) -> str | None:
    token = request.cookies.get(cookie_name, "")
    try:
        payload, signature = token.rsplit(".", 1)
        subject, expiry = payload.rsplit(":", 1)
        if (
            hmac.compare_digest(signature, _token_signature(payload))
            and int(expiry) > int(time.time())
        ):
            return subject
    except (ValueError, TypeError):
        pass
    return None


def _valid_admin(request: Request) -> bool:
    token = request.cookies.get(SESSION_COOKIE, "")
    try:
        payload, signature = token.rsplit(".", 1)
        username, expiry = payload.split(":", 1)
        return (
            hmac.compare_digest(signature, _token_signature(payload))
            and username in ADMIN_ACCOUNTS
            and int(expiry) > int(time.time())
        )
    except (ValueError, TypeError):
        return False


def _admin_subject(request: Request) -> str:
    """Username carried by a signed admin cookie, for displaying the session."""
    token = request.cookies.get(SESSION_COOKIE, "")
    try:
        payload, _ = token.rsplit(".", 1)
        return payload.split(":", 1)[0]
    except (ValueError, TypeError):
        return ADMIN_USERNAME


def require_admin(request: Request) -> None:
    if not _valid_admin(request):
        raise HTTPException(status_code=401, detail="Admin sign-in required.")


@dataclass(frozen=True)
class AuthUser:
    """The slice of an account that decides whether a request may proceed.

    The session cookie is signed, so it already proves who the caller is. Only
    the fields that gate access are read from the database, and they are cached
    briefly so a busy workspace does not re-query the same row on every call.
    """

    id: int
    username: str
    email: str | None
    oauth_provider: str | None
    status: str
    section_id: int | None
    assigned_room_id: int | None
    has_password: bool
    role: str
    workspace_name: str | None


AUTH_CACHE_SECONDS = 15.0
_auth_cache: dict[str, tuple[float, AuthUser]] = {}
_auth_cache_lock = threading.Lock()


def _invalidate_auth_cache(username: str | None = None) -> None:
    """Drop a cached account (or all of them) after the row changes."""
    with _auth_cache_lock:
        if username is None:
            _auth_cache.clear()
        else:
            _auth_cache.pop(username.lower(), None)


def _load_auth_user(db: Session, username: str) -> AuthUser | None:
    now = time.monotonic()
    with _auth_cache_lock:
        cached = _auth_cache.get(username.lower())
        if cached is not None and cached[0] > now:
            return cached[1]
    row = db.execute(
        select(
            ClassroomUser.id,
            ClassroomUser.username,
            ClassroomUser.email,
            ClassroomUser.oauth_provider,
            ClassroomUser.status,
            ClassroomUser.section_id,
            ClassroomUser.assigned_room_id,
            ClassroomUser.workspace_name,
            ClassroomUser.role,
            ClassroomUser.password_hash.is_not(None).label("has_password"),
        ).where(ClassroomUser.username == username)
    ).one_or_none()
    if row is None:
        return None
    # A workspace present on the row means the account owns that workspace.
    # Older OAuth rows predate the role column, so derive "owner" rather than
    # relying on the migration default of "user".
    role = row.role or "user"
    if row.workspace_name and role == "user":
        role = "owner"
    user = AuthUser(
        id=row.id,
        username=row.username,
        email=row.email,
        oauth_provider=row.oauth_provider,
        status=row.status,
        section_id=row.section_id,
        assigned_room_id=row.assigned_room_id,
        workspace_name=row.workspace_name,
        role=role,
        has_password=bool(row.has_password),
    )
    with _auth_cache_lock:
        _auth_cache[username.lower()] = (now + AUTH_CACHE_SECONDS, user)
    return user


def require_user(
    request: Request,
    db: Session = Depends(get_db),
) -> AuthUser:
    username = _read_session_subject(request, USER_SESSION_COOKIE)
    if username is None:
        raise HTTPException(status_code=401, detail="User sign-in required.")
    user = _load_auth_user(db, username)
    if user is None:
        raise HTTPException(status_code=401, detail="User credentials are no longer valid.")
    # Password-based accounts must have a hash; OAuth accounts do not.
    if not user.oauth_provider and not user.has_password:
        raise HTTPException(status_code=401, detail="User credentials are no longer valid.")
    if user.status != "active":
        raise HTTPException(status_code=403, detail="This account is awaiting administrator approval.")
    return user


def _require_workspace_owner(user: AuthUser) -> None:
    """Owners have a workspace and are not coordinators or room users."""
    if not user.workspace_name or user.role == "emc":
        raise HTTPException(
            status_code=403,
            detail="Only workspace owners can perform this action.",
        )


def _clean_text(value: str | None, *, max_length: int) -> str | None:
    """Collapse whitespace and strip control characters from user text.

    Values are stored and rendered as plain text; React escapes them on output.
    This keeps stored data tidy and prevents control-character tricks.
    """
    if value is None:
        return None
    cleaned = "".join(ch for ch in value if ch == "\n" or ch == "\t" or ord(ch) >= 32)
    cleaned = " ".join(cleaned.split())
    return cleaned[:max_length]


def _slugify(value: str | None) -> str:
    """Turn a workspace/username into a URL-safe campus segment."""
    slug = re.sub(r"[^a-z0-9]+", "-", (value or "").lower()).strip("-")
    return slug[:40] or "campus"


def _owner_username_for(
    db: Session, user: AuthUser | ClassroomUser
) -> str | None:
    """Resolve the campus owner's username for an owner or EMC account."""
    if user.role != "emc":
        return user.username
    owner: ClassroomUser | None = None
    if user.section_id:
        section = db.get(ClassroomSection, user.section_id)
        if section is not None and section.owner_id:
            owner = db.get(ClassroomUser, section.owner_id)
    if owner is None and user.assigned_room_id:
        room = db.get(ClassroomRoom, user.assigned_room_id)
        if room is not None and room.owner_id:
            owner = db.get(ClassroomUser, room.owner_id)
    if owner is None and user.workspace_name:
        owner = db.scalar(
            select(ClassroomUser).where(
                ClassroomUser.workspace_name == user.workspace_name,
                ClassroomUser.role == "owner",
            )
        )
    return owner.username if owner is not None else None


def _campus_fields(db: Session, user: AuthUser | ClassroomUser) -> dict:
    return {
        "campus_slug": _slugify(user.workspace_name) if user.workspace_name else "",
        "owner_username": _owner_username_for(db, user),
    }


def _ensure_owner_section(db: Session, user: AuthUser) -> ClassroomSection:
    """Give each workspace one section so its reports can be stored.

    Usage records require a section. Owner-created workspaces do not have the
    legacy seeded sections, so create a workspace-level one on first use.
    """
    owner_row = db.get(ClassroomUser, user.id)
    if owner_row and owner_row.section_id:
        section = db.get(ClassroomSection, owner_row.section_id)
        if section is not None:
            return section
    base = f"{(user.workspace_name or 'Workspace')[:50]} - General"
    name = base
    counter = 1
    while db.scalar(
        select(ClassroomSection.id).where(
            func.lower(ClassroomSection.name) == name.lower()
        )
    ):
        counter += 1
        name = f"{base} ({counter})"
    section = ClassroomSection(name=name, section_name="General", owner_id=user.id)
    db.add(section)
    db.flush()
    if owner_row is not None:
        owner_row.section_id = section.id
    return section


def _section_dict(section: ClassroomSection) -> dict:
    return {
        "id": section.id,
        "name": section.name,
        "grade": section.grade,
        "section_name": section.section_name,
    }


def _appliance_dict(appliance: Appliance) -> dict:
    # connected_watts is what the UI and the energy formula use; keeping it on
    # the payload means the client never has to redo the multiplication.
    quantity = appliance.quantity or 1
    return {
        "id": appliance.id,
        "name": appliance.name,
        "wattage": appliance.wattage,
        "quantity": quantity,
        "connected_watts": round(appliance.wattage * quantity, 4),
    }


def _room_identity(room: ClassroomRoom) -> dict:
    return {
        "id": room.id,
        "building_code": room.building_code,
        "building_name": room.building_name,
        "floor": room.floor,
        "room_index": room.room_index,
        "room_number": room.room_number,
        "room_type": room.room_type,
        "custom_type": room.custom_type,
        "room_name": room.room_name,
    }


def _usage_moment(record: UsageRecord) -> datetime:
    """When the energy was actually used, falling back to submission time.

    A custom-time entry carries the date the teacher picks, so reports bucket by
    usage date rather than by when the row happened to be written.
    """
    return record.started_at or record.created_at


def _kwh_and_bill(kwh: float) -> tuple[float, float]:
    """Round kWh once, then derive the bill from that same value.

    Keeping the rounding in one place is what guarantees the invariant a reader
    checks by hand: displayed_kwh * ELECTRICITY_RATE == displayed_bill.
    """
    rounded = round(kwh or 0.0, KWH_PRECISION)
    return rounded, round(rounded * ELECTRICITY_RATE, 2)


def _record_dict(
    record: UsageRecord,
    stats: dict[int, tuple[float, int]] | None = None,
    flags: list[str] | None = None,
    *,
    user: ClassroomUser | AuthUser | None = None,
    section: ClassroomSection | None = None,
    appliance: Appliance | None = None,
) -> dict:
    # Related rows are passed in when the caller already holds them, so write
    # responses never pay for three lazy relationship loads per record.
    user = user or record.user
    section = section or record.section
    appliance = appliance or record.appliance
    started = record.started_at or (record.created_at - timedelta(hours=record.hours))
    energy_kwh, estimated_cost = _kwh_and_bill(record.energy_kwh)
    quantity = appliance.quantity or 1
    return {
        "id": record.id,
        "username": user.username,
        "section": section.name,
        "section_id": record.section_id,
        "room_id": record.room_id,
        "appliance": appliance.name,
        "appliance_id": record.appliance_id,
        "wattage": appliance.wattage,
        "quantity": quantity,
        "connected_watts": round(appliance.wattage * quantity, 4),
        "hours": record.hours,
        "energy_kwh": energy_kwh,
        "estimated_cost_php": estimated_cost,
        "occupants": record.occupants,
        "started_at": started.isoformat(),
        "created_at": record.created_at.isoformat(),
        "flags": flags
        if flags is not None
        else _usage_flags(record.hours, (stats or {}).get(record.appliance_id)),
    }


def _seed_demo_campus(db: Session) -> None:
    """Create the demo campus once, without touching existing data.

    The demo mirrors the three-building screenshot: G11 BLDG, ADMIN, and
    G12 BLDG, each with four floors of five rooms. Building codes are prefixed
    with CSHS because the room table's uniqueness constraint is global.
    """
    if db.scalar(
        select(ClassroomUser.id).where(
            func.lower(ClassroomUser.username).in_(
                ("admin", "bernoulli", "demo", "demo-emc")
            )
        )
    ):
        return

    owner = ClassroomUser(
        username="admin",
        email="admin@wattwise.local",
        password_hash=_hash_user_password("mcs2026"),
        status="active",
        role="owner",
        workspace_name="cshs",
    )
    db.add(owner)
    db.flush()
    owner_auth = AuthUser(
        id=owner.id,
        username="admin",
        email=owner.email,
        oauth_provider=None,
        status="active",
        section_id=None,
        assigned_room_id=None,
        has_password=True,
        role="owner",
        workspace_name="cshs",
    )
    section = _ensure_owner_section(db, owner_auth)

    buildings = [
        ("CSHS-G11", "BLDG 1 · G11 BLDG"),
        ("CSHS-ADMIN", "BLDG 2 · ADMIN"),
        ("CSHS-G12", "BLDG 3 · G12 BLDG"),
    ]
    demo_rooms: list[ClassroomRoom] = []
    for building_code, building_name in buildings:
        for floor in range(1, 5):
            for room_index in range(1, 6):
                room = ClassroomRoom(
                    building_code=building_code,
                    building_name=building_name,
                    floor=floor,
                    room_index=room_index,
                    room_number=floor * 100 + room_index,
                    room_type="classroom",
                    owner_id=owner.id,
                )
                db.add(room)
                demo_rooms.append(room)
    db.flush()

    emc = ClassroomUser(
        username="bernoulli",
        email="bernoulli@wattwise.local",
        password_hash=_hash_user_password("medsci"),
        status="active",
        role="emc",
        workspace_name="cshs",
        assigned_room_id=demo_rooms[0].id,
        section_id=section.id,
    )
    db.add(emc)
    db.flush()

    appliances: dict[str, Appliance] = {}
    for name, wattage in (
        ("Electric fan", 55),
        ("TV", 100),
        ("Linear Fluorescent Light", 40),
        ("Air Conditioner", 1200),
    ):
        appliance = db.scalar(
            select(Appliance).where(func.lower(Appliance.name) == name.lower())
        )
        if appliance is None:
            appliance = Appliance(name=name, wattage=wattage, quantity=1)
            db.add(appliance)
            db.flush()
        appliances[name] = appliance

    for days_ago, appliance_name, hours in (
        (1, "Electric fan", 4),
        (2, "TV", 2),
        (3, "Linear Fluorescent Light", 6),
        (4, "Air Conditioner", 3),
    ):
        appliance = appliances[appliance_name]
        db.add(
            UsageRecord(
                user_id=emc.id,
                section_id=section.id,
                room_id=demo_rooms[0].id,
                appliance_id=appliance.id,
                hours=hours,
                energy_kwh=round(
                    appliance.wattage * (appliance.quantity or 1) * hours / 1000, 4
                ),
                created_at=utc_now() - timedelta(days=days_ago),
            )
        )
    db.commit()


def _ensure_demo_accounts(db: Session) -> None:
    """Update the existing demo campus to the fixed demo credentials.

    Old databases contain ``demo`` and ``demo-emc``. Renaming those rows in
    place keeps every report attached to the same user ID. Fresh databases get
    the new names directly from ``_seed_demo_campus``.
    """
    owner = db.scalar(
        select(ClassroomUser).where(func.lower(ClassroomUser.username) == "admin")
    )
    if owner is None:
        owner = db.scalar(
            select(ClassroomUser).where(func.lower(ClassroomUser.username) == "demo")
        )
        if owner is None:
            return
        owner.username = "admin"
        owner.status = "active"
        owner.role = "owner"
        if not owner.workspace_name:
            owner.workspace_name = "cshs"

    # Do not touch a real account named "admin" that belongs to another
    # workspace.
    if owner.workspace_name != "cshs":
        return
    if owner.role != "owner":
        owner.role = "owner"
    if not owner.password_hash or not _verify_user_password(
        "mcs2026", owner.password_hash
    ):
        owner.password_hash = _hash_user_password("mcs2026")

    owner_auth = AuthUser(
        id=owner.id,
        username=owner.username,
        email=owner.email,
        oauth_provider=owner.oauth_provider,
        status=owner.status,
        section_id=owner.section_id,
        assigned_room_id=owner.assigned_room_id,
        has_password=True,
        role="owner",
        workspace_name=owner.workspace_name,
    )
    section = _ensure_owner_section(db, owner_auth)

    first_room = db.scalar(
        select(ClassroomRoom)
        .where(
            ClassroomRoom.owner_id == owner.id,
            ClassroomRoom.room_type != "placeholder",
            ClassroomRoom.floor > 0,
        )
        .order_by(
            ClassroomRoom.building_code,
            ClassroomRoom.floor,
            ClassroomRoom.room_index,
        )
        .limit(1)
    )

    emc = db.scalar(
        select(ClassroomUser).where(
            func.lower(ClassroomUser.username) == "bernoulli"
        )
    )
    if emc is None:
        emc = db.scalar(
            select(ClassroomUser).where(
                func.lower(ClassroomUser.username) == "demo-emc"
            )
        )
        if emc is not None:
            emc.username = "bernoulli"
            emc.status = "active"
            emc.role = "emc"
            if not emc.workspace_name:
                emc.workspace_name = "cshs"
    if emc is None and first_room is not None:
        emc = ClassroomUser(
            username="bernoulli",
            email="bernoulli@wattwise.local",
            password_hash=_hash_user_password("medsci"),
            status="active",
            role="emc",
            workspace_name="cshs",
            assigned_room_id=first_room.id,
            section_id=section.id,
        )
        db.add(emc)

    if emc is not None and emc.workspace_name == "cshs":
        emc.role = "emc"
        emc.section_id = section.id
        if emc.assigned_room_id is None and first_room is not None:
            emc.assigned_room_id = first_room.id
        if not emc.password_hash or not _verify_user_password(
            "medsci", emc.password_hash
        ):
            emc.password_hash = _hash_user_password("medsci")
    db.commit()


_db_initialized = False


@app.on_event("startup")
def initialize_database() -> None:
    global _db_initialized
    if _db_initialized:
        return
    _db_initialized = True
    Base.metadata.create_all(bind=engine)
    inspector = inspect(engine)
    user_columns = {column["name"] for column in inspector.get_columns("classroom_users")}
    section_columns = {column["name"] for column in inspector.get_columns("classroom_sections")}
    room_columns = {column["name"] for column in inspector.get_columns("classroom_rooms")}
    usage_columns = {column["name"] for column in inspector.get_columns("usage_records")}
    appliance_columns = {column["name"] for column in inspector.get_columns("appliances")}
    with engine.begin() as connection:
        if "password_hash" not in user_columns:
            connection.exec_driver_sql(
                "ALTER TABLE classroom_users ADD COLUMN password_hash VARCHAR(256)"
            )
        if "email" not in user_columns:
            connection.exec_driver_sql(
                "ALTER TABLE classroom_users ADD COLUMN email VARCHAR(255)"
            )
        if "oauth_provider" not in user_columns:
            connection.exec_driver_sql(
                "ALTER TABLE classroom_users ADD COLUMN oauth_provider VARCHAR(32)"
            )
        if "oauth_subject" not in user_columns:
            connection.exec_driver_sql(
                "ALTER TABLE classroom_users ADD COLUMN oauth_subject VARCHAR(255)"
            )
        if "assigned_room_id" not in user_columns:
            connection.exec_driver_sql(
                "ALTER TABLE classroom_users ADD COLUMN assigned_room_id INTEGER REFERENCES classroom_rooms(id)"
            )
        if "status" not in user_columns:
            connection.exec_driver_sql(
                "ALTER TABLE classroom_users ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'active'"
            )
        if "section_id" not in user_columns:
            connection.exec_driver_sql(
                "ALTER TABLE classroom_users ADD COLUMN section_id INTEGER REFERENCES classroom_sections(id)"
            )
        if "workspace_name" not in user_columns:
            connection.exec_driver_sql(
                "ALTER TABLE classroom_users ADD COLUMN workspace_name VARCHAR(255)"
            )
        if "role" not in user_columns:
            connection.exec_driver_sql(
                "ALTER TABLE classroom_users ADD COLUMN role VARCHAR(16) NOT NULL DEFAULT 'user'"
            )
        if "grade" not in section_columns:
            connection.exec_driver_sql(
                "ALTER TABLE classroom_sections ADD COLUMN grade VARCHAR(4)"
            )
        if "section_name" not in section_columns:
            connection.exec_driver_sql(
                "ALTER TABLE classroom_sections ADD COLUMN section_name VARCHAR(40)"
            )
        if "owner_id" not in section_columns:
            connection.exec_driver_sql(
                "ALTER TABLE classroom_sections ADD COLUMN owner_id INTEGER REFERENCES classroom_users(id)"
            )
        if "owner_id" not in room_columns:
            connection.exec_driver_sql(
                "ALTER TABLE classroom_rooms ADD COLUMN owner_id INTEGER REFERENCES classroom_users(id)"
            )
        if "room_id" not in usage_columns:
            connection.exec_driver_sql(
                "ALTER TABLE usage_records ADD COLUMN room_id INTEGER REFERENCES classroom_rooms(id)"
            )
        if "occupants" not in usage_columns:
            connection.exec_driver_sql(
                "ALTER TABLE usage_records ADD COLUMN occupants INTEGER"
            )
        if "started_at" not in usage_columns:
            connection.exec_driver_sql(
                "ALTER TABLE usage_records ADD COLUMN started_at TIMESTAMP"
            )
        if "archived" not in appliance_columns:
            connection.exec_driver_sql(
                "ALTER TABLE appliances ADD COLUMN archived BOOLEAN NOT NULL DEFAULT 0"
            )
            connection.exec_driver_sql("UPDATE appliances SET archived = 0")
        if "quantity" not in appliance_columns:
            # Existing rows represent a single unit.
            connection.exec_driver_sql(
                "ALTER TABLE appliances ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1"
            )
            connection.exec_driver_sql("UPDATE appliances SET quantity = 1")
        # Composite indexes for the hot read paths: a user's recent submissions
        # (user_id, created_at) and the trailing-30-day room map
        # (room_id, created_at). IF NOT EXISTS keeps every cold start a catalog
        # no-op once they exist, on both SQLite and Postgres.
        connection.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_usage_records_user_created "
            "ON usage_records (user_id, created_at)"
        )
        connection.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_usage_records_room_created "
            "ON usage_records (room_id, created_at)"
        )
        # The user workspace filters one account by its own section, and the
        # report screens filter a month by section or by appliance. A composite
        # index lets those reads seek straight to the matching rows instead of
        # scanning the whole usage table.
        connection.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_usage_records_user_section_created "
            "ON usage_records (user_id, section_id, created_at)"
        )
        connection.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_usage_records_section_created "
            "ON usage_records (section_id, created_at)"
        )
        connection.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_usage_records_appliance_created "
            "ON usage_records (appliance_id, created_at)"
        )
        connection.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_classroom_users_status "
            "ON classroom_users (status)"
        )
    # Case-insensitive uniqueness, enforced by the database instead of by a
    # check-then-insert in Python. The application compares names case
    # insensitively, so two concurrent requests could otherwise both pass the
    # check and insert a duplicate; a unique index makes the second insert
    # fail atomically. IF NOT EXISTS keeps a cold start a no-op, and a
    # legacy database that already holds duplicates is left alone rather than
    # blocking the app from starting.
    for statement in (
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_appliances_lower_name "
        "ON appliances (lower(trim(name)))",
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_classroom_sections_lower_name "
        "ON classroom_sections (lower(trim(name)))",
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_classroom_users_lower_username "
        "ON classroom_users (lower(trim(username)))",
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_classroom_users_email "
        "ON classroom_users (email) WHERE email IS NOT NULL",
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_classroom_users_oauth "
        "ON classroom_users (oauth_provider, oauth_subject) "
        "WHERE oauth_provider IS NOT NULL AND oauth_subject IS NOT NULL",
    ):
        try:
            with engine.begin() as connection:
                connection.exec_driver_sql(statement)
        except Exception as error:  # pragma: no cover - legacy data conflict
            print(f"skipped unique index: {error}", file=sys.stderr)
    with SessionLocal() as db:
        # Backfill structured fields for legacy rows created as "11 - BERNOULLI".
        for section in db.scalars(select(ClassroomSection)):
            if section.grade or not section.name:
                continue
            head, separator, tail = section.name.partition(" - ")
            if separator and head.strip().isdigit() and tail.strip():
                section.grade = head.strip()
                section.section_name = tail.strip()
        # Older rows may still have NULL grade/section_name after backfill, so
        # key on both the structured pair and the display label: a row can hold
        # one without the other, and a mismatch would otherwise trip the unique
        # index on name when we insert "11 - BERNOULLI".
        existing_pairs: set[tuple[str | None, str]] = set()
        existing_names: set[str] = set()
        for section in db.scalars(select(ClassroomSection)):
            existing_pairs.add(
                (section.grade, (section.section_name or "").upper())
            )
            if section.name:
                existing_names.add(section.name.upper())
        all_sections_data = [
            # Grade 11
            ("11", "ENTREPRENEURS"),
            ("11", "COMMERCE"),
            ("11", "BLOOM"),
            ("11", "PATRIOTS"),
            ("11", "SAPIENTIA"),
            ("11", "ADLER"),
            ("11", "ARISTOTLE"),
            ("11", "BERNOULLI"),
            ("11", "CHATTERTON"),
            ("11", "H.DIAZ"),
            ("11", "CROISSANT"),
            ("11", "CANNOLI"),
            ("11", "MICHELIN"),
            ("11", "ERUDITE"),
            ("11", "DRIVEN"),
            ("11", "DILIGENT"),
            ("11", "ANALYTICAL"),
            ("11", "ALCARAZ"),
            ("11", "ASPIRANT"),
            ("11", "DREAMER"),
            # Grade 12
            ("12", "PACIOLI"),
            ("12", "SCHUMPETER"),
            ("12", "EINSTEIN"),
            ("12", "NEWTON"),
            ("12", "YULO"),
            ("12", "AUSTEN"),
            ("12", "BLUMER"),
            ("12", "DURKHEIM"),
            ("12", "A. CUDDY"),
            ("12", "E. ERIKSON"),
            ("12", "FREIRE"),
            ("12", "SEDULOUS"),
            ("12", "ASSIDUOUS"),
            ("12", "INNOVATIVE"),
            ("12", "EFFICIENT"),
            ("12", "ORGANIZED"),
            ("12", "VANGUARD"),
            ("12", "VISIONARY"),
            ("12", "MARTIAN"),
            # Grade 11/12 ALS / SNED
            ("11", "HAWKING/KELLER"),
            ("12", "HAWKING/KELLER"),
        ]
        for grade, sec_name in all_sections_data:
            display = f"{grade} - {sec_name}"
            if (grade, sec_name) in existing_pairs or display.upper() in existing_names:
                continue
            db.add(ClassroomSection(
                name=display,
                grade=grade,
                section_name=sec_name,
            ))
        if not db.scalar(select(Appliance.id).limit(1)):
            # Approved appliance table, in watts. Classroom set:
            # 2 x Electric fan + 1 x TV + 1 x Water Dispenser = 710 W, which is
            # 2.84 kWh / 5.68 kWh / 8.52 kWh over 4 h / 8 h / 12 h.
            db.add_all(
                Appliance(name=name, wattage=wattage)
                for name, wattage in (
                    ("Electric fan", 55),
                    ("TV", 100),
                    ("Printer", 100),
                    ("Water Dispenser", 500),
                    ("Linear Fluorescent Light", 40),
                    ("Desktop Computer", 135),
                )
            )
        if not db.scalar(select(ClassroomRoom.id).limit(1)):
            buildings = (
                ("G11", "BLDG 1 · G11 BLDG"),
                ("ADMIN", "BLDG 2 · ADMIN"),
                ("G12", "BLDG 3 · G12 BLDG"),
            )
            db.add_all(
                ClassroomRoom(
                    building_code=code,
                    building_name=name,
                    floor=floor,
                    room_index=room_index,
                    room_number=floor * 100 + room_index,
                )
                for code, name in buildings
                for floor in range(1, 5)
                for room_index in range(1, 6)
            )
        # An early seed wrote "G11 BLDS"; heal any stale building labels.
        for room in db.scalars(select(ClassroomRoom)):
            if "BLDS" in room.building_name:
                room.building_name = room.building_name.replace("BLDS", "BLDG")
        db.commit()

    # The demo campus is additive. A failure here must not stop the API from
    # starting, and it never touches existing users or reports.
    try:
        with SessionLocal() as demo_db:
            _seed_demo_campus(demo_db)
            _ensure_demo_accounts(demo_db)
    except Exception as error:  # pragma: no cover - local demo convenience
        print(f"demo seed skipped: {error}", file=sys.stderr)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def _catalog_cache(response: Response) -> None:
    # Catalogs (sections, appliances, rooms) change rarely and are read by
    # every visitor, so let the browser serve them for two minutes instead of
    # paying a round trip to the API each page load.
    response.headers["Cache-Control"] = "public, max-age=120"
    response.headers["Vary"] = "Accept-Encoding"


@app.get("/api/sections")
def list_sections(response: Response, db: Session = Depends(get_db)) -> list[dict]:
    _catalog_cache(response)
    return [_section_dict(item) for item in db.scalars(select(ClassroomSection).order_by(ClassroomSection.name))]


@app.get("/api/appliances")
def list_appliances(
    response: Response,
    db: Session = Depends(get_db),
    limit: int = 100,
    offset: int = 0,
) -> list[dict]:
    _catalog_cache(response)
    limit = max(1, min(limit, 200))
    offset = max(0, offset)
    return [
        _appliance_dict(item)
        for item in db.scalars(
            select(Appliance)
            .where(Appliance.archived.is_(False))
            .order_by(Appliance.name)
            .limit(limit)
            .offset(offset)
        )
    ]


def _ordered_rooms(db: Session) -> list[ClassroomRoom]:
    """All rooms in display order: building, then floor, then room index."""
    building_order = {"G11": 0, "ADMIN": 1, "G12": 2}
    rooms = list(db.scalars(select(ClassroomRoom)))
    rooms.sort(
        key=lambda room: (
            building_order.get(room.building_code, 3),
            room.floor,
            room.room_index,
        )
    )
    return rooms


@app.get("/api/rooms")
def list_room_choices(
    response: Response,
    db: Session = Depends(get_db),
    limit: int = 100,
    offset: int = 0,
) -> list[dict]:
    _catalog_cache(response)
    limit = max(1, min(limit, 200))
    offset = max(0, offset)
    rooms = _ordered_rooms(db)
    return [_room_identity(room) for room in rooms[offset : offset + limit]]


@app.post("/api/appliances", status_code=201)
def create_user_appliance(
    payload: ApplianceRequest,
    _: AuthUser = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    name = " ".join(payload.name.split())
    if db.scalar(select(Appliance.id).where(func.lower(Appliance.name) == name.lower())):
        raise HTTPException(status_code=409, detail="That appliance already exists.")
    appliance = Appliance(name=name, wattage=payload.wattage, quantity=payload.quantity)
    db.add(appliance)
    try:
        db.commit()
    except IntegrityError as error:
        # The unique index caught a case-insensitive duplicate that the
        # check above raced past.
        db.rollback()
        raise HTTPException(
            status_code=409, detail="That appliance already exists."
        ) from error
    return _appliance_dict(appliance)


@app.put("/api/appliances/{appliance_id}")
def update_user_appliance(
    appliance_id: int,
    payload: ApplianceRequest,
    _: AuthUser = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    """Let the owning workspace re-type an appliance (name, wattage, quantity)."""
    appliance = db.get(Appliance, appliance_id)
    if appliance is None:
        raise HTTPException(status_code=404, detail="Appliance not found.")
    name = " ".join(payload.name.split())
    clash = db.scalar(
        select(Appliance.id).where(
            func.lower(Appliance.name) == name.lower(),
            Appliance.id != appliance.id,
        )
    )
    if clash:
        raise HTTPException(status_code=409, detail="That appliance already exists.")
    appliance.name = name
    appliance.wattage = payload.wattage
    appliance.quantity = payload.quantity
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(
            status_code=409, detail="That appliance already exists."
        ) from error
    return _appliance_dict(appliance)


@app.delete("/api/appliances/{appliance_id}")
def remove_user_appliance(
    appliance_id: int,
    _: AuthUser = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    appliance = db.get(Appliance, appliance_id)
    if appliance is None:
        raise HTTPException(status_code=404, detail="Appliance not found.")
    has_records = db.scalar(
        select(func.count()).select_from(UsageRecord).where(UsageRecord.appliance_id == appliance_id)
    )
    if has_records:
        raise HTTPException(
            status_code=409,
            detail="This appliance has usage records and cannot be removed.",
        )
    db.delete(appliance)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="This appliance has usage records and cannot be removed.",
        ) from error
    return {"status": "appliance removed"}


@app.post("/api/users/login")
def user_login(
    payload: LoginRequest,
    response: Response,
    db: Session = Depends(get_db),
) -> dict:
    username = " ".join(payload.username.split())
    user = db.scalar(
        select(ClassroomUser).where(
            or_(
                func.lower(ClassroomUser.username) == username.lower(),
                func.lower(ClassroomUser.email) == username.lower(),
            )
        )
    )
    if user is None or user.password_hash is None or not _verify_user_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect account name or password.")
    if user.status != "active":
        raise HTTPException(status_code=403, detail="Your account is awaiting administrator approval.")
    user.last_seen = utc_now()
    db.commit()
    _invalidate_auth_cache(user.username)
    session = _session_payload(user.username)
    response.set_cookie(
        USER_SESSION_COOKIE,
        f"{session}.{_token_signature(session)}",
        max_age=SESSION_SECONDS,
        httponly=True,
        secure=os.getenv("MCS_SECURE_COOKIES", "false").lower() == "true",
        samesite="strict",
        path="/api",
    )
    room = db.get(ClassroomRoom, user.assigned_room_id) if user.assigned_room_id else None
    return {
        "username": user.username,
        "email": user.email,
        "oauth_provider": user.oauth_provider,
        "role": "owner" if user.workspace_name and user.role != "emc" else (user.role or "user"),
        "workspace_name": user.workspace_name,
        "section": _section_dict(user.section) if user.section else None,
        "assigned_room": _room_identity(room) if room else None,
        # The client previews estimated bills before submitting, so it needs
        # the same rate the server will apply to the stored record.
        "rate_php_per_kwh": ELECTRICITY_RATE,
        **_campus_fields(db, user),
    }


@app.post("/api/users/register", status_code=201)
def register_user(payload: RegisterRequest, db: Session = Depends(get_db)) -> dict:
    """Self-registration: the account starts as pending until an admin approves it."""
    username = " ".join(payload.username.split())
    if db.scalar(
        select(ClassroomUser.id).where(func.lower(ClassroomUser.username) == username.lower())
    ):
        raise HTTPException(status_code=409, detail="That account name is already taken.")
    section = db.get(ClassroomSection, payload.section_id)
    if section is None:
        raise HTTPException(status_code=404, detail="Choose an available classroom section.")
    user = ClassroomUser(
        username=username,
        password_hash=_hash_user_password(payload.password),
        section_id=section.id,
        status="pending",
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail="That account name is already taken.") from error
    return {
        "username": user.username,
        "status": "pending",
        "section": _section_dict(section),
        "message": "Account created. An administrator must approve it before you can sign in.",
    }


@app.post("/api/users/register-owner", status_code=201)
def register_owner(
    payload: RegisterOwnerRequest,
    response: Response,
    db: Session = Depends(get_db),
) -> dict:
    """Create a workspace-owner account and sign it in for onboarding."""
    email = _clean_text(payload.email, max_length=255)
    if not email:
        raise HTTPException(status_code=400, detail="Email is required.")
    email = email.lower()
    username = _clean_text(
        payload.username or email.split("@", 1)[0],
        max_length=80,
    ) or "user"
    username = re.sub(r"[^A-Za-z0-9._-]+", "-", username).strip("-_.") or "user"
    if db.scalar(
        select(ClassroomUser.id).where(func.lower(ClassroomUser.username) == username.lower())
    ):
        raise HTTPException(status_code=409, detail="That username is already taken.")
    if db.scalar(
        select(ClassroomUser.id).where(func.lower(ClassroomUser.email) == email)
    ):
        raise HTTPException(status_code=409, detail="An account with that email already exists.")
    workspace_name = _clean_text(payload.workspace_name, max_length=255)
    if not workspace_name:
        raise HTTPException(status_code=400, detail="Workspace name is required.")
    user = ClassroomUser(
        username=username,
        email=email,
        password_hash=_hash_user_password(payload.password),
        status="active",
        role="owner",
        workspace_name=workspace_name,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail="That account already exists.") from error
    _invalidate_auth_cache(user.username)
    _set_user_session_cookie(response, user.username)
    return {
        "username": user.username,
        "email": user.email,
        "role": "owner",
        "workspace_name": user.workspace_name,
        "status": "active",
        **_campus_fields(db, user),
    }


@app.post("/api/users/logout")
def user_logout(response: Response, _: AuthUser = Depends(require_user)) -> dict[str, str]:
    response.delete_cookie(USER_SESSION_COOKIE, path="/api", samesite="strict")
    return {"status": "signed out"}


@app.get("/api/users/session")
def user_session(
    user: AuthUser = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    room = db.get(ClassroomRoom, user.assigned_room_id) if user.assigned_room_id else None
    section = db.get(ClassroomSection, user.section_id) if user.section_id else None
    return {
        "username": user.username,
        "email": user.email,
        "oauth_provider": user.oauth_provider,
        "role": "owner" if user.workspace_name and user.role != "emc" else (user.role or "user"),
        "workspace_name": user.workspace_name,
        "section": _section_dict(section) if section else None,
        "assigned_room": _room_identity(room) if room else None,
        "rate_php_per_kwh": ELECTRICITY_RATE,
        **_campus_fields(db, user),
    }


@app.get("/api/users/me/records")
def user_records(
    user: AuthUser = Depends(require_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    records = list(
        db.scalars(
            select(UsageRecord)
            .where(
                UsageRecord.user_id == user.id,
                # Recent entries only ever show the account's own classroom section.
                UsageRecord.section_id == user.section_id,
            )
            # Only the appliance is needed per row: the account and its section
            # are already known, so joining them again would re-hydrate the same
            # two rows for every record in the list.
            .options(joinedload(UsageRecord.appliance))
            .order_by(UsageRecord.created_at.desc())
            .limit(100)
        )
    )
    stats = _appliance_hour_stats(db, (record.appliance_id for record in records))
    section = db.get(ClassroomSection, user.section_id) if user.section_id else None
    return [
        _record_dict(record, stats, user=user, section=section)
        for record in records
    ]


# --- OAuth authentication ---------------------------------------------------

def _oauth_state_token(subject: str) -> str:
    payload = f"{subject}:{int(time.time()) + 600}"
    return f"{payload}.{_token_signature(payload)}"


def _verify_oauth_state(token: str) -> bool:
    try:
        payload, signature = token.rsplit(".", 1)
        subject, expiry = payload.rsplit(":", 1)
        return (
            hmac.compare_digest(signature, _token_signature(payload))
            and int(expiry) > int(time.time())
        )
    except (ValueError, TypeError):
        return False


def _set_user_session_cookie(response: Response, username: str) -> None:
    session = _session_payload(username)
    response.set_cookie(
        USER_SESSION_COOKIE,
        f"{session}.{_token_signature(session)}",
        max_age=SESSION_SECONDS,
        httponly=True,
        secure=os.getenv("MCS_SECURE_COOKIES", "false").lower() == "true",
        samesite="strict",
        path="/api",
    )


def _oauth_error_redirect(message: str) -> RedirectResponse:
    redirect = RedirectResponse(
        f"{FRONTEND_URL}/auth?oauth_error={quote(message)}",
        status_code=302,
    )
    redirect.delete_cookie("wattwise_oauth_state", path="/")
    return redirect


async def _fetch_google_userinfo(access_token: str) -> OAuthUserInfo:
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=20,
        )
        resp.raise_for_status()
        data = resp.json()
    return OAuthUserInfo(
        id=data.get("sub"),
        email=data.get("email"),
        name=data.get("name"),
        username=data.get("email"),
        picture=data.get("picture"),
    )


async def _fetch_github_userinfo(access_token: str) -> OAuthUserInfo:
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            GITHUB_USERINFO_URL,
            headers={
                "Authorization": f"Bearer {access_token}",
                "Accept": "application/vnd.github+json",
            },
            timeout=20,
        )
        resp.raise_for_status()
        data = resp.json()
    return OAuthUserInfo(
        id=str(data.get("id")) if data.get("id") is not None else None,
        email=data.get("email"),
        name=data.get("name") or data.get("login"),
        username=data.get("login"),
        picture=data.get("avatar_url"),
    )


@app.get("/api/auth/google/login")
def oauth_google_login() -> Response:
    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        raise HTTPException(status_code=501, detail="Google OAuth is not configured.")
    state = _oauth_state_token("google")
    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": f"{FRONTEND_URL}/api/auth/google/callback",
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "access_type": "offline",
        "prompt": "consent",
    }
    redirect = RedirectResponse(
        f"{GOOGLE_AUTH_URL}?{urlencode(params)}",
        status_code=302,
    )
    redirect.set_cookie(
        "wattwise_oauth_state",
        state,
        max_age=600,
        httponly=True,
        secure=os.getenv("MCS_SECURE_COOKIES", "false").lower() == "true",
        samesite="lax",
        path="/",
    )
    return redirect


@app.get("/api/auth/google/callback")
async def oauth_google_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    db: Session = Depends(get_db),
) -> Response:
    cookie_state = request.cookies.get("wattwise_oauth_state", "")
    if (
        not code
        or not state
        or not cookie_state
        or not hmac.compare_digest(state, cookie_state)
        or not _verify_oauth_state(state)
    ):
        return _oauth_error_redirect("Your sign-in link expired. Please try again.")

    try:
        async with httpx.AsyncClient() as client:
            token_resp = await client.post(
                GOOGLE_TOKEN_URL,
                data={
                    "client_id": GOOGLE_CLIENT_ID,
                    "client_secret": GOOGLE_CLIENT_SECRET,
                    "code": code,
                    "grant_type": "authorization_code",
                    "redirect_uri": f"{FRONTEND_URL}/api/auth/google/callback",
                },
                timeout=20,
            )
            token_resp.raise_for_status()
            token_data = token_resp.json()
            access_token = token_data.get("access_token")
        if not access_token:
            return _oauth_error_redirect("Google did not return an access token.")
        userinfo = await _fetch_google_userinfo(access_token)
    except (httpx.HTTPError, ValueError):
        return _oauth_error_redirect("Google sign-in failed. Please try again.")

    redirect = _complete_oauth_login(
        db=db,
        provider="google",
        subject=userinfo.id or "",
        email=userinfo.email,
        display_name=userinfo.name or userinfo.email or "User",
    )
    redirect.delete_cookie("wattwise_oauth_state", path="/")
    return redirect


@app.get("/api/auth/github/login")
def oauth_github_login() -> Response:
    if not GITHUB_CLIENT_ID or not GITHUB_CLIENT_SECRET:
        raise HTTPException(status_code=501, detail="GitHub OAuth is not configured.")
    state = _oauth_state_token("github")
    params = {
        "client_id": GITHUB_CLIENT_ID,
        "redirect_uri": f"{FRONTEND_URL}/api/auth/github/callback",
        "scope": "read:user user:email",
        "state": state,
    }
    redirect = RedirectResponse(
        f"{GITHUB_AUTH_URL}?{urlencode(params)}",
        status_code=302,
    )
    redirect.set_cookie(
        "wattwise_oauth_state",
        state,
        max_age=600,
        httponly=True,
        secure=os.getenv("MCS_SECURE_COOKIES", "false").lower() == "true",
        samesite="lax",
        path="/",
    )
    return redirect


@app.get("/api/auth/github/callback")
async def oauth_github_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    db: Session = Depends(get_db),
) -> Response:
    cookie_state = request.cookies.get("wattwise_oauth_state", "")
    if (
        not code
        or not state
        or not cookie_state
        or not hmac.compare_digest(state, cookie_state)
        or not _verify_oauth_state(state)
    ):
        return _oauth_error_redirect("Your sign-in link expired. Please try again.")

    try:
        async with httpx.AsyncClient() as client:
            token_resp = await client.post(
                GITHUB_TOKEN_URL,
                data={
                    "client_id": GITHUB_CLIENT_ID,
                    "client_secret": GITHUB_CLIENT_SECRET,
                    "code": code,
                    "grant_type": "authorization_code",
                    "redirect_uri": f"{FRONTEND_URL}/api/auth/github/callback",
                },
                headers={"Accept": "application/json"},
                timeout=20,
            )
            token_resp.raise_for_status()
            token_data = token_resp.json()
            access_token = token_data.get("access_token")
        if not access_token:
            return _oauth_error_redirect("GitHub did not return an access token.")

        userinfo = await _fetch_github_userinfo(access_token)
        # GitHub may not return email via /user; fetch emails if needed
        email = userinfo.email
        if not email:
            async with httpx.AsyncClient() as client:
                email_resp = await client.get(
                    "https://api.github.com/user/emails",
                    headers={
                        "Authorization": f"Bearer {access_token}",
                        "Accept": "application/vnd.github+json",
                    },
                    timeout=20,
                )
                email_resp.raise_for_status()
                emails = email_resp.json()
                primary = next((e for e in emails if e.get("primary")), None)
                email = primary.get("email") if primary else None
    except (httpx.HTTPError, ValueError):
        return _oauth_error_redirect("GitHub sign-in failed. Please try again.")

    redirect = _complete_oauth_login(
        db=db,
        provider="github",
        subject=userinfo.id or "",
        email=email or userinfo.username or "",
        display_name=userinfo.name or userinfo.username or "User",
    )
    redirect.delete_cookie("wattwise_oauth_state", path="/")
    return redirect


def _complete_oauth_login(
    db: Session,
    provider: str,
    subject: str,
    email: str,
    display_name: str,
) -> RedirectResponse:
    if not subject:
        return _oauth_error_redirect("The sign-in provider did not return a user ID.")

    user = db.scalar(
        select(ClassroomUser).where(
            ClassroomUser.oauth_provider == provider,
            ClassroomUser.oauth_subject == subject,
        )
    )

    if user is None:
        email = (email or "").strip().lower()
        if not email:
            return _oauth_error_redirect("The sign-in provider did not return an email address.")
        user = db.scalar(
            select(ClassroomUser).where(func.lower(ClassroomUser.email) == email)
        )
        if user is None:
            username = display_name or email
            username = "".join(c for c in username if c.isalnum() or c in "._-")[:80] or "user"
            base = username
            counter = 1
            while db.scalar(
                select(ClassroomUser.id).where(
                    func.lower(ClassroomUser.username) == username.lower()
                )
            ):
                username = f"{base}{counter}"
                counter += 1
            user = ClassroomUser(
                username=username,
                email=email,
                oauth_provider=provider,
                oauth_subject=subject,
                status="active",
                role="owner",
            )
            db.add(user)
            try:
                db.commit()
            except IntegrityError:
                db.rollback()
                return _oauth_error_redirect("An account already exists for this email.")
        else:
            # Link the existing password account to this provider.
            user.oauth_provider = provider
            user.oauth_subject = subject
            if email and not user.email:
                user.email = email
            db.commit()

    user.last_seen = utc_now()
    db.commit()
    _invalidate_auth_cache(user.username)

    if user.workspace_name:
        slug = _slugify(user.workspace_name)
        if slug == "cshs" and user.role == "owner" and user.username == "admin":
            redirect_url = f"{FRONTEND_URL}/mcs/admin"
        elif slug == "cshs" and user.role == "emc" and user.username == "bernoulli":
            redirect_url = f"{FRONTEND_URL}/mcs/user"
        elif user.role == "emc":
            owner_username = _owner_username_for(db, user) or user.username
            redirect_url = f"{FRONTEND_URL}/mcs/{owner_username}/{slug}/emc"
        else:
            redirect_url = f"{FRONTEND_URL}/mcs/{user.username}/{slug}/dashboard"
    else:
        redirect_url = f"{FRONTEND_URL}/onboarding"
    redirect = RedirectResponse(redirect_url, status_code=302)
    _set_user_session_cookie(redirect, user.username)
    return redirect


@app.get("/api/users/me")
def user_me(user: AuthUser = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    room = db.get(ClassroomRoom, user.assigned_room_id) if user.assigned_room_id else None
    section = db.get(ClassroomSection, user.section_id) if user.section_id else None
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "oauth_provider": user.oauth_provider,
        "status": user.status,
        "section": _section_dict(section) if section else None,
        "assigned_room": _room_identity(room) if room else None,
        "rate_php_per_kwh": ELECTRICITY_RATE,
    }


@app.post("/api/records", status_code=201)
def create_record(
    payload: UsageRequest,
    user: AuthUser = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    appliance = db.get(Appliance, payload.appliance_id)
    room = db.get(ClassroomRoom, payload.room_id) if payload.room_id else None
    if appliance is None or (payload.room_id and room is None):
        raise HTTPException(status_code=404, detail="Choose an available appliance and room.")
    
    # Determine if user is a workspace owner (has completed onboarding).
    # EMC accounts also carry workspace_name, but they report for their one
    # assigned room, so they must follow the restricted path.
    is_workspace_owner = user.workspace_name is not None and user.role != "emc"
    
    if is_workspace_owner:
        # Workspace owners can report on any section/room they own
        # Validate section belongs to user
        if user.section_id is None:
            raise HTTPException(
                status_code=403, detail="Please set your section first via workspace settings."
            )
        section = db.get(ClassroomSection, user.section_id)
        if section is None or section.owner_id != user.id:
            raise HTTPException(
                status_code=403, detail="Your section is not available or does not belong to your workspace."
            )
        # Validate room (if provided) belongs to user's workspace
        if payload.room_id is not None:
            if room is None or room.owner_id != user.id:
                raise HTTPException(
                    status_code=403, detail="Room is not available or does not belong to your workspace."
                )
        # Note: Workspace owners are not restricted to their assigned room - they can report on any room they own
    else:
        # Non-owners (EMCs, etc.) follow the original restricted behavior
        # The section comes from the account (fixed at registration), not the payload.
        if user.section_id is None:
            raise HTTPException(
                status_code=403, detail="Ask an administrator to set your classroom section first."
            )
        section = db.get(ClassroomSection, user.section_id)
        if section is None:
            raise HTTPException(status_code=403, detail="Your classroom section is no longer available.")
        if user.assigned_room_id is None:
            raise HTTPException(status_code=403, detail="Ask an administrator to assign your room first.")
        if payload.room_id != user.assigned_room_id:
            raise HTTPException(status_code=403, detail="Usage must be recorded in your assigned room.")
            # Room validation already happened above via db.get
    
    now = utc_now()
    started_at = payload.started_at
    if started_at is not None and started_at.tzinfo is not None:
        started_at = started_at.astimezone(timezone.utc).replace(tzinfo=None)
    # E = P x t / 1000, where P is the whole connected load (unit watts x units).
    connected_watts = appliance.wattage * (appliance.quantity or 1)
    record = UsageRecord(
        user_id=user.id,
        section_id=section.id,
        room_id=room.id if room else None,
        appliance_id=appliance.id,
        hours=payload.hours,
        energy_kwh=round(connected_watts * payload.hours / 1000, 4),
        occupants=payload.occupants,
        started_at=started_at or (now - timedelta(hours=payload.hours)),
        created_at=now,
    )
    db.execute(
        update(ClassroomUser)
        .where(ClassroomUser.id == user.id)
        .values(last_seen=now)
    )
    db.add(record)
    db.commit()
    # The session already holds every related row this response needs.
    return _record_dict(record, user=user, section=section, appliance=appliance)


@app.post("/api/admin/login")
def admin_login(payload: AdminLoginRequest, response: Response) -> dict[str, str]:
    expected = ADMIN_ACCOUNTS.get(payload.username)
    if expected is None or not hmac.compare_digest(payload.password, expected):
        raise HTTPException(status_code=401, detail="Incorrect admin account or password.")
    data = f"{payload.username}:{int(time.time()) + SESSION_SECONDS}"
    response.set_cookie(
        SESSION_COOKIE,
        f"{data}.{_token_signature(data)}",
        max_age=SESSION_SECONDS,
        httponly=True,
        secure=os.getenv("MCS_SECURE_COOKIES", "false").lower() == "true",
        samesite="strict",
        path="/api",
    )
    return {"username": payload.username}


@app.get("/api/admin/session")
def admin_session(
    request: Request, _: None = Depends(require_admin)
) -> dict[str, str]:
    return {"username": _admin_subject(request)}


@app.post("/api/admin/logout")
def admin_logout(response: Response, _: None = Depends(require_admin)) -> dict[str, str]:
    response.delete_cookie(SESSION_COOKIE, path="/api", samesite="strict")
    return {"status": "signed out"}


@app.post("/api/admin/users/credentials", dependencies=[Depends(require_admin)])
def set_user_credentials(
    payload: UserCredentialsRequest,
    db: Session = Depends(get_db),
) -> dict[str, str]:
    username = " ".join(payload.username.split())
    if payload.assigned_room_id and db.get(ClassroomRoom, payload.assigned_room_id) is None:
        raise HTTPException(status_code=404, detail="Room not found.")
    user = db.scalar(
        select(ClassroomUser).where(func.lower(ClassroomUser.username) == username.lower())
    )
    if user is None:
        user = ClassroomUser(username=username)
        db.add(user)
    user.password_hash = _hash_user_password(payload.password)
    user.assigned_room_id = payload.assigned_room_id
    db.commit()
    _invalidate_auth_cache(user.username)
    return {"username": user.username, "status": "credentials set"}


@app.put("/api/admin/users/{username}/room", dependencies=[Depends(require_admin)])
def assign_user_room(
    username: str,
    payload: RoomAssignmentRequest,
    db: Session = Depends(get_db),
) -> dict:
    user = db.scalar(
        select(ClassroomUser).where(func.lower(ClassroomUser.username) == username.lower())
    )
    if user is None:
        raise HTTPException(status_code=404, detail="User account not found.")
    room = db.get(ClassroomRoom, payload.room_id) if payload.room_id else None
    if payload.room_id and room is None:
        raise HTTPException(status_code=404, detail="Room not found.")
    user.assigned_room_id = room.id if room else None
    db.commit()
    _invalidate_auth_cache(user.username)
    return {
        "username": user.username,
        "assigned_room": _room_identity(room) if room else None,
    }


def _find_user(db: Session, username: str) -> ClassroomUser:
    user = db.scalar(
        select(ClassroomUser).where(func.lower(ClassroomUser.username) == username.lower())
    )
    if user is None:
        raise HTTPException(status_code=404, detail="User account not found.")
    return user


@app.post("/api/admin/users/{username}/approve", dependencies=[Depends(require_admin)])
def approve_user(username: str, db: Session = Depends(get_db)) -> dict:
    user = _find_user(db, username)
    if user.status == "active":
        return {"username": user.username, "status": "active"}
    if user.section_id is None:
        raise HTTPException(
            status_code=409,
            detail="Set this account's classroom section before approving it.",
        )
    user.status = "active"
    db.commit()
    _invalidate_auth_cache(user.username)
    return {"username": user.username, "status": "active"}


@app.put("/api/admin/users/{username}/section", dependencies=[Depends(require_admin)])
def assign_user_section(
    username: str,
    payload: SectionAssignmentRequest,
    db: Session = Depends(get_db),
) -> dict:
    user = _find_user(db, username)
    section = db.get(ClassroomSection, payload.section_id) if payload.section_id else None
    if payload.section_id and section is None:
        raise HTTPException(status_code=404, detail="Section not found.")
    user.section_id = section.id if section else None
    db.commit()
    _invalidate_auth_cache(user.username)
    return {"username": user.username, "section": _section_dict(section) if section else None}


@app.delete("/api/admin/users/{username}", dependencies=[Depends(require_admin)])
def delete_user(username: str, db: Session = Depends(get_db)) -> dict[str, str]:
    user = _find_user(db, username)
    has_records = db.scalar(
        select(func.count()).select_from(UsageRecord).where(UsageRecord.user_id == user.id)
    )
    if has_records:
        raise HTTPException(
            status_code=409, detail="This account has usage records and cannot be removed."
        )
    db.delete(user)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(
            status_code=409, detail="This account has usage records and cannot be removed."
        ) from error
    _invalidate_auth_cache(user.username)
    return {"status": "user removed"}


def _month_bounds(month: str) -> tuple[datetime, datetime]:
    try:
        start = datetime.strptime(month, "%Y-%m")
    except ValueError as error:
        raise HTTPException(status_code=422, detail="Month must use YYYY-MM format.") from error
    end = datetime(start.year + (start.month == 12), start.month % 12 + 1, 1)
    return start, end


@app.get("/api/admin/dashboard", dependencies=[Depends(require_admin)])
def admin_dashboard(
    month: str | None = None,
    db: Session = Depends(get_db),
    users_limit: int = 50,
    users_offset: int = 0,
    sections_limit: int = 50,
    sections_offset: int = 0,
) -> dict:
    now = datetime.now()
    month = month or now.strftime("%Y-%m")
    start, end = _month_bounds(month)
    users_limit = max(1, min(users_limit, 200))
    users_offset = max(0, users_offset)
    sections_limit = max(1, min(sections_limit, 200))
    sections_offset = max(0, sections_offset)
    # Identical dashboard requests that arrive together share one computation
    # instead of each running the full set of aggregates.
    flight_key = f"dashboard:{month}:{users_limit}:{users_offset}:{sections_limit}:{sections_offset}"
    return _dashboard_flight.get(flight_key, lambda: _build_dashboard(
        month, start, end, users_limit, users_offset, sections_limit, sections_offset
    ))


def _build_dashboard(
    month: str,
    start: datetime,
    end: datetime,
    users_limit: int,
    users_offset: int,
    sections_limit: int,
    sections_offset: int,
) -> dict:
    # Six-month trend as one grouped query instead of one round trip per
    # month: substr(cast(created_at), 1, 7) produces the YYYY-MM bucket key
    # on both SQLite and Postgres.
    base_index = start.year * 12 + start.month - 1
    bucket_starts: list[datetime] = []
    for offset in range(5, -1, -1):
        year, month_number = divmod(base_index - offset, 12)
        bucket_starts.append(datetime(year, month_number + 1, 1))
    trend_key = func.substr(cast(UsageRecord.created_at, String), 1, 7)

    def _load_month_data() -> tuple:
        """Per-section totals and the month total, in one session.

        The old version pulled every usage row for the month into Python and
        summed them there, then loaded three more tables per row. The sums
        are identical; only the row count of the payload changes.
        """
        with SessionLocal() as session:
            rows = session.execute(
                select(
                    ClassroomSection.name,
                    func.sum(UsageRecord.energy_kwh),
                    func.count(UsageRecord.id),
                )
                .select_from(UsageRecord)
                .join(ClassroomSection, ClassroomSection.id == UsageRecord.section_id)
                .where(UsageRecord.created_at >= start, UsageRecord.created_at < end)
                .group_by(ClassroomSection.name)
            ).all()
            # The month total is summed straight from the rows, separately from
            # the per-section subtotals, so the figure matches the previous
            # row-by-row sum exactly.
            total_row = session.execute(
                select(
                    func.sum(UsageRecord.energy_kwh),
                    func.count(UsageRecord.id),
                ).where(UsageRecord.created_at >= start, UsageRecord.created_at < end)
            ).one()
        return rows, (float(total_row[0] or 0), int(total_row[1] or 0))

    def _load_trend() -> dict:
        with SessionLocal() as session:
            return {
                key: float(total or 0)
                for key, total in session.execute(
                    select(trend_key, func.sum(UsageRecord.energy_kwh))
                    .where(UsageRecord.created_at >= bucket_starts[0], UsageRecord.created_at < end)
                    .group_by(trend_key)
                ).all()
            }

    def _load_users_and_catalogs() -> tuple:
        """The account list, the rooms, the counts and the shared catalogs.

        These are all small lookups, so they share one session rather than
        paying for a connection each.
        """
        with SessionLocal() as session:
            rows = session.execute(
                select(
                    ClassroomUser.username,
                    ClassroomUser.status,
                    ClassroomUser.last_seen,
                    ClassroomUser.password_hash.is_not(None),
                    ClassroomUser.section_id,
                    ClassroomUser.assigned_room_id,
                    func.count(UsageRecord.id),
                )
                .select_from(ClassroomUser)
                .outerjoin(UsageRecord, UsageRecord.user_id == ClassroomUser.id)
                .group_by(ClassroomUser.id)
                .order_by(ClassroomUser.last_seen.desc())
                .limit(users_limit)
                .offset(users_offset)
            ).all()
            room_ids = {
                assigned_room_id
                for _u, _s, _l, _c, _sec, assigned_room_id, _r in rows
                if assigned_room_id
            }
            rooms = {}
            if room_ids:
                rooms = {
                    room.id: _room_identity(room)
                    for room in session.scalars(
                        select(ClassroomRoom).where(ClassroomRoom.id.in_(room_ids))
                    )
                }
            counts = session.execute(
                select(
                    select(func.count()).select_from(ClassroomUser).scalar_subquery(),
                    select(func.count()).select_from(ClassroomSection).scalar_subquery(),
                    select(func.count())
                    .select_from(ClassroomUser)
                    .where(ClassroomUser.status == "pending")
                    .scalar_subquery(),
                )
            ).one()
            sections = [
                _section_dict(item)
                for item in session.scalars(
                    select(ClassroomSection).order_by(ClassroomSection.name)
                )
            ]
            appliances = [
                _appliance_dict(item)
                for item in session.scalars(
                    select(Appliance)
                    .where(Appliance.archived.is_(False))
                    .order_by(Appliance.name)
                )
            ]
        return rows, rooms, counts, sections, appliances

    # The two scans over the usage table are the expensive part, so they run
    # at the same time; the small lookups share a single session.
    (month_rows, month_total), monthly_kwh, (
        user_rows,
        rooms,
        counts,
        sections_catalog,
        appliances,
    ) = _run_parallel(
        [
            _load_month_data,
            _load_trend,
            _load_users_and_catalogs,
        ]
    )
    # Sort on the raw sum, exactly as the previous Python-side aggregation
    # did, so the ordering of equal totals is unchanged.
    section_rows = [
        {"name": name, "kwh": kwh, "bill": bill, "_raw": float(total or 0)}
        for name, total, _count in month_rows
        for kwh, bill in [_kwh_and_bill(float(total or 0))]
    ]
    section_rows.sort(key=lambda row: row["_raw"], reverse=True)
    for row in section_rows:
        row.pop("_raw")
    total_kwh, record_count = month_total
    monthly = []
    for bucket_start in bucket_starts:
        total = monthly_kwh.get(bucket_start.strftime("%Y-%m"), 0)
        kwh, bill = _kwh_and_bill(total)
        monthly.append(
            {
                "month": bucket_start.strftime("%b %Y"),
                "kwh": kwh,
                "bill": bill,
            }
        )
    user_count, section_count, pending_count = counts
    dashboard_kwh, dashboard_bill = _kwh_and_bill(total_kwh)
    # Paginate sections
    paginated_sections = section_rows[sections_offset : sections_offset + sections_limit]
    section_lookup = {item["id"]: item for item in sections_catalog}
    return {
        "month": month,
        "rate_php_per_kwh": ELECTRICITY_RATE,
        "total_kwh": dashboard_kwh,
        "estimated_bill_php": dashboard_bill,
        "record_count": record_count,
        "user_count": user_count,
        "section_count": section_count,
        "pending_count": pending_count,
        "highest_section": section_rows[0]["name"] if section_rows else None,
        "monthly": monthly,
        "sections": paginated_sections,
        "sections_total": len(section_rows),
        "users": [
            {
                "username": username,
                "records": count,
                "last_seen": last_seen.isoformat(),
                "status": status,
                "section": section_lookup.get(section_id),
                "credentials_set": credentials_set,
                "assigned_room": rooms.get(assigned_room_id),
            }
            for username, status, last_seen, credentials_set, section_id, assigned_room_id, count in user_rows
        ],
        "users_total": user_count,
        "sections_catalog": sections_catalog,
        "appliances": appliances,
    }


@app.get("/api/admin/reports", dependencies=[Depends(require_admin)])
def admin_reports(
    month: str | None = None,
    group: str = "day",
    building: str | None = None,
    room_id: int | None = None,
    section_id: int | None = None,
    appliance_id: int | None = None,
    db: Session = Depends(get_db),
) -> dict:
    """Daily / weekly / monthly usage buckets plus usage patterns for a month.

    Optional criteria narrow the report to one building, room, section, or
    appliance; an empty report is a valid answer rather than an error.
    """
    if group not in ("day", "week", "month"):
        raise HTTPException(status_code=422, detail="Group must be day, week, or month.")
    now = datetime.now()
    month = month or now.strftime("%Y-%m")
    start, end = _month_bounds(month)
    # Identical report requests that arrive together share one computation.
    flight_key = (
        f"reports:{month}:{group}:{building}:{room_id}:{section_id}:{appliance_id}"
    )
    return _reports_flight.get(flight_key, lambda: _build_reports(
        month, group, building, room_id, section_id, appliance_id, start, end
    ))


def _build_reports(
    month: str,
    group: str,
    building: str | None,
    room_id: int | None,
    section_id: int | None,
    appliance_id: int | None,
    start: datetime,
    end: datetime,
) -> dict:
    db = SessionLocal()
    filters = []
    if building:
        filters.append(
            UsageRecord.room_id.in_(
                select(ClassroomRoom.id).where(ClassroomRoom.building_code == building)
            )
        )
    if room_id:
        filters.append(UsageRecord.room_id == room_id)
    if section_id:
        filters.append(UsageRecord.section_id == section_id)
    if appliance_id:
        filters.append(UsageRecord.appliance_id == appliance_id)

    # The appliance and room labels come from small lookup tables, so they are
    # fetched once each instead of being joined onto every usage row.
    appliance_names = {
        item.id: item.name
        for item in db.scalars(select(Appliance))
    }
    room_labels = {
        item.id: f"{item.building_code} {item.room_number}"
        for item in db.scalars(select(ClassroomRoom))
    }

    records = list(
        db.scalars(
            select(UsageRecord)
            .where(
                UsageRecord.created_at >= start,
                UsageRecord.created_at < end,
                *filters,
            )
            # Only the energy and the timestamps are read from the row; the
            # appliance and room labels come from the lookups above.
            .options(
                load_only(
                    UsageRecord.energy_kwh,
                    UsageRecord.started_at,
                    UsageRecord.created_at,
                    UsageRecord.occupants,
                    UsageRecord.appliance_id,
                    UsageRecord.room_id,
                ),
            )
            .order_by(UsageRecord.created_at)
        )
    )

    def bucket_key(moment: datetime) -> str:
        if group == "day":
            return moment.strftime("%Y-%m-%d")
        if group == "week":
            monday = moment - timedelta(days=moment.weekday())
            return monday.strftime("%Y-%m-%d")
        return moment.strftime("%Y-%m")

    def bucket_label(key: str) -> str:
        if group == "day":
            moment = datetime.strptime(key, "%Y-%m-%d")
            return f"{moment.strftime('%b')} {moment.day}"
        if group == "week":
            monday = datetime.strptime(key, "%Y-%m-%d")
            sunday = min(monday + timedelta(days=6), end - timedelta(days=1))
            return f"{monday.strftime('%b')} {monday.day} – {sunday.strftime('%b')} {sunday.day}"
        moment = datetime.strptime(key, "%Y-%m")
        return moment.strftime("%b %Y")

    bucketed: dict[str, list[UsageRecord]] = {}
    if group == "month":
        cursor = datetime(start.year, start.month, 1)
        for _ in range(12):
            bucketed[cursor.strftime("%Y-%m")] = []
            prev_month = cursor - timedelta(days=1)
            cursor = datetime(prev_month.year, prev_month.month, 1)
        earliest = min(bucketed)
        earliest_start = datetime.strptime(earliest, "%Y-%m")
        month_records = list(
            db.scalars(
                select(UsageRecord)
                # The twelve buckets end with the selected month, so records
                # after it fall outside every bucket and are dropped anyway.
                # Bounding the scan here reads less and returns the same rows.
                .where(
                    UsageRecord.created_at >= earliest_start,
                    UsageRecord.created_at < end,
                    *filters,
                )
                .options(
                    load_only(
                        UsageRecord.energy_kwh,
                        UsageRecord.started_at,
                        UsageRecord.created_at,
                        UsageRecord.appliance_id,
                    ),
                )
                .order_by(UsageRecord.created_at)
            )
        )
        for record in month_records:
            key = _usage_moment(record).strftime("%Y-%m")
            if key in bucketed:
                bucketed[key].append(record)
    else:
        if group == "day":
            for day in range(1, monthrange(start.year, start.month)[1] + 1):
                bucketed[datetime(start.year, start.month, day).strftime("%Y-%m-%d")] = []
        else:
            monday = start - timedelta(days=start.weekday())
            while monday < end:
                bucketed[monday.strftime("%Y-%m-%d")] = []
                monday += timedelta(days=7)
        for record in records:
            bucketed.setdefault(bucket_key(_usage_moment(record)), []).append(record)

    def summarize(rows: list[UsageRecord]) -> dict:
        top: dict[str, float] = {}
        for record in rows:
            name = appliance_names.get(record.appliance_id)
            top[name] = top.get(name, 0) + record.energy_kwh
        kwh = sum(record.energy_kwh for record in rows)
        rounded_kwh, bill = _kwh_and_bill(kwh)
        return {
            "sessions": len(rows),
            "kwh": rounded_kwh,
            "bill": bill,
            "top_appliance": max(top, key=top.get) if top else None,
        }

    buckets = [
        {"period": bucket_label(key), **summarize(rows)}
        for key, rows in sorted(bucketed.items())
    ]

    weekday_kwh = [0.0] * 7
    hour_kwh = [0.0] * 24
    appliance_kwh: dict[str, float] = {}
    room_kwh: dict[str, float] = {}
    occupant_total = 0
    occupant_count = 0
    for record in records:
        moment = record.started_at or record.created_at
        weekday_kwh[moment.weekday()] += record.energy_kwh
        hour_kwh[moment.hour] += record.energy_kwh
        appliance_name = appliance_names.get(record.appliance_id)
        appliance_kwh[appliance_name] = appliance_kwh.get(appliance_name, 0) + record.energy_kwh
        room_label = (
            room_labels.get(record.room_id)
            if record.room_id
            else "Unassigned"
        )
        room_kwh[room_label] = room_kwh.get(room_label, 0) + record.energy_kwh
        if record.occupants is not None:
            occupant_total += record.occupants
            occupant_count += 1

    def hour_label(hour: int) -> str:
        return f"{hour % 12 or 12} {'AM' if hour < 12 else 'PM'}"

    patterns = {
        "peak_weekday": (
            {"day": day_name[max(range(7), key=lambda index: weekday_kwh[index])],
             "kwh": round(max(weekday_kwh), KWH_PRECISION)}
            if records else None
        ),
        "peak_hour": (
            {"hour": hour_label(max(range(24), key=lambda index: hour_kwh[index])),
             "kwh": round(max(hour_kwh), KWH_PRECISION)}
            if records else None
        ),
        "top_appliance": (
            {"name": max(appliance_kwh, key=appliance_kwh.get),
             "kwh": round(max(appliance_kwh.values()), KWH_PRECISION)}
            if appliance_kwh else None
        ),
        "busiest_room": (
            {"room": max(room_kwh, key=room_kwh.get),
             "kwh": round(max(room_kwh.values()), KWH_PRECISION)}
            if room_kwh else None
        ),
        "avg_occupants": round(occupant_total / occupant_count, 1) if occupant_count else None,
    }
    total_kwh = sum(record.energy_kwh for record in records)
    report_kwh, report_bill = _kwh_and_bill(total_kwh)
    result = {
        "month": month,
        "group": group,
        "buckets": buckets,
        "patterns": patterns,
        "criteria": {
            "building": building,
            "room_id": room_id,
            "section_id": section_id,
            "appliance_id": appliance_id,
        },
        "total_kwh": report_kwh,
        "total_bill": report_bill,
        "session_count": len(records),
        # Rankings power the report search box ("which room uses the most?").
        "room_ranking": [
            {"room": name, "kwh": round(value, KWH_PRECISION)}
            for name, value in sorted(
                room_kwh.items(), key=lambda item: item[1], reverse=True
            )
        ],
        "appliance_ranking": [
            {"name": name, "kwh": round(value, KWH_PRECISION)}
            for name, value in sorted(
                appliance_kwh.items(), key=lambda item: item[1], reverse=True
            )
        ],
    }
    db.close()
    return result


@app.post("/api/admin/sections", status_code=201, dependencies=[Depends(require_admin)])
def add_section(payload: SectionRequest, db: Session = Depends(get_db)) -> dict:
    grade = payload.grade.strip()
    section_name = " ".join(payload.section_name.split()).upper()
    name = f"{grade} - {section_name}"
    if db.scalar(select(ClassroomSection.id).where(func.lower(ClassroomSection.name) == name.lower())):
        raise HTTPException(status_code=409, detail="That section already exists.")
    section = ClassroomSection(name=name, grade=grade, section_name=section_name)
    db.add(section)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(
            status_code=409, detail="That section already exists."
        ) from error
    return _section_dict(section)


def _room_map_stats(db: Session) -> tuple[dict[int, dict], dict[str, float], dict[int, list[str]]]:
    """Trailing-30-day usage per room, per-building average kWh/room, and
    assigned usernames per room. Usage is aggregated in SQL so the routes
    never stream raw usage rows just to count them."""
    cutoff = utc_now() - timedelta(days=30)
    rooms = list(db.scalars(select(ClassroomRoom)))
    room_usage: dict[int, dict] = {
        room.id: {"kwh": 0.0, "appliance_count": 0, "submissions": 0} for room in rooms
    }
    usage_totals = db.execute(
        select(
            UsageRecord.room_id,
            func.sum(UsageRecord.energy_kwh),
            func.count(UsageRecord.id),
            func.count(UsageRecord.appliance_id.distinct()),
        )
        .where(UsageRecord.room_id.is_not(None), UsageRecord.created_at >= cutoff)
        .group_by(UsageRecord.room_id)
    ).all()
    for room_id, kwh, submissions, appliance_count in usage_totals:
        metrics = room_usage.get(room_id)
        if metrics is None:
            continue
        metrics["kwh"] = float(kwh or 0)
        metrics["submissions"] = submissions
        metrics["appliance_count"] = appliance_count

    building_totals: dict[str, float] = {}
    building_counts: dict[str, int] = {}
    for room in rooms:
        building_totals[room.building_code] = (
            building_totals.get(room.building_code, 0.0) + room_usage[room.id]["kwh"]
        )
        building_counts[room.building_code] = building_counts.get(room.building_code, 0) + 1
    building_average = {
        code: building_totals[code] / building_counts[code] if building_counts[code] else 0.0
        for code in building_totals
    }

    room_users: dict[int, list[str]] = {room.id: [] for room in rooms}
    # Only the name and the assigned room are needed here, so the password
    # hash and the rest of the account row are never read.
    assigned = db.execute(
        select(ClassroomUser.username, ClassroomUser.assigned_room_id)
        .where(ClassroomUser.assigned_room_id.is_not(None))
        .order_by(ClassroomUser.username)
    ).all()
    for username, assigned_room_id in assigned:
        if assigned_room_id in room_users:
            room_users[assigned_room_id].append(username)

    return room_usage, building_average, room_users


def _room_status(average: float, building_average: float) -> str:
    """High-use at 1.5x the building's per-room average (per project rules)."""
    return "high" if building_average > 0 and average >= building_average * 1.5 else "average"


@app.get("/api/admin/rooms", dependencies=[Depends(require_admin)])
def admin_rooms(db: Session = Depends(get_db)) -> dict:
    # The room list and the usage totals are independent reads, so they are
    # fetched at the same time, each on its own session.
    def _rooms() -> list[ClassroomRoom]:
        with SessionLocal() as session:
            return _ordered_rooms(session)

    def _stats() -> tuple[dict[int, dict], dict[str, float], dict[int, list[str]]]:
        with SessionLocal() as session:
            return _room_map_stats(session)

    rooms, stats = _run_parallel([_rooms, _stats])
    room_usage, building_average, room_users = stats

    buildings = []
    building_names = {room.building_code: room.building_name for room in rooms}
    for building_code, building_name in building_names.items():
        building_rooms = [room for room in rooms if room.building_code == building_code]
        average = building_average.get(building_code, 0.0)
        room_rows = []
        for room in building_rooms:
            metrics = room_usage[room.id]
            room_average = metrics["kwh"]
            room_rows.append(
                {
                    **_room_identity(room),
                    "display_name": room.room_name or f"Room {room.room_number}",
                    "display_type": room.custom_type if room.room_type == "custom" else room.room_type,
                    "average_kwh": round(room_average, 4),
                    "appliance_count": metrics["appliance_count"],
                    "submission_count": metrics["submissions"],
                    "assigned_users": room_users[room.id],
                    "building_average_kwh": round(average, 3),
                    "usage_status": _room_status(room_average, average),
                }
            )
        buildings.append(
            {
                "code": building_code,
                "name": building_name,
                "average_kwh_per_room": round(average, 4),
                "total_kwh": round(sum(row["average_kwh"] for row in room_rows), 3),
                "rooms": room_rows,
            }
        )
    return {"period_days": 30, "buildings": buildings}


@app.get("/api/admin/rooms/{room_id}", dependencies=[Depends(require_admin)])
def room_detail(room_id: int, db: Session = Depends(get_db)) -> dict:
    room = db.get(ClassroomRoom, room_id)
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found.")
    room_usage, building_average, room_users = _room_map_stats(db)
    metrics = room_usage[room.id]
    average = metrics["kwh"]
    building = building_average.get(room.building_code, 0.0)
    cutoff = utc_now() - timedelta(days=30)
    recent = list(
        db.scalars(
            select(UsageRecord)
            .where(UsageRecord.room_id == room_id, UsageRecord.created_at >= cutoff)
            .options(
                joinedload(UsageRecord.appliance),
                joinedload(UsageRecord.user),
            )
            .order_by(UsageRecord.created_at.desc())
            .limit(5)
        )
    )
    return {
        **_room_identity(room),
        "display_name": room.room_name or f"Room {room.room_number}",
        "display_type": room.custom_type if room.room_type == "custom" else room.room_type,
        "average_kwh": round(average, 4),
        "appliance_count": metrics["appliance_count"],
        "submission_count": metrics["submissions"],
        "assigned_users": room_users[room.id],
        "building_average_kwh": round(building, 4),
        "usage_status": _room_status(average, building),
        "recent": [
            {
                "id": record.id,
                "username": record.user.username,
                "appliance": record.appliance.name,
                "hours": record.hours,
                "energy_kwh": record.energy_kwh,
                "created_at": record.created_at.isoformat(),
            }
            for record in recent
        ],
    }


@app.put("/api/admin/rooms/{room_id}", dependencies=[Depends(require_admin)])
def update_room(
    room_id: int,
    payload: RoomUpdateRequest,
    db: Session = Depends(get_db),
) -> dict:
    room = db.get(ClassroomRoom, room_id)
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found.")
    custom_type = (payload.custom_type or "").strip()
    if payload.room_type == "custom" and len(custom_type) < 2:
        raise HTTPException(status_code=422, detail="Enter a custom room type.")
    room.room_type = payload.room_type
    room.custom_type = custom_type if payload.room_type == "custom" else None
    room.room_name = (payload.room_name or "").strip() or None
    db.commit()
    return _room_identity(room)


@app.delete("/api/admin/sections/{section_id}", dependencies=[Depends(require_admin)])
def delete_section(section_id: int, db: Session = Depends(get_db)) -> dict[str, str]:
    section = db.get(ClassroomSection, section_id)
    if section is None:
        raise HTTPException(status_code=404, detail="Section not found.")
    assigned_users = db.scalar(
        select(func.count()).select_from(ClassroomUser).where(ClassroomUser.section_id == section_id)
    )
    if assigned_users:
        raise HTTPException(status_code=409, detail="This section has assigned accounts and cannot be removed.")
    has_records = db.scalar(
        select(func.count()).select_from(UsageRecord).where(UsageRecord.section_id == section_id)
    )
    if has_records:
        raise HTTPException(status_code=409, detail="This section has usage records and cannot be removed.")
    db.delete(section)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail="This section is still in use and cannot be removed.") from error
    return {"status": "section removed"}


@app.post("/api/admin/appliances", status_code=201, dependencies=[Depends(require_admin)])
def add_appliance(payload: ApplianceRequest, db: Session = Depends(get_db)) -> dict:
    name = " ".join(payload.name.split())
    if db.scalar(select(Appliance.id).where(func.lower(Appliance.name) == name.lower())):
        raise HTTPException(status_code=409, detail="That appliance already exists.")
    appliance = Appliance(name=name, wattage=payload.wattage, quantity=payload.quantity)
    db.add(appliance)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(
            status_code=409, detail="That appliance already exists."
        ) from error
    return _appliance_dict(appliance)


@app.put("/api/admin/appliances/{appliance_id}", dependencies=[Depends(require_admin)])
def update_appliance(appliance_id: int, payload: ApplianceRequest, db: Session = Depends(get_db)) -> dict:
    appliance = db.get(Appliance, appliance_id)
    if appliance is None:
        raise HTTPException(status_code=404, detail="Appliance not found.")
    appliance.name = " ".join(payload.name.split())
    appliance.wattage = payload.wattage
    appliance.quantity = payload.quantity
    db.commit()
    return _appliance_dict(appliance)


@app.delete("/api/admin/appliances/{appliance_id}", dependencies=[Depends(require_admin)])
def delete_appliance(appliance_id: int, db: Session = Depends(get_db)) -> dict[str, str]:
    appliance = db.get(Appliance, appliance_id)
    if appliance is None:
        raise HTTPException(status_code=404, detail="Appliance not found.")
    has_records = db.scalar(
        select(func.count()).select_from(UsageRecord).where(UsageRecord.appliance_id == appliance_id)
    )
    if has_records:
        # Keep the row so historical usage records stay readable, but hide it from the catalog.
        appliance.archived = True
        db.commit()
        return {"status": "appliance archived"}
    db.delete(appliance)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail="This appliance has usage records and cannot be removed.") from error
    return {"status": "appliance removed"}


# --- One-shot maintenance ---------------------------------------------------
# Destructive: wipes usage history, prunes accounts, and replaces the appliance
# catalog. Admin-only, and every step is skipped unless explicitly requested,
# so calling it with an empty payload is a no-op.
class MaintenanceResetRequest(BaseModel):
    keep_users: list[str] = Field(default_factory=list)
    appliances: list[ApplianceRequest] = Field(default_factory=list)
    wipe_records: bool = False
    replace_appliances: bool = False


@app.post("/api/admin/maintenance/reset", dependencies=[Depends(require_admin)])
def maintenance_reset(
    payload: MaintenanceResetRequest,
    db: Session = Depends(get_db),
) -> dict:
    deleted_records = 0
    if payload.wipe_records:
        result = db.execute(delete(UsageRecord))
        deleted_records = result.rowcount or 0

    deleted_users: list[str] = []
    if payload.keep_users:
        keep = {" ".join(name.split()).lower() for name in payload.keep_users}
        for user in list(db.scalars(select(ClassroomUser))):
            if user.username.strip().lower() in keep:
                continue
            deleted_users.append(user.username)
            db.delete(user)

    replaced_appliances: list[str] = []
    if payload.replace_appliances:
        for appliance in list(db.scalars(select(Appliance))):
            replaced_appliances.append(appliance.name)
            db.delete(appliance)
        # Flush the deletes before inserting so the unique name index cannot
        # collide with a row that is still pending removal in this transaction.
        db.flush()
        for item in payload.appliances:
            db.add(
                Appliance(
                    name=" ".join(item.name.split()),
                    wattage=item.wattage,
                    quantity=item.quantity,
                )
            )

    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Maintenance reset failed and was rolled back.",
        ) from error

    return {
        "deleted_records": deleted_records,
        "deleted_users": sorted(deleted_users),
        "replaced_appliances": sorted(replaced_appliances),
        "kept_users": sorted(
            " ".join(item.split()) for item in payload.keep_users
        ),
    }

@app.get("/api/user/workspace")
def get_workspace(
    user: AuthUser = Depends(require_user),
) -> dict:
    """Return the signed-in account's workspace identity."""
    role = "owner" if user.workspace_name and user.role != "emc" else (user.role or "user")
    return {
        "name": user.workspace_name,
        "workspace_name": user.workspace_name,
        "role": role,
    }


@app.put("/api/user/workspace")
def update_workspace(
    payload: WorkspaceUpdate,
    user: AuthUser = Depends(require_user),
    db: Session = Depends(get_db)
) -> dict:
    workspace_name = _clean_text(payload.workspace_name, max_length=255)
    if not workspace_name:
        raise HTTPException(status_code=400, detail="Workspace name is required.")
    row = db.get(ClassroomUser, user.id)
    if row is None:
        raise HTTPException(status_code=404, detail="Account not found.")
    row.workspace_name = workspace_name
    if row.role != "emc":
        row.role = "owner"
    db.commit()
    _invalidate_auth_cache(row.username)
    return {"message": "Workspace updated successfully", "workspace_name": row.workspace_name}


@app.get("/api/user/buildings")
def list_user_buildings(
    user: AuthUser = Depends(require_user),
    db: Session = Depends(get_db)
) -> list[BuildingSummary]:
    """List all buildings for the current user."""
    # Query rooms grouped by building_code/building_name for this user
    from sqlalchemy import func
    
    building_query = (
        select(
            ClassroomRoom.building_code,
            ClassroomRoom.building_name,
            func.count(func.distinct(ClassroomRoom.floor)).label("floor_count"),
            func.count(ClassroomRoom.id).label("room_count")
        )
        .where(ClassroomRoom.owner_id == user.id)
        .group_by(ClassroomRoom.building_code, ClassroomRoom.building_name)
    )
    
    buildings = db.execute(building_query).all()
    
    return [
        BuildingSummary(
            building_code=row.building_code,
            building_name=row.building_name,
            floor_count=row.floor_count,
            room_count=row.room_count
        )
        for row in buildings
    ]


@app.post("/api/user/buildings", status_code=201)
def create_user_building(
    payload: BuildingDetail,
    user: AuthUser = Depends(require_user),
    db: Session = Depends(get_db)
) -> dict:
    """Create a new building reservation (validates uniqueness)."""
    building_code = _clean_text(payload.building_code, max_length=16)
    building_name = _clean_text(payload.building_name, max_length=64)
    if not building_code or not building_name:
        raise HTTPException(status_code=400, detail="Building code and name are required.")
    # The room table has a global (building_code, floor, room_index) constraint,
    # so a code must be unique across the whole database, not just one campus.
    # Check it here to return a useful message instead of a database error.
    if db.scalar(
        select(ClassroomRoom.id)
        .where(func.lower(ClassroomRoom.building_code) == building_code.lower())
        .limit(1)
    ):
        raise HTTPException(
            status_code=409,
            detail="That building code is already in use. Choose a unique code.",
        )
    # Check if building already exists for this user
    existing = db.scalar(
        select(ClassroomRoom.id)
        .where(
            ClassroomRoom.owner_id == user.id,
            ClassroomRoom.building_code == building_code,
            ClassroomRoom.building_name == building_name
        )
        .limit(1)
    )
    
    if existing:
        raise HTTPException(
            status_code=409,
            detail="Building with this code and name already exists"
        )
    
    # To "reserve" the building, we create a placeholder room with minimal info
    # In practice, the building becomes real when rooms are added to it
    # We'll create a dummy room on floor 0, room_index 0 that won't be used for actual classes
    placeholder_room = ClassroomRoom(
        building_code=building_code,
        building_name=building_name,
        floor=0,
        room_index=0,
        room_number=0,  # Special placeholder
        room_type="placeholder",
        owner_id=user.id
    )
    db.add(placeholder_room)
    # Records require a section; give the workspace one on first building.
    _ensure_owner_section(db, user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Building creation failed due to conflict"
        )
    
    return {"message": "Building created successfully"}


@app.get("/api/user/buildings/{building_code}")
def get_user_building(
    building_code: str,
    user: AuthUser = Depends(require_user),
    db: Session = Depends(get_db)
) -> BuildingDetail:
    """Get details of a specific building."""
    # Verify building exists and belongs to user
    building_room = db.scalar(
        select(ClassroomRoom)
        .where(
            ClassroomRoom.owner_id == user.id,
            ClassroomRoom.building_code == building_code
        )
        .limit(1)
    )
    
    if not building_room:
        raise HTTPException(
            status_code=404,
            detail="Building not found"
        )
    
    return BuildingDetail(
        building_code=building_room.building_code,
        building_name=building_room.building_name
    )


@app.put("/api/user/buildings/{building_code}")
def update_user_building(
    building_code: str,
    payload: BuildingDetail,
    user: AuthUser = Depends(require_user),
    db: Session = Depends(get_db)
) -> dict:
    """Update a building's name."""
    new_code = _clean_text(payload.building_code, max_length=16)
    new_name = _clean_text(payload.building_name, max_length=64)
    if not new_code or not new_name:
        raise HTTPException(status_code=400, detail="Building code and name are required.")
    # Verify building exists and belongs to user
    building_room = db.scalar(
        select(ClassroomRoom)
        .where(
            ClassroomRoom.owner_id == user.id,
            ClassroomRoom.building_code == building_code
        )
        .limit(1)
    )
    
    if not building_room:
        raise HTTPException(
            status_code=404,
            detail="Building not found"
        )
    
    # Check if new name conflicts with existing building
    if new_code != building_code:
        # Changing building code - check if new code already exists
        conflict = db.scalar(
            select(ClassroomRoom.id)
            .where(
                ClassroomRoom.owner_id == user.id,
                ClassroomRoom.building_code == new_code,
                ClassroomRoom.building_name == new_name
            )
            .limit(1)
        )
        if conflict:
            raise HTTPException(
                status_code=409,
                detail="Building with this code and name already exists"
            )
    
    # Update all rooms in this building
    db.execute(
        update(ClassroomRoom)
        .where(
            ClassroomRoom.owner_id == user.id,
            ClassroomRoom.building_code == building_code
        )
        .values(
            building_code=new_code,
            building_name=new_name
        )
    )
    db.commit()
    
    return {"message": "Building updated successfully"}


@app.delete("/api/user/buildings/{building_code}")
def delete_user_building(
    building_code: str,
    user: AuthUser = Depends(require_user),
    db: Session = Depends(get_db)
) -> dict:
    """Delete a building (only if it has no rooms/floors)."""
    # Check if building exists and belongs to user
    building_exists = db.scalar(
        select(ClassroomRoom.id)
        .where(
            ClassroomRoom.owner_id == user.id,
            ClassroomRoom.building_code == building_code
        )
        .limit(1)
    )
    
    if not building_exists:
        raise HTTPException(
            status_code=404,
            detail="Building not found"
        )
    
    # Check if building has any rooms (excluding placeholders)
    room_count = db.scalar(
        select(func.count(ClassroomRoom.id))
        .where(
            ClassroomRoom.owner_id == user.id,
            ClassroomRoom.building_code == building_code,
            ClassroomRoom.floor > 0  # Exclude placeholder floors
        )
    )
    
    if room_count > 0:
        raise HTTPException(
            status_code=409,
            detail="Cannot delete building that still contains rooms"
        )
    
    # Delete placeholder rooms for this building
    db.execute(
        delete(ClassroomRoom)
        .where(
            ClassroomRoom.owner_id == user.id,
            ClassroomRoom.building_code == building_code,
            ClassroomRoom.floor == 0  # Placeholder rooms
        )
    )
    db.commit()
    
    return {"message": "Building deleted successfully"}


# --- Floor Management Endpoints ---


@app.get("/api/user/buildings/{building_code}/floors")
def list_building_floors(
    building_code: str,
    user: AuthUser = Depends(require_user),
    db: Session = Depends(get_db)
) -> list[FloorSummary]:
    """List all floors in a building for the current user."""
    # Verify building belongs to user
    building_check = db.scalar(
        select(ClassroomRoom.id)
        .where(
            ClassroomRoom.owner_id == user.id,
            ClassroomRoom.building_code == building_code
        )
        .limit(1)
    )
    
    if not building_check:
        raise HTTPException(
            status_code=404,
            detail="Building not found"
        )
    
    # Query distinct floors for this building and user
    from sqlalchemy import func
    
    floor_query = (
        select(
            ClassroomRoom.floor,
            func.count(ClassroomRoom.id).label("room_count")
        )
        .where(
            ClassroomRoom.owner_id == user.id,
            ClassroomRoom.building_code == building_code,
            ClassroomRoom.floor > 0  # Exclude placeholders
        )
        .group_by(ClassroomRoom.floor)
        .order_by(ClassroomRoom.floor)
    )
    
    floors = db.execute(floor_query).all()
    
    return [
        FloorSummary(
            floor=row.floor,
            room_count=row.room_count
        )
        for row in floors
    ]


@app.post("/api/user/buildings/{building_code}/floors", status_code=201)
def add_building_floor(
    building_code: str,
    payload: FloorDetail,
    user: AuthUser = Depends(require_user),
    db: Session = Depends(get_db)
) -> dict:
    """Add a new floor to a building."""
    # Verify building belongs to user
    building_check = db.scalar(
        select(ClassroomRoom.id)
        .where(
            ClassroomRoom.owner_id == user.id,
            ClassroomRoom.building_code == building_code
        )
        .limit(1)
    )
    
    if not building_check:
        raise HTTPException(
            status_code=404,
            detail="Building not found"
        )
    
    # Check if floor already exists for this building
    floor_exists = db.scalar(
        select(ClassroomRoom.id)
        .where(
            ClassroomRoom.owner_id == user.id,
            ClassroomRoom.building_code == building_code,
            ClassroomRoom.floor == payload.floor
        )
        .limit(1)
    )
    
    if floor_exists:
        raise HTTPException(
            status_code=409,
            detail="Floor already exists in this building"
        )
    
    # Create a placeholder room for this floor to reserve it
    placeholder_room = ClassroomRoom(
        building_code=building_code,
        building_name=db.scalar(
            select(ClassroomRoom.building_name)
            .where(
                ClassroomRoom.owner_id == user.id,
                ClassroomRoom.building_code == building_code
            )
            .limit(1)
        ),
        floor=payload.floor,
        room_index=0,
        room_number=0,  # Special placeholder
        room_type="placeholder",
        owner_id=user.id
    )
    db.add(placeholder_room)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Failed to add floor due to conflict"
        )
    
    return {"message": "Floor added successfully"}


@app.get("/api/user/buildings/{building_code}/floors/{floor_number}")
def get_building_floor(
    building_code: str,
    floor_number: int,
    user: AuthUser = Depends(require_user),
    db: Session = Depends(get_db)
) -> FloorDetail:
    """Get details of a specific floor in a building."""
    # Verify building belongs to user
    building_check = db.scalar(
        select(ClassroomRoom.id)
        .where(
            ClassroomRoom.owner_id == user.id,
            ClassroomRoom.building_code == building_code
        )
        .limit(1)
    )
    
    if not building_check:
        raise HTTPException(
            status_code=404,
            detail="Building not found"
        )
    
    # Verify floor exists in this building for the user
    floor_room = db.scalar(
        select(ClassroomRoom.id)
        .where(
            ClassroomRoom.owner_id == user.id,
            ClassroomRoom.building_code == building_code,
            ClassroomRoom.floor == floor_number
        )
        .limit(1)
    )
    
    if not floor_room:
        raise HTTPException(
            status_code=404,
            detail="Floor not found in building"
        )
    
    return FloorDetail(floor=floor_number)


@app.put("/api/user/buildings/{building_code}/floors/{floor_number}")
def update_building_floor(
    building_code: str,
    floor_number: int,
    payload: FloorDetail,
    user: AuthUser = Depends(require_user),
    db: Session = Depends(get_db)
) -> dict:
    """Update a floor number (renumbering)."""
    # Verify building belongs to user
    building_check = db.scalar(
        select(ClassroomRoom.id)
        .where(
            ClassroomRoom.owner_id == user.id,
            ClassroomRoom.building_code == building_code
        )
        .limit(1)
    )
    
    if not building_check:
        raise HTTPException(
            status_code=404,
            detail="Building not found"
        )
    
    # Verify floor exists in this building for the user
    floor_room = db.scalar(
        select(ClassroomRoom.id)
        .where(
            ClassroomRoom.owner_id == user.id,
            ClassroomRoom.building_code == building_code,
            ClassroomRoom.floor == floor_number
        )
        .limit(1)
    )
    
    if not floor_room:
        raise HTTPException(
            status_code=404,
            detail="Floor not found in building"
        )
    
    # Check if new floor number already exists
    if payload.floor != floor_number:
        floor_conflict = db.scalar(
            select(ClassroomRoom.id)
            .where(
                ClassroomRoom.owner_id == user.id,
                ClassroomRoom.building_code == building_code,
                ClassroomRoom.floor == payload.floor
            )
            .limit(1)
        )
        if floor_conflict:
            raise HTTPException(
                status_code=409,
                detail="Floor number already exists in this building"
            )
    
    # Update all rooms on this floor
    db.execute(
        update(ClassroomRoom)
        .where(
            ClassroomRoom.owner_id == user.id,
            ClassroomRoom.building_code == building_code,
            ClassroomRoom.floor == floor_number
        )
        .values(floor=payload.floor)
    )
    db.commit()
    
    return {"message": "Floor updated successfully"}


@app.delete("/api/user/buildings/{building_code}/floors/{floor_number}")
def delete_building_floor(
    building_code: str,
    floor_number: int,
    user: AuthUser = Depends(require_user),
    db: Session = Depends(get_db)
) -> dict:
    """Delete a floor (only if it has no rooms)."""
    # Verify building belongs to user
    building_check = db.scalar(
        select(ClassroomRoom.id)
        .where(
            ClassroomRoom.owner_id == user.id,
            ClassroomRoom.building_code == building_code
        )
        .limit(1)
    )
    
    if not building_check:
        raise HTTPException(
            status_code=404,
            detail="Building not found"
        )
    
    # Verify floor exists in this building for the user
    floor_room = db.scalar(
        select(ClassroomRoom.id)
        .where(
            ClassroomRoom.owner_id == user.id,
            ClassroomRoom.building_code == building_code,
            ClassroomRoom.floor == floor_number
        )
        .limit(1)
    )
    
    if not floor_room:
        raise HTTPException(
            status_code=404,
            detail="Floor not found in building"
        )
    
    # Check if floor has any rooms (excluding placeholders)
    room_count = db.scalar(
        select(func.count(ClassroomRoom.id))
        .where(
            ClassroomRoom.owner_id == user.id,
            ClassroomRoom.building_code == building_code,
            ClassroomRoom.floor == floor_number,
            ClassroomRoom.room_index > 0  # Exclude placeholders
        )
    )
    
    if room_count > 0:
        raise HTTPException(
            status_code=409,
            detail="Cannot delete floor that still contains rooms"
        )
    
    # Delete placeholder rooms for this floor
    db.execute(
        delete(ClassroomRoom)
        .where(
            ClassroomRoom.owner_id == user.id,
            ClassroomRoom.building_code == building_code,
            ClassroomRoom.floor == floor_number,
            ClassroomRoom.room_index == 0  # Placeholder rooms
        )
    )
    db.commit()
    
    return {"message": "Floor deleted successfully"}


# --- Room Management Endpoints ---


@app.get("/api/user/buildings/{building_code}/floors/{floor_number}/rooms")
def list_floor_rooms(
    building_code: str,
    floor_number: int,
    user: AuthUser = Depends(require_user),
    db: Session = Depends(get_db)
) -> list[RoomSummary]:
    """List all rooms in a floor for the current user."""
    # Verify building belongs to user
    building_check = db.scalar(
        select(ClassroomRoom.id)
        .where(
            ClassroomRoom.owner_id == user.id,
            ClassroomRoom.building_code == building_code
        )
        .limit(1)
    )
    
    if not building_check:
        raise HTTPException(
            status_code=404,
            detail="Building not found"
        )
    
    # Verify floor exists in this building for the user
    floor_check = db.scalar(
        select(ClassroomRoom.id)
        .where(
            ClassroomRoom.owner_id == user.id,
            ClassroomRoom.building_code == building_code,
            ClassroomRoom.floor == floor_number
        )
        .limit(1)
    )
    
    if not floor_check:
        raise HTTPException(
            status_code=404,
            detail="Floor not found in building"
        )
    
    # Query rooms on this floor for this user
    rooms = db.scalars(
        select(ClassroomRoom)
        .where(
            ClassroomRoom.owner_id == user.id,
            ClassroomRoom.building_code == building_code,
            ClassroomRoom.floor == floor_number,
            ClassroomRoom.room_index > 0  # Exclude placeholders
        )
        .order_by(ClassroomRoom.room_index)
    ).all()
    
    return [
        RoomSummary(
            room_index=room.room_index,
            room_number=room.room_number,
            room_name=room.room_name,
            room_type=room.room_type
        )
        for room in rooms
    ]


@app.post("/api/user/buildings/{building_code}/floors/{floor_number}/rooms", status_code=201)
def add_floor_room(
    building_code: str,
    floor_number: int,
    payload: RoomDetail,
    user: AuthUser = Depends(require_user),
    db: Session = Depends(get_db)
) -> dict:
    """Add a new room to a floor."""
    # Verify building belongs to user
    building_check = db.scalar(
        select(ClassroomRoom.id)
        .where(
            ClassroomRoom.owner_id == user.id,
            ClassroomRoom.building_code == building_code
        )
        .limit(1)
    )
    
    if not building_check:
        raise HTTPException(
            status_code=404,
            detail="Building not found"
        )
    
    # Verify floor exists in this building for the user
    floor_check = db.scalar(
        select(ClassroomRoom.id)
        .where(
            ClassroomRoom.owner_id == user.id,
            ClassroomRoom.building_code == building_code,
            ClassroomRoom.floor == floor_number
        )
        .limit(1)
    )
    
    if not floor_check:
        raise HTTPException(
            status_code=404,
            detail="Floor not found in building"
        )
    
    # Check if room already exists at this position
    room_exists = db.scalar(
        select(ClassroomRoom.id)
        .where(
            ClassroomRoom.owner_id == user.id,
            ClassroomRoom.building_code == building_code,
            ClassroomRoom.floor == floor_number,
            ClassroomRoom.room_index == payload.room_index
        )
        .limit(1)
    )
    
    if room_exists:
        raise HTTPException(
            status_code=409,
            detail="Room already exists at this position"
        )
    
    # Get the building name from existing rooms in this building
    building_name = db.scalar(
        select(ClassroomRoom.building_name)
        .where(
            ClassroomRoom.owner_id == user.id,
            ClassroomRoom.building_code == building_code
        )
        .limit(1)
    )
    
    # Calculate room_number if not provided (standard format: floor*100 + room_index)
    room_number = payload.room_number
    if room_number is None:
        room_number = floor_number * 100 + payload.room_index
    
    # Create the room
    new_room = ClassroomRoom(
        building_code=building_code,
        building_name=building_name,
        floor=floor_number,
        room_index=payload.room_index,
        room_number=room_number,
        room_type=_clean_text(payload.room_type, max_length=20) or "classroom",
        custom_type=_clean_text(payload.custom_type, max_length=64),
        room_name=_clean_text(payload.room_name, max_length=80),
        owner_id=user.id
    )
    db.add(new_room)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Failed to create room due to conflict"
        )
    
    return {"message": "Room created successfully"}


@app.get("/api/user/buildings/{building_code}/floors/{floor_number}/rooms/{room_index}")
def get_floor_room(
    building_code: str,
    floor_number: int,
    room_index: int,
    user: AuthUser = Depends(require_user),
    db: Session = Depends(get_db)
) -> RoomDetail:
    """Get details of a specific room in a floor."""
    # Verify building belongs to user
    building_check = db.scalar(
        select(ClassroomRoom.id)
        .where(
            ClassroomRoom.owner_id == user.id,
            ClassroomRoom.building_code == building_code
        )
        .limit(1)
    )
    
    if not building_check:
        raise HTTPException(
            status_code=404,
            detail="Building not found"
        )
    
    # Verify floor exists in this building for the user
    floor_check = db.scalar(
        select(ClassroomRoom.id)
        .where(
            ClassroomRoom.owner_id == user.id,
            ClassroomRoom.building_code == building_code,
            ClassroomRoom.floor == floor_number
        )
        .limit(1)
    )
    
    if not floor_check:
        raise HTTPException(
            status_code=404,
            detail="Floor not found in building"
        )
    
    # Get the room
    room = db.scalar(
        select(ClassroomRoom)
        .where(
            ClassroomRoom.owner_id == user.id,
            ClassroomRoom.building_code == building_code,
            ClassroomRoom.floor == floor_number,
            ClassroomRoom.room_index == room_index
        )
    )
    
    if not room:
        raise HTTPException(
            status_code=404,
            detail="Room not found"
        )
    
    return RoomDetail(
        room_index=room.room_index,
        room_number=room.room_number,
        room_name=room.room_name,
        room_type=room.room_type,
        custom_type=room.custom_type,
        wattage=None  # Not storing appliance wattage sum here for simplicity
    )


@app.put("/api/user/buildings/{building_code}/floors/{floor_number}/rooms/{room_index}")
def update_floor_room(
    building_code: str,
    floor_number: int,
    room_index: int,
    payload: RoomDetail,
    user: AuthUser = Depends(require_user),
    db: Session = Depends(get_db)
) -> dict:
    """Update a room's details."""
    # Verify building belongs to user
    building_check = db.scalar(
        select(ClassroomRoom.id)
        .where(
            ClassroomRoom.owner_id == user.id,
            ClassroomRoom.building_code == building_code
        )
        .limit(1)
    )
    
    if not building_check:
        raise HTTPException(
            status_code=404,
            detail="Building not found"
        )
    
    # Verify floor exists in this building for the user
    floor_check = db.scalar(
        select(ClassroomRoom.id)
        .where(
            ClassroomRoom.owner_id == user.id,
            ClassroomRoom.building_code == building_code,
            ClassroomRoom.floor == floor_number
        )
        .limit(1)
    )
    
    if not floor_check:
        raise HTTPException(
            status_code=404,
            detail="Floor not found in building"
        )
    
    # Get the room
    room = db.scalar(
        select(ClassroomRoom)
        .where(
            ClassroomRoom.owner_id == user.id,
            ClassroomRoom.building_code == building_code,
            ClassroomRoom.floor == floor_number,
            ClassroomRoom.room_index == room_index
        )
    )
    
    if not room:
        raise HTTPException(
            status_code=404,
            detail="Room not found"
        )
    
    # Rooms cannot be moved between positions through an update.
    if payload.room_index != room_index:
        raise HTTPException(
            status_code=400,
            detail="Cannot change room position via update; delete and recreate instead",
        )
    
    # Update the room fields
    update_data = {}
    if payload.room_number is not None:
        update_data["room_number"] = payload.room_number
    if payload.room_name is not None:
        update_data["room_name"] = _clean_text(payload.room_name, max_length=80)
    if payload.room_type is not None:
        update_data["room_type"] = _clean_text(payload.room_type, max_length=20)
    if payload.custom_type is not None:
        update_data["custom_type"] = _clean_text(payload.custom_type, max_length=64)
    
    if update_data:
        db.execute(
            update(ClassroomRoom)
            .where(
                ClassroomRoom.owner_id == user.id,
                ClassroomRoom.building_code == building_code,
                ClassroomRoom.floor == floor_number,
                ClassroomRoom.room_index == room_index
            )
            .values(**update_data)
        )
        db.commit()
    
    return {"message": "Room updated successfully"}


@app.delete("/api/user/buildings/{building_code}/floors/{floor_number}/rooms/{room_index}")
def delete_floor_room(
    building_code: str,
    floor_number: int,
    room_index: int,
    user: AuthUser = Depends(require_user),
    db: Session = Depends(get_db)
) -> dict:
    """Delete a room from a floor."""
    # Verify building belongs to user
    building_check = db.scalar(
        select(ClassroomRoom.id)
        .where(
            ClassroomRoom.owner_id == user.id,
            ClassroomRoom.building_code == building_code
        )
        .limit(1)
    )
    
    if not building_check:
        raise HTTPException(
            status_code=404,
            detail="Building not found"
        )
    
    # Verify floor exists in this building for the user
    floor_check = db.scalar(
        select(ClassroomRoom.id)
        .where(
            ClassroomRoom.owner_id == user.id,
            ClassroomRoom.building_code == building_code,
            ClassroomRoom.floor == floor_number
        )
        .limit(1)
    )
    
    if not floor_check:
        raise HTTPException(
            status_code=404,
            detail="Floor not found in building"
        )
    
    # Get the room
    room = db.scalar(
        select(ClassroomRoom)
        .where(
            ClassroomRoom.owner_id == user.id,
            ClassroomRoom.building_code == building_code,
            ClassroomRoom.floor == floor_number,
            ClassroomRoom.room_index == room_index
        )
    )
    
    if not room:
        raise HTTPException(
            status_code=404,
            detail="Room not found"
        )

    # Reports are history; do not delete a room that would orphan them.
    record_count = db.scalar(
        select(func.count(UsageRecord.id)).where(UsageRecord.room_id == room.id)
    ) or 0
    if record_count:
        raise HTTPException(
            status_code=409,
            detail="This room has reports and cannot be deleted.",
        )
    
    # Delete the room
    db.delete(room)
    db.commit()
    
    return {"message": "Room deleted successfully"}


# --- Owner Dashboard Endpoints ---


def _owner_room_ids(user: AuthUser):
    """Subquery of real (non-placeholder) rooms owned by this workspace."""
    return select(ClassroomRoom.id).where(
        ClassroomRoom.owner_id == user.id,
        ClassroomRoom.room_type != "placeholder",
    )


@app.get("/api/owner/dashboard")
def owner_dashboard(
    user: AuthUser = Depends(require_user),
    db: Session = Depends(get_db)
) -> dict:
    """Get owner dashboard summary statistics."""
    _require_workspace_owner(user)
    room_ids = _owner_room_ids(user)
    
    building_count = db.scalar(
        select(func.count(func.distinct(ClassroomRoom.building_code)))
        .where(
            ClassroomRoom.owner_id == user.id,
            ClassroomRoom.room_type != "placeholder",
        )
    ) or 0
    
    floor_count = db.scalar(
        select(func.count(func.distinct(ClassroomRoom.floor)))
        .where(
            ClassroomRoom.owner_id == user.id,
            ClassroomRoom.room_type != "placeholder",
            ClassroomRoom.floor > 0,
        )
    ) or 0
    
    room_count = db.scalar(
        select(func.count(ClassroomRoom.id))
        .where(
            ClassroomRoom.owner_id == user.id,
            ClassroomRoom.room_type != "placeholder",
        )
    ) or 0
    
    emc_count = db.scalar(
        select(func.count(ClassroomUser.id))
        .where(
            ClassroomUser.workspace_name == user.workspace_name,
            ClassroomUser.role == "emc",
            ClassroomUser.status == "active",
        )
    ) or 0
    
    appliance_count = db.scalar(
        select(func.count(Appliance.id)).where(Appliance.archived.is_(False))
    ) or 0
    
    # Reports are observations, not live sensor readings. "No report" is
    # unknown, so the dashboard only sums reports that were actually submitted
    # for rooms in this workspace.
    thirty_days_ago = utc_now() - timedelta(days=30)
    estimated_kwh = db.scalar(
        select(func.sum(UsageRecord.energy_kwh))
        .where(
            UsageRecord.room_id.in_(room_ids),
            UsageRecord.created_at >= thirty_days_ago,
        )
    ) or 0.0
    
    recent_activity = db.scalars(
        select(UsageRecord)
        .where(UsageRecord.room_id.in_(room_ids))
        .options(joinedload(UsageRecord.appliance), joinedload(UsageRecord.room))
        .order_by(UsageRecord.created_at.desc(), UsageRecord.id.desc())
        .limit(10)
    ).all()
    
    return {
        "workspace_name": user.workspace_name,
        "total_buildings": building_count,
        "total_floors": floor_count,
        "total_rooms": room_count,
        "active_emcs": emc_count,
        "total_appliances": appliance_count,
        "estimated_energy_kwh": round(estimated_kwh, 4),
        "recent_activity": [
            {
                "id": r.id,
                "appliance_id": r.appliance_id,
                "appliance_name": r.appliance.name if r.appliance else None,
                "room_id": r.room_id,
                "room_label": (
                    f"{r.room.room_name or 'Room'} {r.room.room_number}"
                    if r.room else None
                ),
                "energy_kwh": r.energy_kwh,
                "hours": r.hours,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in recent_activity
        ],
    }


@app.get("/api/owner/buildings")
def owner_list_buildings(
    user: AuthUser = Depends(require_user),
    db: Session = Depends(get_db)
) -> list[dict]:
    """Get full building hierarchy for owner dashboard."""
    _require_workspace_owner(user)
    
    rooms = db.scalars(
        select(ClassroomRoom)
        .where(ClassroomRoom.owner_id == user.id)
        .order_by(ClassroomRoom.building_code, ClassroomRoom.floor, ClassroomRoom.room_index)
    ).all()
    
    # Map room -> assigned EMC username for quick lookup.
    emc_by_room: dict[int, str] = {}
    for emc in db.scalars(
        select(ClassroomUser).where(
            ClassroomUser.workspace_name == user.workspace_name,
            ClassroomUser.role == "emc",
            ClassroomUser.assigned_room_id.is_not(None),
        )
    ):
        emc_by_room[emc.assigned_room_id] = emc.username

    # Last-30-day usage is aggregated in SQL so the map does not stream every
    # report row. A room with no report stays at zero/unknown.
    cutoff = utc_now() - timedelta(days=30)
    room_ids = _owner_room_ids(user)
    usage_by_room: dict[int, dict] = {}
    for room_id, kwh, submissions, appliance_count in db.execute(
        select(
            UsageRecord.room_id,
            func.sum(UsageRecord.energy_kwh),
            func.count(UsageRecord.id),
            func.count(UsageRecord.appliance_id.distinct()),
        )
        .where(
            UsageRecord.room_id.in_(room_ids),
            UsageRecord.created_at >= cutoff,
        )
        .group_by(UsageRecord.room_id)
    ).all():
        usage_by_room[room_id] = {
            "kwh": round(float(kwh or 0), 4),
            "submissions": int(submissions or 0),
            "appliance_count": int(appliance_count or 0),
        }

    all_time_submissions = dict(
        db.execute(
            select(UsageRecord.room_id, func.count(UsageRecord.id))
            .where(UsageRecord.room_id.in_(room_ids))
            .group_by(UsageRecord.room_id)
        ).all()
    )

    appliance_rows = db.execute(
        select(
            UsageRecord.room_id,
            Appliance.name,
            func.sum(UsageRecord.energy_kwh),
            func.count(UsageRecord.id),
        )
        .join(Appliance, Appliance.id == UsageRecord.appliance_id)
        .where(
            UsageRecord.room_id.in_(room_ids),
            UsageRecord.created_at >= cutoff,
        )
        .group_by(UsageRecord.room_id, Appliance.name)
        .order_by(UsageRecord.room_id, func.sum(UsageRecord.energy_kwh).desc())
    ).all()
    appliances_by_room: dict[int, list[dict]] = {}
    for room_id, name, kwh, submissions in appliance_rows:
        appliances_by_room.setdefault(room_id, []).append(
            {
                "name": name,
                "kwh": round(float(kwh or 0), 4),
                "submissions": int(submissions or 0),
            }
        )

    buildings: dict[str, dict] = {}
    for room in rooms:
        building = buildings.setdefault(
            room.building_code,
            {
                "building_code": room.building_code,
                "building_name": room.building_name,
                "floors": {},
            },
        )
        if room.floor == 0 or room.room_type == "placeholder":
            # Keep the building visible even before its first real room, so
            # the campus maker can add floors to it.
            continue
        floor = building["floors"].setdefault(
            room.floor, {"floor": room.floor, "rooms": []}
        )
        floor["rooms"].append({
            "id": room.id,
            "room_index": room.room_index,
            "room_number": room.room_number,
            "room_name": room.room_name,
            "room_type": room.room_type,
            "custom_type": room.custom_type,
            "assigned_emc": emc_by_room.get(room.id),
            "usage_30d": usage_by_room.get(
                room.id, {"kwh": 0.0, "submissions": 0, "appliance_count": 0}
            ),
            "appliances": appliances_by_room.get(room.id, []),
            "total_submissions": int(all_time_submissions.get(room.id, 0) or 0),
        })
    
    result = []
    for building in buildings.values():
        building["floors"] = sorted(
            building["floors"].values(), key=lambda item: item["floor"]
        )
        building["room_count"] = sum(
            len(floor["rooms"]) for floor in building["floors"]
        )
        building["total_kwh_30d"] = round(
            sum(
                room["usage_30d"]["kwh"]
                for floor in building["floors"]
                for room in floor["rooms"]
            ),
            4,
        )
        result.append(building)
    return sorted(result, key=lambda item: item["building_name"].lower())


@app.get("/api/owner/appliances")
def owner_list_appliances(
    user: AuthUser = Depends(require_user),
    db: Session = Depends(get_db)
) -> list[dict]:
    """Get all appliances for the owner's workspace."""
    _require_workspace_owner(user)
    
    appliances = db.scalars(
        select(Appliance)
        .where(Appliance.archived.is_(False))
        .order_by(Appliance.name)
    ).all()
    
    return [
        {
            "id": a.id,
            "name": a.name,
            "wattage": a.wattage,
            "quantity": a.quantity,
            "connected_watts": a.wattage * a.quantity,
            "archived": a.archived,
        }
        for a in appliances
    ]


@app.post("/api/owner/appliances", status_code=201)
def owner_create_appliance(
    payload: ApplianceRequest,
    user: AuthUser = Depends(require_user),
    db: Session = Depends(get_db)
) -> dict:
    """Create a new appliance for the workspace."""
    _require_workspace_owner(user)
    
    name = _clean_text(payload.name, max_length=80)
    if not name:
        raise HTTPException(status_code=400, detail="Appliance name is required.")
    if db.scalar(select(Appliance.id).where(func.lower(Appliance.name) == name.lower())):
        raise HTTPException(status_code=409, detail="That appliance already exists.")
    
    appliance = Appliance(name=name, wattage=payload.wattage, quantity=payload.quantity)
    db.add(appliance)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="That appliance already exists.")
    
    return {
        "id": appliance.id,
        "name": appliance.name,
        "wattage": appliance.wattage,
        "quantity": appliance.quantity,
        "connected_watts": appliance.wattage * appliance.quantity,
        "archived": appliance.archived,
    }


class EMCCreateRequest(BaseModel):
    username: str = Field(
        min_length=1,
        max_length=80,
        pattern=r"^[A-Za-z0-9._@ -]+$",
    )
    email: str | None = Field(default=None, max_length=255)
    password: str | None = Field(default=None, min_length=8, max_length=200)
    assigned_room_id: int | None = None
    section_id: int | None = None


class EMCUpdateRequest(BaseModel):
    assigned_room_id: int | None = None
    section_id: int | None = None
    status: str | None = None
    email: str | None = Field(default=None, max_length=255)


@app.get("/api/owner/emcs")
def owner_list_emcs(
    user: AuthUser = Depends(require_user),
    db: Session = Depends(get_db)
) -> list[dict]:
    """List all EMCs in the owner's workspace."""
    _require_workspace_owner(user)
    
    emcs = db.scalars(
        select(ClassroomUser)
        .where(ClassroomUser.workspace_name == user.workspace_name, ClassroomUser.role == "emc")
        .order_by(ClassroomUser.username)
    ).all()
    
    result = []
    for emc in emcs:
        room = db.get(ClassroomRoom, emc.assigned_room_id) if emc.assigned_room_id else None
        section = db.get(ClassroomSection, emc.section_id) if emc.section_id else None
        result.append({
            "id": emc.id,
            "username": emc.username,
            "email": emc.email,
            "status": emc.status,
            "last_seen": emc.last_seen.isoformat() if emc.last_seen else None,
            "assigned_room": {
                "id": room.id,
                "building_name": room.building_name,
                "floor": room.floor,
                "room_number": room.room_number,
                "room_name": room.room_name,
            } if room else None,
            "assigned_room_id": emc.assigned_room_id,
            "section_id": emc.section_id,
            "section": section.name if section else None,
        })
    
    return result


@app.post("/api/owner/emcs", status_code=201)
def owner_create_emc(
    payload: EMCCreateRequest,
    user: AuthUser = Depends(require_user),
    db: Session = Depends(get_db)
) -> dict:
    """Create a new EMC account in the workspace."""
    _require_workspace_owner(user)
    if not user.workspace_name:
        raise HTTPException(status_code=400, detail="Create a workspace before adding EMCs.")
    
    username = _clean_text(payload.username, max_length=80)
    if not username:
        raise HTTPException(status_code=400, detail="Username is required.")
    
    if db.scalar(select(ClassroomUser.id).where(func.lower(ClassroomUser.username) == username.lower())):
        raise HTTPException(status_code=409, detail="Username already exists.")
    
    if payload.assigned_room_id:
        room = db.get(ClassroomRoom, payload.assigned_room_id)
        if (
            not room
            or room.owner_id != user.id
            or room.room_type == "placeholder"
        ):
            raise HTTPException(status_code=400, detail="Room does not belong to this workspace.")
    section_id = payload.section_id
    if section_id:
        section = db.get(ClassroomSection, section_id)
        if not section or section.owner_id != user.id:
            raise HTTPException(status_code=400, detail="Section does not belong to this workspace.")
    else:
        # Reports need a section; default the EMC to the workspace section.
        section_id = _ensure_owner_section(db, user).id
    
    password = payload.password or secrets.token_urlsafe(12)
    
    emc = ClassroomUser(
        username=username,
        email=_clean_text(payload.email, max_length=255),
        password_hash=_hash_user_password(password),
        status="active",
        role="emc",
        workspace_name=user.workspace_name,
        section_id=section_id,
        assigned_room_id=payload.assigned_room_id,
    )
    db.add(emc)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Failed to create EMC account.")
    _invalidate_auth_cache(emc.username)
    
    return {
        "id": emc.id,
        "username": emc.username,
        "email": emc.email,
        "status": emc.status,
        "role": emc.role,
        "workspace_name": emc.workspace_name,
        "assigned_room_id": emc.assigned_room_id,
        "section_id": emc.section_id,
        "temporary_password": payload.password is None,
        "password": password if payload.password is None else None,
    }


@app.put("/api/owner/emcs/{emc_id}")
def owner_update_emc(
    emc_id: int,
    payload: EMCUpdateRequest,
    user: AuthUser = Depends(require_user),
    db: Session = Depends(get_db)
) -> dict:
    """Update EMC assignment or status."""
    _require_workspace_owner(user)
    
    emc = db.get(ClassroomUser, emc_id)
    if not emc or emc.workspace_name != user.workspace_name or emc.role != "emc":
        raise HTTPException(status_code=404, detail="EMC not found.")
    
    fields = payload.model_dump(exclude_unset=True)
    if "assigned_room_id" in fields:
        if fields["assigned_room_id"]:
            room = db.get(ClassroomRoom, fields["assigned_room_id"])
            if (
                not room
                or room.owner_id != user.id
                or room.room_type == "placeholder"
            ):
                raise HTTPException(status_code=400, detail="Room does not belong to this workspace.")
        emc.assigned_room_id = fields["assigned_room_id"]
    
    if "section_id" in fields:
        if fields["section_id"]:
            section = db.get(ClassroomSection, fields["section_id"])
            if not section or section.owner_id != user.id:
                raise HTTPException(status_code=400, detail="Section does not belong to this workspace.")
        emc.section_id = fields["section_id"]
    
    if "status" in fields:
        if fields["status"] not in ("active", "inactive"):
            raise HTTPException(status_code=400, detail="Invalid status.")
        emc.status = fields["status"]
    
    if "email" in fields:
        emc.email = _clean_text(fields["email"], max_length=255)
    
    db.commit()
    _invalidate_auth_cache(emc.username)
    return {"message": "EMC updated successfully"}


@app.delete("/api/owner/emcs/{emc_id}")
def owner_delete_emc(
    emc_id: int,
    user: AuthUser = Depends(require_user),
    db: Session = Depends(get_db)
) -> dict:
    """Disable an EMC account without deleting its report history."""
    _require_workspace_owner(user)
    
    emc = db.get(ClassroomUser, emc_id)
    if not emc or emc.workspace_name != user.workspace_name or emc.role != "emc":
        raise HTTPException(status_code=404, detail="EMC not found.")
    
    # Reports reference the user row, so deactivate instead of deleting.
    emc.status = "inactive"
    db.commit()
    _invalidate_auth_cache(emc.username)
    return {"message": "EMC account disabled"}


@app.get("/api/owner/notifications")
def owner_list_notifications(
    user: AuthUser = Depends(require_user),
    db: Session = Depends(get_db),
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    """Recent workspace activity shown on the owner dashboard."""
    _require_workspace_owner(user)
    limit = max(1, min(limit, 100))
    offset = max(0, offset)
    records = db.scalars(
        select(UsageRecord)
        .where(UsageRecord.room_id.in_(_owner_room_ids(user)))
        .options(joinedload(UsageRecord.appliance), joinedload(UsageRecord.room))
        .order_by(UsageRecord.created_at.desc(), UsageRecord.id.desc())
        .offset(offset)
        .limit(limit)
    ).all()
    return [
        {
            "id": record.id,
            "title": "Report submitted",
            "message": (
                f"{record.appliance.name if record.appliance else 'Appliance'} reported "
                f"{record.energy_kwh:.3f} kWh"
                + (f" in {record.room.room_name}" if record.room and record.room.room_name else "")
            ),
            "kind": "info",
            "created_at": record.created_at.isoformat() if record.created_at else None,
        }
        for record in records
    ]



# --- Serve the built React frontend (production / Render) -------------------
# Registered after every /api route so the API always wins; unknown /api paths
# still 404 instead of falling through to the SPA shell.
FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"

if FRONTEND_DIST.is_dir():
    _DIST_ROOT = FRONTEND_DIST.resolve()

    @app.get("/{spa_path:path}", include_in_schema=False)
    def serve_spa(spa_path: str) -> FileResponse:
        if spa_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not found.")
        if spa_path:
            candidate = (_DIST_ROOT / spa_path).resolve()
            if candidate.is_file() and candidate.is_relative_to(_DIST_ROOT):
                return FileResponse(candidate)
        # /mcs, /mcs/user, /mcs/admin (and any unknown path) -> SPA shell.
        return FileResponse(_DIST_ROOT / "index.html")


# Serverless platforms (Vercel) may never fire the startup event, so run the
# idempotent schema+seed init at import too; the flag keeps a single run.
try:
    initialize_database()
except Exception as error:  # pragma: no cover - unreachable DB at import
    print(f"deferred database init: {error}", file=sys.stderr)