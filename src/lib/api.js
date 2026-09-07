import { supabase } from "./supabase.js";

/** Data access layer: maps Supabase rows to the shapes the UI already uses. */

const localDate = (d) => d.toLocaleDateString("sv-SE"); // YYYY-MM-DD in local tz
const localTime = (d) => d.toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" });

export async function fetchPlayers() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, phone, points, wins, losses, role, center_id, joined_at, point_adjustments!player_id(event_id, delta, points_after, placement, reason, created_at, events(title))")
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
        eventId: a.event_id,
        date: a.created_at.slice(0, 10),
        title: a.events?.title || a.reason || "Justering af point",
        delta: a.delta,
        after: a.points_after,
        placement: a.placement,
        // The day's sets are fetched on demand when a history card is opened.
        sets: [],
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

/** Event status as the Danish UI labels it. */
const EVENT_STATUS = { open: "åben", in_progress: "i gang", finished: "afsluttet", cancelled: "aflyst" };

export async function fetchEvents() {
  const { data, error } = await supabase
    .from("events")
    .select("id, title, starts_at, duration_minutes, capacity, status, event_registrations(player_id, status, seq, offer_expires_at), event_courts(courts(name, sort_order))")
    .in("status", ["open", "in_progress"])
    .order("starts_at", { ascending: true });
  if (error) throw error;
  return data.map((e) => {
    const d = new Date(e.starts_at);
    // seq is the queue order the server promotes by — show the same order.
    const regs = (e.event_registrations || []).slice().sort((a, b) => (a.seq || 0) - (b.seq || 0));
    const offer = regs.find((r) => r.status === "offered");
    return {
      id: e.id,
      title: e.title,
      startsAt: e.starts_at,
      durationMinutes: e.duration_minutes,
      date: localDate(d),
      time: localTime(d),
      capacity: e.capacity,
      registered: regs.filter((r) => r.status === "registered").map((r) => r.player_id),
      waitlist: regs.filter((r) => r.status === "waitlist").map((r) => r.player_id),
      status: EVENT_STATUS[e.status] || e.status,
      pendingOffer: offer?.player_id || null,
      offerExpiresAt: offer?.offer_expires_at || null,
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

/* ---- Waitlist offers (the other end of the SMS link) ---- */

export async function acceptOfferApi(eventId) {
  const { error } = await supabase.rpc("accept_offer", { p_event_id: eventId });
  if (error) throw error;
}

export async function declineOfferApi(eventId) {
  const { error } = await supabase.rpc("decline_offer", { p_event_id: eventId });
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

/** The sets a player took part in on one match day, in playing order. */
export async function fetchPlayerSetsApi(eventId, playerId) {
  const { data, error } = await supabase
    .from("sets")
    .select("set_no, team_a, team_b, games_a, games_b")
    .eq("event_id", eventId)
    .or(`team_a.cs.{${playerId}},team_b.cs.{${playerId}}`)
    .order("set_no", { ascending: true });
  if (error) throw error;
  return data.map((s) => {
    const mine = s.team_a.includes(playerId) ? "a" : "b";
    const own = mine === "a" ? s.team_a : s.team_b;
    const opp = mine === "a" ? s.team_b : s.team_a;
    const ownGames = mine === "a" ? s.games_a : s.games_b;
    const oppGames = mine === "a" ? s.games_b : s.games_a;
    return {
      label: "Sæt " + s.set_no,
      partnerId: own.find((id) => id !== playerId),
      oppIds: opp,
      score: [ownGames, oppGames],
      won: ownGames > oppGames,
    };
  });
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

/* These go through RPCs rather than table writes: cancelling a day has to
   notify everyone, and freeing or adding a spot has to move the waitlist. */

export async function cancelEventApi(eventId) {
  const { data, error } = await supabase.rpc("admin_cancel_event", { p_event_id: eventId });
  if (error) throw error;
  return data; // number of players notified
}

export async function updateCapacityApi(eventId, capacity) {
  const { error } = await supabase.rpc("admin_set_capacity", {
    p_event_id: eventId,
    p_capacity: Number(capacity),
  });
  if (error) throw error;
}

export async function adminAddApi(eventId, playerId) {
  const { data, error } = await supabase.rpc("admin_add_registration", {
    p_event_id: eventId,
    p_player_id: playerId,
  });
  if (error) throw error;
  return data; // 'registered' | 'waitlist'
}

export async function adminRemoveApi(eventId, playerId) {
  const { error } = await supabase.rpc("admin_remove_registration", {
    p_event_id: eventId,
    p_player_id: playerId,
  });
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

/* ---- Messages ---- */

const msgTime = (iso) =>
  new Date(iso).toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" });

/**
 * Every conversation the signed-in player takes part in, keyed by the other
 * player's id and shaped the way the UI renders them.
 */
export async function fetchThreadsApi(meId) {
  const { data, error } = await supabase
    .from("messages")
    .select("id, sender_id, recipient_id, body, created_at, read_at")
    .order("created_at", { ascending: true });
  if (error) throw error;

  const threads = {};
  for (const m of data) {
    const otherId = m.sender_id === meId ? m.recipient_id : m.sender_id;
    (threads[otherId] ||= []).push({
      id: m.id,
      from: m.sender_id === meId ? "me" : "them",
      text: m.body,
      time: msgTime(m.created_at),
      unread: m.recipient_id === meId && !m.read_at,
    });
  }
  return threads;
}

export async function sendMessageApi(centerId, senderId, recipientId, body) {
  const { data, error } = await supabase
    .from("messages")
    .insert({ center_id: centerId, sender_id: senderId, recipient_id: recipientId, body })
    .select("id, created_at")
    .single();
  if (error) throw error;
  return { id: data.id, from: "me", text: body, time: msgTime(data.created_at), unread: false };
}

export async function markThreadReadApi(meId, otherId) {
  const { error } = await supabase
    .from("messages")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_id", meId)
    .eq("sender_id", otherId)
    .is("read_at", null);
  if (error) throw error;
}

/** Live delivery for incoming messages. Returns an unsubscribe function. */
export function subscribeToMessages(meId, onMessage) {
  if (!supabase || !meId) return () => {};
  const channel = supabase
    .channel("messages-" + meId)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: `recipient_id=eq.${meId}` },
      (payload) => {
        const m = payload.new;
        onMessage(m.sender_id, {
          id: m.id,
          from: "them",
          text: m.body,
          time: msgTime(m.created_at),
          unread: true,
        });
      }
    )
    .subscribe();
  return () => supabase.removeChannel(channel);
}
