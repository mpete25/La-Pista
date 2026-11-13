import React, { useState, useMemo, useEffect, useRef } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { Trophy, MessageCircle, Calendar, User, ChevronRight, ChevronLeft, Send, Plus, Minus, X, Check, Clock, TrendingUp, Crown, Shield, Smartphone, ArrowLeft, Swords } from "lucide-react";
import { DEMO_CENTER, PLATFORM } from "./config/center.js";
import { centerSlugFromLocation, fetchCenterBySlug } from "./lib/center.js";
import { C, G, shadow, softShadow, serif, sans, globalCss } from "./theme.js";
import { Avatar, Card, Eyebrow, H, Btn, Tag, Logo, CourtSVG, Chips, Bar, BallDot, BallLoader, BallBurst, CountUp, firstName } from "./components/ui.jsx";
import { supabase } from "./lib/supabase.js";
import { useAuth } from "./hooks/useAuth.js";
import { setMonitoringUser } from "./lib/monitoring.js";
import AuthScreen, { SetPasswordScreen, PRIVACY_URL } from "./components/AuthScreen.jsx";
import {
  fetchPlayers, fetchEvents, fetchCourts, joinEventApi, leaveEventApi,
  createEventApi, cancelEventApi, updateCapacityApi, adminAddApi, adminRemoveApi,
  adminUpdatePlayerApi, adminSetPointsApi, adminDeletePlayerApi,
  startMatchdayApi, fetchMatchdayApi, reportSetApi, finishCourtApi,
  acceptOfferApi, declineOfferApi, fetchPlayerSetsApi,
  fetchThreadsApi, sendMessageApi, markThreadReadApi, subscribeToMessages,
  fetchSmsLogApi, subscribeToCenterChanges,
  fetchMyPrivateProfileApi, updateMyPhoneApi, setSmsConsentApi, exportMyDataApi, deleteMyAccountApi,
} from "./lib/api.js";

/* Demo mode: no Supabase configured -> the app runs on the in-memory seed data. */
const IS_DEMO = !supabase;

const adminInput = { fontFamily: "'Outfit', ui-sans-serif, system-ui, sans-serif", fontSize: 16, padding: "11px 14px", borderRadius: 12, border: "1px solid #E9DECB", background: "#F6F1E8", outline: "none" };

/* ================= HELPERS ================= */
const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const fmtDate = (iso) => { const d = new Date(iso + "T12:00:00"); return d.toLocaleDateString("da-DK", { weekday: "short", day: "numeric", month: "short" }); };
const fmtDateLong = (iso) => { const d = new Date(iso + "T12:00:00"); return d.toLocaleDateString("da-DK", { weekday: "long", day: "numeric", month: "long" }); };
const fmtDeadline = (iso) => new Date(iso).toLocaleString("da-DK", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const shortDate = (iso) => { const d = new Date(iso + "T12:00:00"); return d.getDate() + "/" + (d.getMonth() + 1); };

/* ELO-inspireret pointmodel: forventet score ud fra pointdifference */
const K = 24, D = 400;
const expected = (own, opp) => 1 / (1 + Math.pow(10, (opp - own) / D));
const setDelta = (player, partner, o1, o2, ownGames, oppGames) => {
  const team = (player + partner) / 2, opp = (o1 + o2) / 2;
  const E = expected(team, opp);
  const S = ownGames / (ownGames + oppGames);
  return { delta: K * (S - E), E, S };
};

/* ================= SEED DATA ================= */
const NAMES = [
  ["Frederik Lund", 812], ["Jonas Brandt", 776], ["Andreas Holm", 748], ["Emil Sørensen", 731],
  ["Oliver Bech", 704], ["Victor Dahl", 688], ["Magnus Iversen", 662], ["Mads Kristensen", 645],
  ["Sofie Krag", 631], ["Laura Vinter", 612], ["Casper Nyholm", 598], ["Mathias Juhl", 577],
  ["Tobias Skov", 561], ["Nikolaj Friis", 543], ["Sebastian Riis", 528], ["Anton Meyer", 512],
  ["Ida Bruun", 497], ["Jeppe Kold", 489], ["Alma Østergaard", 476], ["William Toft", 461],
];
const HIST_DATES = ["2026-05-21", "2026-05-28", "2026-06-04", "2026-06-11", "2026-06-18", "2026-06-25"];

const seedPlayers = () => NAMES.map(([name, pts], i) => {
  const rnd = mulberry32(1000 + i * 77);
  let after = pts;
  const entries = [];
  for (let j = HIST_DATES.length - 1; j >= 0; j--) {
    const delta = Math.round((rnd() - 0.42) * 55);
    const before = after - delta;
    const others = NAMES.filter((_, k) => k !== i);
    const pick = () => others[Math.floor(rnd() * others.length)][0];
    const sets = [0, 1, 2, 3].map(r => {
      const won = rnd() > (delta >= 0 ? 0.38 : 0.58);
      const ls = won ? 7 : 1 + Math.floor(rnd() * 6);
      const os = won ? 1 + Math.floor(rnd() * 6) : 7;
      return { label: r === 3 ? "Finale" : "Runde " + (r + 1), partner: pick(), opps: [pick(), pick()], score: [ls, os], won };
    });
    entries.unshift({ date: HIST_DATES[j], title: "Torsdagsrangliste", delta, after, sets, placement: 1 + Math.floor(rnd() * 4) });
    after = before;
  }
  const setsWon = entries.reduce((a, e) => a + e.sets.filter(s => s.won).length, 0);
  const setsLost = entries.length * 4 - setsWon;
  return { id: "p" + i, name, points: pts, wins: setsWon + Math.floor(mulberry32(i)() * 10), losses: setsLost + Math.floor(mulberry32(i + 5)() * 10), phone: "+45 2" + String(1000000 + i * 13579).slice(0, 7), history: entries, joined: "2025-0" + (1 + (i % 9)) + "-12" };
});

const TODAY = IS_DEMO ? "2026-07-03" : new Date().toLocaleDateString("sv-SE");
const seedEvents = (P) => {
  const ids = (a, b) => P.slice(a, b).map(p => p.id);
  return [
    { id: "e1", title: "Fredagsrangliste", date: TODAY, time: "19:00", capacity: 16, registered: ids(0, 16), waitlist: [P[16].id, P[17].id], status: "åben", pendingOffer: null },
    { id: "e2", title: "Torsdagsrangliste", date: "2026-07-09", time: "18:30", capacity: 16, registered: ids(2, 14), waitlist: [], status: "åben", pendingOffer: null },
    { id: "e3", title: "Søndagsrangliste", date: "2026-07-12", time: "10:00", capacity: 12, registered: ids(8, 20), waitlist: [], status: "åben", pendingOffer: null },
    { id: "e4", title: "Torsdagsrangliste", date: "2026-07-16", time: "18:30", capacity: 16, registered: ids(9, 14), waitlist: [], status: "åben", pendingOffer: null },
  ];
};
const seedThreads = () => ({
  p1: [
    { from: "p1", text: "Stærkt spillet i torsdags! Skal vi træne serv på onsdag?", time: "10:42" },
    { from: "me", text: "Tak! Onsdag kl. 17 fungerer for mig 🎾", time: "10:51" },
    { from: "p1", text: "Perfekt, jeg booker bane 2.", time: "10:53" },
  ],
  p8: [
    { from: "p8", text: "Er du med på fredagsranglisten i dag?", time: "08:15" },
    { from: "me", text: "Ja, jeg er tilmeldt – vi ses kl. 19!", time: "08:20" },
  ],
});

/* ================= APP ================= */
export default function App() {
  const demo = IS_DEMO;
  const { session, loading: authLoading, needsPassword, passwordSet } = useAuth();
  const [players, setPlayers] = useState(demo ? seedPlayers : []);
  const [events, setEvents] = useState(demo ? () => seedEvents(seedPlayers()) : []);
  const [threads, setThreads] = useState(demo ? seedThreads : () => ({}));
  const [courtsList, setCourtsList] = useState(demo ? () => Array.from({ length: 8 }, (_, i) => ({ id: "dc" + (i + 1), name: "D" + (i + 1), sort_order: i + 1 })) : []);
  const [editPlayer, setEditPlayer] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [smsLog, setSmsLog] = useState([]);
  const [tab, setTab] = useState("rangliste");
  const [viewPlayerId, setViewPlayerId] = useState(null);
  const [activeThread, setActiveThread] = useState(null);
  const [msgDraft, setMsgDraft] = useState("");
  const [admin, setAdmin] = useState(false);
  const [adminCreds, setAdminCreds] = useState({ email: "", pass: "" });
  const [toast, setToast] = useState(null);
  const [matchday, setMatchday] = useState(null);
  const [newEvent, setNewEvent] = useState({ title: "Torsdagsrangliste", date: "2026-07-23", time: "18:30", capacity: 16, courtIds: [] });
  const [eventDetailId, setEventDetailId] = useState(null);
  const [expandedHist, setExpandedHist] = useState(null);
  const [clock, setClock] = useState(Date.now());
  const [center, setCenter] = useState(demo ? DEMO_CENTER : null);
  const [centerError, setCenterError] = useState(null);
  const [histSets, setHistSets] = useState({});
  const [dataLoaded, setDataLoaded] = useState(false);
  const [account, setAccount] = useState(null); // own private fields: { phone, smsConsent }
  const [phoneDraft, setPhoneDraft] = useState("");
  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);
  useEffect(() => { const t = setInterval(() => setClock(Date.now()), 15000); return () => clearInterval(t); }, []);

  const ME = demo ? "p7" /* Mads Kristensen – demo-login */ : session?.user?.id;
  const playersById = useMemo(() => Object.fromEntries(players.map(p => [p.id, p])), [players]);
  const ranked = useMemo(() => [...players].sort((a, b) => b.points - a.points), [players]);
  const rankOf = (id) => ranked.findIndex(p => p.id === id) + 1;
  const me = playersById[ME];
  const isAdmin = demo ? admin : me?.role === "center_admin";

  /* ---- Tenant: which center is this? Resolved from the URL, then read
     from the database, so one deployment serves every center. ---- */
  useEffect(() => {
    if (demo) return;
    const slug = centerSlugFromLocation();
    if (!slug) {
      setCenterError("Ingen padelcenter angivet i adressen.");
      return;
    }
    let cancelled = false;
    fetchCenterBySlug(slug)
      .then((c) => {
        if (cancelled) return;
        if (c) setCenter(c);
        else setCenterError(`Vi kunne ikke finde et padelcenter der hedder “${slug}”.`);
      })
      .catch((e) => {
        console.error("Center lookup failed:", e);
        if (!cancelled) setCenterError("Kunne ikke hente centeret – prøv at genindlæse.");
      });
    return () => { cancelled = true; };
  }, [demo]);

  /* ---- Real data (Supabase) ---- */
  const reloadPlayers = async () => setPlayers(await fetchPlayers(session?.user?.id));
  const reloadEvents = async () => setEvents(await fetchEvents());

  /* DOMAIN RULE: confirmed spots cannot self-cancel within 24h of start —
     the player must contact the center. Enforced in the DB too (leave_event). */
  const nowMs = () => (demo ? new Date(TODAY + "T12:00:00").getTime() : Date.now());
  /* A match day can be entered while it is open and while it is running:
     the first player through the door locks the court split, the rest join
     the day already in progress. */
  const isPlayable = (ev) => ev.status === "åben" || ev.status === "i gang";
  const eventStartMs = (ev) => new Date(`${ev.date}T${ev.time || "00:00"}:00`).getTime();
  const canSelfCancel = (ev) => eventStartMs(ev) - nowMs() > 24 * 60 * 60 * 1000;
  useEffect(() => {
    if (demo || !session) return;
    let cancelled = false;
    Promise.all([fetchPlayers(session.user.id), fetchEvents(), fetchCourts(), fetchThreadsApi(session.user.id)])
      .then(([pl, ev, co, th]) => { if (!cancelled) { setPlayers(pl); setEvents(ev); setCourtsList(co); setThreads(th); } })
      .catch((e) => { console.error("Data load failed:", e); if (!cancelled) setToast("Kunne ikke hente data – prøv at genindlæse"); })
      .finally(() => { if (!cancelled) setDataLoaded(true); });
    return () => { cancelled = true; };
  }, [demo, session]);

  /* Incoming messages arrive over realtime, so an open conversation
     updates without a reload. */
  useEffect(() => {
    if (demo || !ME) return;
    return subscribeToMessages(ME, (fromId, msg) => {
      setThreads((t) => ({ ...t, [fromId]: [...(t[fromId] || []), msg] }));
    });
  }, [demo, ME]);

  /* Own private fields (phone, SMS consent) are not in the shared player
     list, so they are read separately when the own profile is opened. */
  // A different user on the same device must never see the previous one's fields.
  const sessionUserId = session?.user?.id;
  useEffect(() => { setAccount(null); setConfirmDeleteAccount(false); setMonitoringUser(sessionUserId); }, [sessionUserId]);
  const ownProfileOpen = tab === "profil" && (!viewPlayerId || viewPlayerId === ME);
  useEffect(() => {
    if (!ownProfileOpen || account) return;
    if (demo) {
      const p = playersById[ME];
      setAccount({ phone: p?.phone || "", smsConsent: true });
      setPhoneDraft(p?.phone || "");
      return;
    }
    if (!session) return;
    let cancelled = false;
    fetchMyPrivateProfileApi()
      .then(a => { if (!cancelled) { setAccount(a); setPhoneDraft(a.phone); } })
      .catch(e => console.error("Could not load account settings:", e));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownProfileOpen, demo, session, account]);

  /* Live updates: a set reported on another phone, a new sign-up or points
     awarded at the end of a day reach every open app without a reload. */
  const matchdayRef = useRef(matchday);
  useEffect(() => { matchdayRef.current = matchday; }, [matchday]);
  const syncMatchdaySets = async (eventId, courtNo) => {
    const { sets } = await fetchMatchdayApi(eventId);
    const results = sets.filter(s => s.court_no === courtNo).map(s => ({
      round: s.set_no - 1, left: s.team_a, right: s.team_b,
      score: [s.games_a, s.games_b],
      winners: s.games_a > s.games_b ? s.team_a : s.team_b,
    }));
    let changed = false;
    setMatchday(cur => {
      if (!cur || cur.eventId !== eventId || cur.courtNo !== courtNo || cur.stage === "færdig") return cur;
      if (results.length <= cur.results.length) return cur;
      changed = true;
      return { ...cur, results, round: results.length, winners: null, wScore: null, lScore: null, stage: "bane" };
    });
    if (changed) notify("En medspiller har indberettet sættet");
  };
  const centerId = me?.centerId;
  useEffect(() => {
    if (demo || !session || !centerId) return;
    let reloadTimer = null, setsTimer = null;
    const unsubscribe = subscribeToCenterChanges(centerId, (table, row) => {
      // Bursts (a whole court split, a day's point changes) arrive as many
      // rows; refetch once after they settle.
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        reloadPlayers().catch(e => console.error("Live reload of players failed:", e));
        reloadEvents().catch(e => console.error("Live reload of events failed:", e));
      }, 600);
      const md = matchdayRef.current;
      if (table === "sets" && md && row?.event_id === md.eventId && row?.court_no === md.courtNo) {
        clearTimeout(setsTimer);
        setsTimer = setTimeout(() => syncMatchdaySets(md.eventId, md.courtNo).catch(e => console.error(e)), 300);
      }
    });
    return () => { clearTimeout(reloadTimer); clearTimeout(setsTimer); unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, session, centerId]);

  useEffect(() => {
    if (demo || !isAdmin || tab !== "admin") return;
    let cancelled = false;
    fetchSmsLogApi()
      .then(rows => { if (!cancelled) setSmsLog(rows); })
      .catch(e => console.error("Could not load the SMS log:", e));
    return () => { cancelled = true; };
  }, [demo, isAdmin, tab, events]);

  const notify = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2600); };

  /* An open conversation stays scrolled to the newest message. */
  const threadEndRef = useRef(null);
  const openThreadLen = activeThread ? (threads[activeThread] || []).length : 0;
  useEffect(() => {
    const el = threadEndRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activeThread, openThreadLen, tab]);

  /* A new view starts at the top, like a native app. */
  useEffect(() => { window.scrollTo(0, 0); }, [tab, viewPlayerId, eventDetailId, activeThread]);

  const openThread = async (otherId) => {
    setActiveThread(otherId);
    if (demo || !ME) return;
    const hasUnread = (threads[otherId] || []).some(m => m.unread);
    if (!hasUnread) return;
    setThreads(t => ({ ...t, [otherId]: (t[otherId] || []).map(m => ({ ...m, unread: false })) }));
    try { await markThreadReadApi(ME, otherId); } catch (e) { console.error(e); }
  };
  const sendSMS = (playerId, text) => {
    const p = playersById[playerId];
    setSmsLog(l => [{ to: p.phone, name: p.name, text, time: new Date().toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" }) }, ...l]);
  };

  /* ---- Til-/afmelding & venteliste ---- */
  const openSlotFollowUp = (ev) => {
    if (ev.waitlist.length > 0 && !ev.pendingOffer) {
      const next = ev.waitlist[0];
      sendSMS(next, `Hej ${firstName(playersById[next].name)}! Der er blevet en plads ledig til ${ev.title} ${fmtDate(ev.date)} kl. ${ev.time}. Tilmeld dig her: lapista.dk/e/${ev.id}`);
      notify(`SMS med ledig plads sendt til ${firstName(playersById[next].name)}`);
      return { ...ev, pendingOffer: next, waitlist: ev.waitlist.slice(1) };
    }
    return ev;
  };
  const joinEvent = async (evId) => {
    if (demo) {
      setEvents(es => es.map(ev => {
        if (ev.id !== evId) return ev;
        if (ev.registered.includes(ME) || ev.waitlist.includes(ME)) return ev;
        if (ev.registered.length < ev.capacity) { notify("Du er tilmeldt " + ev.title); return { ...ev, registered: [...ev.registered, ME] }; }
        notify("Begivenheden er fuld – du står nu på ventelisten"); return { ...ev, waitlist: [...ev.waitlist, ME] };
      }));
      return;
    }
    try {
      const status = await joinEventApi(evId);
      notify(status === "registered" ? "Du er tilmeldt" : "Begivenheden er fuld – du står nu på ventelisten");
      await reloadEvents();
    } catch (e) { console.error(e); notify("Tilmelding fejlede – prøv igen"); }
  };
  const leaveEvent = async (evId) => {
    const evObj = events.find(e => e.id === evId);
    if (evObj && evObj.registered.includes(ME) && !canSelfCancel(evObj)) {
      notify("Afmelding er lukket under 24 timer før start – kontakt centeret");
      return;
    }
    if (demo) {
      setEvents(es => es.map(ev => {
        if (ev.id !== evId) return ev;
        if (ev.waitlist.includes(ME)) { notify("Du er fjernet fra ventelisten"); return { ...ev, waitlist: ev.waitlist.filter(x => x !== ME) }; }
        if (!ev.registered.includes(ME)) return ev;
        notify("Du er afmeldt " + ev.title);
        return openSlotFollowUp({ ...ev, registered: ev.registered.filter(x => x !== ME) });
      }));
      return;
    }
    try {
      await leaveEventApi(evId);
      notify("Du er afmeldt");
      await reloadEvents();
    } catch (e) {
      console.error(e);
      notify(String(e?.message || "").includes("CANCEL_WINDOW_CLOSED")
        ? "Afmelding er lukket under 24 timer før start – kontakt centeret"
        : "Afmelding fejlede – prøv igen");
    }
  };
  const acceptOffer = async (evId) => {
    if (demo) {
      setEvents(es => es.map(ev => {
        if (ev.id !== evId || !ev.pendingOffer) return ev;
        notify(playersById[ev.pendingOffer].name + " har taget pladsen via SMS-linket");
        return { ...ev, registered: [...ev.registered, ev.pendingOffer], pendingOffer: null };
      }));
      return;
    }
    try {
      await acceptOfferApi(evId);
      notify("Pladsen er din – vi ses på banen");
      await reloadEvents();
    } catch (e) {
      console.error(e);
      notify(String(e?.message || "").includes("OFFER_EXPIRED")
        ? "Tilbuddet er udløbet og er gået videre til den næste på ventelisten"
        : "Kunne ikke tage pladsen – prøv igen");
      await reloadEvents();
    }
  };
  const declineOffer = async (evId) => {
    if (demo) {
      setEvents(es => es.map(ev => ev.id !== evId ? ev : { ...ev, pendingOffer: null }));
      notify("Nej tak – pladsen tilbydes den næste på ventelisten");
      return;
    }
    try {
      await declineOfferApi(evId);
      notify("Pladsen er tilbudt den næste på ventelisten");
      await reloadEvents();
    } catch (e) { console.error(e); notify("Kunne ikke afvise pladsen – prøv igen"); }
  };

  /* ---- Admin ---- */
  const adminRemove = async (evId, pid) => {
    if (demo) {
      setEvents(es => es.map(ev => ev.id !== evId ? ev : openSlotFollowUp({ ...ev, registered: ev.registered.filter(x => x !== pid), waitlist: ev.waitlist.filter(x => x !== pid) })));
      return;
    }
    try { await adminRemoveApi(evId, pid); await reloadEvents(); }
    catch (e) { console.error(e); notify("Kunne ikke fjerne spilleren"); }
  };
  const adminAdd = async (evId, pid) => {
    if (demo) {
      setEvents(es => es.map(ev => {
        if (ev.id !== evId || !pid || ev.registered.includes(pid)) return ev;
        if (ev.registered.length >= ev.capacity) { notify("Fuldt – udvid antal pladser først"); return ev; }
        return { ...ev, registered: [...ev.registered, pid], waitlist: ev.waitlist.filter(x => x !== pid) };
      }));
      return;
    }
    if (!pid) return;
    try { await adminAddApi(evId, pid); await reloadEvents(); }
    catch (e) { console.error(e); notify("Kunne ikke tilføje spilleren"); }
  };
  const adminCapacity = async (evId, d) => {
    if (demo) {
      setEvents(es => es.map(ev => {
        if (ev.id !== evId) return ev;
        const cap = Math.max(4, ev.capacity + d);
        let next = { ...ev, capacity: cap };
        if (d > 0 && next.registered.length < cap) next = openSlotFollowUp(next);
        return next;
      }));
      return;
    }
    const ev = events.find(e => e.id === evId);
    if (!ev) return;
    try { await updateCapacityApi(evId, Math.max(4, ev.capacity + d)); await reloadEvents(); }
    catch (e) { console.error(e); notify("Kunne ikke ændre antal pladser"); }
  };
  const adminDelete = async (evId) => {
    if (demo) {
      setEvents(es => {
        const ev = es.find(e => e.id === evId);
        [...ev.registered, ...ev.waitlist].forEach(pid => sendSMS(pid, `Hej ${firstName(playersById[pid].name)}. ${ev.title} ${fmtDate(ev.date)} kl. ${ev.time} er desværre aflyst pga. for få tilmeldte. Vi ses næste gang!`));
        notify("Begivenhed aflyst – SMS sendt til " + (ev.registered.length + ev.waitlist.length) + " spillere");
        return es.filter(e => e.id !== evId);
      });
      return;
    }
    try {
      const notified = await cancelEventApi(evId);
      notify(notified > 0
        ? `Begivenhed aflyst – SMS på vej til ${notified} spillere`
        : "Begivenhed aflyst");
      await reloadEvents();
    }
    catch (e) { console.error(e); notify("Kunne ikke aflyse begivenheden"); }
  };
  const adminCreate = async () => {
    if (!newEvent.date || !newEvent.time) return;
    if (demo) {
      const courtNames = newEvent.courtIds.map(id => courtsList.find(c => c.id === id)?.name).filter(Boolean);
      setEvents(es => [...es, { id: "e" + Date.now(), ...newEvent, capacity: Number(newEvent.capacity) || 16, courtNames, registered: [], waitlist: [], status: "åben", pendingOffer: null }].sort((a, b) => a.date.localeCompare(b.date)));
      notify("Begivenhed oprettet");
      setNewEvent(ne => ({ ...ne, courtIds: [] }));
      return;
    }
    try {
      await createEventApi({ ...newEvent, centerId: me?.centerId });
      notify("Begivenhed oprettet");
      setNewEvent(ne => ({ ...ne, courtIds: [] }));
      await reloadEvents();
    }
    catch (e) { console.error(e); notify("Kunne ikke oprette begivenheden"); }
  };

  /* ---- Kampdag-motor ---- */
  const pairings = (c) => [
    { left: [c[0], c[1]], right: [c[2], c[3]] },
    { left: [c[0], c[2]], right: [c[1], c[3]] },
    { left: [c[0], c[3]], right: [c[1], c[2]] },
  ];
  const startMatchday = async (ev) => {
    if (demo) {
      const sorted = ev.registered.map(id => playersById[id]).sort((a, b) => b.points - a.points);
      const courts = []; for (let i = 0; i < sorted.length; i += 4) courts.push(sorted.slice(i, i + 4).map(p => p.id));
      const myCourtIdx = courts.findIndex(c => c.includes(ME));
      if (myCourtIdx === -1 || courts[myCourtIdx].length < 4) { notify("Din bane mangler spillere (4 kræves)"); return; }
      setEventDetailId(null);
      setMatchday({ eventId: ev.id, courts, myCourtIdx, courtNo: myCourtIdx + 1, stage: "lobby", round: 0, results: [], winners: null, wScore: null, lScore: null, startedAt: Date.now() });
      setTab("kampdag");
      return;
    }
    try {
      await startMatchdayApi(ev.id);
      const { assignments, sets } = await fetchMatchdayApi(ev.id);
      const courtNos = [...new Set(assignments.map(a => a.court_no))].sort((a, b) => a - b);
      // Deterministic order (points desc, then id) so every device shows
      // the same partner rotation.
      const courts = courtNos.map(no => assignments
        .filter(a => a.court_no === no)
        .map(a => a.player_id)
        .sort((a, b) => ((playersById[b]?.points || 0) - (playersById[a]?.points || 0)) || a.localeCompare(b)));
      const myCourtIdx = courts.findIndex(c => c.includes(ME));
      if (myCourtIdx === -1) {
        notify("Du er ikke på en bane i dag – der var ikke plads til en hel bane (4 kræves)");
        await reloadEvents();
        return;
      }
      const courtNo = courtNos[myCourtIdx];
      const results = sets.filter(s => s.court_no === courtNo).map(s => ({
        round: s.set_no - 1,
        left: s.team_a,
        right: s.team_b,
        score: [s.games_a, s.games_b],
        winners: s.games_a > s.games_b ? s.team_a : s.team_b,
      }));
      setEventDetailId(null);
      setMatchday({ eventId: ev.id, courts, myCourtIdx, courtNo, stage: results.length > 0 ? "bane" : "lobby", round: results.length, results, winners: null, wScore: null, lScore: null, startedAt: Date.now() });
      setTab("kampdag");
    } catch (e) {
      console.error(e);
      const m = String(e?.message || "");
      notify(m.includes("TOO_EARLY") ? "Kampdagen kan først startes 15 min. før starttid"
        : m.includes("NOT_ENOUGH_PLAYERS") ? "Der er ikke spillere nok til en hel bane (4 kræves)"
        : m.includes("NOT_PARTICIPANT") ? "Du er ikke tilmeldt denne kampdag"
        : "Kunne ikke starte kampdagen – prøv igen");
    }
  };
  const currentPairing = (md) => pairings(md.courts[md.myCourtIdx])[md.round % 3];
  const confirmSet = async (md) => {
    const pr = currentPairing(md);
    const score = md.winners === "L" ? [md.wScore, md.lScore] : [md.lScore, md.wScore];
    if (!demo) {
      try {
        await reportSetApi(md.eventId, md.courtNo, pr.left, pr.right, score[0], score[1]);
      } catch (e) {
        console.error(e);
        // Likely a teammate reported the same set first — resync from the DB.
        try {
          const { sets } = await fetchMatchdayApi(md.eventId);
          const results = sets.filter(s => s.court_no === md.courtNo).map(s => ({
            round: s.set_no - 1, left: s.team_a, right: s.team_b,
            score: [s.games_a, s.games_b],
            winners: s.games_a > s.games_b ? s.team_a : s.team_b,
          }));
          setMatchday({ ...md, results, round: results.length, winners: null, wScore: null, lScore: null, stage: "bane" });
          notify(results.length > md.results.length ? "Sættet var allerede indberettet af en medspiller" : "Kunne ikke gemme sættet – prøv igen");
        } catch { notify("Kunne ikke gemme sættet – prøv igen"); }
        return;
      }
    }
    const res = { round: md.round, left: pr.left, right: pr.right, score, winners: md.winners === "L" ? pr.left : pr.right };
    setMatchday({ ...md, results: [...md.results, res], round: md.round + 1, winners: null, wScore: null, lScore: null, stage: "bane" });
  };
  const dayPoints = (md) => {
    const court = md.courts[md.myCourtIdx];
    return court.map(pid => {
      let sum = 0, Esum = 0, Ssum = 0, won = 0;
      md.results.forEach(r => {
        const onLeft = r.left.includes(pid), onRight = r.right.includes(pid);
        if (!onLeft && !onRight) return;
        const own = onLeft ? r.left : r.right, opp = onLeft ? r.right : r.left;
        const g = onLeft ? [r.score[0], r.score[1]] : [r.score[1], r.score[0]];
        const partner = own.find(x => x !== pid);
        const { delta, E, S } = setDelta(playersById[pid].points, playersById[partner].points, playersById[opp[0]].points, playersById[opp[1]].points, g[0], g[1]);
        sum += delta; Esum += E; Ssum += S; if (g[0] > g[1]) won++;
      });
      return { pid, delta: Math.round(sum), E: Esum, S: Ssum, won, n: md.results.length };
    }).sort((a, b) => b.delta - a.delta);
  };
  const applyMatchday = async (md) => {
    if (!demo) {
      try {
        await finishCourtApi(md.eventId, md.courtNo);
        await Promise.all([reloadPlayers(), reloadEvents()]);
        setMatchday({ ...md, stage: "færdig" });
        notify("Ranglisten er opdateret med dagens resultater");
      } catch (e) {
        console.error(e);
        const m = String(e?.message || "");
        notify(m.includes("ALREADY_FINISHED") ? "Banen er allerede afsluttet og point er tildelt"
          : m.includes("NO_SETS") ? "Der er ingen sæt at beregne point for"
          : "Kunne ikke afslutte kampdagen – prøv igen");
      }
      return;
    }
    const rows = dayPoints(md);
    setPlayers(ps => ps.map(p => {
      const row = rows.find(r => r.pid === p.id); if (!row) return p;
      const sets = md.results.map((r, i) => {
        const onLeft = r.left.includes(p.id);
        const own = onLeft ? r.left : r.right, opp = onLeft ? r.right : r.left;
        return { label: "Sæt " + (i + 1), partner: playersById[own.find(x => x !== p.id)].name, opps: opp.map(o => playersById[o].name), score: onLeft ? r.score : [r.score[1], r.score[0]], won: onLeft ? r.score[0] > r.score[1] : r.score[1] > r.score[0] };
      });
      return { ...p, points: p.points + row.delta, wins: p.wins + row.won, losses: p.losses + (md.results.length - row.won), history: [...p.history, { date: TODAY, title: events.find(e => e.id === md.eventId).title, delta: row.delta, after: p.points + row.delta, sets, placement: rows.findIndex(r => r.pid === p.id) + 1 }] };
    }));
    setEvents(es => es.map(e => e.id === md.eventId ? { ...e, status: "afsluttet" } : e));
    setMatchday({ ...md, stage: "færdig" });
    notify("Ranglisten er opdateret med dagens resultater");
  };

  /* ---- Admin: player management ---- */
  const savePlayer = async () => {
    const ep = editPlayer;
    if (!ep) return;
    const orig = playersById[ep.id];
    if (!orig) { setEditPlayer(null); return; }
    const newPts = parseInt(ep.points, 10);
    if (demo) {
      setPlayers(ps => ps.map(p => p.id === ep.id ? { ...p, name: ep.name.trim() || p.name, phone: ep.phone, points: Number.isNaN(newPts) ? p.points : newPts } : p));
      setEditPlayer(null);
      notify("Spiller opdateret");
      return;
    }
    try {
      if (ep.name.trim() !== orig.name || ep.phone !== (orig.phone || "")) await adminUpdatePlayerApi(ep.id, ep.name, ep.phone);
      if (!Number.isNaN(newPts) && newPts !== orig.points) await adminSetPointsApi(ep.id, newPts, ep.reason);
      await reloadPlayers();
      setEditPlayer(null);
      notify("Spiller opdateret");
    } catch (e) { console.error(e); notify("Kunne ikke gemme ændringerne"); }
  };
  const deletePlayer = async (pid) => {
    if (demo) {
      setPlayers(ps => ps.filter(p => p.id !== pid));
      setConfirmDelete(null);
      notify("Spiller fjernet");
      return;
    }
    try {
      await adminDeletePlayerApi(pid);
      setConfirmDelete(null);
      await Promise.all([reloadPlayers(), reloadEvents()]);
      notify("Spiller fjernet");
    } catch (e) { console.error(e); notify("Kunne ikke fjerne spilleren"); }
  };

  /* ================= VIEWS ================= */
  const lastDelta = (p) => (p.history.length ? p.history[p.history.length - 1].delta : null);
  const Trend = ({ delta, light = false }) => {
    if (delta === null || delta === undefined) return null;
    if (delta === 0) return <span style={{ fontFamily: sans, fontSize: 12, fontWeight: 600, color: light ? "rgba(255,253,248,.7)" : C.muted }}>±0</span>;
    const up = delta > 0;
    const col = light ? (up ? C.ball : "#F1B9A4") : (up ? C.olive : C.clay);
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontFamily: sans, fontSize: 12, fontWeight: 600, color: col }}>
        <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden style={{ transform: up ? "none" : "rotate(180deg)" }}><path d="M5 1 L9.2 8.5 H0.8 Z" fill={col} /></svg>
        {up ? "+" : ""}{delta}
      </span>
    );
  };

  /* Faint court lines used as texture on hero cards. */
  const CourtLines = ({ opacity = 0.14 }) => (
    <svg aria-hidden viewBox="0 0 400 220" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity, pointerEvents: "none" }}>
      <g fill="none" stroke="#FFFDF8" strokeWidth="1.5">
        <rect x="150" y="-40" width="330" height="200" rx="10" transform="rotate(-14 315 60)" />
        <line x1="315" y1="-60" x2="315" y2="180" transform="rotate(-14 315 60)" />
        <line x1="215" y1="60" x2="415" y2="60" transform="rotate(-14 315 60)" />
      </g>
    </svg>
  );

  const renderRanking = () => {
    const myRank = rankOf(ME);
    const above = myRank > 1 ? ranked[myRank - 2] : null;
    const below = myRank < ranked.length ? ranked[myRank] : null;
    const gap = above ? above.points - me.points : 0;
    // How far through the stretch between the player below and the one above.
    const span = above && below ? Math.max(1, above.points - below.points) : null;
    const progress = !above ? 1 : span ? (me.points - below.points) / span : 0.5;
    const podium = ranked.length >= 3 ? [ranked[1], ranked[0], ranked[2]] : [];
    const rest = podium.length ? ranked.slice(3) : ranked;
    const openPlayer = (id) => { setViewPlayerId(id); setTab("profil"); };
    const steps = { 1: { h: 84, bg: "linear-gradient(180deg, #EBD9AE, #D6BB84)", ink: "#6A5223" }, 2: { h: 60, bg: "linear-gradient(180deg, #EFE8DC, #DDD2C0)", ink: C.mokkaDeep }, 3: { h: 44, bg: "linear-gradient(180deg, #F0DDD0, #E2C3B1)", ink: "#8A4A33" } };
    return (
      <div>
        <div style={{ padding: "24px 4px 16px" }}>
          <Eyebrow>Ranglisten · {center.name}</Eyebrow>
          <H size={30} style={{ marginTop: 6 }}>Sæsonen lige nu</H>
        </div>

        {/* Your position */}
        <div className="lp-press" role="button" tabIndex={0} onClick={() => openPlayer(ME)} onKeyDown={e => e.key === "Enter" && openPlayer(ME)} style={{ position: "relative", overflow: "hidden", borderRadius: 26, padding: "20px 22px 18px", background: G.hero, color: C.cream, boxShadow: "0 18px 40px rgba(46,37,25,.28)", cursor: "pointer" }}>
          <CourtLines />
          <div aria-hidden style={{ position: "absolute", right: -30, top: -40, width: 170, height: 170, borderRadius: 999, background: "radial-gradient(circle, rgba(216,227,107,.30), rgba(216,227,107,0) 65%)", animation: "lp-drift 9s ease-in-out infinite" }} />
          <div style={{ position: "relative", display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12 }}>
            <div>
              <div style={{ fontFamily: sans, fontSize: 11, fontWeight: 600, letterSpacing: ".18em", textTransform: "uppercase", opacity: .8 }}>Din placering</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
                <span style={{ fontFamily: serif, fontWeight: 700, fontSize: 52, lineHeight: 1, letterSpacing: "-.02em" }}><span style={{ fontSize: 28, opacity: .7, marginRight: 2 }}>#</span><CountUp value={myRank} duration={600} /></span>
                <span style={{ fontFamily: sans, fontSize: 14, opacity: .75 }}>af {ranked.length}</span>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: serif, fontWeight: 700, fontSize: 30, lineHeight: 1 }}><CountUp value={me.points} /></div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, marginTop: 5 }}>
                <span style={{ fontFamily: sans, fontSize: 10.5, letterSpacing: ".14em", textTransform: "uppercase", opacity: .75 }}>point</span>
                <Trend delta={lastDelta(me)} light />
              </div>
            </div>
          </div>
          <div style={{ position: "relative", marginTop: 16 }}>
            <Bar value={progress} height={7} fill={`linear-gradient(90deg, ${C.gold}, ${C.ball})`} track="rgba(255,253,248,.18)" />
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 8, fontFamily: sans, fontSize: 12.5, opacity: .9 }}>
              <span>{above ? <><b>{gap === 0 ? "Lige" : gap + " point"}</b> {gap === 0 ? "med" : "op til"} {firstName(above.name)} (#{myRank - 1})</> : <b>Du fører ranglisten</b>}</span>
              <span style={{ opacity: .75, whiteSpace: "nowrap" }}>{me.wins} S · {me.losses} N</span>
            </div>
          </div>
        </div>

        {/* Podium */}
        {podium.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.12fr 1fr", gap: 10, alignItems: "end", margin: "26px 2px 0" }}>
            {podium.map((p) => {
              const place = rankOf(p.id), st = steps[place], first = place === 1;
              return (
                <button key={p.id} className="lp-btn lp-fade" onClick={() => openPlayer(p.id)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", minWidth: 0, animationDelay: `${0.1 + (place - 1) * 0.08}s` }}>
                  {first && <Crown size={20} color={C.gold} fill={C.gold} className="lp-pop" style={{ marginBottom: 4, animationDelay: ".5s" }} />}
                  <Avatar name={p.name} size={first ? 66 : 52} ring ringColor={first ? C.gold : p.id === ME ? C.court : C.line} />
                  <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 13.5, color: C.espresso, marginTop: 8, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{firstName(p.name)}{p.id === ME ? " (dig)" : ""}</div>
                  <div style={{ fontFamily: serif, fontWeight: 700, fontSize: first ? 19 : 16.5, color: C.espresso, marginTop: 1 }}>{p.points}</div>
                  <div className="lp-growy" style={{ width: "100%", height: st.h, marginTop: 8, borderRadius: "16px 16px 6px 6px", background: st.bg, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 8, fontFamily: serif, fontWeight: 700, fontSize: first ? 26 : 20, color: st.ink, boxShadow: "inset 0 1px 0 rgba(255,255,255,.6)", animationDelay: `${0.15 + (3 - place) * 0.1}s` }}>{place}</div>
                </button>
              );
            })}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "24px 4px 10px" }}>
          <Eyebrow>{podium.length ? "Resten af feltet" : "Alle spillere"}</Eyebrow>
          <span style={{ fontFamily: sans, fontSize: 12, color: C.muted }}>{players.length} spillere · alle starter på 500</span>
        </div>
        <div className="lp-stagger" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rest.map((p) => {
            const place = rankOf(p.id), mine = p.id === ME;
            return (
              <Card key={p.id} onClick={() => openPlayer(p.id)} pad={12} style={{ display: "flex", alignItems: "center", gap: 12, ...(mine ? { border: `1.5px solid ${C.court}`, background: G.cool } : {}) }}>
                <div style={{ width: 28, textAlign: "center", fontFamily: serif, fontWeight: 700, fontSize: 16, color: mine ? C.courtDeep : C.muted }}>{place}</div>
                <Avatar name={p.name} size={40} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 15, color: C.espresso, display: "flex", alignItems: "center", gap: 7 }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>{mine && <Tag tone="court">dig</Tag>}
                  </div>
                  <div style={{ fontFamily: sans, fontSize: 12.5, color: C.muted, marginTop: 2, display: "flex", alignItems: "center", gap: 8 }}>{p.wins} S · {p.losses} N <Trend delta={lastDelta(p)} /></div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontFamily: serif, fontWeight: 700, fontSize: 19, color: C.espresso, lineHeight: 1.1 }}>{p.points}</div>
                  <div style={{ fontFamily: sans, fontSize: 10, letterSpacing: ".12em", color: C.muted, textTransform: "uppercase" }}>point</div>
                </div>
                <ChevronRight size={17} color={C.muted} style={{ opacity: .5 }} />
              </Card>
            );
          })}
        </div>
      </div>
    );
  };

  /* ---- My account: phone, SMS consent, data export, deletion (GDPR) ---- */
  const accountAction = async (fn) => {
    if (accountBusy) return;
    setAccountBusy(true);
    try { await fn(); } finally { setAccountBusy(false); }
  };
  const savePhone = () => accountAction(async () => {
    const phone = phoneDraft.trim();
    if (phone && !/^\+?[\d\s-]{8,16}$/.test(phone)) { notify("Det ligner ikke et telefonnummer"); return; }
    try {
      if (!demo) await updateMyPhoneApi(ME, phone);
      setAccount(a => ({ ...a, phone }));
      notify(phone ? "Dit mobilnummer er gemt" : "Dit mobilnummer er fjernet");
    } catch (e) { console.error(e); notify("Kunne ikke gemme nummeret – prøv igen"); }
  });
  const toggleSms = (on) => accountAction(async () => {
    if (on && !account?.phone) { notify("Tilføj et mobilnummer først"); return; }
    try {
      if (!demo) await setSmsConsentApi(on);
      setAccount(a => ({ ...a, smsConsent: on }));
      notify(on ? "Du får SMS ved ledige pladser og aflysninger" : "Du får ikke længere SMS fra os");
    } catch (e) { console.error(e); notify("Kunne ikke gemme dit valg – prøv igen"); }
  });
  const downloadMyData = () => accountAction(async () => {
    try {
      const data = demo ? { demo: true, profile: playersById[ME] } : await exportMyDataApi();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `la-pista-mine-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { console.error(e); notify("Kunne ikke hente dine data – prøv igen"); }
  });
  const deleteMyAccount = () => accountAction(async () => {
    if (demo) { setConfirmDeleteAccount(false); notify("Demo: kontoen ville nu være slettet"); return; }
    try {
      await deleteMyAccountApi();
      await supabase.auth.signOut();
    } catch (e) {
      console.error(e);
      const m = String(e?.message || "");
      setConfirmDeleteAccount(false);
      notify(m.includes("ACTIVE_MATCHDAY") ? "Du kan ikke slette din konto midt i en kampdag"
        : m.includes("LAST_ADMIN") ? "Du er centerets eneste admin – udnævn en anden admin først"
        : "Kunne ikke slette kontoen – prøv igen");
    }
  });

  const signOut = async () => {
    if (demo) { notify("Demo: du ville nu blive logget ud"); return; }
    try { await supabase.auth.signOut(); } catch (e) { console.error(e); notify("Kunne ikke logge ud – prøv igen"); }
  };

  const renderAccount = () => {
    if (!account) return <Card style={{ marginTop: 12 }}><div style={{ fontFamily: sans, fontSize: 13.5, color: C.muted }}>Henter dine indstillinger…</div></Card>;
    const phoneChanged = phoneDraft.trim() !== (account.phone || "");
    const row = { display: "flex", alignItems: "center", gap: 12, padding: "14px 0", borderTop: `1px solid ${C.line}` };
    return (
      <>
        <div style={{ padding: "22px 4px 10px" }}><Eyebrow>Konto</Eyebrow><H size={19} style={{ marginTop: 4 }}>Indstillinger og privatliv</H></div>
        <Card>
          <div style={{ paddingBottom: 14 }}>
            <label htmlFor="my-phone" style={{ fontFamily: sans, fontWeight: 600, fontSize: 14, color: C.espresso }}>Mobilnummer</label>
            <div style={{ fontFamily: sans, fontSize: 12.5, color: C.muted, margin: "2px 0 8px" }}>Kun du og centerets personale kan se det.</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input id="my-phone" value={phoneDraft} onChange={e => setPhoneDraft(e.target.value)} type="tel" autoComplete="tel" placeholder="+45 12 34 56 78" style={{ ...adminInput, fontSize: 16, flex: 1, minWidth: 0 }} />
              {phoneChanged && <Btn small onClick={savePhone} disabled={accountBusy}><Check size={14} /> Gem</Btn>}
            </div>
          </div>
          <label style={{ ...row, cursor: "pointer" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 14, color: C.espresso }}>SMS-beskeder</div>
              <div style={{ fontFamily: sans, fontSize: 12.5, color: C.muted, marginTop: 2, lineHeight: 1.45 }}>Når der bliver en plads ledig til dig, eller en kampdag bliver aflyst.</div>
            </div>
            <input type="checkbox" role="switch" checked={!!account.smsConsent} disabled={accountBusy} onChange={e => toggleSms(e.target.checked)} style={{ width: 22, height: 22, accentColor: C.mokka, flexShrink: 0 }} />
          </label>
          <div style={row}>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 14, color: C.espresso }}>Dine data</div>
              <div style={{ fontFamily: sans, fontSize: 12.5, color: C.muted, marginTop: 2 }}>Hent alt, vi har gemt om dig, som en fil.</div>
            </div>
            <Btn small kind="soft" onClick={downloadMyData} disabled={accountBusy}>Download</Btn>
          </div>
          <div style={row}>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 14, color: C.espresso }}>Privatlivspolitik</div>
              <div style={{ fontFamily: sans, fontSize: 12.5, color: C.muted, marginTop: 2 }}>Hvad vi gemmer, og hvorfor.</div>
            </div>
            <a href={PRIVACY_URL} target="_blank" rel="noreferrer" style={{ fontFamily: sans, fontWeight: 600, fontSize: 13, color: C.mokkaDeep, textDecoration: "none", padding: "8px 16px", borderRadius: 999, background: C.beige }}>Læs</a>
          </div>
          <div style={row}>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 14, color: C.espresso }}>Log ud</div>
              <div style={{ fontFamily: sans, fontSize: 12.5, color: C.muted, marginTop: 2 }}>Fx hvis du har lånt en andens telefon.</div>
            </div>
            <Btn small kind="ghost" onClick={signOut}>Log ud</Btn>
          </div>
          <div style={{ ...row, paddingBottom: 0, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 14, color: C.clay }}>Slet min konto</div>
              <div style={{ fontFamily: sans, fontSize: 12.5, color: C.muted, marginTop: 2, lineHeight: 1.45 }}>
                {confirmDeleteAccount ? "Din profil, dine point, tilmeldinger og beskeder slettes for altid. Det kan ikke fortrydes." : "Fjerner din profil og dit login permanent."}
              </div>
            </div>
            {confirmDeleteAccount ? (
              <div style={{ display: "flex", gap: 6 }}>
                <Btn small kind="danger" onClick={deleteMyAccount} disabled={accountBusy}>Ja, slet</Btn>
                <Btn small kind="ghost" onClick={() => setConfirmDeleteAccount(false)}>Fortryd</Btn>
              </div>
            ) : (
              <Btn small kind="danger" onClick={() => setConfirmDeleteAccount(true)}>Slet</Btn>
            )}
          </div>
        </Card>
      </>
    );
  };

  const renderProfile = () => {
    const p = playersById[viewPlayerId || ME];
    const own = p.id === ME;
    const chart = p.history.map(h => ({ d: shortDate(h.date), point: h.after }));
    const winrate = Math.round((p.wins / Math.max(1, p.wins + p.losses)) * 100);
    const rank = rankOf(p.id);
    const last = p.history[p.history.length - 1];
    return (
      <div>
        {!own && backBtn("Rangliste", () => { setViewPlayerId(null); setTab("rangliste"); })}
        <div style={{ position: "relative", overflow: "hidden", borderRadius: 26, padding: "22px 20px 18px", marginTop: own ? 22 : 10, background: G.hero, color: C.cream, boxShadow: "0 18px 40px rgba(46,37,25,.26)" }}>
          <CourtLines />
          <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 14 }}>
            <Avatar name={p.name} size={66} ring ringColor={rank === 1 ? C.gold : C.ball} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: serif, fontWeight: 600, fontSize: 24, lineHeight: 1.15, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>{p.name}{rank === 1 && <Crown size={18} color={C.ball} fill={C.ball} />}</div>
              <div style={{ fontFamily: sans, fontSize: 13, opacity: .8, marginTop: 4 }}>Medlem siden {new Date(p.joined).toLocaleDateString("da-DK", { month: "long", year: "numeric" })}</div>
            </div>
            {own && <button className="lp-btn" onClick={signOut} style={{ alignSelf: "flex-start", background: "rgba(255,253,248,.14)", border: "1px solid rgba(255,253,248,.24)", color: C.cream, fontFamily: sans, fontWeight: 600, fontSize: 12.5, padding: "7px 13px", borderRadius: 999, cursor: "pointer", whiteSpace: "nowrap" }}>Log ud</button>}
          </div>
          <div style={{ position: "relative", display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginTop: 18 }}>
            {[[<><span style={{ fontSize: 15, opacity: .7 }}>#</span><CountUp value={rank} duration={600} /></>, "Placering"], [<CountUp value={p.points} />, "Point"], [<CountUp value={winrate} suffix="%" />, "Sejrsrate"]].map(([v, l]) => (
              <div key={l} style={{ textAlign: "center", background: "rgba(255,253,248,.12)", border: "1px solid rgba(255,253,248,.16)", borderRadius: 16, padding: "11px 4px 10px", backdropFilter: "blur(4px)" }}>
                <div style={{ fontFamily: serif, fontWeight: 700, fontSize: 23, lineHeight: 1.1 }}>{v}</div>
                <div style={{ fontFamily: sans, fontSize: 10, fontWeight: 600, letterSpacing: ".14em", textTransform: "uppercase", opacity: .75, marginTop: 4 }}>{l}</div>
              </div>
            ))}
          </div>
          <div style={{ position: "relative", marginTop: 14 }}>
            <div style={{ display: "flex", height: 7, borderRadius: 999, overflow: "hidden", background: "rgba(255,253,248,.18)" }}>
              <div className="lp-grow" style={{ width: `${winrate}%`, background: `linear-gradient(90deg, ${C.gold}, ${C.ball})`, borderRadius: 999 }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontFamily: sans, fontSize: 12, opacity: .85, marginTop: 7 }}><span><b>{p.wins}</b> sejre</span><span><b>{p.losses}</b> nederlag</span></div>
          </div>
        </div>
        {!own && <Btn kind="court" onClick={() => { openThread(p.id); setTab("beskeder"); }} style={{ width: "100%", marginTop: 12 }}><MessageCircle size={16} /> Skriv til {firstName(p.name)}</Btn>}
        <Card style={{ marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div><Eyebrow>Progression</Eyebrow><H size={19} style={{ marginTop: 4 }}>Pointudvikling</H></div>
            {p.history.length > 0 && <Tag tone={last.delta >= 0 ? "olive" : "clay"}><TrendingUp size={11} style={{ transform: last.delta >= 0 ? "none" : "scaleY(-1)" }} />{(last.delta >= 0 ? "+" : "") + last.delta} sidst</Tag>}
          </div>
          {chart.length < 2 ? (
            <div style={{ fontFamily: sans, fontSize: 13.5, color: C.muted, textAlign: "center", padding: "30px 10px 20px", lineHeight: 1.5 }}>Kurven dukker op, når {own ? "du" : firstName(p.name)} har spillet et par kampdage.</div>
          ) : (
            <div style={{ height: 190, marginTop: 14, marginLeft: -12 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chart} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="pointFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={C.court} stopOpacity=".32" /><stop offset="1" stopColor={C.court} stopOpacity="0" /></linearGradient>
                    <linearGradient id="pointLine" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor={C.gold} /><stop offset="1" stopColor={C.court} /></linearGradient>
                  </defs>
                  <CartesianGrid stroke={C.line} strokeDasharray="3 6" vertical={false} />
                  <XAxis dataKey="d" tick={{ fontFamily: sans, fontSize: 11, fill: C.muted }} axisLine={{ stroke: C.line }} tickLine={false} />
                  <YAxis domain={["dataMin - 30", "dataMax + 30"]} tick={{ fontFamily: sans, fontSize: 11, fill: C.muted }} axisLine={false} tickLine={false} width={42} />
                  <Tooltip cursor={{ stroke: C.court, strokeOpacity: .35 }} contentStyle={{ fontFamily: sans, fontSize: 13, borderRadius: 14, border: `1px solid ${C.line}`, boxShadow: softShadow, background: C.cream }} labelStyle={{ color: C.muted }} formatter={(v) => [v + " point", ""]} separator="" />
                  <Area type="monotone" dataKey="point" stroke="url(#pointLine)" strokeWidth={3} fill="url(#pointFade)" dot={{ r: 3.5, fill: C.cream, stroke: C.court, strokeWidth: 2 }} activeDot={{ r: 6, fill: C.ball, stroke: C.courtDeep, strokeWidth: 2 }} animationDuration={900} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
        <div style={{ padding: "22px 4px 10px" }}><Eyebrow>Kamphistorik</Eyebrow><H size={19} style={{ marginTop: 4 }}>Seneste kampdage</H></div>
        <div className="lp-stagger" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {p.history.length === 0 && <Card pad={18} style={{ textAlign: "center", background: G.warm, fontFamily: sans, fontSize: 13.5, color: C.mokkaDeep, lineHeight: 1.5 }}>Ingen kampdage endnu. {own ? "Tilmeld dig en ranglistedag under Kampe." : ""}</Card>}
          {[...p.history].reverse().map((h, hi) => {
            const key = p.id + "-" + hi;
            const open = expandedHist === key;
            return (
              <Card key={hi} pad={16} onClick={() => {
                setExpandedHist(open ? null : key);
                if (!open && !demo && h.eventId && !histSets[key]) {
                  fetchPlayerSetsApi(h.eventId, p.id)
                    .then(rows => setHistSets(hs => ({ ...hs, [key]: rows })))
                    .catch(e => console.error("Could not load the sets for this day:", e));
                }
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <div>
                    <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 14.5, color: C.espresso }}>{h.title}</div>
                    <div style={{ fontFamily: sans, fontSize: 12.5, color: C.muted, marginTop: 2 }}>{fmtDate(h.date)}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ fontFamily: serif, fontWeight: 700, fontSize: 18, color: h.delta >= 0 ? C.olive : C.clay }}>{h.delta >= 0 ? "+" : ""}{h.delta}</div>
                    <ChevronRight size={17} color={C.muted} style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .2s" }} />
                  </div>
                </div>
                {open && (
                  <div className="lp-fade" style={{ marginTop: 12 }}>
                    <div style={{ fontFamily: sans, fontSize: 12, color: C.muted, marginBottom: 8 }}>{fmtDateLong(h.date)}{h.placement ? ` · nr. ${h.placement} på banen` : ""} · {h.after} point efter dagen</div>
                    {!demo && h.eventId && !histSets[key] && <div style={{ fontFamily: sans, fontSize: 12, color: C.muted, marginBottom: 8 }}>Henter sæt …</div>}
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {(histSets[key] || h.sets).map((sx, si) => (
                        <div key={si} style={{ display: "flex", alignItems: "center", gap: 10, background: C.sand, borderRadius: 12, padding: "8px 12px" }}>
                          <span style={{ fontFamily: sans, fontSize: 10.5, fontWeight: 700, letterSpacing: ".08em", color: C.muted, width: 46, textTransform: "uppercase" }}>{sx.label}</span>
                          <span style={{ flex: 1, fontFamily: sans, fontSize: 12.5, color: C.espresso }}>m. {firstName(sx.partner || playersById[sx.partnerId]?.name || "—")} <span style={{ color: C.muted }}>vs. {(sx.opps || (sx.oppIds || []).map(id => playersById[id]?.name || "—")).map(firstName).join(" & ")}</span></span>
                          <span style={{ fontFamily: serif, fontWeight: 700, fontSize: 14.5, color: sx.won ? C.olive : C.clay }}>{sx.score[0]}–{sx.score[1]}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
        {own && renderAccount()}
      </div>
    );
  };

  const renderMessages = () => {
    if (activeThread) {
      const other = playersById[activeThread];
      const msgs = threads[activeThread] || [];
      const send = async () => {
        const text = msgDraft.trim();
        if (!text) return;
        setMsgDraft("");
        if (demo) {
          setThreads(t => ({ ...t, [activeThread]: [...(t[activeThread] || []), { from: "me", text, time: new Date().toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" }) }] }));
          return;
        }
        try {
          const msg = await sendMessageApi(center.id, ME, activeThread, text);
          setThreads(t => ({ ...t, [activeThread]: [...(t[activeThread] || []), msg] }));
        } catch (e) {
          console.error(e);
          notify("Beskeden blev ikke sendt");
          setMsgDraft(text);
        }
      };
      return (
        <div style={{ display: "flex", flexDirection: "column", height: "calc(100dvh - 158px - env(safe-area-inset-top) - env(safe-area-inset-bottom))", marginBottom: "calc(-100px - env(safe-area-inset-bottom))" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 0 12px", borderBottom: `1px solid ${C.line}` }}>
            <button className="lp-btn" aria-label="Tilbage til indbakken" onClick={() => setActiveThread(null)} style={{ background: C.cream, border: `1px solid ${C.line}`, borderRadius: 999, width: 38, height: 38, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><ArrowLeft size={18} color={C.mokka} /></button>
            <div role="button" tabIndex={0} onClick={() => { setViewPlayerId(other.id); setTab("profil"); }} onKeyDown={e => e.key === "Enter" && (setViewPlayerId(other.id), setTab("profil"))} style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0, cursor: "pointer" }}>
              <Avatar name={other.name} size={40} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 15, color: C.espresso }}>{other.name}</div>
                <div style={{ fontFamily: sans, fontSize: 12, color: C.muted }}>#{rankOf(other.id)} · {other.points} point</div>
              </div>
            </div>
          </div>
          <div ref={threadEndRef} style={{ flex: 1, overflowY: "auto", padding: "16px 2px", display: "flex", flexDirection: "column", gap: 8 }}>
            {msgs.length === 0 && <div style={{ margin: "auto", textAlign: "center", fontFamily: sans, fontSize: 13.5, color: C.muted, lineHeight: 1.5 }}>Skriv til {firstName(other.name)} – f.eks. for at aftale en træningskamp.</div>}
            {msgs.map((m, i) => {
              const mine = m.from === "me";
              return (
                <div key={m.id || i} className="lp-fade" style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "80%" }}>
                  <div style={{ background: mine ? G.primary : C.cream, color: mine ? C.cream : C.espresso, border: mine ? "none" : `1px solid ${C.line}`, borderRadius: mine ? "20px 20px 6px 20px" : "20px 20px 20px 6px", padding: "10px 15px", fontFamily: sans, fontSize: 15, lineHeight: 1.45, boxShadow: softShadow, overflowWrap: "anywhere" }}>{m.text}</div>
                  <div style={{ fontFamily: sans, fontSize: 10.5, color: C.muted, marginTop: 3, padding: "0 6px", textAlign: mine ? "right" : "left" }}>{m.time}</div>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 8, padding: "10px 0 12px" }}>
            <input value={msgDraft} onChange={e => setMsgDraft(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} placeholder="Skriv en besked …" aria-label="Besked" enterKeyHint="send" style={{ flex: 1, minWidth: 0, fontFamily: sans, fontSize: 16, padding: "12px 18px", borderRadius: 999, border: `1px solid ${C.line}`, background: C.cream, color: C.espresso, outline: "none" }} />
            <button className="lp-btn" aria-label="Send" onClick={send} disabled={!msgDraft.trim()} style={{ width: 48, height: 48, borderRadius: 999, background: G.court, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 8px 18px rgba(44,89,97,.3)", opacity: msgDraft.trim() ? 1 : .45, flexShrink: 0 }}><Send size={18} color={C.cream} /></button>
          </div>
        </div>
      );
    }
    const threadIds = Object.keys(threads).filter(id => playersById[id] && threads[id].length > 0);
    return (
      <div>
        <div style={{ padding: "24px 4px 16px" }}><Eyebrow>Beskeder</Eyebrow><H size={30} style={{ marginTop: 6 }}>Indbakke</H></div>
        <div className="lp-stagger" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {threadIds.map(id => {
            const last = threads[id][threads[id].length - 1];
            const unread = threads[id].filter(m => m.unread).length;
            return (
              <Card key={id} pad={14} onClick={() => openThread(id)} style={{ display: "flex", gap: 13, alignItems: "center", ...(unread ? { border: `1.5px solid ${C.court}`, background: G.cool } : {}) }}>
                <Avatar name={playersById[id].name} size={46} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: sans, fontWeight: unread ? 700 : 600, fontSize: 15, color: C.espresso }}>{playersById[id].name}</div>
                  <div style={{ fontFamily: sans, fontSize: 13.5, fontWeight: unread ? 600 : 400, color: unread ? C.espresso : C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 2 }}>{last.from === "me" ? "Dig: " : ""}{last.text}</div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5 }}>
                  <div style={{ fontFamily: sans, fontSize: 11.5, color: C.muted }}>{last.time}</div>
                  {unread > 0 && <span style={{ minWidth: 20, height: 20, padding: "0 6px", borderRadius: 999, background: C.ball, color: "#2F340C", fontFamily: sans, fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{unread}</span>}
                </div>
              </Card>
            );
          })}
          <Card pad={18} onClick={() => setTab("rangliste")} style={{ display: "flex", alignItems: "center", gap: 14, background: G.warm }}>
            <div style={{ width: 42, height: 42, borderRadius: 999, background: C.cream, border: `1px solid ${C.line}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><MessageCircle size={19} color={C.mokka} /></div>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 14.5, color: C.espresso }}>{threadIds.length ? "Ny samtale" : "Ingen beskeder endnu"}</div>
              <div style={{ fontFamily: sans, fontSize: 13, color: C.muted, marginTop: 2, lineHeight: 1.4 }}>Find en spiller på ranglisten, og tryk "Besked" på profilen.</div>
            </div>
            <ChevronRight size={17} color={C.muted} style={{ opacity: .6 }} />
          </Card>
        </div>
      </div>
    );
  };

  const backBtn = (label, onClick) => (
    <button className="lp-btn" onClick={onClick} style={{ background: "none", border: "none", color: C.mokka, fontFamily: sans, fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", gap: 6, padding: "18px 8px 4px 0", cursor: "pointer" }}><ArrowLeft size={16} /> {label}</button>
  );

  /* Calendar tile: weekday, day number, month. */
  const DateTile = ({ iso, today, light = false }) => {
    const d = new Date(iso + "T12:00:00");
    const wd = d.toLocaleDateString("da-DK", { weekday: "short" }).replace(".", "");
    const mo = d.toLocaleDateString("da-DK", { month: "short" }).replace(".", "");
    const on = today || light;
    return (
      <div style={{ width: 58, flexShrink: 0, borderRadius: 16, padding: "8px 0 9px", textAlign: "center", background: light ? "rgba(255,253,248,.16)" : today ? G.court : G.warm, border: on ? "1px solid rgba(255,255,255,.22)" : `1px solid ${C.line}`, color: on ? C.cream : C.espresso, boxShadow: today && !light ? "0 8px 18px rgba(44,89,97,.25)" : "none" }}>
        <div style={{ fontFamily: sans, fontSize: 10, fontWeight: 600, letterSpacing: ".14em", textTransform: "uppercase", opacity: on ? .85 : 1, color: on ? C.cream : C.muted }}>{wd}</div>
        <div style={{ fontFamily: serif, fontWeight: 700, fontSize: 24, lineHeight: 1.05 }}>{d.getDate()}</div>
        <div style={{ fontFamily: sans, fontSize: 10.5, fontWeight: 500, letterSpacing: ".06em", opacity: on ? .85 : 1, color: on ? C.cream : C.muted }}>{mo}</div>
      </div>
    );
  };

  const spotsLabel = (ev) => {
    const free = ev.capacity - ev.registered.length;
    return free <= 0 ? "Fuldt booket" : free === 1 ? "1 plads tilbage" : `${free} pladser tilbage`;
  };

  const renderEventDetail = (ev) => {
    const isIn = ev.registered.includes(ME), onWL = ev.waitlist.includes(ME);
    const full = ev.registered.length >= ev.capacity;
    const today = ev.date === TODAY;
    const sorted = ev.registered.map(id => playersById[id]).sort((a, b) => b.points - a.points);
    return (
      <div>
        {backBtn("Alle kampdage", () => setEventDetailId(null))}
        <div style={{ position: "relative", overflow: "hidden", borderRadius: 26, padding: 20, marginTop: 10, background: G.hero, color: C.cream, boxShadow: "0 18px 40px rgba(46,37,25,.26)" }}>
          <CourtLines />
          <div style={{ position: "relative", display: "flex", gap: 14, alignItems: "center" }}>
            <DateTile iso={ev.date} light />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {today && <Tag tone="ball"><BallDot size={7} live />I dag</Tag>}
                {isIn && <Tag tone="ball"><Check size={11} />Tilmeldt</Tag>}
                {onWL && <Tag tone="gold">Venteliste nr. {ev.waitlist.indexOf(ME) + 1}</Tag>}
              </div>
              <div style={{ fontFamily: serif, fontWeight: 600, fontSize: 23, lineHeight: 1.15, marginTop: 6 }}>{ev.title}</div>
              <div style={{ fontFamily: sans, fontSize: 13, opacity: .85, marginTop: 4 }}>{fmtDateLong(ev.date)}</div>
            </div>
          </div>
          <div style={{ position: "relative", display: "flex", gap: 16, flexWrap: "wrap", marginTop: 16, fontFamily: sans, fontSize: 13, opacity: .92 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Clock size={14} />kl. {ev.time} · 2 timer</span>
            {ev.courtNames?.length > 0 && <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Swords size={14} />{ev.courtNames.join(" · ")}</span>}
          </div>
          <div style={{ position: "relative", marginTop: 14 }}>
            <Bar value={ev.registered.length / ev.capacity} height={7} fill={`linear-gradient(90deg, ${C.gold}, ${C.ball})`} track="rgba(255,253,248,.18)" />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 7, fontFamily: sans, fontSize: 12.5 }}>
              <span><b>{ev.registered.length}</b> af {ev.capacity} pladser</span>
              <span style={{ opacity: .8 }}>{spotsLabel(ev)}{ev.waitlist.length > 0 ? ` · ${ev.waitlist.length} på venteliste` : ""}</span>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, margin: "14px 0 20px" }}>
          {today && isIn && isPlayable(ev) && <Btn kind="court" onClick={() => startMatchday(ev)} style={{ flex: 1 }}><Swords size={16} /> Gå til kampdagen</Btn>}
          {!isIn && !onWL && <Btn kind={full ? "soft" : "primary"} onClick={() => joinEvent(ev.id)} style={{ flex: 1 }}>{full ? "Skriv på venteliste" : "Tilmeld dig"}</Btn>}
          {(isIn || onWL) && (onWL || canSelfCancel(ev)
            ? <Btn kind="ghost" onClick={() => leaveEvent(ev.id)} style={{ flex: 1 }}>{onWL ? "Forlad venteliste" : "Afmeld"}</Btn>
            : <div style={{ flex: 1, alignSelf: "center", fontFamily: sans, fontSize: 12, color: C.muted, textAlign: "center", lineHeight: 1.4, padding: "8px 4px" }}>Afmelding er lukket (&lt;24 t) – kontakt centeret for afbud</div>)}
        </div>
        {ev.pendingOffer && <div style={{ marginBottom: 18 }}><OfferBanner ev={ev} margin={0} /></div>}
        <Eyebrow style={{ padding: "0 4px" }}>Tilmeldte spillere ({ev.registered.length})</Eyebrow>
        <div className="lp-stagger" style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
          {sorted.map((p, i) => (
            <React.Fragment key={p.id}>
              {/* Level matching: every four players form a court. */}
              {i % 4 === 0 && sorted.length >= 4 && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: i ? "8px 4px 0" : "0 4px", animation: "none" }}>
                  <span style={{ fontFamily: sans, fontSize: 10.5, fontWeight: 600, letterSpacing: ".14em", textTransform: "uppercase", color: i + 4 <= sorted.length ? C.court : C.muted }}>{i + 4 <= sorted.length ? ((ev.courtNames && ev.courtNames[i / 4]) || "Bane " + (i / 4 + 1)) : "Mangler spillere til en bane"}</span>
                  <span style={{ flex: 1, height: 1, background: C.line }} />
                  {i === 0 && <span style={{ fontFamily: sans, fontSize: 11, color: C.muted }}>foreløbig fordeling</span>}
                </div>
              )}
              <Card pad={11} onClick={() => { setViewPlayerId(p.id); setTab("profil"); }} style={{ display: "flex", alignItems: "center", gap: 12, ...(p.id === ME ? { border: `1.5px solid ${C.court}`, background: G.cool } : {}) }}>
                <Avatar name={p.name} size={36} />
                <div style={{ flex: 1, minWidth: 0, fontFamily: sans, fontWeight: 600, fontSize: 14, color: C.espresso, display: "flex", alignItems: "center", gap: 7 }}><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>{p.id === ME && <Tag tone="court">dig</Tag>}</div>
                <div style={{ fontFamily: serif, fontWeight: 700, fontSize: 16, color: C.espresso }}>{p.points} <span style={{ fontFamily: sans, fontSize: 10.5, color: C.muted, fontWeight: 500 }}>point</span></div>
              </Card>
            </React.Fragment>
          ))}
          {ev.registered.length === 0 && <Card pad={18} style={{ textAlign: "center", background: G.warm, fontFamily: sans, fontSize: 13.5, color: C.mokkaDeep }}>Ingen tilmeldte endnu – vær den første!</Card>}
        </div>
        {ev.waitlist.length > 0 && (
          <>
            <Eyebrow style={{ padding: "20px 4px 0" }}>Venteliste ({ev.waitlist.length})</Eyebrow>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
              {ev.waitlist.map((pid, i) => (
                <Card key={pid} pad={11} style={{ display: "flex", alignItems: "center", gap: 12, background: C.cream + "b0", borderStyle: "dashed" }}>
                  <span style={{ fontFamily: serif, fontWeight: 700, fontSize: 14, color: C.muted, width: 18, textAlign: "center" }}>{i + 1}</span>
                  <Avatar name={playersById[pid].name} size={32} />
                  <div style={{ flex: 1, fontFamily: sans, fontWeight: 500, fontSize: 13.5, color: C.espresso }}>{playersById[pid].name}{pid === ME ? " (dig)" : ""}</div>
                  <span style={{ fontFamily: sans, fontSize: 12, color: C.muted }}>{playersById[pid].points} point</span>
                </Card>
              ))}
            </div>
          </>
        )}
      </div>
    );
  };

  /* A freed spot is offered to one player at a time. The player who holds
     the offer sees the two buttons; everyone else just sees that the spot
     is spoken for. */
  const OfferBanner = ({ ev, margin }) => {
    const mine = ev.pendingOffer === ME;
    const holder = playersById[ev.pendingOffer];
    return (
      <div style={{ marginTop: margin, background: C.gold + "1c", border: `1px dashed ${C.gold}`, borderRadius: 14, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Smartphone size={16} color="#8a6b3c" />
        <span style={{ flex: 1, minWidth: 150, fontFamily: sans, fontSize: 12.5, color: "#8a6b3c" }}>
          {mine
            ? <>Du er tilbudt en ledig plads{ev.offerExpiresAt ? <> – svar inden <b>{fmtDeadline(ev.offerExpiresAt)}</b></> : null}</>
            : <>Plads tilbudt via SMS til {firstName(holder?.name || "en spiller")}</>}
        </span>
        {mine && <Btn small onClick={() => acceptOffer(ev.id)}>Tag pladsen</Btn>}
        {mine && <Btn small kind="ghost" onClick={() => declineOffer(ev.id)}>Nej tak</Btn>}
        {!mine && demo && <Btn small kind="soft" onClick={() => acceptOffer(ev.id)}>Simulér accept</Btn>}
      </div>
    );
  };

  const renderEvents = () => {
    const detail = events.find(e => e.id === eventDetailId && e.status !== "afsluttet");
    if (detail) return renderEventDetail(detail);
    const upcoming = events.filter(e => e.status !== "afsluttet");
    return (
    <div>
      <div style={{ padding: "24px 4px 16px" }}>
        <Eyebrow>Kommende kampe</Eyebrow>
        <H size={30} style={{ marginTop: 6 }}>Ranglistedage</H>
        <p style={{ fontFamily: sans, color: C.muted, fontSize: 14, margin: "8px 0 0", lineHeight: 1.5 }}>Er der fyldt, kommer du på venteliste og får besked, når en plads bliver ledig.</p>
      </div>
      <div className="lp-stagger" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {upcoming.length === 0 && (
          <Card pad={26} style={{ textAlign: "center", background: G.warm }}>
            <Calendar size={26} color={C.mokka} />
            <div style={{ fontFamily: serif, fontWeight: 600, fontSize: 18, marginTop: 8 }}>Ingen kampdage lige nu</div>
            <div style={{ fontFamily: sans, fontSize: 13.5, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>Centeret har ikke lagt nye ranglistedage op endnu. Kig forbi igen snart.</div>
          </Card>
        )}
        {upcoming.map(ev => {
          const isIn = ev.registered.includes(ME), onWL = ev.waitlist.includes(ME);
          const full = ev.registered.length >= ev.capacity;
          const today = ev.date === TODAY;
          const fill = ev.registered.length / ev.capacity;
          return (
            <Card key={ev.id} pad={16} style={today ? { border: `1.5px solid ${C.court}`, background: G.cool, boxShadow: "0 14px 34px rgba(44,89,97,.16)" } : {}}>
              <div role="button" tabIndex={0} onClick={() => setEventDetailId(ev.id)} onKeyDown={e => e.key === "Enter" && setEventDetailId(ev.id)} style={{ display: "flex", gap: 14, alignItems: "center", cursor: "pointer" }}>
                <DateTile iso={ev.date} today={today} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", minHeight: 22 }}>
                    {today && <Tag tone="ball"><BallDot size={7} live />I dag</Tag>}
                    {isIn && <Tag tone="olive"><Check size={11} />Tilmeldt</Tag>}
                    {onWL && <Tag tone="gold">Venteliste nr. {ev.waitlist.indexOf(ME) + 1}</Tag>}
                    {full && !isIn && !onWL && <Tag tone="clay">Fuldt</Tag>}
                  </div>
                  <H size={19} style={{ marginTop: 4 }}>{ev.title}</H>
                  <div style={{ fontFamily: sans, fontSize: 13, color: C.muted, marginTop: 3, display: "inline-flex", alignItems: "center", gap: 5 }}><Clock size={13} />kl. {ev.time} · 2 timer</div>
                </div>
                <ChevronRight size={18} color={C.muted} style={{ opacity: .6, flexShrink: 0 }} />
              </div>

              <div style={{ marginTop: 14 }}>
                <Bar value={fill} fill={full ? `linear-gradient(90deg, ${C.gold}, ${C.clay})` : G.bar} />
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", minWidth: 0 }}>
                    {ev.registered.slice(0, 5).map((pid, i) => <div key={pid} style={{ marginLeft: i ? -6 : 0 }}><Avatar name={playersById[pid].name} size={28} /></div>)}
                    {ev.registered.length > 5 && <div style={{ marginLeft: -6, minWidth: 28, height: 28, padding: "0 6px", borderRadius: 999, background: C.espresso, color: C.cream, fontFamily: sans, fontSize: 10.5, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid rgba(255,255,255,.7)" }}>+{ev.registered.length - 5}</div>}
                  </div>
                  <div style={{ fontFamily: sans, fontSize: 12.5, color: C.muted, textAlign: "right" }}>
                    <b style={{ color: C.espresso }}>{ev.registered.length}/{ev.capacity}</b> · {spotsLabel(ev)}{ev.waitlist.length > 0 ? ` · ${ev.waitlist.length} venter` : ""}
                  </div>
                </div>
              </div>

              {ev.pendingOffer && <OfferBanner ev={ev} margin={12} />}
              <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap", alignItems: "center" }}>
                {today && isIn && isPlayable(ev) && <Btn kind="court" onClick={() => startMatchday(ev)} style={{ flex: 1 }}><Swords size={16} /> Gå til kampdagen</Btn>}
                {!isIn && !onWL && <Btn kind={full ? "soft" : "primary"} onClick={() => joinEvent(ev.id)} style={{ flex: 1 }}>{full ? "Skriv på venteliste" : "Tilmeld dig"}</Btn>}
                {(isIn || onWL) && (onWL || canSelfCancel(ev)
                  ? <Btn kind="ghost" onClick={() => leaveEvent(ev.id)} style={today && isIn ? {} : { flex: 1 }}>{onWL ? "Forlad venteliste" : "Afmeld"}</Btn>
                  : <div style={{ fontFamily: sans, fontSize: 12, color: C.muted, lineHeight: 1.4, padding: "4px", flexBasis: "100%", textAlign: "center" }}>Afmelding er lukket (&lt;24 t) – kontakt centeret</div>)}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
    );
  };

  const renderMatchday = () => {
    if (!matchday) return (
      <div style={{ padding: "70px 20px", textAlign: "center" }}>
        <div style={{ width: 70, height: 70, borderRadius: 999, background: G.warm, border: `1px solid ${C.line}`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}><Swords size={28} color={C.mokka} /></div>
        <H size={22}>Ingen aktiv kampdag</H>
        <p style={{ fontFamily: sans, fontSize: 14, color: C.muted, margin: "8px 0 20px", lineHeight: 1.5 }}>Start dagens ranglistedag fra oversigten.</p>
        <Btn onClick={() => setTab("kampe")}>Gå til Kampe</Btn>
      </div>
    );
    const md = matchday;
    const ev = events.find(e => e.id === md.eventId);
    const minsLeft = Math.min(120, Math.max(0, 120 - Math.floor((clock - md.startedAt) / 60000)));
    const courtLabel = (i) => (ev?.courtNames && ev.courtNames[i]) || "Bane " + (i + 1);
    const names = (ids) => ids.map(x => firstName(playersById[x].name)).join(" & ");

    if (md.stage === "lobby") return (
      <div>
        <div style={{ padding: "24px 4px 16px" }}>
          <Eyebrow>{ev.title} · kl. {ev.time}</Eyebrow>
          <H size={28} style={{ marginTop: 6 }}>Baner & niveaumatch</H>
          <p style={{ fontFamily: sans, color: C.muted, fontSize: 14, margin: "8px 0 0", lineHeight: 1.55 }}>De fire tætteste på point deler bane. Kampdagen varer <b style={{ color: C.espresso }}>2 timer</b> – I roterer makkere og spiller så mange sæt, I når.</p>
        </div>
        <div className="lp-stagger" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {md.courts.map((c, i) => {
            const mine = i === md.myCourtIdx;
            return (
              <Card key={i} pad={16} style={mine ? { background: G.court, border: "1px solid rgba(255,255,255,.18)", color: C.cream, boxShadow: "0 16px 34px rgba(44,89,97,.28)", position: "relative", overflow: "hidden" } : {}}>
                {mine && <CourtLines opacity={0.12} />}
                <div style={{ position: "relative", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontFamily: serif, fontWeight: 600, fontSize: 18, color: mine ? C.cream : C.espresso, display: "flex", alignItems: "center", gap: 8 }}>{courtLabel(i)}{mine && <Tag tone="ball">Din bane</Tag>}</div>
                  <span style={{ fontFamily: sans, fontSize: 12, color: mine ? "rgba(255,253,248,.8)" : C.muted }}>Ø {Math.round(c.reduce((a, id) => a + playersById[id].points, 0) / c.length)} point</span>
                </div>
                <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 7, marginTop: 12 }}>
                  {c.map(pid => (
                    <div key={pid} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <Avatar name={playersById[pid].name} size={30} />
                      <span style={{ flex: 1, fontFamily: sans, fontSize: 14, fontWeight: pid === ME ? 700 : 500, color: mine ? C.cream : C.espresso }}>{playersById[pid].name}{pid === ME ? " (dig)" : ""}</span>
                      <span style={{ fontFamily: sans, fontSize: 12.5, color: mine ? "rgba(255,253,248,.8)" : C.muted }}>{playersById[pid].points} p</span>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
        <div style={{ position: "sticky", bottom: "calc(88px + env(safe-area-inset-bottom))", marginTop: 16, zIndex: 5 }}>
          <Btn onClick={() => setMatchday({ ...md, stage: "bane", startedAt: Date.now() })} style={{ width: "100%", boxShadow: "0 12px 28px rgba(46,37,25,.38), inset 0 1px 0 rgba(255,255,255,.16)" }}><Swords size={17} /> Start kamp – {courtLabel(md.myCourtIdx)}</Btn>
        </div>
      </div>
    );

    const pr = currentPairing(md);
    const comboNo = (md.round % 3) + 1;
    const meLeft = pr.left.includes(ME);
    const myPartner = (meLeft ? pr.left : pr.right).find(x => x !== ME);

    if (md.stage === "bane") return (
      <div>
        <div style={{ padding: "22px 4px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Tag tone="court"><BallDot size={7} live />{courtLabel(md.myCourtIdx)}</Tag>
            <Tag tone="mokka">Sæt {md.round + 1}</Tag>
            <span style={{ marginLeft: "auto", fontFamily: sans, fontSize: 12.5, fontWeight: 600, color: minsLeft <= 10 ? C.clay : C.muted, display: "inline-flex", alignItems: "center", gap: 5 }}><Clock size={13} />{minsLeft} min tilbage</span>
          </div>
          <Bar value={1 - minsLeft / 120} height={5} fill={minsLeft <= 10 ? `linear-gradient(90deg, ${C.gold}, ${C.clay})` : G.bar} style={{ marginTop: 10 }} />
          <H size={26} style={{ marginTop: 16 }}>Din opstilling</H>
          <p style={{ fontFamily: sans, fontSize: 13.5, color: C.muted, margin: "5px 0 0" }}>Holdkombination {comboNo} af 3 · makkerne roterer efter hvert sæt</p>
        </div>
        <Card pad={12} style={{ overflow: "hidden" }}>
          <CourtSVG key={md.round} left={pr.left} right={pr.right} meId={ME} playersById={playersById} />
          <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "12px 4px 4px" }}>
            <Avatar name={playersById[myPartner].name} size={42} ring ringColor={C.court} />
            <div style={{ fontFamily: sans, fontSize: 14, color: C.espresso, lineHeight: 1.45 }}>
              Din makker er <b>{firstName(playersById[myPartner].name)}</b><br />
              <span style={{ color: C.muted, fontSize: 13 }}>I starter i <b style={{ color: C.courtDeep }}>{meLeft ? "venstre" : "højre"} side</b></span>
            </div>
          </div>
        </Card>
        <Btn kind="court" onClick={() => setMatchday({ ...md, stage: "score" })} style={{ width: "100%", marginTop: 14 }}>Sættet er spillet – indtast resultat</Btn>
        {md.results.length > 0 && (
          <>
            <Eyebrow style={{ padding: "22px 4px 8px" }}>Spillede sæt ({md.results.length})</Eyebrow>
            <div className="lp-stagger" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {md.results.map((r, i) => {
                const leftWon = r.score[0] > r.score[1];
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: sans, fontSize: 13, color: C.muted, background: C.cream, border: `1px solid ${C.line}`, borderRadius: 14, padding: "9px 14px" }}>
                    <span style={{ fontWeight: 700, letterSpacing: ".06em", fontSize: 10.5, color: C.court, width: 20 }}>S{i + 1}</span>
                    <span style={{ flex: 1, minWidth: 0 }}><span style={{ color: leftWon ? C.espresso : C.muted, fontWeight: leftWon ? 600 : 400 }}>{names(r.left)}</span> <span style={{ opacity: .6 }}>vs.</span> <span style={{ color: leftWon ? C.muted : C.espresso, fontWeight: leftWon ? 400 : 600 }}>{names(r.right)}</span></span>
                    <b style={{ fontFamily: serif, fontSize: 15, color: C.espresso }}>{r.score[0]}–{r.score[1]}</b>
                  </div>
                );
              })}
            </div>
          </>
        )}
        <Btn kind="ghost" disabled={md.results.length === 0} onClick={() => setMatchday({ ...md, stage: "point" })} style={{ width: "100%", marginTop: 16 }}><Trophy size={15} /> Afslut kampdag & beregn point</Btn>
        <div style={{ textAlign: "center", fontFamily: sans, fontSize: 12, color: C.muted, marginTop: 8, lineHeight: 1.45 }}>Når de 2 timer er gået: indtast jeres sidste sæt og afslut kampdagen her.</div>
      </div>
    );

    if (md.stage === "score") {
      const loserOptions = md.wScore === 7 ? [5, 6] : md.wScore === 6 ? [0, 1, 2, 3, 4] : [];
      const ok = md.winners && md.wScore !== null && md.lScore !== null;
      const shown = (key) => (md.winners === key ? md.wScore : md.winners ? md.lScore : null);
      return (
        <div>
          <div style={{ padding: "24px 4px 14px", textAlign: "center" }}>
            <Eyebrow>Sæt {md.round + 1} · Resultat</Eyebrow>
            <H size={26} style={{ marginTop: 6 }}>Hvem vandt sættet?</H>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {[["L", pr.left, "Venstre"], ["R", pr.right, "Højre"]].map(([key, team, side]) => {
              const won = md.winners === key, sc = shown(key);
              return (
                <Card key={key} pad={14} onClick={() => setMatchday({ ...md, winners: key })} style={{ textAlign: "center", position: "relative", ...(won ? { border: `2px solid ${C.court}`, background: G.cool, boxShadow: "0 12px 26px rgba(44,89,97,.18)" } : { border: `2px solid transparent`, outline: `1px solid ${C.line}`, outlineOffset: -1 }) }}>
                  <Eyebrow style={{ letterSpacing: ".14em", color: won ? C.courtDeep : C.muted }}>{side} side</Eyebrow>
                  <div style={{ display: "flex", justifyContent: "center", margin: "10px 0 8px" }}>
                    <Avatar name={playersById[team[0]].name} size={36} /><div style={{ marginLeft: -9 }}><Avatar name={playersById[team[1]].name} size={36} /></div>
                  </div>
                  <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 13.5, color: C.espresso, lineHeight: 1.4 }}>{names(team)}</div>
                  <div key={String(sc)} className={sc !== null ? "lp-pop" : ""} style={{ fontFamily: serif, fontWeight: 700, fontSize: 40, lineHeight: 1.1, marginTop: 6, color: sc === null ? C.line : won ? C.courtDeep : C.espresso }}>{sc === null ? "–" : sc}</div>
                  <div style={{ height: 24, marginTop: 2 }}>{won ? <Tag tone="ball"><Check size={11} />Vinder</Tag> : <span style={{ fontFamily: sans, fontSize: 12, color: C.muted }}>{md.winners ? "" : "Tryk for at vælge"}</span>}</div>
                </Card>
              );
            })}
          </div>
          <Card style={{ marginTop: 12, opacity: md.winners ? 1 : 0.55, transition: "opacity .25s" }}>
            <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 13.5, color: C.espresso, marginBottom: 8 }}>Vinderholdets partier</div>
            <Chips label="Vinderholdets partier" options={[6, 7]} value={md.wScore} onChange={v => setMatchday({ ...md, wScore: v, lScore: null })} />
            <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 13.5, color: C.espresso, margin: "18px 0 8px" }}>Taberholdets partier</div>
            {md.wScore === null
              ? <div style={{ fontFamily: sans, fontSize: 13, color: C.muted }}>Vælg vinderholdets partier først</div>
              : <div className="lp-fade" key={md.wScore}><Chips label="Taberholdets partier" options={loserOptions} value={md.lScore} onChange={v => setMatchday({ ...md, lScore: v })} /></div>}
            {md.wScore === 7 && <div style={{ marginTop: 12, fontFamily: sans, fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>Et sæt vundet 7–5 afgøres efter 5–5, og 7–6 betyder tiebreak – derfor kan taberholdet kun have 5 eller 6 partier.</div>}
            {md.wScore === 6 && <div style={{ marginTop: 12, fontFamily: sans, fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>Ved 6 vundne partier kan taberholdet have 0–4 – ved 5–5 spilles der videre til 7–5 eller 7–6.</div>}
          </Card>
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <Btn kind="ghost" onClick={() => setMatchday({ ...md, stage: "bane", winners: null, wScore: null, lScore: null })}><ChevronLeft size={16} /> Tilbage</Btn>
            <Btn kind="court" disabled={!ok} onClick={() => confirmSet(md)} style={{ flex: 1 }}>Gem sæt – holdene roterer</Btn>
          </div>
        </div>
      );
    }

    if (md.stage === "point") {
      const rows = dayPoints(md);
      return (
        <div>
          <div style={{ padding: "24px 4px 14px", textAlign: "center" }}>
            <Eyebrow>{courtLabel(md.myCourtIdx)} · {md.results.length} sæt spillet</Eyebrow>
            <H size={26} style={{ marginTop: 6 }}>Dagens pointændringer</H>
            <p style={{ fontFamily: sans, fontSize: 13.5, color: C.muted, margin: "8px 0 0", lineHeight: 1.55 }}>Slår du spillere med flere point, tjener du ekstra – taber du som favorit, koster det mere.</p>
          </div>
          <div className="lp-stagger" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {rows.map((r, i) => {
              const mine = r.pid === ME;
              return (
                <Card key={r.pid} pad={14} style={{ display: "flex", alignItems: "center", gap: 12, ...(mine ? { border: `1.5px solid ${C.court}`, background: G.cool } : {}) }}>
                  <div style={{ fontFamily: serif, fontWeight: 700, fontSize: 18, color: i === 0 ? C.gold : C.muted, width: 22, textAlign: "center" }}>{i + 1}</div>
                  <Avatar name={playersById[r.pid].name} size={40} ring={i === 0} ringColor={C.gold} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 14.5, color: C.espresso }}>{playersById[r.pid].name}{mine ? " (dig)" : ""}</div>
                    <div style={{ fontFamily: sans, fontSize: 12, color: C.muted, marginTop: 2 }}>{r.won}/{r.n} sæt vundet · forventet {Math.round(r.E * 100 / r.n)}% – faktisk {Math.round(r.S * 100 / r.n)}%</div>
                  </div>
                  <div style={{ fontFamily: serif, fontWeight: 700, fontSize: 22, color: r.delta >= 0 ? C.olive : C.clay, minWidth: 44, textAlign: "right" }}><CountUp value={r.delta} prefix={r.delta >= 0 ? "+" : ""} /></div>
                </Card>
              );
            })}
          </div>
          <Btn kind="court" onClick={() => applyMatchday(md)} style={{ width: "100%", marginTop: 16 }}><Trophy size={16} /> Godkend & opdater ranglisten</Btn>
          <Btn kind="ghost" onClick={() => setMatchday({ ...md, stage: "bane" })} style={{ width: "100%", marginTop: 8 }}><ChevronLeft size={15} /> Tilbage – spil et sæt mere</Btn>
        </div>
      );
    }

    return (
      <div style={{ textAlign: "center", padding: "110px 20px 40px" }}>
        <div style={{ position: "relative", width: 92, height: 92, margin: "0 auto 20px" }}>
          <BallBurst />
          <div className="lp-pop" style={{ position: "relative", width: 92, height: 92, borderRadius: 999, background: G.hero, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 16px 36px rgba(46,37,25,.28)" }}><Trophy size={38} color={C.ball} /></div>
        </div>
        <H size={27}>Godt spillet!</H>
        <p style={{ fontFamily: sans, fontSize: 14.5, color: C.muted, margin: "10px auto 22px", lineHeight: 1.55, maxWidth: 300 }}>Kampdagen er afsluttet. Point, sejre og kamphistorik er registreret for alle fire på banen.</p>
        <Btn onClick={() => { setMatchday(null); setTab("rangliste"); }}>Se den nye rangliste</Btn>
      </div>
    );
  };

  const renderAdmin = () => {
    if (!demo && !isAdmin) return (
      <div style={{ padding: "40px 20px", textAlign: "center" }}>
        <button onClick={() => setTab("rangliste")} style={{ background: "none", border: "none", color: C.mokka, fontFamily: sans, fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", gap: 6, cursor: "pointer", margin: "0 auto 26px" }}><ArrowLeft size={16} /> Tilbage til appen</button>
        <div style={{ width: 70, height: 70, borderRadius: 999, background: C.beige, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 18px" }}><Shield size={30} color={C.mokka} /></div>
        <H size={24}>Centeradministration</H>
        <p style={{ fontFamily: sans, fontSize: 13.5, color: C.muted, margin: "8px 0 18px", lineHeight: 1.55 }}>Din konto har ikke administrator-rettigheder. Kontakt centeret, hvis du mener det er en fejl.</p>
      </div>
    );
    if (demo && !admin) return (
      <div style={{ padding: "40px 20px", textAlign: "center" }}>
        <button onClick={() => setTab("rangliste")} style={{ background: "none", border: "none", color: C.mokka, fontFamily: sans, fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", gap: 6, cursor: "pointer", margin: "0 auto 26px" }}><ArrowLeft size={16} /> Tilbage til appen</button>
        <div style={{ width: 70, height: 70, borderRadius: 999, background: C.beige, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 18px" }}><Shield size={30} color={C.mokka} /></div>
        <H size={24}>Centeradministration</H>
        <p style={{ fontFamily: sans, fontSize: 13.5, color: C.muted, margin: "8px 0 18px", lineHeight: 1.55 }}>Kun for centerets personale. I produktion ligger admin på en separat adresse med rollebaseret login – spillere kan hverken se eller tilgå den.<br />(Demo: admin@lapista.dk / demo1234)</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 300, margin: "0 auto" }}>
          <input value={adminCreds.email} onChange={e => setAdminCreds({ ...adminCreds, email: e.target.value })} type="email" placeholder="E-mail" style={{ fontFamily: sans, fontSize: 14.5, padding: "12px 16px", borderRadius: 14, border: `1px solid ${C.line}`, background: C.cream, outline: "none" }} />
          <input value={adminCreds.pass} onChange={e => setAdminCreds({ ...adminCreds, pass: e.target.value })} type="password" placeholder="Adgangskode" style={{ fontFamily: sans, fontSize: 14.5, padding: "12px 16px", borderRadius: 14, border: `1px solid ${C.line}`, background: C.cream, outline: "none" }} />
          <Btn onClick={() => { if (adminCreds.email.trim().toLowerCase() === "admin@lapista.dk" && adminCreds.pass === "demo1234") { setAdmin(true); notify("Logget ind som centeradmin"); } else notify("Forkert e-mail eller adgangskode"); }}>Log ind</Btn>
        </div>
      </div>
    );
    return (
      <div>
        <div style={{ padding: "26px 4px 16px", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div><Eyebrow>Backend · centeradmin</Eyebrow><H size={28} style={{ marginTop: 6 }}>Administration</H></div>
          <div style={{ display: "flex", gap: 6 }}><Btn small kind="ghost" onClick={() => setTab("rangliste")}>Til appen</Btn>{demo && <Btn small kind="ghost" onClick={() => { setAdmin(false); setAdminCreds({ email: "", pass: "" }); }}>Log ud</Btn>}</div>
        </div>

        <Card>
          <Eyebrow>Opret ranglistedag</Eyebrow>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
            <input value={newEvent.title} onChange={e => setNewEvent({ ...newEvent, title: e.target.value })} placeholder="Titel" style={{ gridColumn: "1 / -1", fontFamily: sans, fontSize: 14, padding: "11px 14px", borderRadius: 12, border: `1px solid ${C.line}`, background: C.sand, outline: "none" }} />
            <input type="date" value={newEvent.date} onChange={e => setNewEvent({ ...newEvent, date: e.target.value })} style={{ fontFamily: sans, fontSize: 14, padding: "11px 14px", borderRadius: 12, border: `1px solid ${C.line}`, background: C.sand, outline: "none" }} />
            <input type="time" value={newEvent.time} onChange={e => setNewEvent({ ...newEvent, time: e.target.value })} style={{ fontFamily: sans, fontSize: 14, padding: "11px 14px", borderRadius: 12, border: `1px solid ${C.line}`, background: C.sand, outline: "none" }} />
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={{ fontFamily: sans, fontSize: 13.5, color: C.muted }}>Baner til dagen <span style={{ fontSize: 12 }}>(kapacitet sættes automatisk til baner × 4)</span></div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                {courtsList.map(c => {
                  const on = newEvent.courtIds.includes(c.id);
                  return (
                    <button key={c.id} onClick={() => setNewEvent(ne => { const ids = on ? ne.courtIds.filter(x => x !== c.id) : [...ne.courtIds, c.id]; return { ...ne, courtIds: ids, capacity: ids.length > 0 ? ids.length * 4 : ne.capacity }; })} style={{ padding: "8px 14px", borderRadius: 12, border: `1.5px solid ${on ? C.mokka : C.line}`, background: on ? C.mokka : C.cream, color: on ? C.cream : C.espresso, fontFamily: sans, fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}>{c.name}</button>
                  );
                })}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, gridColumn: "1 / -1" }}>
              <span style={{ fontFamily: sans, fontSize: 13.5, color: C.muted, flex: 1 }}>Antal pladser (standard 16)</span>
              <input type="number" min="4" step="1" value={newEvent.capacity} onChange={e => setNewEvent({ ...newEvent, capacity: e.target.value })} style={{ width: 74, textAlign: "center", fontFamily: sans, fontSize: 14, padding: "9px 8px", borderRadius: 12, border: `1px solid ${C.line}`, background: C.sand, outline: "none" }} />
            </div>
          </div>
          <Btn onClick={adminCreate} style={{ width: "100%", marginTop: 12 }}><Plus size={16} /> Opret begivenhed</Btn>
        </Card>

        <div style={{ padding: "22px 4px 10px" }}><Eyebrow>Begivenheder & deltagere</Eyebrow></div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {events.map(ev => (
            <Card key={ev.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <div>
                  <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 15, color: C.espresso }}>{ev.title} {ev.status === "afsluttet" && <Tag tone="olive">Afsluttet</Tag>}</div>
                  <div style={{ fontFamily: sans, fontSize: 12.5, color: C.muted, marginTop: 3 }}>{fmtDate(ev.date)} · kl. {ev.time}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button onClick={() => adminCapacity(ev.id, -4)} style={{ width: 30, height: 30, borderRadius: 10, border: `1px solid ${C.line}`, background: C.cream, cursor: "pointer" }}><Minus size={14} color={C.mokka} style={{ verticalAlign: "middle" }} /></button>
                  <span style={{ fontFamily: serif, fontWeight: 700, fontSize: 15, minWidth: 46, textAlign: "center" }}>{ev.registered.length}/{ev.capacity}</span>
                  <button onClick={() => adminCapacity(ev.id, 4)} style={{ width: 30, height: 30, borderRadius: 10, border: `1px solid ${C.line}`, background: C.cream, cursor: "pointer" }}><Plus size={14} color={C.mokka} style={{ verticalAlign: "middle" }} /></button>
                </div>
              </div>
              {ev.status !== "afsluttet" && (
                <>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
                    {ev.registered.map(pid => (
                      <span key={pid} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: C.sand, border: `1px solid ${C.line}`, borderRadius: 999, padding: "5px 6px 5px 12px", fontFamily: sans, fontSize: 12.5, color: C.espresso }}>
                        {firstName(playersById[pid].name)} {playersById[pid].name.split(" ")[1][0]}.
                        <button onClick={() => adminRemove(ev.id, pid)} style={{ width: 20, height: 20, borderRadius: 999, border: "none", background: C.line, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><X size={11} color={C.mokkaDeep} /></button>
                      </span>
                    ))}
                  </div>
                  {ev.waitlist.length > 0 && <div style={{ fontFamily: sans, fontSize: 12, color: C.muted, marginTop: 10 }}>Venteliste: {ev.waitlist.map(pid => firstName(playersById[pid].name)).join(", ")}</div>}
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <select defaultValue="" onChange={e => { adminAdd(ev.id, e.target.value); e.target.value = ""; }} style={{ flex: 1, fontFamily: sans, fontSize: 13.5, padding: "10px 12px", borderRadius: 12, border: `1px solid ${C.line}`, background: C.cream, color: C.espresso, outline: "none" }}>
                      <option value="" disabled>Tilføj spiller …</option>
                      {players.filter(p => !ev.registered.includes(p.id)).map(p => <option key={p.id} value={p.id}>{p.name} ({p.points} p)</option>)}
                    </select>
                    <Btn small kind="danger" onClick={() => adminDelete(ev.id)}><X size={13} /> Aflys</Btn>
                  </div>
                </>
              )}
            </Card>
          ))}
        </div>

        <div style={{ padding: "22px 4px 10px" }}><Eyebrow>Spillere ({players.length})</Eyebrow></div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {ranked.map(p => (
            <Card key={p.id} pad={14}>
              {editPlayer?.id === p.id ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <input value={editPlayer.name} onChange={e => setEditPlayer({ ...editPlayer, name: e.target.value })} placeholder="Fulde navn" style={adminInput} />
                  <input value={editPlayer.phone} onChange={e => setEditPlayer({ ...editPlayer, phone: e.target.value })} placeholder="Mobilnummer" style={adminInput} />
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontFamily: sans, fontSize: 13, color: C.muted, flex: 1 }}>Point</span>
                    <input type="number" min="0" value={editPlayer.points} onChange={e => setEditPlayer({ ...editPlayer, points: e.target.value })} style={{ ...adminInput, width: 90, textAlign: "center" }} />
                  </div>
                  {String(editPlayer.points) !== String(p.points) && (
                    <input value={editPlayer.reason} onChange={e => setEditPlayer({ ...editPlayer, reason: e.target.value })} placeholder="Årsag til pointændring (logges)" style={adminInput} />
                  )}
                  <div style={{ display: "flex", gap: 8 }}>
                    <Btn small onClick={savePlayer} style={{ flex: 1 }}><Check size={14} /> Gem</Btn>
                    <Btn small kind="ghost" onClick={() => setEditPlayer(null)}>Annullér</Btn>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <Avatar name={p.name} size={36} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 14, color: C.espresso, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>{p.name}{p.role === "center_admin" && <Tag tone="mokka">admin</Tag>}{p.id === ME && <Tag>dig</Tag>}</div>
                    <div style={{ fontFamily: sans, fontSize: 12, color: C.muted, marginTop: 2 }}>{p.phone || "Intet nummer"}{p.phone && p.smsConsent === false ? " (ingen SMS)" : ""} · {p.points} point · {p.wins} S / {p.losses} N</div>
                  </div>
                  <Btn small kind="soft" onClick={() => { setConfirmDelete(null); setEditPlayer({ id: p.id, name: p.name, phone: p.phone || "", points: String(p.points), reason: "" }); }}>Redigér</Btn>
                  {p.id !== ME && (confirmDelete === p.id ? (
                    <>
                      <Btn small kind="danger" onClick={() => deletePlayer(p.id)}>Sikker?</Btn>
                      <Btn small kind="ghost" onClick={() => setConfirmDelete(null)}>Nej</Btn>
                    </>
                  ) : (
                    <Btn small kind="danger" onClick={() => { setEditPlayer(null); setConfirmDelete(p.id); }}><X size={13} /></Btn>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>

        <div style={{ padding: "22px 4px 10px" }}><Eyebrow>SMS-log {demo ? "(simuleret gateway)" : "· gateway-kø"}</Eyebrow></div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {smsLog.length === 0 && <Card pad={16} style={{ background: C.beige, border: "none", textAlign: "center", fontFamily: sans, fontSize: 13, color: C.mokkaDeep }}>Ingen SMS'er sendt endnu. Afmeld en spiller fra en fuld begivenhed – eller aflys en dag – for at se notifikationer.</Card>}
          {smsLog.map((s, i) => (
            <Card key={s.id || i} pad={14} style={{ display: "flex", gap: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: 12, background: C.beige, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Smartphone size={16} color={C.mokka} /></div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: sans, fontSize: 12.5, color: C.muted, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span>Til {s.name} · {s.to} · {s.time}</span>
                  {s.status && <Tag tone={s.failed ? "clay" : s.status === "sendt" ? "olive" : "gold"}>{s.status}</Tag>}
                </div>
                <div style={{ fontFamily: sans, fontSize: 13.5, color: C.espresso, marginTop: 4, lineHeight: 1.5 }}>{s.text}</div>
                {s.error && <div style={{ fontFamily: sans, fontSize: 11.5, color: C.clay, marginTop: 4 }}>{s.error}</div>}
              </div>
            </Card>
          ))}
        </div>
      </div>
    );
  };

  /* ================= SHELL ================= */
  const navItems = [
    { id: "rangliste", label: "Rangliste", icon: Trophy },
    { id: "kampe", label: "Kampe", icon: Calendar },
    ...(matchday ? [{ id: "kampdag", label: "Kampdag", icon: Swords }] : []),
    { id: "beskeder", label: "Beskeder", icon: MessageCircle },
    { id: "profil", label: "Profil", icon: User },
  ];

  /* ---- Auth gate (real mode) ---- */
  const centerScreen = (msg, loading = false) => (
    <div style={{ minHeight: "100dvh", background: G.page, display: "flex", alignItems: "center", justifyContent: "center", padding: 28 }}>
      <style>{globalCss}</style>
      {loading
        ? <BallLoader label={msg} />
        : <div className="lp-fade" style={{ fontFamily: sans, fontSize: 14.5, color: C.muted, textAlign: "center", maxWidth: 320, lineHeight: 1.55 }}>{msg}</div>}
    </div>
  );
  if (!demo && centerError) return centerScreen(centerError);
  if (!demo && !center) return centerScreen("Finder dit padelcenter…", true);
  if (!demo && authLoading) return centerScreen("Indlæser…", true);
  if (!demo && !session) return <AuthScreen center={center} />;
  if (!demo && needsPassword) return <SetPasswordScreen center={center} onDone={() => { passwordSet(); notify("Din adgangskode er gemt"); }} />;
  if (!demo && !me) return dataLoaded
    ? centerScreen(`Din bruger er logget ind, men har ingen spillerprofil hos ${center.name}. Kontakt centeret, så de kan oprette dig.`)
    : centerScreen("Henter din profil…", true);

  const unreadTotal = Object.values(threads).reduce((n, msgs) => n + msgs.filter(m => m.unread).length, 0);

  return (
    <div style={{ minHeight: "100dvh", background: C.sand, fontFamily: sans, color: C.espresso, position: "relative" }}>
      <style>{globalCss}</style>
      {/* Ambient wash behind everything; fixed so it does not scroll away. */}
      <div aria-hidden style={{ position: "fixed", inset: 0, background: G.page, pointerEvents: "none", zIndex: 0 }} />

      <header style={{ position: "sticky", top: 0, zIndex: 20, paddingTop: "env(safe-area-inset-top)", background: "rgba(246,241,232,.78)", backdropFilter: "saturate(1.4) blur(14px)", WebkitBackdropFilter: "saturate(1.4) blur(14px)", borderBottom: `1px solid ${C.line}aa` }}>
        <div style={{ maxWidth: 560, margin: "0 auto", padding: "13px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button className="lp-btn" aria-label="Til ranglisten" onClick={() => { setViewPlayerId(null); setTab("rangliste"); }} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}><Logo center={center} /></button>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {isAdmin && <Tag tone="mokka"><Shield size={11} />Admin</Tag>}
            <button className="lp-btn" aria-label="Min profil" onClick={() => { setViewPlayerId(null); setTab("profil"); }} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", borderRadius: 999 }}><Avatar name={me.name} size={36} ring ringColor={C.court} /></button>
          </div>
        </div>
      </header>

      {toast && (
        <div role="status" style={{ position: "fixed", top: "calc(74px + env(safe-area-inset-top))", left: "50%", transform: "translateX(-50%)", zIndex: 50, background: "rgba(46,37,25,.94)", backdropFilter: "blur(8px)", color: C.cream, fontFamily: sans, fontSize: 13.5, fontWeight: 500, padding: "11px 18px 11px 14px", borderRadius: 999, boxShadow: shadow, maxWidth: "88%", display: "flex", alignItems: "center", gap: 10, animation: "lp-toast .32s cubic-bezier(.2,.8,.3,1.1) both" }}>
          <BallDot size={10} /><span style={{ textAlign: "left" }}>{toast}</span>
        </div>
      )}

      <main style={{ maxWidth: 560, margin: "0 auto", padding: "0 20px calc(120px + env(safe-area-inset-bottom))", position: "relative", zIndex: 1 }}>
        <div className="view" key={tab + (viewPlayerId || "") + (activeThread || "") + (eventDetailId || "") + (matchday ? matchday.stage : "")}>
          {tab === "rangliste" && renderRanking()}
          {tab === "kampe" && renderEvents()}
          {tab === "kampdag" && renderMatchday()}
          {tab === "beskeder" && renderMessages()}
          {tab === "profil" && renderProfile()}
          {tab === "admin" && renderAdmin()}
        </div>
        {tab !== "admin" && !(tab === "beskeder" && activeThread) && (
          <div style={{ textAlign: "center", padding: "38px 0 0" }}>
            <button onClick={() => setTab("admin")} style={{ background: "none", border: "none", fontFamily: sans, fontSize: 11.5, letterSpacing: ".08em", color: C.muted, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3, padding: 8 }}>Centeradministration</button>
            <div style={{ fontFamily: sans, fontSize: 10.5, letterSpacing: ".14em", color: C.muted, textTransform: "uppercase", marginTop: 8, opacity: .7 }}>Powered by {PLATFORM}</div>
          </div>
        )}
      </main>

      {tab !== "admin" && <nav aria-label="Hovedmenu" style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 30, background: "rgba(255,253,248,.86)", backdropFilter: "saturate(1.4) blur(16px)", WebkitBackdropFilter: "saturate(1.4) blur(16px)", borderTop: `1px solid ${C.line}aa` }}>
        <div style={{ maxWidth: 560, margin: "0 auto", display: "flex", padding: "8px 8px calc(10px + env(safe-area-inset-bottom))" }}>
          {navItems.map(item => {
            const active = tab === item.id;
            const Icon = item.icon;
            const live = item.id === "kampdag";
            const badge = item.id === "beskeder" ? unreadTotal : 0;
            return (
              <button key={item.id} className="lp-btn" aria-current={active ? "page" : undefined} onClick={() => { setTab(item.id); if (item.id === "profil") setViewPlayerId(null); if (item.id === "beskeder") setActiveThread(null); if (item.id === "kampe") setEventDetailId(null); }} style={{ flex: 1, background: "none", border: "none", cursor: "pointer", padding: "6px 2px", display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <div style={{ position: "relative", width: 52, height: 30, borderRadius: 999, background: active ? (live ? G.court : G.primary) : "transparent", boxShadow: active ? "0 6px 14px rgba(94,70,50,.22)" : "none", display: "flex", alignItems: "center", justifyContent: "center", transition: "background .25s, box-shadow .25s" }}>
                  <Icon size={19} color={active ? C.cream : live ? C.court : C.muted} strokeWidth={active ? 2.3 : 2} />
                  {live && !active && <BallDot size={8} live style={{ position: "absolute", top: 2, right: 9 }} />}
                  {badge > 0 && <span className="lp-pop" style={{ position: "absolute", top: -3, right: 4, minWidth: 17, height: 17, padding: "0 5px", borderRadius: 999, background: C.ball, color: "#2F340C", border: `1.5px solid ${C.cream}`, fontFamily: sans, fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{badge}</span>}
                </div>
                <span style={{ fontFamily: sans, fontSize: 10.5, fontWeight: active ? 700 : 500, letterSpacing: ".03em", color: active ? C.espresso : C.muted }}>{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>}
    </div>
  );
}
