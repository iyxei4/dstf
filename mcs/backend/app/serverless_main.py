"""
Serverless-compatible FastAPI app for Vercel.

This is a streamlined version of main.py adapted for Vercel's serverless runtime:
- No background threads, thread pools, or in-memory caches
- Per-request database sessions
- No startup schema migrations (use Supabase dashboard for migrations)
- Stateless request handling
"""

from calendar import day_name, monthrange
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import os
import re
import secrets
import sys
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

# Import database and models
from app.database import Base, SessionLocal, engine
from app.db_models import Appliance, ClassroomRoom, ClassroomSection, ClassroomUser, UsageRecord, utc_now

# Supabase REST API client for serverless environments
import httpx
from typing import Any

class SupabaseClient:
    """Wrapper for Supabase REST API (PostgREST) operations."""
    
    def __init__(self):
        self.supabase_url = os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL")
        self.service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if not self.supabase_url or not self.service_role_key:
            raise RuntimeError(
                "Supabase credentials not configured. "
                "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables."
            )
        self.base_url = f"{self.supabase_url}/rest/v1"
        self.headers = {
            "apikey": self.service_role_key,
            "Authorization": f"Bearer {self.service_role_key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation"
        }
        self._client: httpx.AsyncClient | None = None
    
    @property
    def client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(base_url=self.base_url, headers=self.headers, timeout=30.0)
        return self._client
    
    async def close(self):
        if self._client:
            await self._client.aclose()
            self._client = None
    
    def _build_filter_params(self, filters: dict) -> dict:
        """Build filter parameters for PostgREST."""
        params = {}
        if filters:
            for key, value in filters.items():
                if isinstance(value, dict):
                    for op, val in value.items():
                        # For ilike/like, wrap value with wildcards for pattern matching
                        if op in ("ilike.", "like."):
                            params[f"{key}{op}"] = f"*{val}*"
                        else:
                            params[f"{key}{op}"] = str(val)
                else:
                    # Check if value already contains an operator
                    if isinstance(value, str) and any(value.startswith(op) for op in ["eq.", "neq.", "gt.", "gte.", "lt.", "lte.", "like.", "ilike.", "in.", "is.", "fts.", "plfts.", "phfts.", "wfts."]):
                        # For ilike/like, wrap value with wildcards
                        if value.startswith("ilike.") or value.startswith("like."):
                            op_part = value.split(".", 1)[0] + "."
                            val_part = value.split(".", 1)[1]
                            params[key] = f"{op_part}*{val_part}*"
                        else:
                            params[key] = value
                    else:
                        params[key] = f"eq.{value}"
        return params
    
    async def select(self, table: str, columns: str = "*", filters: dict = None, order: str = None, limit: int = None, offset: int = None) -> list[dict]:
        """SELECT query with filters, ordering, pagination."""
        params = {"select": columns}
        params.update(self._build_filter_params(filters))
        if order:
            params["order"] = order
        if limit:
            params["limit"] = str(limit)
        if offset:
            params["offset"] = str(offset)
        
        response = await self.client.get(f"/{table}", params=params)
        response.raise_for_status()
        return response.json()
    
    async def insert(self, table: str, data: dict | list[dict]) -> list[dict]:
        """INSERT and return inserted rows."""
        response = await self.client.post(f"/{table}", json=data)
        response.raise_for_status()
        return response.json()
    
    async def update(self, table: str, data: dict, filters: dict) -> list[dict]:
        """UPDATE with filters and return updated rows."""
        params = self._build_filter_params(filters)
        
        response = await self.client.patch(f"/{table}", params=params, json=data)
        response.raise_for_status()
        return response.json()
    
    async def delete(self, table: str, filters: dict) -> list[dict]:
        """DELETE with filters."""
        params = self._build_filter_params(filters)
        
        response = await self.client.delete(f"/{table}", params=params)
        response.raise_for_status()
        return response.json()
    
    async def rpc(self, function_name: str, params: dict = None) -> Any:
        """Call a PostgREST stored procedure."""
        response = await self.client.post(f"/rpc/{function_name}", json=params or {})
        response.raise_for_status()
        return response.json()

# Singleton instance
_supabase_client: SupabaseClient | None = None

def get_supabase() -> SupabaseClient:
    """Get or create the Supabase client singleton."""
    global _supabase_client
    if _supabase_client is None:
        _supabase_client = SupabaseClient()
    return _supabase_client

# Serverless app - no middleware that requires persistent state
app = FastAPI(title="WattWise Classroom Energy API", version="1.0.0")
app.add_middleware(GZipMiddleware, minimum_size=500)


# Security headers middleware
@app.middleware("http")
async def security_headers(request: Request, call_next):
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


# Test database connection endpoint (uses Supabase REST API)
@app.get("/api/test-db")
async def test_db_connection():
    try:
        sb = get_supabase()
        data = await sb.select("classroom_sections", columns="id,name", limit=1)
        return {
            "status": "ok",
            "database_connection": "successful",
            "test_data": data
        }
    except RuntimeError as e:
        # Missing credentials
        return {
            "status": "error",
            "database_connection": "failed",
            "error": str(e),
            "error_type": "ConfigurationError",
            "hint": "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel project settings"
        }
    except httpx.HTTPStatusError as e:
        return {
            "status": "error",
            "database_connection": "failed",
            "error": f"Supabase API error: {e.response.status_code} {e.response.text}",
            "error_type": "SupabaseAPIError"
        }

# Debug endpoint to check admin cookie
@app.get("/api/debug-admin-cookie")
async def debug_admin_cookie(request: Request):
    token = request.cookies.get("wattwise_admin", "")
    return {
        "cookie_received": token[:50] + "..." if len(token) > 50 else token,
        "cookie_length": len(token),
        "all_cookies": dict(request.cookies),
    }


# Test endpoint to check classroom_users table structure
@app.get("/api/test-users")
async def test_users_table():
    try:
        sb = get_supabase()
        # Get one user to see columns
        data = await sb.select("classroom_users", limit=1)
        return {
            "status": "ok",
            "columns": list(data[0].keys()) if data else [],
            "sample_data": data
        }
    except Exception as e:
        import traceback
        return {
            "status": "error",
            "error": str(e),
            "error_type": type(e).__name__,
            "traceback": traceback.format_exc()
        }
    except Exception as e:
        import traceback
        return {
            "status": "error",
            "database_connection": "failed",
            "error": str(e),
            "error_type": type(e).__name__,
            "traceback": traceback.format_exc()
        }


# Configuration from environment
ADMIN_USERNAME = os.getenv("MCS_ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.getenv("MCS_ADMIN_PASSWORD", "mcs2026")
SESSION_SECRET = os.getenv("MCS_SESSION_SECRET", "development-secret-change-before-deploy")
ELECTRICITY_RATE = float(os.getenv("MCS_ELECTRICITY_RATE", "12"))
SESSION_COOKIE = "wattwise_admin"
USER_SESSION_COOKIE = "wattwise_user"
SESSION_SECONDS = 8 * 60 * 60
PASSWORD_ITERATIONS = 310_000

FRONTEND_URL = os.getenv("MCS_FRONTEND_URL", "https://wattwise-classrooms-uzi-siegfrieds-projects.vercel.app")

KWH_PRECISION = 4
EXTENDED_USE_HOURS = 8.0
UNUSUAL_USE_MULTIPLE = 2.0
UNUSUAL_USE_MIN_SESSIONS = 3


def _appliance_hour_stats(
    db: Session,
    appliance_ids: Iterable[int] | None = None,
) -> dict[int, tuple[float, int]]:
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


# Pydantic models (same as main.py)
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
    quantity: int = Field(default=1, ge=1, le=999)


class UsageRequest(BaseModel):
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
    username: str | None = Field(default=None, max_length=80)


class RegisterUserRequest(BaseModel):
    username: str = Field(min_length=2, max_length=80)
    campus_name: str = Field(min_length=1, max_length=255)
    email: str = Field(
        min_length=5,
        max_length=255,
        pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$",
    )
    password: str = Field(min_length=8, max_length=200)


# Database dependency - returns Supabase client for serverless
async def get_db():
    """Dependency that provides a Supabase client."""
    sb = get_supabase()
    try:
        yield sb
    finally:
        await sb.close()


# Security utilities
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


@dataclass(frozen=True)
class AuthUser:
    id: int
    username: str
    email: str | None
    status: str
    section_id: int | None
    assigned_room_id: int | None
    has_password: bool
    role: str
    workspace_name: str | None


AUTH_CACHE_SECONDS = 15.0
_auth_cache: dict[str, tuple[float, AuthUser]] = {}


def _invalidate_auth_cache(username: str | None = None) -> None:
    if username is None:
        _auth_cache.clear()
    else:
        _auth_cache.pop(username.lower(), None)


async def _load_auth_user(db: SupabaseClient, username: str) -> AuthUser | None:
    now = time.monotonic()
    cached = _auth_cache.get(username.lower())
    if cached is not None and cached[0] > now:
        return cached[1]
    
    # Select only columns that exist in the Supabase table
    users = await db.select(
        "classroom_users",
        columns="id,username,status,section_id,assigned_room_id,password_hash",
        filters={"username": f"ilike.{username}"},
        limit=1
    )
    if not users:
        return None
    row = users[0]
    # Default values for columns that don't exist in the DB
    role = "user"
    user = AuthUser(
        id=row["id"],
        username=row["username"],
        email=row.get("email"),
        status=row.get("status", "pending"),
        section_id=row.get("section_id"),
        assigned_room_id=row.get("assigned_room_id"),
        workspace_name=row.get("workspace_name"),
        role=role,
        has_password=row.get("password_hash") is not None,
    )
    _auth_cache[username.lower()] = (now + AUTH_CACHE_SECONDS, user)
    return user


async def require_user(
    request: Request,
    db: SupabaseClient = Depends(get_db),
) -> AuthUser:
    username = _read_session_subject(request, USER_SESSION_COOKIE)
    if username is None:
        raise HTTPException(status_code=401, detail="User sign-in required.")
    user = await _load_auth_user(db, username)
    if user is None:
        raise HTTPException(status_code=401, detail="User credentials are no longer valid.")
    if not user.has_password:
        raise HTTPException(status_code=401, detail="User credentials are no longer valid.")
    if user.status != "active":
        raise HTTPException(status_code=403, detail="This account is awaiting administrator approval.")
    return user


def _require_workspace_owner(user: AuthUser) -> None:
    if not user.workspace_name or user.role == "emc":
        raise HTTPException(
            status_code=403,
            detail="Only workspace owners can perform this action.",
        )


def _clean_text(value: str | None, *, max_length: int) -> str | None:
    if value is None:
        return None
    cleaned = "".join(ch for ch in value if ch == "\n" or ch == "\t" or ord(ch) >= 32)
    cleaned = " ".join(cleaned.split())
    return cleaned[:max_length]


def _slugify(value: str | None) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (value or "").lower()).strip("-")
    return slug[:40] or "campus"


async def _owner_username_for(
    db: SupabaseClient, user: AuthUser
) -> str | None:
    if user.role != "emc":
        return user.username
    
    # Check section owner
    if user.section_id:
        sections = await db.select("classroom_sections", columns="owner_id", filters={"id": f"eq.{user.section_id}"}, limit=1)
        if sections and sections[0].get("owner_id"):
            owners = await db.select("classroom_users", columns="username", filters={"id": f"eq.{sections[0]['owner_id']}"}, limit=1)
            if owners:
                return owners[0]["username"]
    
    # Check room owner
    if user.assigned_room_id:
        rooms = await db.select("classroom_rooms", columns="owner_id", filters={"id": f"eq.{user.assigned_room_id}"}, limit=1)
        if rooms and rooms[0].get("owner_id"):
            owners = await db.select("classroom_users", columns="username", filters={"id": f"eq.{rooms[0]['owner_id']}"}, limit=1)
            if owners:
                return owners[0]["username"]
    
    # Check workspace owner
    if user.workspace_name:
        owners = await db.select(
            "classroom_users", 
            columns="username", 
            filters={"workspace_name": f"eq.{user.workspace_name}", "role": "eq.owner"},
            limit=1
        )
        if owners:
            return owners[0]["username"]
    
    return None


async def _campus_fields(db: SupabaseClient, user: AuthUser) -> dict:
    owner_username = await _owner_username_for(db, user)
    return {
        "campus_slug": _slugify(user.workspace_name) if user.workspace_name else "",
        "owner_username": owner_username,
    }


async def _ensure_owner_section(db: SupabaseClient, user: AuthUser) -> dict:
    # Check if user already has a section
    if user.section_id:
        sections = await db.select("classroom_sections", columns="id,name,grade,section_name,owner_id", filters={"id": f"eq.{user.section_id}"}, limit=1)
        if sections:
            return sections[0]
    
    base = f"{(user.workspace_name or 'Workspace')[:50]} - General"
    name = base
    counter = 1
    
    # Check if section name exists
    while True:
        sections = await db.select("classroom_sections", columns="id", filters={"name": f"ilike.{name}"}, limit=1)
        if not sections:
            break
        counter += 1
        name = f"{base} ({counter})"
    
    # Create new section
    new_section = await db.insert("classroom_sections", {
        "name": name,
        "section_name": "General",
        "owner_id": user.id
    })
    return new_section[0] if new_section else {}


def _section_dict(section: ClassroomSection) -> dict:
    return {
        "id": section.id,
        "name": section.name,
        "grade": section.grade,
        "section_name": section.section_name,
    }


def _appliance_dict(appliance: Appliance) -> dict:
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
    return record.started_at or record.created_at


def _kwh_and_bill(kwh: float) -> tuple[float, float]:
    rounded = round(kwh or 0.0, KWH_PRECISION)
    return rounded, round(rounded * ELECTRICITY_RATE, 2)


def _record_dict(
    record: dict,
    stats: dict[int, tuple[float, int]] | None = None,
    flags: list[str] | None = None,
    *,
    user: dict | AuthUser | None = None,
    section: dict | None = None,
    appliance: dict | None = None,
) -> dict:
    """Convert a usage record dict to API response format."""
    user = user or record.get("user", {})
    section = section or record.get("section", {})
    appliance = appliance or record.get("appliance", {})
    
    started_at = record.get("started_at") or record.get("created_at")
    if started_at:
        started = datetime.fromisoformat(started_at.replace("Z", "+00:00")) if isinstance(started_at, str) else started_at
    else:
        created = datetime.fromisoformat(record["created_at"].replace("Z", "+00:00")) if isinstance(record["created_at"], str) else record["created_at"]
        started = created - timedelta(hours=record["hours"])
    
    energy_kwh, estimated_cost = _kwh_and_bill(record.get("energy_kwh", 0))
    quantity = appliance.get("quantity") or 1
    
    return {
        "id": record["id"],
        "username": user.get("username", "") if isinstance(user, dict) else (user.username if user else ""),
        "section": section.get("name", "") if isinstance(section, dict) else (section.name if section else ""),
        "section_id": record.get("section_id"),
        "room_id": record.get("room_id"),
        "appliance": appliance.get("name", "") if isinstance(appliance, dict) else (appliance.name if appliance else ""),
        "appliance_id": record.get("appliance_id"),
        "wattage": float(appliance.get("wattage", 0)) if isinstance(appliance, dict) else (appliance.wattage if appliance else 0),
        "quantity": quantity,
        "connected_watts": round(float(appliance.get("wattage", 0)) * quantity, 4) if isinstance(appliance, dict) else round(appliance.wattage * quantity, 4),
        "hours": record["hours"],
        "energy_kwh": energy_kwh,
        "estimated_cost_php": estimated_cost,
        "occupants": record.get("occupants"),
        "started_at": started.isoformat() if hasattr(started, 'isoformat') else str(started),
        "created_at": record["created_at"] if isinstance(record["created_at"], str) else record["created_at"].isoformat(),
        "flags": flags if flags is not None else _usage_flags(record["hours"], (stats or {}).get(record["appliance_id"])),
    }


def _month_bounds(month: str) -> tuple[datetime, datetime]:
    try:
        start = datetime.strptime(month, "%Y-%m")
    except ValueError as error:
        raise HTTPException(status_code=422, detail="Month must use YYYY-MM format.") from error
    end = datetime(start.year + (start.month == 12), start.month % 12 + 1, 1)
    return start, end


async def _ordered_rooms(db: SupabaseClient) -> list[dict]:
    building_order = {"G11": 0, "ADMIN": 1, "G12": 2}
    rooms = await db.select("classroom_rooms")
    rooms.sort(
        key=lambda room: (
            building_order.get(room.get("building_code", ""), 3),
            room.get("floor", 0),
            room.get("room_index", 0),
        )
    )
    return rooms


async def _find_user(db: SupabaseClient, username: str) -> dict:
    users = await db.select("classroom_users", filters={"username": f"ilike.{username}"}, limit=1)
    if not users:
        raise HTTPException(status_code=404, detail="User account not found.")
    return users[0]


def _set_user_session_cookie(response: Response, username: str) -> None:
    session = _session_payload(username)
    response.set_cookie(
        USER_SESSION_COOKIE,
        f"{session}.{_token_signature(session)}",
        max_age=SESSION_SECONDS,
        httponly=True,
        secure=True,
        samesite="lax",
        path="/api",
    )


# --- API Routes ---

@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def _catalog_cache(response: Response) -> None:
    response.headers["Cache-Control"] = "public, max-age=120"
    response.headers["Vary"] = "Accept-Encoding"


def _section_dict(section: dict) -> dict:
    return {
        "id": section["id"],
        "name": section["name"],
        "grade": section.get("grade", ""),
        "section_name": section.get("section_name", ""),
    }


def _appliance_dict(appliance: dict) -> dict:
    quantity = appliance.get("quantity") or 1
    return {
        "id": appliance["id"],
        "name": appliance["name"],
        "wattage": float(appliance["wattage"]),
        "quantity": quantity,
        "connected_watts": round(float(appliance["wattage"]) * quantity, 4),
    }


def _room_identity(room: dict) -> dict:
    return {
        "id": room["id"],
        "building_code": room.get("building_code", ""),
        "building_name": room.get("building_name", ""),
        "floor": room.get("floor", 0),
        "room_index": room.get("room_index", 0),
        "room_number": room.get("room_number"),
        "room_type": room.get("room_type", "classroom"),
        "custom_type": room.get("custom_type"),
        "room_name": room.get("room_name"),
    }


@app.get("/api/sections")
async def list_sections(response: Response, db: SupabaseClient = Depends(get_db)) -> list[dict]:
    _catalog_cache(response)
    sections = await db.select("classroom_sections", order="name")
    return [_section_dict(s) for s in sections]


@app.get("/api/appliances")
async def list_appliances(
    response: Response,
    db: SupabaseClient = Depends(get_db),
    limit: int = 100,
    offset: int = 0,
) -> list[dict]:
    _catalog_cache(response)
    limit = max(1, min(limit, 200))
    offset = max(0, offset)
    appliances = await db.select(
        "appliances", 
        filters={"archived": "eq.false"}, 
        order="name",
        limit=limit,
        offset=offset
    )
    return [_appliance_dict(a) for a in appliances]


@app.get("/api/rooms")
async def list_room_choices(
    response: Response,
    db: SupabaseClient = Depends(get_db),
    limit: int = 100,
    offset: int = 0,
) -> list[dict]:
    _catalog_cache(response)
    limit = max(1, min(limit, 200))
    offset = max(0, offset)
    # Get rooms ordered by building_code, floor, room_index
    # We'll need to sort in Python since Supabase ordering is limited
    rooms = await db.select("classroom_rooms", limit=limit, offset=offset)
    # Sort by building order, floor, room_index
    building_order = {"G11": 0, "ADMIN": 1, "G12": 2}
    rooms.sort(key=lambda r: (building_order.get(r.get("building_code", ""), 3), r.get("floor", 0), r.get("room_index", 0)))
    return [_room_identity(r) for r in rooms]


@app.post("/api/users/login")
async def user_login(
    payload: LoginRequest,
    response: Response,
    db: SupabaseClient = Depends(get_db),
) -> dict:
    username = " ".join(payload.username.split())
    users = await db.select(
        "classroom_users",
        filters={"username": f"ilike.{username}"},
        limit=1
    )
    if not users:
        raise HTTPException(status_code=401, detail="Incorrect account name or password.")
    
    user = users[0]
    if user.get("password_hash") is None or not _verify_user_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Incorrect account name or password.")
    if user.get("status") != "active":
        raise HTTPException(status_code=403, detail="Your account is awaiting administrator approval.")
    
    # Update last_seen
    await db.update("classroom_users", {"last_seen": datetime.utcnow().isoformat()}, {"id": f"eq.{user['id']}"})
    _invalidate_auth_cache(user["username"])
    _set_user_session_cookie(response, user["username"])
    
    # Get room info
    room = None
    if user.get("assigned_room_id"):
        rooms = await db.select("classroom_rooms", filters={"id": f"eq.{user['assigned_room_id']}"}, limit=1)
        room = rooms[0] if rooms else None
    
    # Get section info
    section = None
    if user.get("section_id"):
        sections = await db.select("classroom_sections", filters={"id": f"eq.{user['section_id']}"}, limit=1)
        section = sections[0] if sections else None
    
    # Default role since workspace_name and role columns don't exist in DB
    role = "user"
    auth_user = AuthUser(
        id=user["id"],
        username=user["username"],
        email=None,  # email column doesn't exist in DB
        status=user.get("status", "pending"),
        section_id=user.get("section_id"),
        assigned_room_id=user.get("assigned_room_id"),
        workspace_name=None,  # workspace_name column doesn't exist in DB
        role=role,
        has_password=user.get("password_hash") is not None
    )
    campus = await _campus_fields(db, auth_user)
    owner_username = await _owner_username_for(db, auth_user)
    campus["owner_username"] = owner_username
    
    return {
        "username": user["username"],
        "email": user.get("email"),
        "role": role,
        "workspace_name": user.get("workspace_name"),
        "section": _section_dict(section) if section else None,
        "assigned_room": _room_identity(room) if room else None,
        "rate_php_per_kwh": ELECTRICITY_RATE,
        **campus,
    }


@app.post("/api/users/register", status_code=201)
async def register_user(payload: RegisterRequest, db: SupabaseClient = Depends(get_db)) -> dict:
    username = " ".join(payload.username.split())
    existing = await db.select("classroom_users", columns="id", filters={"username": f"ilike.{username}"}, limit=1)
    if existing:
        raise HTTPException(status_code=409, detail="That account name is already taken.")
    
    sections = await db.select("classroom_sections", filters={"id": f"eq.{payload.section_id}"}, limit=1)
    if not sections:
        raise HTTPException(status_code=404, detail="Choose an available classroom section.")
    section = sections[0]
    
    now = datetime.utcnow().isoformat()
    new_user = await db.insert("classroom_users", {
        "username": username,
        "password_hash": _hash_user_password(payload.password),
        "section_id": section["id"],
        "status": "pending",
        "created_at": now,
        "last_seen": now,
    })
    user = new_user[0] if new_user else None
    
    return {
        "username": user["username"],
        "status": "pending",
        "section": _section_dict(section),
        "message": "Account created. An administrator must approve it before you can sign in.",
    }


@app.post("/api/users/register-owner", status_code=201)
async def register_owner(
    payload: RegisterOwnerRequest,
    response: Response,
    db: SupabaseClient = Depends(get_db),
) -> dict:
    email = _clean_text(payload.email, max_length=255)
    if not email:
        raise HTTPException(status_code=400, detail="Email is required.")
    email = email.lower()
    username = _clean_text(
        payload.username or email.split("@", 1)[0],
        max_length=80,
    ) or "user"
    username = re.sub(r"[^A-Za-z0-9._-]+", "-", username).strip("-_.") or "user"
    
    existing = await db.select("classroom_users", columns="id", filters={"username": f"ilike.{username}"}, limit=1)
    if existing:
        raise HTTPException(status_code=409, detail="That username is already taken.")
    
    # Note: Email uniqueness check skipped because email column doesn't exist in Supabase table
    # The email is validated but not stored
    
    workspace_name = _clean_text(payload.workspace_name, max_length=255)
    if not workspace_name:
        raise HTTPException(status_code=400, detail="Workspace name is required.")
    
    # The Supabase classroom_users table may not have all columns (email, workspace_name, role)
    # Only insert columns that exist in the database
    now = datetime.utcnow().isoformat()
    insert_data = {
        "username": username,
        "password_hash": _hash_user_password(payload.password),
        "status": "active",
        "created_at": now,
        "last_seen": now,
    }
    new_user = await db.insert("classroom_users", insert_data)
    user = new_user[0] if new_user else None
    
    _invalidate_auth_cache(user["username"])
    _set_user_session_cookie(response, user["username"])
    
    campus = await _campus_fields(db, AuthUser(
        id=user["id"],
        username=user["username"],
        email=None,
        status=user.get("status", "pending"),
        section_id=user.get("section_id"),
        assigned_room_id=user.get("assigned_room_id"),
        workspace_name=None,
        role="owner",
        has_password=user.get("password_hash") is not None
    ))
    owner_username = await _owner_username_for(db, AuthUser(
        id=user["id"],
        username=user["username"],
        email=None,
        status=user.get("status", "pending"),
        section_id=user.get("section_id"),
        assigned_room_id=user.get("assigned_room_id"),
        workspace_name=None,
        role="owner",
        has_password=user.get("password_hash") is not None
    ))
    campus["owner_username"] = owner_username
    
    return {
        "username": user["username"],
        "email": None,  # email column doesn't exist in DB
        "role": "owner",
        "workspace_name": None,  # workspace_name column doesn't exist in DB
        "status": "active",
        **campus,
    }


@app.post("/api/users/register-user", status_code=201)
async def register_user_simple(
    payload: RegisterUserRequest,
    db: SupabaseClient = Depends(get_db),
) -> dict:
    # Email is validated by Pydantic but not stored in DB (column doesn't exist)
    email = _clean_text(payload.email, max_length=255)
    if not email:
        raise HTTPException(status_code=400, detail="Email is required.")
    email = email.lower()
    username = _clean_text(payload.username, max_length=80)
    if not username:
        raise HTTPException(status_code=400, detail="Username is required.")
    username = re.sub(r"[^A-Za-z0-9._-]+", "-", username).strip("-_.") or "user"
    
    existing = await db.select("classroom_users", columns="id", filters={"username": f"ilike.{username}"}, limit=1)
    if existing:
        raise HTTPException(status_code=409, detail="That username is already taken.")
    
    # Note: Email uniqueness check skipped because email column doesn't exist in Supabase table
    # The email is validated but not stored
    
    campus_name = _clean_text(payload.campus_name, max_length=255)
    if not campus_name:
        raise HTTPException(status_code=400, detail="Campus name is required.")
    workspace_slug = _slugify(campus_name)
    if not workspace_slug:
        workspace_slug = "campus"
    
    # The Supabase classroom_users table may not have all columns (email, workspace_name, role)
    # Only insert columns that exist in the database
    now = datetime.utcnow().isoformat()
    insert_data = {
        "username": username,
        "password_hash": _hash_user_password(payload.password),
        "status": "pending",
        "created_at": now,
        "last_seen": now,
    }
    # Only add email if the column exists (check by trying to select it)
    # We'll skip email and workspace_name for now since they don't exist in the DB
    try:
        new_user = await db.insert("classroom_users", insert_data)
    except httpx.HTTPStatusError as e:
        import traceback
        return {
            "status": "error",
            "detail": f"Supabase insert error: {e.response.status_code} - {e.response.text}",
            "error_type": "SupabaseInsertError",
            "traceback": traceback.format_exc()
        }
    user = new_user[0] if new_user else None
    _invalidate_auth_cache(user["username"])
    
    return {
        "username": user["username"],
        "email": None,  # email column doesn't exist in DB
        "role": "user",
        "workspace_name": None,  # workspace_name column doesn't exist in DB
        "status": "pending",
        "message": "Account created. An administrator must approve it before you can sign in.",
    }


@app.get("/api/users/username-available")
async def check_username_available(username: str, db: SupabaseClient = Depends(get_db)) -> dict:
    existing = await db.select("classroom_users", columns="id", filters={"username": f"ilike.{username}"}, limit=1)
    return {"available": not bool(existing)}


@app.post("/api/users/logout")
async def user_logout(response: Response, _: AuthUser = Depends(require_user)) -> dict[str, str]:
    response.delete_cookie(USER_SESSION_COOKIE, path="/api", samesite="lax")
    return {"status": "signed out"}


@app.get("/api/users/session")
async def user_session(
    user: AuthUser = Depends(require_user),
    db: SupabaseClient = Depends(get_db),
) -> dict:
    room = None
    if user.assigned_room_id:
        rooms = await db.select("classroom_rooms", filters={"id": f"eq.{user.assigned_room_id}"}, limit=1)
        room = rooms[0] if rooms else None
    section = None
    if user.section_id:
        sections = await db.select("classroom_sections", filters={"id": f"eq.{user.section_id}"}, limit=1)
        section = sections[0] if sections else None
    
    role = "owner" if user.workspace_name and user.role != "emc" else (user.role or "user")
    campus = await _campus_fields(db, user)
    owner_username = await _owner_username_for(db, user)
    campus["owner_username"] = owner_username
    
    return {
        "username": user.username,
        "email": user.email,
        "role": role,
        "workspace_name": user.workspace_name,
        "section": _section_dict(section) if section else None,
        "assigned_room": _room_identity(room) if room else None,
        "rate_php_per_kwh": ELECTRICITY_RATE,
        **campus,
    }


@app.get("/api/users/me")
async def user_me(user: AuthUser = Depends(require_user), db: SupabaseClient = Depends(get_db)) -> dict:
    room = None
    if user.assigned_room_id:
        rooms = await db.select("classroom_rooms", filters={"id": f"eq.{user.assigned_room_id}"}, limit=1)
        room = rooms[0] if rooms else None
    section = None
    if user.section_id:
        sections = await db.select("classroom_sections", filters={"id": f"eq.{user.section_id}"}, limit=1)
        section = sections[0] if sections else None
    
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "status": user.status,
        "section": _section_dict(section) if section else None,
        "assigned_room": _room_identity(room) if room else None,
        "rate_php_per_kwh": ELECTRICITY_RATE,
    }


@app.get("/api/users/me/records")
async def user_records(
    user: AuthUser = Depends(require_user),
    db: SupabaseClient = Depends(get_db),
) -> list[dict]:
    # Get records with appliance and section info
    records = await db.select(
        "usage_records",
        columns="*,appliance:appliances(*),section:classroom_sections(*)",
        filters={"user_id": f"eq.{user.id}", "section_id": f"eq.{user.section_id}"},
        order="created_at.desc",
        limit=100
    )
    
    # Get appliance stats
    appliance_ids = [r["appliance_id"] for r in records]
    stats = {}
    if appliance_ids:
        for aid in set(appliance_ids):
            recs = [r for r in records if r["appliance_id"] == aid]
            hours = [r["hours"] for r in recs]
            stats[aid] = (sum(hours) / len(hours), len(hours))
    
    return [
        _record_dict(record, stats, user={"username": user.username}, section=record.get("section"), appliance=record.get("appliance"))
        for record in records
    ]


@app.post("/api/records", status_code=201)
async def create_record(
    payload: UsageRequest,
    user: AuthUser = Depends(require_user),
    db: SupabaseClient = Depends(get_db),
) -> dict:
    # Get appliance
    appliances = await db.select("appliances", filters={"id": f"eq.{payload.appliance_id}"}, limit=1)
    if not appliances:
        raise HTTPException(status_code=404, detail="Choose an available appliance and room.")
    appliance = appliances[0]
    
    room = None
    if payload.room_id:
        rooms = await db.select("classroom_rooms", filters={"id": f"eq.{payload.room_id}"}, limit=1)
        if not rooms:
            raise HTTPException(status_code=404, detail="Choose an available appliance and room.")
        room = rooms[0]
    
    is_workspace_owner = user.workspace_name is not None and user.role != "emc"
    
    if is_workspace_owner:
        if user.section_id is None:
            raise HTTPException(
                status_code=403, detail="Please set your section first via workspace settings."
            )
        sections = await db.select("classroom_sections", filters={"id": f"eq.{user.section_id}"}, limit=1)
        if not sections or sections[0].get("owner_id") != user.id:
            raise HTTPException(
                status_code=403, detail="Your section is not available or does not belong to your workspace."
            )
        section = sections[0]
        if payload.room_id is not None:
            if room is None or room.get("owner_id") != user.id:
                raise HTTPException(
                    status_code=403, detail="Room is not available or does not belong to your workspace."
                )
    else:
        if user.section_id is None:
            raise HTTPException(
                status_code=403, detail="Ask an administrator to set your classroom section first."
            )
        sections = await db.select("classroom_sections", filters={"id": f"eq.{user.section_id}"}, limit=1)
        if not sections:
            raise HTTPException(status_code=403, detail="Your classroom section is no longer available.")
        section = sections[0]
        if user.assigned_room_id is None:
            raise HTTPException(status_code=403, detail="Ask an administrator to assign your room first.")
        if payload.room_id != user.assigned_room_id:
            raise HTTPException(status_code=403, detail="Usage must be recorded in your assigned room.")
    
    now = utc_now()
    started_at = payload.started_at
    if started_at is not None and started_at.tzinfo is not None:
        started_at = started_at.astimezone(timezone.utc).replace(tzinfo=None)
    connected_watts = float(appliance["wattage"]) * (appliance.get("quantity") or 1)
    
    new_record = await db.insert("usage_records", {
        "user_id": user.id,
        "section_id": section["id"],
        "room_id": room["id"] if room else None,
        "appliance_id": appliance["id"],
        "hours": payload.hours,
        "energy_kwh": round(connected_watts * payload.hours / 1000, 4),
        "occupants": payload.occupants,
        "started_at": (started_at or (now - timedelta(hours=payload.hours))).isoformat(),
        "created_at": now.isoformat(),
    })
    record = new_record[0] if new_record else {}
    
    # Update user last_seen
    await db.update("classroom_users", {"last_seen": now.isoformat()}, {"id": f"eq.{user.id}"})
    
    return _record_dict(record, user={"username": user.username}, section=section, appliance=appliance)


# Admin routes
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
        secure=True,
        samesite="lax",
        path="/api",
    )
    return {"username": ADMIN_USERNAME}


@app.get("/api/admin/session")
def admin_session(_: None = Depends(require_admin)) -> dict[str, str]:
    return {"username": ADMIN_USERNAME}


@app.post("/api/admin/logout")
def admin_logout(response: Response, _: None = Depends(require_admin)) -> dict[str, str]:
    response.delete_cookie(SESSION_COOKIE, path="/api", samesite="lax")
    return {"status": "signed out"}


@app.post("/api/admin/users/credentials", dependencies=[Depends(require_admin)])
async def set_user_credentials(
    payload: UserCredentialsRequest,
    db: SupabaseClient = Depends(get_db),
) -> dict[str, str]:
    username = " ".join(payload.username.split())
    if payload.assigned_room_id:
        rooms = await db.select("classroom_rooms", columns="id", filters={"id": f"eq.{payload.assigned_room_id}"}, limit=1)
        if not rooms:
            raise HTTPException(status_code=404, detail="Room not found.")
    
    users = await db.select("classroom_users", filters={"username": f"ilike.{username}"}, limit=1)
    if not users:
        new_user = await db.insert("classroom_users", {"username": username})
        user = new_user[0] if new_user else None
    else:
        user = users[0]
    
    await db.update("classroom_users", 
        {"password_hash": _hash_user_password(payload.password), "assigned_room_id": payload.assigned_room_id},
        {"id": f"eq.{user['id']}"}
    )
    _invalidate_auth_cache(user["username"])
    return {"username": user["username"], "status": "credentials set"}


@app.put("/api/admin/users/{username}/room", dependencies=[Depends(require_admin)])
async def assign_user_room(
    username: str,
    payload: RoomAssignmentRequest,
    db: SupabaseClient = Depends(get_db),
) -> dict:
    user = await _find_user(db, username)
    room = None
    if payload.room_id:
        rooms = await db.select("classroom_rooms", filters={"id": f"eq.{payload.room_id}"}, limit=1)
        if not rooms:
            raise HTTPException(status_code=404, detail="Room not found.")
        room = rooms[0]
    
    await db.update("classroom_users", {"assigned_room_id": room["id"] if room else None}, {"id": f"eq.{user['id']}"})
    _invalidate_auth_cache(user["username"])
    return {
        "username": user["username"],
        "assigned_room": _room_identity(room) if room else None,
    }


@app.post("/api/admin/users/{username}/approve", dependencies=[Depends(require_admin)])
async def approve_user(username: str, db: SupabaseClient = Depends(get_db)) -> dict:
    user = await _find_user(db, username)
    if user.get("status") == "active":
        return {"username": user["username"], "status": "active"}
    if user.get("section_id") is None:
        raise HTTPException(
            status_code=409,
            detail="Set this account's classroom section before approving it.",
        )
    await db.update("classroom_users", {"status": "active"}, {"id": f"eq.{user['id']}"})
    _invalidate_auth_cache(user["username"])
    return {"username": user["username"], "status": "active"}


@app.put("/api/admin/users/{username}/section", dependencies=[Depends(require_admin)])
async def assign_user_section(
    username: str,
    payload: SectionAssignmentRequest,
    db: SupabaseClient = Depends(get_db),
) -> dict:
    user = await _find_user(db, username)
    section = None
    if payload.section_id:
        sections = await db.select("classroom_sections", filters={"id": f"eq.{payload.section_id}"}, limit=1)
        if not sections:
            raise HTTPException(status_code=404, detail="Section not found.")
        section = sections[0]
    
    await db.update("classroom_users", {"section_id": section["id"] if section else None}, {"id": f"eq.{user['id']}"})
    _invalidate_auth_cache(user["username"])
    return {"username": user["username"], "section": _section_dict(section) if section else None}


@app.delete("/api/admin/users/{username}", dependencies=[Depends(require_admin)])
async def delete_user(username: str, db: SupabaseClient = Depends(get_db)) -> dict[str, str]:
    user = await _find_user(db, username)
    records = await db.select("usage_records", columns="id", filters={"user_id": f"eq.{user['id']}"}, limit=1)
    if records:
        raise HTTPException(
            status_code=409, detail="This account has usage records and cannot be removed."
        )
    await db.delete("classroom_users", {"id": f"eq.{user['id']}"})
    _invalidate_auth_cache(user["username"])
    return {"status": "user removed"}


# --- Admin Appliance CRUD ---

@app.post("/api/admin/appliances", status_code=201, dependencies=[Depends(require_admin)])
async def add_appliance(
    payload: ApplianceRequest,
    db: SupabaseClient = Depends(get_db),
) -> dict:
    name = " ".join(payload.name.split())
    existing = await db.select("appliances", columns="id", filters={"name": f"ilike.{name}"}, limit=1)
    if existing:
        raise HTTPException(status_code=409, detail="That appliance already exists.")
    
    new_appliance = await db.insert("appliances", {
        "name": name,
        "wattage": payload.wattage,
        "quantity": payload.quantity,
        "archived": False,
    })
    appliance = new_appliance[0] if new_appliance else None
    return _appliance_dict(appliance)


@app.put("/api/admin/appliances/{appliance_id}", dependencies=[Depends(require_admin)])
async def update_appliance(
    appliance_id: int,
    payload: ApplianceRequest,
    db: SupabaseClient = Depends(get_db),
) -> dict:
    appliances = await db.select("appliances", filters={"id": f"eq.{appliance_id}"}, limit=1)
    if not appliances:
        raise HTTPException(status_code=404, detail="Appliance not found.")
    
    name = " ".join(payload.name.split())
    existing = await db.select("appliances", columns="id", filters={"name": f"ilike.{name}", "id": f"neq.{appliance_id}"}, limit=1)
    if existing:
        raise HTTPException(status_code=409, detail="That appliance already exists.")
    
    updated = await db.update("appliances", {
        "name": name,
        "wattage": payload.wattage,
        "quantity": payload.quantity,
    }, {"id": f"eq.{appliance_id}"})
    appliance = updated[0] if updated else None
    return _appliance_dict(appliance)


@app.delete("/api/admin/appliances/{appliance_id}", dependencies=[Depends(require_admin)])
async def delete_appliance(
    appliance_id: int,
    db: SupabaseClient = Depends(get_db),
) -> dict[str, str]:
    appliances = await db.select("appliances", filters={"id": f"eq.{appliance_id}"}, limit=1)
    if not appliances:
        raise HTTPException(status_code=404, detail="Appliance not found.")
    
    appliance = appliances[0]
    has_records = await db.select("usage_records", columns="id", filters={"appliance_id": f"eq.{appliance_id}"}, limit=1)
    if has_records:
        await db.update("appliances", {"archived": True}, {"id": f"eq.{appliance_id}"})
        return {"status": "appliance archived"}
    
    await db.delete("appliances", {"id": f"eq.{appliance_id}"})
    return {"status": "appliance removed"}


@app.get("/api/admin/dashboard", dependencies=[Depends(require_admin)])
async def admin_dashboard(
    month: str | None = None,
    db: SupabaseClient = Depends(get_db),
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

    try:
        # Fetch records for the month
        start_iso = start.isoformat()
        end_iso = end.isoformat()
        records = await db.select(
            "usage_records",
            columns="energy_kwh,section_id,user_id,created_at",
            filters={"created_at": f"gte.{start_iso}", "created_at": f"lt.{end_iso}"}
        )
        
        # Calculate section aggregates
        section_stats = {}
        total_kwh = 0.0
        total_records = len(records)
        
        for r in records:
            sid = r.get("section_id")
            kwh = float(r.get("energy_kwh", 0))
            total_kwh += kwh
            if sid not in section_stats:
                section_stats[sid] = {"energy_kwh": 0.0, "records": 0}
            section_stats[sid]["energy_kwh"] += kwh
            section_stats[sid]["records"] += 1
        
        # Get section names
        sections_list = []
        for sid, stats in section_stats.items():
            secs = await db.select("classroom_sections", columns="id,name", filters={"id": f"eq.{sid}"}, limit=1)
            name = secs[0]["name"] if secs else f"Section {sid}"
            sections_list.append({"name": name, "energy_kwh": round(stats["energy_kwh"], 4), "records": stats["records"]})
        
        # Get all users with their info
        users_data = await db.select(
            "classroom_users",
            columns="id,username,status,last_seen,password_hash,section_id,assigned_room_id",
            order="last_seen.desc",
            limit=users_limit,
            offset=users_offset
        )
        
        # Get all rooms for assigned_room_id lookup
        room_ids = {u.get("assigned_room_id") for u in users_data if u.get("assigned_room_id")}
        rooms = {}
        if room_ids:
            room_list = await db.select("classroom_rooms", filters={"id": f"in.({','.join(map(str, room_ids))})"})
            rooms = {r["id"]: _room_identity(r) for r in room_list}
        
        # Count records per user
        user_record_counts = {}
        for r in records:
            uid = r.get("user_id")
            user_record_counts[uid] = user_record_counts.get(uid, 0) + 1
        
        users = []
        for u in users_data:
            users.append({
                "username": u.get("username"),
                "status": u.get("status", "pending"),
                "last_seen": u.get("last_seen"),
                "has_password": u.get("password_hash") is not None,
                "section_id": u.get("section_id"),
                "assigned_room": rooms.get(u.get("assigned_room_id")),
                "records_count": user_record_counts.get(u.get("id"), 0),
            })
        
        # Get sections list with record counts
        all_sections = await db.select(
            "classroom_sections",
            columns="id,name",
            order="name",
            limit=sections_limit,
            offset=sections_offset
        )
        
        # Count records per section
        section_record_counts = {}
        for r in records:
            sid = r.get("section_id")
            section_record_counts[sid] = section_record_counts.get(sid, 0) + 1
        
        sections_list_full = []
        for s in all_sections:
            sections_list_full.append({
                "id": s["id"],
                "name": s["name"],
                "records": section_record_counts.get(s["id"], 0),
            })
        
        # Get monthly data for the last 6 months
        monthly_data = []
        for i in range(6):
            m_start = (now.replace(day=1) - timedelta(days=32 * i)).replace(day=1)
            m_end = (m_start.replace(day=28) + timedelta(days=4)).replace(day=1)
            m_records = await db.select(
                "usage_records",
                columns="energy_kwh",
                filters={"created_at": f"gte.{m_start.isoformat()}", "created_at": f"lt.{m_end.isoformat()}"}
            )
            m_kwh = sum(float(r.get("energy_kwh", 0)) for r in m_records)
            monthly_data.append({
                "month": m_start.strftime("%Y-%m"),
                "kwh": round(m_kwh, 4)
            })
        monthly_data.reverse()  # oldest to newest
        
        return {
            "month": month,
            "total_kwh": round(total_kwh, 4),
            "total_records": total_records,
            "sections": sections_list,
            "users": users,
            "sections_list": sections_list_full,
            "rate_php_per_kwh": ELECTRICITY_RATE,
            "monthly": monthly_data,
        }
    except Exception as e:
        import traceback
        print(f"Database error in admin_dashboard: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="Internal server error")


# Export the app for Vercel
# Vercel will automatically detect the FastAPI app