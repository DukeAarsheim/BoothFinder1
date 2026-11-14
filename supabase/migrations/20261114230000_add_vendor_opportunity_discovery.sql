-- Vendor-opportunity discovery: a review queue that sits in front of `events`.
--
-- The discovery pipeline (lib/discovery) finds pages where California fairs, festivals,
-- farmers markets, holiday markets, and organizers publicly advertise vendor
-- opportunities, extracts the facts, and saves each one here as `pending`.
-- A person approves or rejects it. Approving copies the facts into `events`, which is
-- what the vendor map and the Fit score read. Nothing reaches `events` unreviewed.
--
-- Additive only (MASTER.md §5b): two new tables and two new nullable columns.

-- ---------------------------------------------------------------------------
-- events: optional coordinates, so the map can place events anywhere in California.
-- Null = not geocoded; the map then falls back to its city table (lib/vendor/geo.ts).
-- ---------------------------------------------------------------------------
alter table public.events
  add column latitude double precision check (latitude between -90 and 90),
  add column longitude double precision check (longitude between -180 and 180);

comment on column public.events.latitude is 'Geocoded from the venue or city the source states. Null when not geocoded.';
comment on column public.events.longitude is 'Geocoded from the venue or city the source states. Null when not geocoded.';

-- ---------------------------------------------------------------------------
-- vendor_opportunities: one row per discovered source page.
-- ---------------------------------------------------------------------------
create table public.vendor_opportunities (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),

  -- Where it came from
  source_url text not null unique,
  source_domain text not null,
  source_title text,
  source_documents jsonb not null default '[]'::jsonb,
  discovered_via text not null default 'search'
    check (discovered_via in ('search', 'manual')),
  discovery_query text,
  fetched_at timestamptz not null default now(),
  content_hash text,

  -- What was extracted
  name text not null check (length(btrim(name)) > 0),
  organizer_name text,
  extracted jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  dropped_fields text[] not null default '{}',
  has_pricing boolean not null default false,

  -- Map position
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  geo_precision text check (geo_precision in ('venue', 'city')),

  -- Review
  event_id uuid references public.events (id) on delete set null,
  reviewed_at timestamptz,
  review_note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.vendor_opportunities is 'Discovered vendor opportunities awaiting review. Approved rows are copied into events. Not readable with the public key.';
comment on column public.vendor_opportunities.status is 'pending | approved | rejected';
comment on column public.vendor_opportunities.source_url is 'The organizer page the opportunity was found on. One row per page.';
comment on column public.vendor_opportunities.source_documents is 'Every document read for this row: [{ url, kind: html|pdf, title, content_hash }]. The page itself plus linked vendor applications or fee sheets.';
comment on column public.vendor_opportunities.discovered_via is 'search | manual (a person submitted the URL)';
comment on column public.vendor_opportunities.content_hash is 'SHA-256 of the text that was read. A changed hash on a later run means the source changed.';
comment on column public.vendor_opportunities.extracted is 'Event facts in the shape of an events insert (lib/types.ts ExtractedEvent). Only values backed by a quote in evidence survive.';
comment on column public.vendor_opportunities.evidence is 'Per field: { quote, url }. The quote is verbatim text from the document at url.';
comment on column public.vendor_opportunities.dropped_fields is 'Fields the model returned whose quote could not be found in the source. They were discarded.';
comment on column public.vendor_opportunities.has_pricing is 'True when at least one booth fee figure was found and verified.';
comment on column public.vendor_opportunities.geo_precision is 'venue | city. How precisely latitude and longitude were geocoded.';
comment on column public.vendor_opportunities.event_id is 'The events row created when this was approved.';

create index vendor_opportunities_status_idx
  on public.vendor_opportunities (status, created_at desc);

create trigger vendor_opportunities_set_updated_at
  before update on public.vendor_opportunities
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- discovery_runs: one row per pipeline run. Used to rotate through the search
-- queries and to show what the last run did.
-- ---------------------------------------------------------------------------
create table public.discovery_runs (
  id uuid primary key default gen_random_uuid(),
  trigger text not null default 'manual' check (trigger in ('manual', 'cron')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  query_offset integer not null default 0 check (query_offset >= 0),
  queries text[] not null default '{}',
  stats jsonb not null default '{}'::jsonb,
  error text
);

comment on table public.discovery_runs is 'One row per discovery pipeline run. Not readable with the public key.';
comment on column public.discovery_runs.query_offset is 'Index of the first search query this run used. The next run starts after this run''s queries.';
comment on column public.discovery_runs.stats is 'Counts for the run: searched, fetched, skipped (with reasons), saved.';

create index discovery_runs_started_at_idx on public.discovery_runs (started_at desc);

-- ---------------------------------------------------------------------------
-- Access. Server only: row-level security is on with no policies, so the public
-- key can neither read nor write. The service-role key (server routes) can.
-- ---------------------------------------------------------------------------
alter table public.vendor_opportunities enable row level security;
alter table public.discovery_runs enable row level security;

revoke all on public.vendor_opportunities, public.discovery_runs from anon, authenticated;
grant all on public.vendor_opportunities, public.discovery_runs to service_role;
