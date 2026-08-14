import { getSupabase } from "./supabase";
import type { Attendee, Reservation } from "./types";

export interface NewAttendee {
  full_name: string;
  email: string | null;
  phone: string | null;
  dietary_notes: string | null;
}

export interface NewReservation {
  venue_id: string;
  title: string;
  event_date: string | null;
  headcount: number;
  search_address: string | null;
  commute_mode: string | null;
  notes: string | null;
}

const DB_HINT =
  "Database not reachable. Run supabase/migrations in your Supabase project (see README) and reload.";

export async function listAttendees(): Promise<Attendee[]> {
  const supabase = getSupabase();
  if (!supabase) throw new Error(DB_HINT);
  const { data, error } = await supabase
    .from("attendees")
    .select("*")
    .order("full_name");
  if (error) throw new Error(error.message);
  return data as Attendee[];
}

/**
 * Creates attendee profiles, reusing an existing profile when the email
 * already exists (saved profiles for repeat dinners).
 */
export async function upsertAttendees(entries: NewAttendee[]): Promise<Attendee[]> {
  const supabase = getSupabase();
  if (!supabase) throw new Error(DB_HINT);
  const results: Attendee[] = [];
  for (const entry of entries) {
    if (entry.email) {
      const { data: existing } = await supabase
        .from("attendees")
        .select("*")
        .ilike("email", entry.email)
        .maybeSingle();
      if (existing) {
        const { data: updated, error } = await supabase
          .from("attendees")
          .update({
            full_name: entry.full_name,
            phone: entry.phone ?? existing.phone,
            dietary_notes: entry.dietary_notes ?? existing.dietary_notes,
          })
          .eq("id", existing.id)
          .select()
          .single();
        if (error) throw new Error(error.message);
        results.push(updated as Attendee);
        continue;
      }
    }
    const { data: created, error } = await supabase
      .from("attendees")
      .insert(entry)
      .select()
      .single();
    if (error) throw new Error(error.message);
    results.push(created as Attendee);
  }
  return results;
}

export async function createReservation(
  reservation: NewReservation,
  attendeeIds: string[]
): Promise<Reservation> {
  const supabase = getSupabase();
  if (!supabase) throw new Error(DB_HINT);
  const { data, error } = await supabase
    .from("reservations")
    .insert(reservation)
    .select()
    .single();
  if (error) throw new Error(error.message);
  const created = data as Reservation;

  if (attendeeIds.length > 0) {
    const { error: joinError } = await supabase.from("reservation_attendees").insert(
      attendeeIds.map((attendee_id) => ({
        reservation_id: created.id,
        attendee_id,
      }))
    );
    if (joinError) throw new Error(joinError.message);
  }
  return created;
}

export interface ReservationWithDetails extends Reservation {
  venue_name: string;
  venue_address: string;
  attendees: Attendee[];
}

export async function listReservations(): Promise<ReservationWithDetails[]> {
  const supabase = getSupabase();
  if (!supabase) throw new Error(DB_HINT);
  const { data, error } = await supabase
    .from("reservations")
    .select(
      "*, venues(name, address), reservation_attendees(attendees(*))"
    )
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  type Row = Reservation & {
    venues: { name: string; address: string } | null;
    reservation_attendees: { attendees: Attendee | null }[];
  };
  return (data as Row[]).map((row) => ({
    ...row,
    venue_name: row.venues?.name ?? row.venue_id,
    venue_address: row.venues?.address ?? "",
    attendees: row.reservation_attendees
      .map((ra) => ra.attendees)
      .filter((a): a is Attendee => a !== null),
  }));
}

export async function deleteReservation(id: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error(DB_HINT);
  const { error } = await supabase.from("reservations").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
