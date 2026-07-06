import { supabase } from "./supabase.js";

/** Data access layer: maps Supabase rows to the shapes the UI already uses. */

const localDate = (d) => d.toLocaleDateString("sv-SE"); // YYYY-MM-DD in local tz
const localTime = (d) => d.toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" });

export async function fetchPlayers() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, phone, points, wins, losses, role, center_id, joined_at, point_adjustments!player_id(delta, points_after, placement, reason, created_at, events(title))")
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
    history: (p.point_adjustments || [])
      .slice()
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((a) => ({
        date: a.created_at.slice(0, 10),
        title: a.events?.title || a.reason || "Justering af point",
        delta: a.delta,
        after: a.points_after,
        placement: a.placement,
        sets: [], // per-set detail arrives with the server-side matchday engine
      })),
  }));
}

export async function fetchCourts() {
  const { data, error } = await supabase
    .from("courts")
    .select("id, name, sort_order")
    .eq("active", true)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return data;
}

export async function fetchEvents() {
  const { data, error } = await supabase
    .from("events")
    .select("id, title, starts_at, duration_minutes, capacity, status, event_registrations(player_id, status), event_courts(courts(name, sort_order))")
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
      courtNames: (e.event_courts || [])
        .map((ec) => ec.courts)
        .filter(Boolean)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((c) => c.name),
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

/* ---- Matchday engine (server-side court split, sets and points) ---- */

export async function startMatchdayApi(eventId) {
  const { error } = await supabase.rpc("start_matchday", { p_event_id: eventId });
  if (error) throw error;
}

export async function fetchMatchdayApi(eventId) {
  const [assignsRes, setsRes] = await Promise.all([
    supabase.from("court_assignments").select("court_no, player_id").eq("event_id", eventId).order("court_no"),
    supabase.from("sets").select("court_no, set_no, team_a, team_b, games_a, games_b").eq("event_id", eventId).order("set_no"),
  ]);
  if (assignsRes.error) throw assignsRes.error;
  if (setsRes.error) throw setsRes.error;
  return { assignments: assignsRes.data, sets: setsRes.data };
}

export async function reportSetApi(eventId, courtNo, teamA, teamB, gamesA, gamesB) {
  const { data, error } = await supabase.rpc("report_set", {
    p_event_id: eventId,
    p_court_no: courtNo,
    p_team_a: teamA,
    p_team_b: teamB,
    p_games_a: gamesA,
    p_games_b: gamesB,
  });
  if (error) throw error;
  return data; // set number
}

export async function finishCourtApi(eventId, courtNo) {
  const { error } = await supabase.rpc("finish_court", { p_event_id: eventId, p_court_no: courtNo });
  if (error) throw error;
}

/* ---- Admin (RLS enforces center_admin role server-side) ---- */

export async function createEventApi({ title, date, time, capacity, centerId, courtIds = [] }) {
  const startsAt = new Date(`${date}T${time}:00`);
  const { data, error } = await supabase
    .from("events")
    .insert({
      center_id: centerId,
      title,
      starts_at: startsAt.toISOString(),
      capacity: Number(capacity) || 16,
    })
    .select("id")
    .single();
  if (error) throw error;
  if (courtIds.length > 0) {
    const { error: courtsError } = await supabase.from("event_courts").insert(
      courtIds.map((courtId) => ({ event_id: data.id, court_id: courtId, center_id: centerId }))
    );
    if (courtsError) throw courtsError;
  }
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

/* ---- Admin player management (audited security-definer RPCs) ---- */

export async function adminUpdatePlayerApi(playerId, fullName, phone) {
  const { error } = await supabase.rpc("admin_update_player", {
    p_player_id: playerId,
    p_full_name: fullName,
    p_phone: phone,
  });
  if (error) throw error;
}

export async function adminSetPointsApi(playerId, points, reason) {
  const { error } = await supabase.rpc("admin_set_points", {
    p_player_id: playerId,
    p_points: points,
    p_reason: reason,
  });
  if (error) throw error;
}

export async function adminDeletePlayerApi(playerId) {
  const { error } = await supabase.rpc("admin_delete_player", { p_player_id: playerId });
  if (error) throw error;
}
