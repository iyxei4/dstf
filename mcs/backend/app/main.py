from calendar import day_name, monthrange
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import os
from pathlib import Path
import secrets
import time
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, inspect, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

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
# Extended-use / anomaly thresholds. A session counts as extended-use at or
# above a full school day; it counts as unusual past twice the appliance's
# all-time mean, requiring a minimum history before the comparison applies.
EXTENDED_USE_HOURS = 8.0
UNUSUAL_USE_MULTIPLE = 2.0
UNUSUAL_USE_MIN_SESSIONS = 3


def _appliance_hour_stats(db: Session) -> dict[int, tuple[float, int]]:
    """Map appliance_id -> (mean hours, session count) over all history."""
    rows = db.execute(
        select(
            UsageRecord.appliance_id,
            func.avg(UsageRecord.hours),
            func.count(UsageRecord.id),
        ).group_by(UsageRecord.appliance_id)
    ).all()
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
    name: str = Field(min_length=2, max_length=80)


class ApplianceRequest(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    wattage: float = Field(gt=0, le=100_000)


class UsageRequest(BaseModel):
    section_id: int = Field(gt=0)
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
    return user


def _section_dict(section: ClassroomSection) -> dict:
    return {"id": section.id, "name": section.name}


def _appliance_dict(appliance: Appliance) -> dict:
    return {"id": appliance.id, "name": appliance.name, "wattage": appliance.wattage}


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


def _record_dict(record: UsageRecord, stats: dict[int, tuple[float, int]] | None = None) -> dict:
    started = record.started_at or (record.created_at - timedelta(hours=record.hours))
    return {
        "id": record.id,
        "username": record.user.username,
        "section": record.section.name,
        "section_id": record.section_id,
        "room_id": record.room_id,
        "appliance": record.appliance.name,
        "appliance_id": record.appliance_id,
        "wattage": record.appliance.wattage,
        "hours": record.hours,
        "energy_kwh": record.energy_kwh,
        "estimated_cost_php": round(record.energy_kwh * ELECTRICITY_RATE, 2),
        "occupants": record.occupants,
        "started_at": started.isoformat(),
        "created_at": record.created_at.isoformat(),
        "flags": _usage_flags(record.hours, (stats or {}).get(record.appliance_id)),
    }


@app.on_event("startup")
def initialize_database() -> None:
    Base.metadata.create_all(bind=engine)
    user_columns = {column["name"] for column in inspect(engine).get_columns("classroom_users")}
    with engine.begin() as connection:
        if "password_hash" not in user_columns:
            connection.exec_driver_sql(
                "ALTER TABLE classroom_users ADD COLUMN password_hash VARCHAR(256)"
            )
        if "assigned_room_id" not in user_columns:
            connection.exec_driver_sql(
                "ALTER TABLE classroom_users ADD COLUMN assigned_room_id INTEGER REFERENCES classroom_rooms(id)"
            )
    usage_columns = {column["name"] for column in inspect(engine).get_columns("usage_records")}
    if "room_id" not in usage_columns:
        with engine.begin() as connection:
            connection.exec_driver_sql(
                "ALTER TABLE usage_records ADD COLUMN room_id INTEGER REFERENCES classroom_rooms(id)"
            )
    appliance_columns = {column["name"] for column in inspect(engine).get_columns("appliances")}
    if "archived" not in appliance_columns:
        with engine.begin() as connection:
            connection.exec_driver_sql(
                "ALTER TABLE appliances ADD COLUMN archived BOOLEAN NOT NULL DEFAULT 0"
            )
            connection.exec_driver_sql("UPDATE appliances SET archived = 0")
    record_columns = {column["name"] for column in inspect(engine).get_columns("usage_records")}
    if "occupants" not in record_columns:
        with engine.begin() as connection:
            connection.exec_driver_sql(
                "ALTER TABLE usage_records ADD COLUMN occupants INTEGER"
            )
    if "started_at" not in record_columns:
        with engine.begin() as connection:
            connection.exec_driver_sql(
                "ALTER TABLE usage_records ADD COLUMN started_at DATETIME"
            )
    with SessionLocal() as db:
        if not db.scalar(select(ClassroomSection.id).limit(1)):
            db.add_all(
                ClassroomSection(name=name)
                for name in ("Grade 7 - Narra", "Grade 8 - Mahogany", "Grade 9 - Acacia")
            )
        if not db.scalar(select(Appliance.id).limit(1)):
            db.add_all(
                Appliance(name=name, wattage=wattage)
                for name, wattage in (
                    ("LED lights", 40),
                    ("Electric fan", 75),
                    ("Projector", 300),
                    ("Desktop computer", 180),
                    ("Air conditioner", 1200),
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
        db.commit()


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/sections")
def list_sections(db: Session = Depends(get_db)) -> list[dict]:
    return [_section_dict(item) for item in db.scalars(select(ClassroomSection).order_by(ClassroomSection.name))]


@app.get("/api/appliances")
def list_appliances(db: Session = Depends(get_db)) -> list[dict]:
    return [
        _appliance_dict(item)
        for item in db.scalars(
            select(Appliance).where(Appliance.archived.is_(False)).order_by(Appliance.name)
        )
    ]


@app.get("/api/rooms")
def list_room_choices(db: Session = Depends(get_db)) -> list[dict]:
    rooms = list(db.scalars(select(ClassroomRoom)))
    building_order = {"G11": 0, "ADMIN": 1, "G12": 2}
    rooms.sort(
        key=lambda room: (
            building_order.get(room.building_code, 3),
            room.floor,
            room.room_index,
        )
    )
    return [_room_identity(room) for room in rooms]


@app.post("/api/appliances", status_code=201)
def create_user_appliance(
    payload: ApplianceRequest,
    _: ClassroomUser = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    name = " ".join(payload.name.split())
    if db.scalar(select(Appliance.id).where(func.lower(Appliance.name) == name.lower())):
        raise HTTPException(status_code=409, detail="That appliance already exists.")
    appliance = Appliance(name=name, wattage=payload.wattage)
    db.add(appliance)
    db.commit()
    db.refresh(appliance)
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
        "assigned_room": _room_identity(room) if room else None,
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
        "assigned_room": _room_identity(room) if room else None,
    }


@app.get("/api/users/me/records")
def user_records(
    user: ClassroomUser = Depends(require_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    records = db.scalars(
        select(UsageRecord)
        .where(UsageRecord.user_id == user.id)
        .options(joinedload(UsageRecord.user), joinedload(UsageRecord.section), joinedload(UsageRecord.appliance))
        .order_by(UsageRecord.created_at.desc())
        .limit(100)
    )
    stats = _appliance_hour_stats(db)
    return [_record_dict(record, stats) for record in records]


@app.post("/api/records", status_code=201)
def create_record(
    payload: UsageRequest,
    user: ClassroomUser = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    section = db.get(ClassroomSection, payload.section_id)
    appliance = db.get(Appliance, payload.appliance_id)
    room = db.get(ClassroomRoom, payload.room_id) if payload.room_id else None
    if section is None or appliance is None or (payload.room_id and room is None):
        raise HTTPException(status_code=404, detail="Choose an available section and appliance.")
    if user.assigned_room_id is None:
        raise HTTPException(status_code=403, detail="Ask an administrator to assign your room first.")
    if payload.room_id != user.assigned_room_id:
        raise HTTPException(status_code=403, detail="Usage must be recorded in your assigned room.")
    now = utc_now()
    started_at = payload.started_at
    if started_at is not None and started_at.tzinfo is not None:
        started_at = started_at.astimezone(timezone.utc).replace(tzinfo=None)
    record = UsageRecord(
        user_id=user.id,
        section_id=section.id,
        room_id=room.id if room else None,
        appliance_id=appliance.id,
        hours=payload.hours,
        energy_kwh=round(appliance.wattage * payload.hours / 1000, 4),
        occupants=payload.occupants,
        started_at=started_at or (now - timedelta(hours=payload.hours)),
        created_at=now,
    )
    user.last_seen = utc_now()
    db.add(record)
    db.commit()
    db.refresh(record)
    return _record_dict(record)


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
    base_query = (
        select(UsageRecord)
        .where(UsageRecord.created_at >= start, UsageRecord.created_at < end)
        .options(joinedload(UsageRecord.user), joinedload(UsageRecord.section), joinedload(UsageRecord.appliance))
        .order_by(UsageRecord.created_at.desc())
    )
    records = list(db.scalars(base_query))
    section_totals: dict[str, float] = {}
    for record in records:
        section_totals[record.section.name] = section_totals.get(record.section.name, 0) + record.energy_kwh
    total_kwh = sum(record.energy_kwh for record in records)
    monthly = []
    for offset in range(5, -1, -1):
        month_index = start.year * 12 + start.month - 1 - offset
        year, month_index = divmod(month_index, 12)
        month_start = datetime(year, month_index + 1, 1)
        next_month = datetime(month_start.year + (month_start.month == 12), month_start.month % 12 + 1, 1)
        total = db.scalar(
            select(func.coalesce(func.sum(UsageRecord.energy_kwh), 0)).where(
                UsageRecord.created_at >= month_start,
                UsageRecord.created_at < next_month,
            )
        ) or 0
        monthly.append({"month": month_start.strftime("%b %Y"), "kwh": round(total, 2), "bill": round(total * ELECTRICITY_RATE, 2)})
    user_rows = db.execute(
        select(ClassroomUser, func.count(UsageRecord.id))
        .outerjoin(UsageRecord)
        .group_by(ClassroomUser.id)
        .order_by(ClassroomUser.last_seen.desc())
    ).all()
    stats = _appliance_hour_stats(db)
    flagged = [
        record
        for record in records
        if _usage_flags(record.hours, stats.get(record.appliance_id))
    ]
    return {
        "month": month,
        "rate_php_per_kwh": ELECTRICITY_RATE,
        "total_kwh": round(total_kwh, 2),
        "estimated_bill_php": round(total_kwh * ELECTRICITY_RATE, 2),
        "record_count": len(records),
        "user_count": db.scalar(select(func.count()).select_from(ClassroomUser)) or 0,
        "section_count": db.scalar(select(func.count()).select_from(ClassroomSection)) or 0,
        "highest_section": max(section_totals, key=section_totals.get) if section_totals else None,
        "monthly": monthly,
        "sections": [
            {"name": name, "kwh": round(kwh, 2), "bill": round(kwh * ELECTRICITY_RATE, 2)}
            for name, kwh in sorted(section_totals.items(), key=lambda item: item[1], reverse=True)
        ],
        "records": [_record_dict(record, stats) for record in records[:100]],
        "alerts": [
            {
                **_record_dict(record, stats),
                "reasons": [
                    "Session ran {0:g} hours (school-day threshold is {1:g}).".format(
                        record.hours, EXTENDED_USE_HOURS
                    )
                    if "extended-use" in _usage_flags(record.hours, stats.get(record.appliance_id))
                    else "Session is unusually long for {0}.".format(record.appliance.name),
                ],
            }
            for record in flagged[:20]
        ],
        "users": [
            {
                "username": user.username,
                "records": count,
                "last_seen": user.last_seen.isoformat(),
                "credentials_set": user.password_hash is not None,
                "assigned_room": (
                    _room_identity(db.get(ClassroomRoom, user.assigned_room_id))
                    if user.assigned_room_id
                    else None
                ),
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
    db: Session = Depends(get_db),
) -> dict:
    """Daily / weekly / monthly usage buckets plus usage patterns for a month."""
    if group not in ("day", "week", "month"):
        raise HTTPException(status_code=422, detail="Group must be day, week, or month.")
    now = datetime.now()
    month = month or now.strftime("%Y-%m")
    start, end = _month_bounds(month)
    records = list(
        db.scalars(
            select(UsageRecord)
            .where(UsageRecord.created_at >= start, UsageRecord.created_at < end)
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
                .where(UsageRecord.created_at >= earliest_start)
                .options(joinedload(UsageRecord.appliance))
                .order_by(UsageRecord.created_at)
            )
        )
        for record in month_records:
            key = record.created_at.strftime("%Y-%m")
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
            bucketed.setdefault(bucket_key(record.created_at), []).append(record)

    def summarize(rows: list[UsageRecord]) -> dict:
        top: dict[str, float] = {}
        for record in rows:
            top[record.appliance.name] = top.get(record.appliance.name, 0) + record.energy_kwh
        kwh = sum(record.energy_kwh for record in rows)
        return {
            "sessions": len(rows),
            "kwh": round(kwh, 2),
            "bill": round(kwh * ELECTRICITY_RATE, 2),
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
             "kwh": round(max(weekday_kwh), 2)}
            if records else None
        ),
        "peak_hour": (
            {"hour": hour_label(max(range(24), key=lambda index: hour_kwh[index])),
             "kwh": round(max(hour_kwh), 2)}
            if records else None
        ),
        "top_appliance": (
            {"name": max(appliance_kwh, key=appliance_kwh.get),
             "kwh": round(max(appliance_kwh.values()), 2)}
            if appliance_kwh else None
        ),
        "busiest_room": (
            {"room": max(room_kwh, key=room_kwh.get),
             "kwh": round(max(room_kwh.values()), 2)}
            if room_kwh else None
        ),
        "avg_occupants": round(occupant_total / occupant_count, 1) if occupant_count else None,
    }
    return {"month": month, "group": group, "buckets": buckets, "patterns": patterns}


@app.post("/api/admin/sections", status_code=201, dependencies=[Depends(require_admin)])
def add_section(payload: SectionRequest, db: Session = Depends(get_db)) -> dict:
    name = " ".join(payload.name.split())
    if db.scalar(select(ClassroomSection.id).where(func.lower(ClassroomSection.name) == name.lower())):
        raise HTTPException(status_code=409, detail="That section already exists.")
    section = ClassroomSection(name=name)
    db.add(section)
    db.commit()
    db.refresh(section)
    return _section_dict(section)


def _room_map_stats(db: Session) -> tuple[dict[int, dict], dict[str, float], dict[int, list[str]]]:
    """30-day usage per room, per-building average kWh/room, and assigned usernames per room."""
    cutoff = utc_now() - timedelta(days=30)
    rooms = list(db.scalars(select(ClassroomRoom)))
    room_usage: dict[int, dict] = {
        room.id: {"kwh": 0.0, "appliances": set(), "submissions": 0} for room in rooms
    }
    usage_records = db.scalars(
        select(UsageRecord)
        .where(UsageRecord.room_id.is_not(None), UsageRecord.created_at >= cutoff)
        .options(joinedload(UsageRecord.appliance))
    )
    for record in usage_records:
        metrics = room_usage.get(record.room_id)
        if metrics is None:
            continue
        metrics["kwh"] += record.energy_kwh
        metrics["appliances"].add(record.appliance_id)
        metrics["submissions"] += 1

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
    rooms = list(db.scalars(select(ClassroomRoom)))
    building_order = {"G11": 0, "ADMIN": 1, "G12": 2}
    rooms.sort(
        key=lambda room: (
            building_order.get(room.building_code, 3),
            room.floor,
            room.room_index,
        )
    )
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
                    "appliance_count": len(metrics["appliances"]),
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
        "appliance_count": len(metrics["appliances"]),
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
        raise HTTPException(status_code=409, detail="This section has usage records and cannot be removed.") from error
    return {"status": "section removed"}


@app.post("/api/admin/appliances", status_code=201, dependencies=[Depends(require_admin)])
def add_appliance(payload: ApplianceRequest, db: Session = Depends(get_db)) -> dict:
    name = " ".join(payload.name.split())
    if db.scalar(select(Appliance.id).where(func.lower(Appliance.name) == name.lower())):
        raise HTTPException(status_code=409, detail="That appliance already exists.")
    appliance = Appliance(name=name, wattage=payload.wattage)
    db.add(appliance)
    db.commit()
    db.refresh(appliance)
    return _appliance_dict(appliance)


@app.put("/api/admin/appliances/{appliance_id}", dependencies=[Depends(require_admin)])
def update_appliance(appliance_id: int, payload: ApplianceRequest, db: Session = Depends(get_db)) -> dict:
    appliance = db.get(Appliance, appliance_id)
    if appliance is None:
        raise HTTPException(status_code=404, detail="Appliance not found.")
    appliance.name = " ".join(payload.name.split())
    appliance.wattage = payload.wattage
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