-- Cuisine extracted alongside capacity from a restaurant's own website. Terra
-- supplies no cuisine field, so this is populated only by scripts/extract-capacity.ts
-- for venues outside the curated overlay (which carries its own cuisine).
alter table public.venue_capacity
  add column if not exists cuisine text;
