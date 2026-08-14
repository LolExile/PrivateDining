-- Private Dining Finder — schema
-- Run this in the Supabase SQL editor (or `supabase db push`) before seeding.

create table if not exists public.venues (
  id text primary key,
  name text not null,
  address text not null,
  city text not null,
  region text not null,
  lat double precision not null,
  lng double precision not null,
  cuisine text not null,
  description text,
  rating numeric(2, 1),
  review_count integer,
  price_tier smallint check (price_tier between 1 and 4),
  min_spend integer,
  price_trust text not null default 'unverified'
    check (price_trust in ('verified', 'likely', 'unverified')),
  trust_label text not null default 'unverified'
    check (trust_label in ('verified', 'likely', 'unverified')),
  dietary text[] not null default '{}',
  event_styles text[] not null default '{seated}',
  image_url text,
  menu_url text,
  menu_image_url text,
  menu_highlights jsonb not null default '[]',
  contact_name text,
  contact_email text,
  contact_phone text,
  created_at timestamptz not null default now()
);

create table if not exists public.private_rooms (
  id uuid primary key default gen_random_uuid(),
  venue_id text not null references public.venues (id) on delete cascade,
  name text not null,
  seated_capacity integer not null default 0,
  standing_capacity integer not null default 0,
  notes text
);

create index if not exists private_rooms_venue_id_idx
  on public.private_rooms (venue_id);

create table if not exists public.attendees (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text,
  phone text,
  dietary_notes text,
  created_at timestamptz not null default now()
);

-- One saved profile per email address (when an email is given).
create unique index if not exists attendees_email_idx
  on public.attendees (lower(email))
  where email is not null;

create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  venue_id text not null references public.venues (id) on delete cascade,
  title text not null,
  event_date date,
  headcount integer not null check (headcount > 0),
  search_address text,
  commute_mode text,
  notes text,
  status text not null default 'planning',
  created_at timestamptz not null default now()
);

create index if not exists reservations_venue_id_idx
  on public.reservations (venue_id);

create table if not exists public.reservation_attendees (
  reservation_id uuid not null references public.reservations (id) on delete cascade,
  attendee_id uuid not null references public.attendees (id) on delete cascade,
  primary key (reservation_id, attendee_id)
);

create index if not exists reservation_attendees_attendee_idx
  on public.reservation_attendees (attendee_id);

-- RLS: internal planning tool accessed with the publishable (anon) key.
-- Venue data is read-only; planning tables are read/write.
alter table public.venues enable row level security;
alter table public.private_rooms enable row level security;
alter table public.attendees enable row level security;
alter table public.reservations enable row level security;
alter table public.reservation_attendees enable row level security;

drop policy if exists "venues readable" on public.venues;
create policy "venues readable" on public.venues
  for select to anon, authenticated using (true);

drop policy if exists "rooms readable" on public.private_rooms;
create policy "rooms readable" on public.private_rooms
  for select to anon, authenticated using (true);

drop policy if exists "attendees read" on public.attendees;
create policy "attendees read" on public.attendees
  for select to anon, authenticated using (true);
drop policy if exists "attendees insert" on public.attendees;
create policy "attendees insert" on public.attendees
  for insert to anon, authenticated with check (true);
drop policy if exists "attendees update" on public.attendees;
create policy "attendees update" on public.attendees
  for update to anon, authenticated using (true) with check (true);

drop policy if exists "reservations read" on public.reservations;
create policy "reservations read" on public.reservations
  for select to anon, authenticated using (true);
drop policy if exists "reservations insert" on public.reservations;
create policy "reservations insert" on public.reservations
  for insert to anon, authenticated with check (true);
drop policy if exists "reservations update" on public.reservations;
create policy "reservations update" on public.reservations
  for update to anon, authenticated using (true) with check (true);
drop policy if exists "reservations delete" on public.reservations;
create policy "reservations delete" on public.reservations
  for delete to anon, authenticated using (true);

drop policy if exists "reservation_attendees read" on public.reservation_attendees;
create policy "reservation_attendees read" on public.reservation_attendees
  for select to anon, authenticated using (true);
drop policy if exists "reservation_attendees insert" on public.reservation_attendees;
create policy "reservation_attendees insert" on public.reservation_attendees
  for insert to anon, authenticated with check (true);
drop policy if exists "reservation_attendees delete" on public.reservation_attendees;
create policy "reservation_attendees delete" on public.reservation_attendees
  for delete to anon, authenticated using (true);
