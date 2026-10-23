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
import asyncio
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
        
        for attempt in range(2):
            try:
                response = await self.client.get(f"/{table}", params=params)
                break
            except (httpx.ReadError, httpx.RemoteProtocolError, httpx.ConnectError):
                # Reused keep-alive sockets can be closed by the upstream
                # pool; drop the client and retry once on a fresh connection.
                await self.close()
                if attempt == 1:
                    raise
        response.raise_for_status()
        return response.json()

    async def count(self, table: str, filters: dict = None) -> int:
        """Return an exact row count without downloading the matching rows."""
        params = {"select": "id", "limit": "1"}
        params.update(self._build_filter_params(filters))

        for attempt in range(2):
            try:
                response = await self.client.get(
                    f"/{table}",
                    params=params,
                    headers={"Prefer": "count=exact"},
                )
                break
            except (httpx.ReadError, httpx.RemoteProtocolError, httpx.ConnectError):
                await self.close()
                if attempt == 1:
                    raise

        response.raise_for_status()
        content_range = response.headers.get("content-range", "")
        if "/" in content_range:
            total = content_range.rsplit("/", 1)[1]
            if total.isdigit():
                return int(total)
        # Fallback for a proxy that strips Content-Range.
        return len(response.json())
    
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
# Demo admins that can sign in alongside the env-configured account above.
ADMIN_ACCOUNTS = {
    ADMIN_USERNAME: ADMIN_PASSWORD,
    "dstf-live": "123",
    "interactive-admin": "123",
}
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


def _parse_db_datetime(value: datetime | str | None) -> datetime | None:
    """Parse a PostgREST timestamp into a naive UTC datetime."""
    if value is None:
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


async def _select_all(
    db: SupabaseClient,
    table: str,
    columns: str = "*",
    filters: dict | None = None,
    order: str | None = None,
    page_size: int = 1000,
) -> list[dict]:
    """Read every matching row, paging past the PostgREST response limit."""
    rows: list[dict] = []
    offset = 0
    while True:
        page = await db.select(
            table,
            columns=columns,
            filters=filters,
            order=order,
            limit=page_size,
            offset=offset,
        )
        rows.extend(page)
        if len(page) < page_size:
            return rows
        offset += page_size


def _room_status(average: float, building_average: float) -> str:
    """High-use at 1.5x the building's per-room average (per project rules)."""
    return "high" if building_average > 0 and average >= building_average * 1.5 else "average"


async def _room_map_stats(
    db: SupabaseClient,
) -> tuple[list[dict], dict[int, dict], dict[str, float], dict[int, list[str]]]:
    """Trailing-30-day usage per room, per-building average, and assigned users."""
    cutoff = (datetime.utcnow() - timedelta(days=30)).isoformat()
    rooms, usage, assigned = await asyncio.gather(
        _ordered_rooms(db),
        _select_all(
            db,
            "usage_records",
            columns="room_id,appliance_id,energy_kwh",
            filters={"created_at": f"gte.{cutoff}"},
            order="created_at,id",
        ),
        _select_all(
            db,
            "classroom_users",
            columns="username,assigned_room_id",
            order="username",
        ),
    )
    room_usage: dict[int, dict] = {
        room["id"]: {"kwh": 0.0, "appliance_ids": set(), "submissions": 0}
        for room in rooms
    }
    for row in usage:
        metrics = room_usage.get(row.get("room_id"))
        if metrics is None:
            continue
        metrics["kwh"] += float(row.get("energy_kwh") or 0)
        metrics["submissions"] += 1
        if row.get("appliance_id") is not None:
            metrics["appliance_ids"].add(row["appliance_id"])

    building_totals: dict[str, float] = {}
    building_counts: dict[str, int] = {}
    for room in rooms:
        code = room.get("building_code", "")
        building_totals[code] = building_totals.get(code, 0.0) + room_usage[room["id"]]["kwh"]
        building_counts[code] = building_counts.get(code, 0) + 1
    building_average = {
        code: building_totals[code] / building_counts[code] if building_counts[code] else 0.0
        for code in building_totals
    }

    room_users: dict[int, list[str]] = {room["id"]: [] for room in rooms}
    for user in assigned:
        room_id = user.get("assigned_room_id")
        if room_id in room_users:
            room_users[room_id].append(user.get("username", ""))

    return rooms, room_usage, building_average, room_users


def _room_row(
    room: dict,
    metrics: dict,
    building_average: float,
    assigned_users: list[str],
) -> dict:
    average = metrics["kwh"]
    room_type = room.get("room_type") or "classroom"
    return {
        **_room_identity(room),
        "display_name": room.get("room_name") or f"Room {room.get('room_number')}",
        "display_type": (
            room.get("custom_type") if room_type == "custom" else room_type
        ),
        "average_kwh": round(average, 4),
        "appliance_count": len(metrics["appliance_ids"]),
        "submission_count": metrics["submissions"],
        "assigned_users": assigned_users,
        "building_average_kwh": round(building_average, 3),
        "usage_status": _room_status(average, building_average),
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
    expected = ADMIN_ACCOUNTS.get(payload.username)
    if expected is None or not hmac.compare_digest(payload.password, expected):
        raise HTTPException(status_code=401, detail="Incorrect admin account or password.")
    data = f"{payload.username}:{int(time.time()) + SESSION_SECONDS}"
    response.set_cookie(
        SESSION_COOKIE,
        f"{data}.{_token_signature(data)}",
        max_age=SESSION_SECONDS,
        httponly=True,
        secure=True,
        samesite="lax",
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
    
    password_hash = _hash_user_password(payload.password)
    now = datetime.utcnow().isoformat()
    users = await db.select("classroom_users", filters={"username": f"ilike.{username}"}, limit=1)
    if not users:
        new_user = await db.insert("classroom_users", {
            "username": username,
            "password_hash": password_hash,
            "assigned_room_id": payload.assigned_room_id,
            "status": "active",
            "created_at": now,
            "last_seen": now,
        })
        user = new_user[0] if new_user else None
    else:
        user = users[0]
    
    await db.update("classroom_users", 
        {"password_hash": password_hash, "assigned_room_id": payload.assigned_room_id},
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


# --- Admin reports, room map, and section management ---

@app.get("/api/admin/reports", dependencies=[Depends(require_admin)])
async def admin_reports(
    month: str | None = None,
    group: str = "day",
    building: str | None = None,
    room_id: int | None = None,
    section_id: int | None = None,
    appliance_id: int | None = None,
    db: SupabaseClient = Depends(get_db),
) -> dict:
    """Daily / weekly / monthly usage buckets plus usage patterns for a month."""
    if group not in ("day", "week", "month"):
        raise HTTPException(status_code=422, detail="Group must be day, week, or month.")
    now = datetime.now()
    month = month or now.strftime("%Y-%m")
    start, end = _month_bounds(month)

    if group == "month":
        bucket_keys: list[str] = []
        cursor = datetime(start.year, start.month, 1)
        for _ in range(12):
            bucket_keys.append(cursor.strftime("%Y-%m"))
            previous = cursor - timedelta(days=1)
            cursor = datetime(previous.year, previous.month, 1)
        scan_start = datetime.strptime(min(bucket_keys), "%Y-%m")
    else:
        bucket_keys = []
        scan_start = start

    filters: dict[str, str] = {}
    if room_id:
        filters["room_id"] = f"eq.{room_id}"
    if section_id:
        filters["section_id"] = f"eq.{section_id}"
    if appliance_id:
        filters["appliance_id"] = f"eq.{appliance_id}"
    query_filters = dict(filters)
    query_filters["created_at"] = f"gte.{scan_start.isoformat()}"

    all_rooms, appliance_rows, rows = await asyncio.gather(
        db.select(
            "classroom_rooms",
            columns="id,building_code,room_number",
        ),
        db.select("appliances", columns="id,name"),
        _select_all(
            db,
            "usage_records",
            columns=(
                "id,energy_kwh,started_at,created_at,occupants,"
                "appliance_id,room_id,section_id,user_id"
            ),
            filters=query_filters,
            order="created_at,id",
        ),
    )

    building_room_ids: set[int] | None = None
    if building:
        building_room_ids = {
            room["id"]
            for room in all_rooms
            if room.get("building_code") == building
        }
    appliance_names = {item["id"]: item["name"] for item in appliance_rows}
    room_labels = {
        item["id"]: f"{item.get('building_code', '')} {item.get('room_number', '')}"
        for item in all_rooms
    }

    records: list[dict] = []
    scan_records: list[dict] = []
    if building_room_ids is None or building_room_ids:
        for row in rows:
            moment = _parse_db_datetime(row.get("started_at") or row.get("created_at"))
            created = _parse_db_datetime(row.get("created_at")) or moment
            if moment is None or created is None or created >= end:
                continue
            if building_room_ids is not None and row.get("room_id") not in building_room_ids:
                continue
            record = {
                **row,
                "energy_kwh": float(row.get("energy_kwh") or 0),
                "_moment": moment,
            }
            scan_records.append(record)
            # The twelve-month bucket series scans earlier months too, but
            # totals and patterns remain scoped to the selected month.
            if created >= start:
                records.append(record)

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

    bucketed: dict[str, list[dict]] = {}
    if group == "month":
        for key in bucket_keys:
            bucketed[key] = []
        for record in scan_records:
            key = record["_moment"].strftime("%Y-%m")
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
            bucketed.setdefault(bucket_key(record["_moment"]), []).append(record)

    def summarize(rows: list[dict]) -> dict:
        top: dict[str, float] = {}
        for record in rows:
            name = appliance_names.get(record.get("appliance_id"))
            if name is not None:
                top[name] = top.get(name, 0.0) + record["energy_kwh"]
        kwh = sum(record["energy_kwh"] for record in rows)
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
        moment = record["_moment"]
        energy = record["energy_kwh"]
        weekday_kwh[moment.weekday()] += energy
        hour_kwh[moment.hour] += energy
        appliance_name = appliance_names.get(record.get("appliance_id"))
        if appliance_name is not None:
            appliance_kwh[appliance_name] = (
                appliance_kwh.get(appliance_name, 0.0) + energy
            )
        room_label = (
            room_labels.get(record.get("room_id"))
            if record.get("room_id")
            else "Unassigned"
        )
        if room_label is None:
            room_label = f"Room {record.get('room_id')}"
        room_kwh[room_label] = room_kwh.get(room_label, 0.0) + energy
        occupants = record.get("occupants")
        if occupants is not None:
            occupant_total += float(occupants)
            occupant_count += 1

    def hour_label(hour: int) -> str:
        return f"{hour % 12 or 12} {'AM' if hour < 12 else 'PM'}"

    patterns = {
        "peak_weekday": (
            {
                "day": day_name[max(range(7), key=lambda index: weekday_kwh[index])],
                "kwh": round(max(weekday_kwh), KWH_PRECISION),
            }
            if records
            else None
        ),
        "peak_hour": (
            {
                "hour": hour_label(max(range(24), key=lambda index: hour_kwh[index])),
                "kwh": round(max(hour_kwh), KWH_PRECISION),
            }
            if records
            else None
        ),
        "top_appliance": (
            {
                "name": max(appliance_kwh, key=appliance_kwh.get),
                "kwh": round(max(appliance_kwh.values()), KWH_PRECISION),
            }
            if appliance_kwh
            else None
        ),
        "busiest_room": (
            {
                "room": max(room_kwh, key=room_kwh.get),
                "kwh": round(max(room_kwh.values()), KWH_PRECISION),
            }
            if room_kwh
            else None
        ),
        "avg_occupants": (
            round(occupant_total / occupant_count, 1) if occupant_count else None
        ),
    }
    total_kwh = sum(record["energy_kwh"] for record in records)
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


@app.get("/api/admin/rooms", dependencies=[Depends(require_admin)])
async def admin_rooms(db: SupabaseClient = Depends(get_db)) -> dict:
    rooms, room_usage, building_average, room_users = await _room_map_stats(db)
    buildings = []
    building_names = {
        room.get("building_code", ""): room.get("building_name", "")
        for room in rooms
    }
    for building_code, building_name in building_names.items():
        building_rooms = [
            room for room in rooms if room.get("building_code") == building_code
        ]
        average = building_average.get(building_code, 0.0)
        room_rows = [
            _room_row(room, room_usage[room["id"]], average, room_users[room["id"]])
            for room in building_rooms
        ]
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
async def admin_room_detail(
    room_id: int,
    db: SupabaseClient = Depends(get_db),
) -> dict:
    rooms, room_usage, building_average, room_users = await _room_map_stats(db)
    room = next((item for item in rooms if item.get("id") == room_id), None)
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found.")

    cutoff = (datetime.utcnow() - timedelta(days=30)).isoformat()
    recent_rows, appliance_rows, user_rows = await asyncio.gather(
        db.select(
            "usage_records",
            columns="id,user_id,appliance_id,hours,energy_kwh,created_at",
            filters={"room_id": f"eq.{room_id}", "created_at": f"gte.{cutoff}"},
            order="created_at.desc",
            limit=5,
        ),
        db.select("appliances", columns="id,name"),
        db.select("classroom_users", columns="id,username"),
    )
    appliance_names = {item["id"]: item["name"] for item in appliance_rows}
    user_names = {item["id"]: item["username"] for item in user_rows}
    recent = [
        {
            "id": row.get("id"),
            "username": user_names.get(row.get("user_id"), ""),
            "appliance": appliance_names.get(row.get("appliance_id"), ""),
            "hours": row.get("hours"),
            "energy_kwh": row.get("energy_kwh"),
            "created_at": row.get("created_at"),
        }
        for row in recent_rows
    ]

    average = room_usage[room_id]["kwh"]
    building = building_average.get(room.get("building_code", ""), 0.0)
    return {
        **_room_row(room, room_usage[room_id], building, room_users[room_id]),
        "building_average_kwh": round(building, 4),
        "recent": recent,
    }


@app.put("/api/admin/rooms/{room_id}", dependencies=[Depends(require_admin)])
async def update_admin_room(
    room_id: int,
    payload: RoomUpdateRequest,
    db: SupabaseClient = Depends(get_db),
) -> dict:
    rooms = await db.select(
        "classroom_rooms",
        filters={"id": f"eq.{room_id}"},
        limit=1,
    )
    if not rooms:
        raise HTTPException(status_code=404, detail="Room not found.")
    custom_type = (payload.custom_type or "").strip()
    if payload.room_type == "custom" and len(custom_type) < 2:
        raise HTTPException(status_code=422, detail="Enter a custom room type.")
    updated = await db.update(
        "classroom_rooms",
        {
            "room_type": payload.room_type,
            "custom_type": custom_type if payload.room_type == "custom" else None,
            "room_name": (payload.room_name or "").strip() or None,
        },
        {"id": f"eq.{room_id}"},
    )
    return _room_identity(updated[0] if updated else rooms[0])


@app.post("/api/admin/sections", status_code=201, dependencies=[Depends(require_admin)])
async def add_admin_section(
    payload: SectionRequest,
    db: SupabaseClient = Depends(get_db),
) -> dict:
    grade = payload.grade.strip()
    section_name = " ".join(payload.section_name.split()).upper()
    name = f"{grade} - {section_name}"
    sections = await db.select("classroom_sections", columns="id,name")
    if any(item.get("name", "").casefold() == name.casefold() for item in sections):
        raise HTTPException(status_code=409, detail="That section already exists.")
    try:
        created = await db.insert(
            "classroom_sections",
            {
                "name": name,
                "grade": grade,
                "section_name": section_name,
                "created_at": datetime.utcnow().isoformat(),
            },
        )
    except httpx.HTTPStatusError as error:
        if error.response.status_code == 409:
            raise HTTPException(
                status_code=409, detail="That section already exists."
            ) from error
        raise
    if not created:
        raise HTTPException(status_code=500, detail="Section could not be created.")
    return _section_dict(created[0])


@app.delete("/api/admin/sections/{section_id}", dependencies=[Depends(require_admin)])
async def delete_admin_section(
    section_id: int,
    db: SupabaseClient = Depends(get_db),
) -> dict[str, str]:
    sections = await db.select(
        "classroom_sections",
        columns="id",
        filters={"id": f"eq.{section_id}"},
        limit=1,
    )
    if not sections:
        raise HTTPException(status_code=404, detail="Section not found.")
    assigned = await db.select(
        "classroom_users",
        columns="id",
        filters={"section_id": f"eq.{section_id}"},
        limit=1,
    )
    if assigned:
        raise HTTPException(
            status_code=409,
            detail="This section has assigned accounts and cannot be removed.",
        )
    has_records = await db.select(
        "usage_records",
        columns="id",
        filters={"section_id": f"eq.{section_id}"},
        limit=1,
    )
    if has_records:
        raise HTTPException(
            status_code=409,
            detail="This section has usage records and cannot be removed.",
        )
    try:
        await db.delete("classroom_sections", {"id": f"eq.{section_id}"})
    except httpx.HTTPStatusError as error:
        if error.response.status_code == 409:
            raise HTTPException(
                status_code=409,
                detail="This section is still in use and cannot be removed.",
            ) from error
        raise
    return {"status": "section removed"}


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
        # The selected month and the six-month trend share one bounded read.
        # Month stepping must use calendar months so no month is skipped by a
        # fixed 32-day offset.
        base_index = start.year * 12 + start.month - 1
        month_starts = []
        for offset in range(5, -1, -1):
            year, month_number = divmod(base_index - offset, 12)
            month_starts.append(datetime(year, month_number + 1, 1))

        (
            scan_rows,
            section_rows,
            users_data,
            all_rooms,
            users_total,
            pending_count,
            appliances,
        ) = await asyncio.gather(
            _select_all(
                db,
                "usage_records",
                columns="energy_kwh,section_id,user_id,created_at",
                filters={"created_at": f"gte.{month_starts[0].isoformat()}"},
                order="created_at,id",
            ),
            _select_all(
                db,
                "classroom_sections",
                columns="id,name,grade,section_name",
                order="name",
            ),
            db.select(
                "classroom_users",
                columns="id,username,status,last_seen,password_hash,section_id,assigned_room_id",
                order="last_seen.desc",
                limit=users_limit,
                offset=users_offset,
            ),
            db.select(
                "classroom_rooms",
                columns=(
                    "id,building_code,building_name,floor,room_index,"
                    "room_number,room_type,custom_type,room_name"
                ),
            ),
            db.count("classroom_users"),
            db.count("classroom_users", {"status": "eq.pending"}),
            db.select(
                "appliances",
                columns="id,name,wattage,quantity",
                order="name",
            ),
        )

        section_lookup = {section["id"]: section for section in section_rows}
        rooms = {room["id"]: _room_identity(room) for room in all_rooms}
        rooms_count = len(all_rooms)

        records = []
        monthly_totals = {
            month_start.strftime("%Y-%m"): 0.0 for month_start in month_starts
        }
        for row in scan_rows:
            moment = _parse_db_datetime(row.get("created_at"))
            if moment is None or moment >= end:
                continue
            key = moment.strftime("%Y-%m")
            if key in monthly_totals:
                monthly_totals[key] += float(row.get("energy_kwh") or 0)
            if moment >= start:
                records.append(row)

        # Calculate section aggregates.
        section_stats = {}
        total_kwh = 0.0
        for row in records:
            sid = row.get("section_id")
            kwh = float(row.get("energy_kwh") or 0)
            total_kwh += kwh
            stats = section_stats.setdefault(sid, {"energy_kwh": 0.0, "records": 0})
            stats["energy_kwh"] += kwh
            stats["records"] += 1
        total_records = len(records)

        sections_list = []
        for sid, stats in section_stats.items():
            section = section_lookup.get(sid)
            sections_list.append({
                "name": section["name"] if section else f"Section {sid}",
                "kwh": round(stats["energy_kwh"], 4),
                "energy_kwh": round(stats["energy_kwh"], 4),
                "records": stats["records"],
            })

        # Count records per user.
        user_record_counts = {}
        for row in records:
            uid = row.get("user_id")
            user_record_counts[uid] = user_record_counts.get(uid, 0) + 1

        users = []
        for user in users_data:
            section = section_lookup.get(user.get("section_id"))
            record_count = user_record_counts.get(user.get("id"), 0)
            users.append({
                "username": user.get("username"),
                "status": user.get("status", "pending"),
                "last_seen": user.get("last_seen"),
                "has_password": user.get("password_hash") is not None,
                "credentials_set": user.get("password_hash") is not None,
                "section_id": user.get("section_id"),
                "section": _section_dict(section) if section else None,
                "assigned_room": rooms.get(user.get("assigned_room_id")),
                "records_count": record_count,
                "records": record_count,
            })

        # Count records per section and page the already-loaded catalog.
        section_record_counts = {}
        for row in records:
            sid = row.get("section_id")
            section_record_counts[sid] = section_record_counts.get(sid, 0) + 1

        paged_sections = section_rows[
            sections_offset : sections_offset + sections_limit
        ]
        sections_list_full = [
            {
                "id": section["id"],
                "name": section["name"],
                "records": section_record_counts.get(section["id"], 0),
            }
            for section in paged_sections
        ]

        monthly_data = [
            {"month": key, "kwh": round(value, 4)}
            for key, value in monthly_totals.items()
        ]

        return {
            "month": month,
            "total_kwh": round(total_kwh, 4),
            "total_records": total_records,
            "sections": sections_list,
            "users": users,
            "sections_list": sections_list_full,
            "sections_catalog": [_section_dict(section) for section in section_rows],
            "users_total": users_total,
            "pending_count": pending_count,
            "rate_php_per_kwh": ELECTRICITY_RATE,
            "monthly": monthly_data,
            "rooms_count": rooms_count,
            "section_count": len(section_rows),
            "appliances": appliances,
            "record_count": total_records,
        }
    except Exception as e:
        import traceback
        print(f"Database error in admin_dashboard: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="Internal server error")


# Export the app for Vercel
# Vercel will automatically detect the FastAPI app