-- Idempotent indexes for the Supabase/Postgres production tables.
-- Apply once in the Supabase SQL Editor (or with psql). No data is changed.

CREATE INDEX IF NOT EXISTS ix_usage_records_created_id
    ON usage_records (created_at, id);

CREATE INDEX IF NOT EXISTS ix_usage_records_user_created
    ON usage_records (user_id, created_at);

CREATE INDEX IF NOT EXISTS ix_usage_records_room_created
    ON usage_records (room_id, created_at);

CREATE INDEX IF NOT EXISTS ix_usage_records_section_created
    ON usage_records (section_id, created_at);

CREATE INDEX IF NOT EXISTS ix_usage_records_appliance_created
    ON usage_records (appliance_id, created_at);

CREATE INDEX IF NOT EXISTS ix_classroom_users_status
    ON classroom_users (status);

CREATE INDEX IF NOT EXISTS ix_classroom_users_assigned_room
    ON classroom_users (assigned_room_id);

CREATE INDEX IF NOT EXISTS ix_classroom_users_last_seen
    ON classroom_users (last_seen DESC);

CREATE INDEX IF NOT EXISTS ix_classroom_rooms_owner
    ON classroom_rooms (owner_id);

CREATE INDEX IF NOT EXISTS ix_classroom_sections_owner
    ON classroom_sections (owner_id);
