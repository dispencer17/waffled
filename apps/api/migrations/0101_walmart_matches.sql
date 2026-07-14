-- Up Migration
-- Walmart cart handoff (fork): cache grocery-item → Walmart product matches so
-- weekly staples don't re-hit the affiliate API / LLM every time. A user tap
-- ("that's the right product") sets confirmed and pins the match; unconfirmed
-- entries are treated as stale after 30 days (enforced in code, not here).

create table walmart_product_matches (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id),
  item_name_normalized text not null,     -- lowercased/trimmed grocery item name
  walmart_item_id text not null,
  title text,
  price_cents integer,
  thumbnail_url text,
  confidence real not null default 0,
  confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, item_name_normalized)
);

-- Down Migration
drop table if exists walmart_product_matches;
