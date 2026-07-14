-- Up Migration
-- Calendar provider abstraction (fork): calendar accounts can now be Google OR
-- Microsoft (Outlook / Graph). Additive by design — the google_* columns keep
-- their names but mean "provider external id" (google_sub = OAuth subject,
-- google_calendar_id = provider calendar id, events.google_event_id = provider
-- event id, calendars.sync_token = Google syncToken or Graph @odata.deltaLink).
-- Renaming them would churn every query and fight upstream merges for no gain.
-- Fork migrations are numbered from 0100 so upstream's next numbers never collide.

alter table calendar_accounts add column provider text not null default 'google';
alter table calendars add column provider text not null default 'google';
alter table calendar_oauth_states add column provider text not null default 'google';

-- One account row per (household, provider, subject) — subjects from different
-- providers may collide in theory, and the provider now disambiguates.
alter table calendar_accounts drop constraint if exists calendar_accounts_household_id_google_sub_key;
alter table calendar_accounts add constraint calendar_accounts_household_provider_sub_key
  unique (household_id, provider, google_sub);

-- Down Migration
alter table calendar_accounts drop constraint if exists calendar_accounts_household_provider_sub_key;
alter table calendar_accounts add constraint calendar_accounts_household_id_google_sub_key
  unique (household_id, google_sub);
alter table calendar_accounts drop column if exists provider;
alter table calendars drop column if exists provider;
alter table calendar_oauth_states drop column if exists provider;
