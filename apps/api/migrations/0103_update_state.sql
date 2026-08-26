-- Up Migration
-- Single-row server state for the in-app update button (fork). Server-wide, NOT
-- per household: an update rebuilds the whole stack, so two households cannot
-- meaningfully disagree about it. The API cannot rebuild its own host, so this
-- table is a mailbox — the button queues, the host agent claims and reports back.
create table if not exists update_state (
  id            boolean primary key default true check (id),
  status        text not null default 'idle'
                check (status in ('idle', 'queued', 'running', 'failed')),
  requested_at  timestamptz,
  requested_by  uuid references persons(id) on delete set null,
  claimed_at    timestamptz,
  finished_at   timestamptz,
  exit_code     integer,
  message       text,
  agent_seen_at timestamptz,
  behind_count  integer not null default 0
);
insert into update_state (id) values (true) on conflict (id) do nothing;

-- Down Migration
drop table if exists update_state;
