from calendar import day_name, monthrange
from collections.abc import Iterable
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import os
from pathlib import Path
import secrets
import time
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import String, cast, delete, func, inspect, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.database import Base, SessionLocal, engine
from app.db_models import Appliance, ClassroomRoom, ClassroomSection, ClassroomUser, UsageRecord, utc_now

app = FastAPI(title="WattWise Classroom Energy API", version="1.0.0")
ADMIN_USERNAME = os.getenv("MCS_ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.getenv("MCS_ADMIN_PASSWORD", "mcs2026")
SESSION_SECRET = os.getenv("MCS_SESSION_SECRET", "development-secret-change-before-deploy")
ELECTRICITY_RATE = float(os.getenv("MCS_ELECTRICITY_RATE", "12"))
SESSION_COOKIE = "wattwise_admin"
USER_SESSION_COOKIE = "wattwise_user"
SESSION_SECONDS = 8 * 60 * 60
PASSWORD_ITERATIONS = 310_000
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
    password: str = Field(min_length=10, max_length=200)
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
            and hmac.compare_digest(username, ADMIN_USERNAME)
            and int(expiry) > int(time.time())
        )
    except (ValueError, TypeError):
        return False


def require_admin(request: Request) -> None:
    if not _valid_admin(request):
        raise HTTPException(status_code=401, detail="Admin sign-in required.")


def require_user(
    request: Request,
    db: Session = Depends(get_db),
) -> ClassroomUser:
    username = _read_session_subject(request, USER_SESSION_COOKIE)
    if username is None:
        raise HTTPException(status_code=401, detail="User sign-in required.")
    user = db.scalar(select(ClassroomUser).where(ClassroomUser.username == username))
    if user is None or user.password_hash is None:
        raise HTTPException(status_code=401, detail="User credentials are no longer valid.")
    if user.status != "active":
        raise HTTPException(status_code=403, detail="This account is awaiting administrator approval.")
    return user


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
    user: ClassroomUser | None = None,
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
    usage_columns = {column["name"] for column in inspector.get_columns("usage_records")}
    appliance_columns = {column["name"] for column in inspector.get_columns("appliances")}
    with engine.begin() as connection:
        if "password_hash" not in user_columns:
            connection.exec_driver_sql(
                "ALTER TABLE classroom_users ADD COLUMN password_hash VARCHAR(256)"
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
        if "grade" not in section_columns:
            connection.exec_driver_sql(
                "ALTER TABLE classroom_sections ADD COLUMN grade VARCHAR(4)"
            )
        if "section_name" not in section_columns:
            connection.exec_driver_sql(
                "ALTER TABLE classroom_sections ADD COLUMN section_name VARCHAR(40)"
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


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def _catalog_cache(response: Response) -> None:
    # Catalogs (sections, appliances, rooms) change rarely and are read by
    # every visitor, so let the browser serve them for a minute instead of
    # paying a round trip to the API each page load.
    response.headers["Cache-Control"] = "public, max-age=60"
    response.headers["Vary"] = "Accept-Encoding"


@app.get("/api/sections")
def list_sections(response: Response, db: Session = Depends(get_db)) -> list[dict]:
    _catalog_cache(response)
    return [_section_dict(item) for item in db.scalars(select(ClassroomSection).order_by(ClassroomSection.name))]


@app.get("/api/appliances")
def list_appliances(response: Response, db: Session = Depends(get_db)) -> list[dict]:
    _catalog_cache(response)
    return [
        _appliance_dict(item)
        for item in db.scalars(
            select(Appliance).where(Appliance.archived.is_(False)).order_by(Appliance.name)
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
def list_room_choices(response: Response, db: Session = Depends(get_db)) -> list[dict]:
    _catalog_cache(response)
    return [_room_identity(room) for room in _ordered_rooms(db)]


@app.post("/api/appliances", status_code=201)
def create_user_appliance(
    payload: ApplianceRequest,
    _: ClassroomUser = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    name = " ".join(payload.name.split())
    if db.scalar(select(Appliance.id).where(func.lower(Appliance.name) == name.lower())):
        raise HTTPException(status_code=409, detail="That appliance already exists.")
    appliance = Appliance(name=name, wattage=payload.wattage, quantity=payload.quantity)
    db.add(appliance)
    db.commit()
    return _appliance_dict(appliance)


@app.put("/api/appliances/{appliance_id}")
def update_user_appliance(
    appliance_id: int,
    payload: ApplianceRequest,
    _: ClassroomUser = Depends(require_user),
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
    db.commit()
    return _appliance_dict(appliance)


@app.delete("/api/appliances/{appliance_id}")
def remove_user_appliance(
    appliance_id: int,
    _: ClassroomUser = Depends(require_user),
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
    user = db.scalar(select(ClassroomUser).where(func.lower(ClassroomUser.username) == username.lower()))
    if user is None or user.password_hash is None or not _verify_user_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect account name or password.")
    if user.status != "active":
        raise HTTPException(status_code=403, detail="Your account is awaiting administrator approval.")
    user.last_seen = utc_now()
    db.commit()
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
        "section": _section_dict(user.section) if user.section else None,
        "assigned_room": _room_identity(room) if room else None,
        # The client previews estimated bills before submitting, so it needs
        # the same rate the server will apply to the stored record.
        "rate_php_per_kwh": ELECTRICITY_RATE,
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


@app.post("/api/users/logout")
def user_logout(response: Response, _: ClassroomUser = Depends(require_user)) -> dict[str, str]:
    response.delete_cookie(USER_SESSION_COOKIE, path="/api", samesite="strict")
    return {"status": "signed out"}


@app.get("/api/users/session")
def user_session(
    user: ClassroomUser = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    room = db.get(ClassroomRoom, user.assigned_room_id) if user.assigned_room_id else None
    return {
        "username": user.username,
        "section": _section_dict(user.section) if user.section else None,
        "assigned_room": _room_identity(room) if room else None,
        "rate_php_per_kwh": ELECTRICITY_RATE,
    }


@app.get("/api/users/me/records")
def user_records(
    user: ClassroomUser = Depends(require_user),
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
            .options(joinedload(UsageRecord.user), joinedload(UsageRecord.section), joinedload(UsageRecord.appliance))
            .order_by(UsageRecord.created_at.desc())
            .limit(100)
        )
    )
    stats = _appliance_hour_stats(db, (record.appliance_id for record in records))
    return [_record_dict(record, stats) for record in records]


@app.post("/api/records", status_code=201)
def create_record(
    payload: UsageRequest,
    user: ClassroomUser = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    appliance = db.get(Appliance, payload.appliance_id)
    room = db.get(ClassroomRoom, payload.room_id) if payload.room_id else None
    if appliance is None or (payload.room_id and room is None):
        raise HTTPException(status_code=404, detail="Choose an available appliance and room.")
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
    user.last_seen = now
    db.add(record)
    db.commit()
    # The session already holds every related row this response needs.
    return _record_dict(record, user=user, section=section, appliance=appliance)


@app.post("/api/admin/login")
def admin_login(payload: AdminLoginRequest, response: Response) -> dict[str, str]:
    if not (
        hmac.compare_digest(payload.username, ADMIN_USERNAME)
        and hmac.compare_digest(payload.password, ADMIN_PASSWORD)
    ):
        raise HTTPException(status_code=401, detail="Incorrect admin account or password.")
    data = f"{ADMIN_USERNAME}:{int(time.time()) + SESSION_SECONDS}"
    response.set_cookie(
        SESSION_COOKIE,
        f"{data}.{_token_signature(data)}",
        max_age=SESSION_SECONDS,
        httponly=True,
        secure=os.getenv("MCS_SECURE_COOKIES", "false").lower() == "true",
        samesite="strict",
        path="/api",
    )
    return {"username": ADMIN_USERNAME}


@app.get("/api/admin/session")
def admin_session(_: None = Depends(require_admin)) -> dict[str, str]:
    return {"username": ADMIN_USERNAME}


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
    return {"status": "user removed"}


def _month_bounds(month: str) -> tuple[datetime, datetime]:
    try:
        start = datetime.strptime(month, "%Y-%m")
    except ValueError as error:
        raise HTTPException(status_code=422, detail="Month must use YYYY-MM format.") from error
    end = datetime(start.year + (start.month == 12), start.month % 12 + 1, 1)
    return start, end


@app.get("/api/admin/dashboard", dependencies=[Depends(require_admin)])
def admin_dashboard(month: str | None = None, db: Session = Depends(get_db)) -> dict:
    now = datetime.now()
    month = month or now.strftime("%Y-%m")
    start, end = _month_bounds(month)
    records = list(
        db.scalars(
            select(UsageRecord)
            .where(UsageRecord.created_at >= start, UsageRecord.created_at < end)
            .options(joinedload(UsageRecord.user), joinedload(UsageRecord.section), joinedload(UsageRecord.appliance))
            .order_by(UsageRecord.created_at.desc())
        )
    )
    section_totals: dict[str, float] = {}
    for record in records:
        section_totals[record.section.name] = section_totals.get(record.section.name, 0) + record.energy_kwh
    total_kwh = sum(record.energy_kwh for record in records)

    # Six-month trend as one grouped query instead of one round trip per
    # month: substr(cast(created_at), 1, 7) produces the YYYY-MM bucket key
    # on both SQLite and Postgres.
    base_index = start.year * 12 + start.month - 1
    bucket_starts: list[datetime] = []
    for offset in range(5, -1, -1):
        year, month_number = divmod(base_index - offset, 12)
        bucket_starts.append(datetime(year, month_number + 1, 1))
    trend_key = func.substr(cast(UsageRecord.created_at, String), 1, 7)
    monthly_kwh = {
        key: float(total or 0)
        for key, total in db.execute(
            select(trend_key, func.sum(UsageRecord.energy_kwh))
            .where(UsageRecord.created_at >= bucket_starts[0], UsageRecord.created_at < end)
            .group_by(trend_key)
        ).all()
    }
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
    user_rows = db.execute(
        select(ClassroomUser, func.count(UsageRecord.id))
        .outerjoin(UsageRecord)
        .group_by(ClassroomUser.id)
        .order_by(ClassroomUser.last_seen.desc())
        .options(
            selectinload(ClassroomUser.section),
            selectinload(ClassroomUser.assigned_room),
        )
    ).all()
    user_count, section_count = db.execute(
        select(
            select(func.count()).select_from(ClassroomUser).scalar_subquery(),
            select(func.count()).select_from(ClassroomSection).scalar_subquery(),
        )
    ).one()
    dashboard_kwh, dashboard_bill = _kwh_and_bill(total_kwh)
    section_rows = []
    for name, total in sorted(
        section_totals.items(), key=lambda item: item[1], reverse=True
    ):
        kwh, bill = _kwh_and_bill(total)
        section_rows.append({"name": name, "kwh": kwh, "bill": bill})
    return {
        "month": month,
        "rate_php_per_kwh": ELECTRICITY_RATE,
        "total_kwh": dashboard_kwh,
        "estimated_bill_php": dashboard_bill,
        "record_count": len(records),
        "user_count": user_count,
        "section_count": section_count,
        "highest_section": max(section_totals, key=section_totals.get) if section_totals else None,
        "monthly": monthly,
        "sections": section_rows,
        "users": [
            {
                "username": user.username,
                "records": count,
                "last_seen": user.last_seen.isoformat(),
                "status": user.status,
                "section": _section_dict(user.section) if user.section else None,
                "credentials_set": user.password_hash is not None,
                "assigned_room": _room_identity(user.assigned_room) if user.assigned_room else None,
            }
            for user, count in user_rows
        ],
        "sections_catalog": [_section_dict(item) for item in db.scalars(select(ClassroomSection).order_by(ClassroomSection.name))],
        "appliances": [
            _appliance_dict(item)
            for item in db.scalars(
                select(Appliance).where(Appliance.archived.is_(False)).order_by(Appliance.name)
            )
        ],
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

    records = list(
        db.scalars(
            select(UsageRecord)
            .where(
                UsageRecord.created_at >= start,
                UsageRecord.created_at < end,
                *filters,
            )
            .options(
                joinedload(UsageRecord.user),
                joinedload(UsageRecord.section),
                joinedload(UsageRecord.appliance),
                joinedload(UsageRecord.room),
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
                .where(UsageRecord.created_at >= earliest_start, *filters)
                .options(joinedload(UsageRecord.appliance))
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
            top[record.appliance.name] = top.get(record.appliance.name, 0) + record.energy_kwh
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
        appliance_kwh[record.appliance.name] = appliance_kwh.get(record.appliance.name, 0) + record.energy_kwh
        room_label = (
            f"{record.room.building_code} {record.room.room_number}"
            if record.room
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
    return {
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


@app.post("/api/admin/sections", status_code=201, dependencies=[Depends(require_admin)])
def add_section(payload: SectionRequest, db: Session = Depends(get_db)) -> dict:
    grade = payload.grade.strip()
    section_name = " ".join(payload.section_name.split()).upper()
    name = f"{grade} - {section_name}"
    if db.scalar(select(ClassroomSection.id).where(func.lower(ClassroomSection.name) == name.lower())):
        raise HTTPException(status_code=409, detail="That section already exists.")
    section = ClassroomSection(name=name, grade=grade, section_name=section_name)
    db.add(section)
    db.commit()
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
    assigned = db.scalars(
        select(ClassroomUser)
        .where(ClassroomUser.assigned_room_id.is_not(None))
        .order_by(ClassroomUser.username)
    )
    for user in assigned:
        if user.assigned_room_id in room_users:
            room_users[user.assigned_room_id].append(user.username)

    return room_usage, building_average, room_users


def _room_status(average: float, building_average: float) -> str:
    """High-use at 1.5x the building's per-room average (per project rules)."""
    return "high" if building_average > 0 and average >= building_average * 1.5 else "average"


@app.get("/api/admin/rooms", dependencies=[Depends(require_admin)])
def admin_rooms(db: Session = Depends(get_db)) -> dict:
    rooms = _ordered_rooms(db)
    room_usage, building_average, room_users = _room_map_stats(db)

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
    db.commit()
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
    import sys

    print(f"deferred database init: {error}", file=sys.stderr)