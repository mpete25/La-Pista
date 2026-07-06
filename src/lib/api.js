import { supabase } from "./supabase.js";

/** Data access layer: maps Supabase rows to the shapes the UI already uses. */

const localDate = (d) => d.toLocaleDateString("sv-SE"); // YYYY-MM-DD in local tz
const localTime = (d) => d.toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" });

export async function fetchPlayers() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, phone, points, wins, losses, role, center_id, joined_at")
    .order("points", { ascending: false });
  if (error) throw error;
  return data.map((p) => ({
    id: p.id,
    name: p.full_name,
    phone: p.phone || "",
    points: p.points,
    wins: p.wins,
    losses: p.losses,
    role: p.role,
    centerId: p.center_id,
    joined: p.joined_at,
    history: [], // filled from point_adjustments in a later milestone
  }));
}

export async function fetchEvents() {
  const { data, error } = await supabase
    .from("events")
    .select("id, title, starts_at, duration_minutes, capacity, status, event_registrations(player_id, status)")
    .in("status", ["open", "in_progress"])
    .order("starts_at", { ascending: true });
  if (error) throw error;
  return data.map((e) => {
    const d = new Date(e.starts_at);
    const regs = e.event_registrations || [];
    return {
      id: e.id,
      title: e.title,
      date: localDate(d),
      time: localTime(d),
      capacity: e.capacity,
      registered: regs.filter((r) => r.status === "registered").map((r) => r.player_id),
      waitlist: regs.filter((r) => r.status === "waitlist").map((r) => r.player_id),
      status: "åben",
      pendingOffer: regs.find((r) => r.status === "offered")?.player_id || null,
    };
  });
}

export async function joinEventApi(eventId) {
  const { data, error } = await supabase.rpc("join_event", { p_event_id: eventId });
  if (error) throw error;
  return data; // 'registered' | 'waitlist'
}

export async function leaveEventApi(eventId) {
  const { error } = await supabase.rpc("leave_event", { p_event_id: eventId });
  if (error) throw error;
}

/* ---- Admin (RLS enforces center_admin role server-side) ---- */

export async function createEventApi({ title, date, time, capacity, centerId }) {
  const startsAt = new Date(`${date}T${time}:00`);
  const { error } = await supabase.from("events").insert({
    center_id: centerId,
    title,
    starts_at: startsAt.toISOString(),
    capacity: Number(capacity) || 16,
  });
  if (error) throw error;
}

export async function cancelEventApi(eventId) {
  const { error } = await supabase.from("events").update({ status: "cancelled" }).eq("id", eventId);
  if (error) throw error;
}

export async function updateCapacityApi(eventId, capacity) {
  const { error } = await supabase.from("events").update({ capacity }).eq("id", eventId);
  if (error) throw error;
}

export async function adminAddApi(eventId, playerId, centerId) {
  const { error } = await supabase.from("event_registrations").insert({
    event_id: eventId,
    player_id: playerId,
    center_id: centerId,
    status: "registered",
  });
  if (error) throw error;
}

export async function adminRemoveApi(eventId, playerId) {
  const { error } = await supabase
    .from("event_registrations")
    .update({ status: "cancelled" })
    .eq("event_id", eventId)
    .eq("player_id", playerId);
  if (error) throw error;
}
