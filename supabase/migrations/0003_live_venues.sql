-- Venues are now fetched live from TripAdvisor per search. The catalog tables
-- go away; reservations keep a self-contained snapshot of the chosen venue so
-- saved plans survive a delisting or an API outage.

alter table public.reservations
  add column if not exists venue_name text,
  add column if not exists venue_address text,
  add column if not exists venue_lat double precision,
  add column if not exists venue_lng double precision,
  add column if not exists venue_ta_id text,
  add column if not exists venue_ta_url text,
  add column if not exists venue_rating numeric(2, 1),
  add column if not exists venue_image_url text;

-- Backfill from the catalog BEFORE dropping it, so existing plans keep working.
update public.reservations r
set venue_name = v.name,
    venue_address = v.address,
    venue_lat = v.lat,
    venue_lng = v.lng,
    venue_rating = v.rating,
    venue_image_url = v.image_url
from public.venues v
where v.id = r.venue_id and r.venue_name is null;

alter table public.reservations
  drop constraint if exists reservations_venue_id_fkey;

drop index if exists reservations_venue_id_idx;
drop table if exists public.private_rooms;
drop table if exists public.venues;

-- Machine-extracted private-dining data. Not a venue catalog: no names,
-- addresses, ratings or listing links — only what TripAdvisor cannot supply.
create table if not exists public.venue_capacity (
  ta_location_id text primary key,
  rooms jsonb not null default '[]',
  source_url text,
  confidence text not null default 'unverified'
    check (confidence in ('likely', 'unverified')),
  extracted_at timestamptz not null default now()
);

alter table public.venue_capacity enable row level security;

drop policy if exists "venue_capacity readable" on public.venue_capacity;
create policy "venue_capacity readable" on public.venue_capacity
  for select to anon, authenticated using (true);
-- Writes are service-role only: the extractor is the sole writer.
