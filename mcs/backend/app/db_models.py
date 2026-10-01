from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class ClassroomSection(Base):
    __tablename__ = "classroom_sections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    # Structured section fields: name is the display label ("11 - BERNOULLI")
    # while grade/section_name hold the parts; legacy rows may have them null.
    grade: Mapped[str | None] = mapped_column(String(4), nullable=True)
    section_name: Mapped[str | None] = mapped_column(String(40), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    records: Mapped[list["UsageRecord"]] = relationship(back_populates="section")


class Appliance(Base):
    __tablename__ = "appliances"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    wattage: Mapped[float] = mapped_column(Float)
    archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    records: Mapped[list["UsageRecord"]] = relationship(back_populates="appliance")


class ClassroomUser(Base):
    __tablename__ = "classroom_users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    password_hash: Mapped[str | None] = mapped_column(String(256), nullable=True)
    # "pending" until an admin approves a self-registration; "active" to sign in.
    status: Mapped[str] = mapped_column(String(16), default="active", nullable=False)
    section_id: Mapped[int | None] = mapped_column(
        ForeignKey("classroom_sections.id"), nullable=True, index=True
    )
    assigned_room_id: Mapped[int | None] = mapped_column(
        ForeignKey("classroom_rooms.id"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    last_seen: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    records: Mapped[list["UsageRecord"]] = relationship(back_populates="user")
    section: Mapped["ClassroomSection | None"] = relationship()
    assigned_room: Mapped["ClassroomRoom | None"] = relationship(
        back_populates="assigned_users", foreign_keys=[assigned_room_id]
    )


class ClassroomRoom(Base):
    __tablename__ = "classroom_rooms"
    __table_args__ = (UniqueConstraint("building_code", "floor", "room_index"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    building_code: Mapped[str] = mapped_column(String(16), index=True)
    building_name: Mapped[str] = mapped_column(String(64))
    floor: Mapped[int] = mapped_column(Integer)
    room_index: Mapped[int] = mapped_column(Integer)
    room_number: Mapped[int] = mapped_column(Integer)
    room_type: Mapped[str] = mapped_column(String(20), default="classroom")
    custom_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    room_name: Mapped[str | None] = mapped_column(String(80), nullable=True)
    records: Mapped[list["UsageRecord"]] = relationship(back_populates="room")
    assigned_users: Mapped[list[ClassroomUser]] = relationship(
        back_populates="assigned_room", foreign_keys="ClassroomUser.assigned_room_id"
    )


class UsageRecord(Base):
    __tablename__ = "usage_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("classroom_users.id"), index=True)
    section_id: Mapped[int] = mapped_column(ForeignKey("classroom_sections.id"), index=True)
    room_id: Mapped[int | None] = mapped_column(ForeignKey("classroom_rooms.id"), nullable=True, index=True)
    appliance_id: Mapped[int] = mapped_column(ForeignKey("appliances.id"), index=True)
    hours: Mapped[float] = mapped_column(Float)
    energy_kwh: Mapped[float] = mapped_column(Float)
    occupants: Mapped[int | None] = mapped_column(Integer, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, index=True)
    user: Mapped[ClassroomUser] = relationship(back_populates="records")
    section: Mapped[ClassroomSection] = relationship(back_populates="records")
    room: Mapped[ClassroomRoom | None] = relationship(back_populates="records")
    appliance: Mapped[Appliance] = relationship(back_populates="records")