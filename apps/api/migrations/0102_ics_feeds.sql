-- Up Migration
-- ICS calendar feeds (fork P2): read-only subscriptions to published ICS URLs
-- (school schedules, Outlook "publish calendar" links, sports teams). A third
-- calendar source next to Google/Microsoft OAuth accounts — no OAuth, no
-- write-back, no per-account tokens, so it gets its own small table instead of
-- riding calendar_accounts/calendars.
create table ics_feeds (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id),
  url text not null,
  name text,
  person_id uuid references persons(id),   -- event color/owner mapping (like calendars.person_id)
  visibility text not null default 'family', -- family | personal (mirrors calendars.visibility)
  last_synced_at timestamptz,
  last_error text,                          -- last poll failure, cleared on success
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index ix_ics_feeds_household on ics_feeds (household_id) where deleted_at is null;
create trigger trg_ics_feeds_updated before update on ics_feeds
  for each row execute function set_updated_at();

-- Feed events live in `events` with origin='ics', calendar_id NULL,
-- origin_ref_id = the feed id, and google_event_id = the VEVENT UID (the
-- established "provider external id" convention). The upstream dedupe index
-- uq_events_google on (calendar_id, google_event_id) canNOT arbitrate these
-- rows: calendar_id is NULL and Postgres unique indexes treat NULLs as
-- distinct, so every re-sync would insert duplicates. This fork-owned partial
-- index is the ON CONFLICT arbiter that makes feed re-syncs idempotent.
create unique index uq_events_ics_feed_uid on events (origin_ref_id, google_event_id)
  where origin = 'ics' and google_event_id is not null;

-- Down Migration
drop index if exists uq_events_ics_feed_uid;
drop table if exists ics_feeds cascade;
