-- Up Migration
-- Household kiosk lock code (fork). One 4-digit code per household that a grown-up
-- enters to unlock a paired kiosk ("look, don't touch" for kids). Hashed with the same
-- scrypt scheme as per-person PINs and throttled the same way. Lives in its own columns,
-- NOT in settings.display — that blob is served to the device, the hash never is.
alter table households add column if not exists kiosk_lock_hash         text;
alter table households add column if not exists kiosk_lock_failed_count int not null default 0;
alter table households add column if not exists kiosk_lock_locked_until timestamptz;

-- Down Migration
alter table households drop column if exists kiosk_lock_locked_until;
alter table households drop column if exists kiosk_lock_failed_count;
alter table households drop column if exists kiosk_lock_hash;
