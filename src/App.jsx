import React, { useState, useMemo, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from "recharts";
import { Trophy, MessageCircle, Calendar, User, ChevronRight, ChevronLeft, Send, Plus, Minus, X, Check, Clock, TrendingUp, Crown, Shield, Smartphone, ArrowLeft, Swords } from "lucide-react";
import { CENTER } from "./config/center.js";

/* ================= PALETTE / DESIGN TOKENS ================= */
const C = {
  sand: "#F6F1E8",        // page background
  cream: "#FFFDF8",       // cards
  line: "#E9DECB",        // borders
  beige: "#EFE6D6",       // muted fills
  mokka: "#7A5C43",       // primary
  mokkaDeep: "#5E4632",
  espresso: "#2E2519",    // text
  muted: "#96866F",       // secondary text
  olive: "#7D8A5F",       // positive
  clay: "#B4694E",        // negative (sparingt)
  gold: "#B08D57",
};
const shadow = "0 1px 2px rgba(46,37,25,.05), 0 10px 30px rgba(46,37,25,.07)";
const softShadow = "0 1px 2px rgba(46,37,25,.04), 0 4px 14px rgba(46,37,25,.05)";
const serif = "'Fraunces', Georgia, serif";
const sans = "'Outfit', ui-sans-serif, system-ui, sans-serif";

/* ================= HELPERS ================= */
const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const fmtDate = (iso) => { const d = new Date(iso + "T12:00:00"); return d.toLocaleDateString("da-DK", { weekday: "short", day: "numeric", month: "short" }); };
const fmtDateLong = (iso) => { const d = new Date(iso + "T12:00:00"); return d.toLocaleDateString("da-DK", { weekday: "long", day: "numeric", month: "long" }); };
const shortDate = (iso) => { const d = new Date(iso + "T12:00:00"); return d.getDate() + "/" + (d.getMonth() + 1); };
const initials = (name) => name.split(" ").map(n => n[0]).slice(0, 2).join("");
const firstName = (name) => name.split(" ")[0];

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

const TODAY = "2026-07-03";
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

/* ================= SMÅ BYGGESTEN ================= */
const Avatar = ({ name, size = 40, ring = false }) => (
  <div style={{ width: size, height: size, borderRadius: 999, background: `linear-gradient(135deg, ${C.beige}, ${C.line})`, color: C.mokkaDeep, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: sans, fontWeight: 600, fontSize: size * 0.36, letterSpacing: ".02em", border: ring ? `2px solid ${C.mokka}` : `1px solid ${C.line}`, flexShrink: 0 }}>
    {initials(name)}
  </div>
);

const Card = ({ children, style = {}, onClick, pad = 20 }) => (
  <div onClick={onClick} style={{ background: C.cream, border: `1px solid ${C.line}`, borderRadius: 22, padding: pad, boxShadow: softShadow, cursor: onClick ? "pointer" : "default", ...style }}>{children}</div>
);

const Eyebrow = ({ children, style = {} }) => (
  <div style={{ fontFamily: sans, fontSize: 11, fontWeight: 600, letterSpacing: ".18em", textTransform: "uppercase", color: C.muted, ...style }}>{children}</div>
);

const H = ({ children, size = 26, style = {} }) => (
  <h2 style={{ fontFamily: serif, fontWeight: 600, fontSize: size, color: C.espresso, margin: 0, lineHeight: 1.15, ...style }}>{children}</h2>
);

const Btn = ({ children, onClick, kind = "primary", disabled, small, style = {} }) => {
  const base = { fontFamily: sans, fontWeight: 600, fontSize: small ? 13 : 15, borderRadius: 999, padding: small ? "8px 16px" : "13px 22px", border: "1px solid transparent", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.45 : 1, transition: "transform .12s ease, box-shadow .12s ease", display: "inline-flex", alignItems: "center", gap: 8, justifyContent: "center" };
  const kinds = {
    primary: { background: C.mokka, color: C.cream, boxShadow: "0 6px 16px rgba(122,92,67,.28)" },
    ghost: { background: "transparent", color: C.mokkaDeep, border: `1px solid ${C.line}` },
    soft: { background: C.beige, color: C.mokkaDeep },
    danger: { background: "transparent", color: C.clay, border: `1px solid ${C.clay}55` },
  };
  return <button disabled={disabled} onClick={onClick} onMouseDown={e => !disabled && (e.currentTarget.style.transform = "scale(.97)")} onMouseUp={e => (e.currentTarget.style.transform = "scale(1)")} onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")} style={{ ...base, ...kinds[kind], ...style }}>{children}</button>;
};

const Tag = ({ children, tone = "beige" }) => {
  const tones = { beige: [C.beige, C.mokkaDeep], olive: [C.olive + "22", C.olive], clay: [C.clay + "1e", C.clay], mokka: [C.mokka, C.cream], gold: [C.gold + "26", "#8a6b3c"] };
  const [bg, col] = tones[tone];
  return <span style={{ background: bg, color: col, fontFamily: sans, fontSize: 11.5, fontWeight: 600, padding: "4px 10px", borderRadius: 999, letterSpacing: ".04em", whiteSpace: "nowrap" }}>{children}</span>;
};

const Logo = ({ light = false }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
    <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden>
      <defs><linearGradient id="sun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={C.gold} /><stop offset="1" stopColor={C.mokka} /></linearGradient></defs>
      <path d="M4 19 a11 11 0 0 1 22 0" fill="url(#sun)" />
      <line x1="2" y1="19" x2="28" y2="19" stroke={light ? C.cream : C.espresso} strokeWidth="2" strokeLinecap="round" />
      <line x1="7" y1="24" x2="23" y2="24" stroke={light ? C.cream : C.mokka} strokeWidth="2" strokeLinecap="round" opacity=".55" />
    </svg>
    <div>
      <div style={{ fontFamily: serif, fontWeight: 700, fontSize: 19, letterSpacing: ".06em", color: light ? C.cream : C.espresso, lineHeight: 1, textTransform: "uppercase" }}>{CENTER.name}</div>
      <div style={{ fontFamily: sans, fontSize: 9.5, letterSpacing: ".3em", color: light ? C.cream + "bb" : C.muted, textTransform: "uppercase", marginTop: 2 }}>{CENTER.city} · Rangliste</div>
    </div>
  </div>
);

/* Banevisualisering – makker & side */
const CourtSVG = ({ left, right, meId, playersById }) => {
  const nameChip = (pid, x, y, anchor) => {
    const p = playersById[pid]; const me = pid === meId;
    return (
      <g key={pid + x}>
        <rect x={x - 62} y={y - 15} width="124" height="30" rx="15" fill={me ? C.mokka : C.cream} stroke={me ? C.mokkaDeep : C.line} strokeWidth="1" />
        <text x={x} y={y + 4.5} textAnchor="middle" fontFamily={sans} fontWeight="600" fontSize="12.5" fill={me ? C.cream : C.espresso}>{firstName(playersById[pid].name)}{me ? " (dig)" : ""}</text>
      </g>
    );
  };
  return (
    <svg viewBox="0 0 400 230" style={{ width: "100%", display: "block" }}>
      <rect x="14" y="14" width="372" height="202" rx="14" fill={C.beige} stroke={C.mokka} strokeWidth="2.5" />
      <rect x="24" y="24" width="352" height="182" rx="8" fill="none" stroke={C.mokka} strokeWidth="1" opacity=".35" />
      <line x1="200" y1="14" x2="200" y2="216" stroke={C.mokkaDeep} strokeWidth="3" />
      <line x1="200" y1="14" x2="200" y2="216" stroke={C.cream} strokeWidth="1" strokeDasharray="4 6" />
      <line x1="76" y1="115" x2="324" y2="115" stroke={C.mokka} strokeWidth="1.4" opacity=".6" />
      <line x1="76" y1="24" x2="76" y2="206" stroke={C.mokka} strokeWidth="1.4" opacity=".6" />
      <line x1="324" y1="24" x2="324" y2="206" stroke={C.mokka} strokeWidth="1.4" opacity=".6" />
      <text x="107" y="34" fontFamily={sans} fontSize="10" letterSpacing="2" fill={C.mokkaDeep} opacity=".7">VENSTRE</text>
      <text x="252" y="34" fontFamily={sans} fontSize="10" letterSpacing="2" fill={C.mokkaDeep} opacity=".7">HØJRE</text>
      {nameChip(left[0], 110, 78)}
      {nameChip(left[1], 110, 158)}
      {nameChip(right[0], 290, 78)}
      {nameChip(right[1], 290, 158)}
    </svg>
  );
};

/* Chip-vælger med dynamiske valgmuligheder (padel-regler) */
const Chips = ({ options, value, onChange }) => (
  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
    {options.map(n => (
      <button key={n} onClick={() => onChange(n)} style={{ width: 38, height: 38, borderRadius: 12, border: `1.5px solid ${value === n ? C.mokka : C.line}`, background: value === n ? C.mokka : C.cream, color: value === n ? C.cream : C.espresso, fontFamily: sans, fontWeight: 700, fontSize: 15, cursor: "pointer" }}>{n}</button>
    ))}
  </div>
);

/* ================= APP ================= */
export default function App() {
  const [players, setPlayers] = useState(seedPlayers);
  const [events, setEvents] = useState(() => seedEvents(seedPlayers()));
  const [threads, setThreads] = useState(seedThreads);
  const [smsLog, setSmsLog] = useState([]);
  const [tab, setTab] = useState("rangliste");
  const [viewPlayerId, setViewPlayerId] = useState(null);
  const [activeThread, setActiveThread] = useState(null);
  const [msgDraft, setMsgDraft] = useState("");
  const [admin, setAdmin] = useState(false);
  const [adminCreds, setAdminCreds] = useState({ email: "", pass: "" });
  const [toast, setToast] = useState(null);
  const [matchday, setMatchday] = useState(null);
  const [newEvent, setNewEvent] = useState({ title: "Torsdagsrangliste", date: "2026-07-23", time: "18:30", capacity: 16 });
  const [eventDetailId, setEventDetailId] = useState(null);
  const [expandedHist, setExpandedHist] = useState(null);
  const [clock, setClock] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setClock(Date.now()), 15000); return () => clearInterval(t); }, []);

  const ME = "p7"; // Mads Kristensen – demo-login
  const playersById = useMemo(() => Object.fromEntries(players.map(p => [p.id, p])), [players]);
  const ranked = useMemo(() => [...players].sort((a, b) => b.points - a.points), [players]);
  const rankOf = (id) => ranked.findIndex(p => p.id === id) + 1;
  const me = playersById[ME];

  const notify = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2600); };
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
  const joinEvent = (evId) => setEvents(es => es.map(ev => {
    if (ev.id !== evId) return ev;
    if (ev.registered.includes(ME) || ev.waitlist.includes(ME)) return ev;
    if (ev.registered.length < ev.capacity) { notify("Du er tilmeldt " + ev.title); return { ...ev, registered: [...ev.registered, ME] }; }
    notify("Begivenheden er fuld – du står nu på ventelisten"); return { ...ev, waitlist: [...ev.waitlist, ME] };
  }));
  const leaveEvent = (evId) => setEvents(es => es.map(ev => {
    if (ev.id !== evId) return ev;
    if (ev.waitlist.includes(ME)) { notify("Du er fjernet fra ventelisten"); return { ...ev, waitlist: ev.waitlist.filter(x => x !== ME) }; }
    if (!ev.registered.includes(ME)) return ev;
    notify("Du er afmeldt " + ev.title);
    return openSlotFollowUp({ ...ev, registered: ev.registered.filter(x => x !== ME) });
  }));
  const acceptOffer = (evId) => setEvents(es => es.map(ev => {
    if (ev.id !== evId || !ev.pendingOffer) return ev;
    notify(playersById[ev.pendingOffer].name + " har taget pladsen via SMS-linket");
    return { ...ev, registered: [...ev.registered, ev.pendingOffer], pendingOffer: null };
  }));

  /* ---- Admin ---- */
  const adminRemove = (evId, pid) => setEvents(es => es.map(ev => ev.id !== evId ? ev : openSlotFollowUp({ ...ev, registered: ev.registered.filter(x => x !== pid), waitlist: ev.waitlist.filter(x => x !== pid) })));
  const adminAdd = (evId, pid) => setEvents(es => es.map(ev => {
    if (ev.id !== evId || !pid || ev.registered.includes(pid)) return ev;
    if (ev.registered.length >= ev.capacity) { notify("Fuldt – udvid antal pladser først"); return ev; }
    return { ...ev, registered: [...ev.registered, pid], waitlist: ev.waitlist.filter(x => x !== pid) };
  }));
  const adminCapacity = (evId, d) => setEvents(es => es.map(ev => {
    if (ev.id !== evId) return ev;
    const cap = Math.max(4, ev.capacity + d);
    let next = { ...ev, capacity: cap };
    if (d > 0 && next.registered.length < cap) next = openSlotFollowUp(next);
    return next;
  }));
  const adminDelete = (evId) => setEvents(es => {
    const ev = es.find(e => e.id === evId);
    [...ev.registered, ...ev.waitlist].forEach(pid => sendSMS(pid, `Hej ${firstName(playersById[pid].name)}. ${ev.title} ${fmtDate(ev.date)} kl. ${ev.time} er desværre aflyst pga. for få tilmeldte. Vi ses næste gang!`));
    notify("Begivenhed aflyst – SMS sendt til " + (ev.registered.length + ev.waitlist.length) + " spillere");
    return es.filter(e => e.id !== evId);
  });
  const adminCreate = () => {
    if (!newEvent.date || !newEvent.time) return;
    setEvents(es => [...es, { id: "e" + Date.now(), ...newEvent, capacity: Number(newEvent.capacity) || 16, registered: [], waitlist: [], status: "åben", pendingOffer: null }].sort((a, b) => a.date.localeCompare(b.date)));
    notify("Begivenhed oprettet");
  };

  /* ---- Kampdag-motor ---- */
  const pairings = (c) => [
    { left: [c[0], c[1]], right: [c[2], c[3]] },
    { left: [c[0], c[2]], right: [c[1], c[3]] },
    { left: [c[0], c[3]], right: [c[1], c[2]] },
  ];
  const startMatchday = (ev) => {
    const sorted = ev.registered.map(id => playersById[id]).sort((a, b) => b.points - a.points);
    const courts = []; for (let i = 0; i < sorted.length; i += 4) courts.push(sorted.slice(i, i + 4).map(p => p.id));
    const myCourtIdx = courts.findIndex(c => c.includes(ME));
    if (myCourtIdx === -1 || courts[myCourtIdx].length < 4) { notify("Din bane mangler spillere (4 kræves)"); return; }
    setEventDetailId(null);
    setMatchday({ eventId: ev.id, courts, myCourtIdx, stage: "lobby", round: 0, results: [], winners: null, wScore: null, lScore: null, startedAt: Date.now() });
    setTab("kampdag");
  };
  const currentPairing = (md) => pairings(md.courts[md.myCourtIdx])[md.round % 3];
  const confirmSet = (md) => {
    const pr = currentPairing(md);
    const score = md.winners === "L" ? [md.wScore, md.lScore] : [md.lScore, md.wScore];
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
  const applyMatchday = (md) => {
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

  /* ================= VIEWS ================= */
  const renderRanking = () => (
    <div>
      <div style={{ padding: "26px 4px 18px" }}>
        <Eyebrow>Ranglisten · {CENTER.name}</Eyebrow>
        <H size={30} style={{ marginTop: 6 }}>Sæsonen lige nu</H>
        <p style={{ fontFamily: sans, color: C.muted, fontSize: 14, margin: "8px 0 0", lineHeight: 1.5 }}>{players.length} aktive spillere · alle starter på 500 point · opdateret efter hver kampdag</p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {ranked.map((p, i) => (
          <Card key={p.id} onClick={() => { setViewPlayerId(p.id); setTab("profil"); }} pad={14} style={{ display: "flex", alignItems: "center", gap: 14, border: p.id === ME ? `1.5px solid ${C.mokka}` : `1px solid ${C.line}` }}>
            <div style={{ width: 34, textAlign: "center", fontFamily: serif, fontWeight: 700, fontSize: i < 3 ? 22 : 17, color: i === 0 ? C.gold : i < 3 ? C.mokka : C.muted }}>{i + 1}</div>
            <Avatar name={p.name} ring={i === 0} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 15.5, color: C.espresso, display: "flex", alignItems: "center", gap: 7 }}>
                {p.name}{i === 0 && <Crown size={15} color={C.gold} fill={C.gold} />}{p.id === ME && <Tag tone="mokka">dig</Tag>}
              </div>
              <div style={{ fontFamily: sans, fontSize: 12.5, color: C.muted, marginTop: 2 }}>{p.wins} sejre · {p.losses} nederlag</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: serif, fontWeight: 700, fontSize: 19, color: C.espresso }}>{p.points}</div>
              <div style={{ fontFamily: sans, fontSize: 10.5, letterSpacing: ".12em", color: C.muted, textTransform: "uppercase" }}>point</div>
            </div>
            <ChevronRight size={18} color={C.line} />
          </Card>
        ))}
      </div>
    </div>
  );

  const renderProfile = () => {
    const p = playersById[viewPlayerId || ME];
    const own = p.id === ME;
    const chart = p.history.map(h => ({ d: shortDate(h.date), point: h.after }));
    const winrate = Math.round((p.wins / Math.max(1, p.wins + p.losses)) * 100);
    return (
      <div>
        {!own && <button onClick={() => { setViewPlayerId(null); setTab("rangliste"); }} style={{ background: "none", border: "none", color: C.mokka, fontFamily: sans, fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", gap: 6, padding: "18px 0 0", cursor: "pointer" }}><ArrowLeft size={16} /> Rangliste</button>}
        <div style={{ padding: "24px 4px 18px", display: "flex", alignItems: "center", gap: 16 }}>
          <Avatar name={p.name} size={64} ring />
          <div style={{ flex: 1 }}>
            <H size={26}>{p.name}</H>
            <div style={{ fontFamily: sans, fontSize: 13.5, color: C.muted, marginTop: 4 }}>Medlem siden {new Date(p.joined).toLocaleDateString("da-DK", { month: "long", year: "numeric" })}</div>
          </div>
          {!own && <Btn small kind="soft" onClick={() => { setActiveThread(p.id); setTab("beskeder"); }}><MessageCircle size={15} /> Besked</Btn>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
          {[["# " + rankOf(p.id), "Placering"], [p.points, "Point"], [winrate + "%", "Sejrsrate"]].map(([v, l]) => (
            <Card key={l} pad={16} style={{ textAlign: "center" }}>
              <div style={{ fontFamily: serif, fontWeight: 700, fontSize: 23, color: C.espresso }}>{v}</div>
              <Eyebrow style={{ marginTop: 4, letterSpacing: ".12em" }}>{l}</Eyebrow>
            </Card>
          ))}
        </div>
        <Card style={{ marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div><Eyebrow>Progression</Eyebrow><H size={19} style={{ marginTop: 4 }}>Pointudvikling</H></div>
            <Tag tone={p.history.length && p.history[p.history.length - 1].delta >= 0 ? "olive" : "clay"}><TrendingUp size={11} style={{ verticalAlign: "-1.5px", marginRight: 3 }} />{p.history.length ? (p.history[p.history.length - 1].delta >= 0 ? "+" : "") + p.history[p.history.length - 1].delta + " sidst" : "–"}</Tag>
          </div>
          <div style={{ height: 190, marginTop: 14, marginLeft: -12 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart}>
                <CartesianGrid stroke={C.line} strokeDasharray="3 6" vertical={false} />
                <XAxis dataKey="d" tick={{ fontFamily: sans, fontSize: 11, fill: C.muted }} axisLine={{ stroke: C.line }} tickLine={false} />
                <YAxis domain={["dataMin - 30", "dataMax + 30"]} tick={{ fontFamily: sans, fontSize: 11, fill: C.muted }} axisLine={false} tickLine={false} width={42} />
                <Tooltip contentStyle={{ fontFamily: sans, fontSize: 13, borderRadius: 14, border: `1px solid ${C.line}`, boxShadow: softShadow, background: C.cream }} labelStyle={{ color: C.muted }} formatter={(v) => [v + " point", ""]} separator="" />
                <Line type="monotone" dataKey="point" stroke={C.mokka} strokeWidth={2.5} dot={{ r: 3.5, fill: C.mokka, strokeWidth: 0 }} activeDot={{ r: 5, fill: C.mokkaDeep }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <div style={{ padding: "22px 4px 10px" }}><Eyebrow>Kamphistorik</Eyebrow><H size={19} style={{ marginTop: 4 }}>Seneste kampdage</H></div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[...p.history].reverse().map((h, hi) => {
            const key = p.id + "-" + hi;
            const open = expandedHist === key;
            return (
              <Card key={hi} pad={16} onClick={() => setExpandedHist(open ? null : key)}>
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
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontFamily: sans, fontSize: 12, color: C.muted, marginBottom: 8 }}>{fmtDateLong(h.date)} · nr. {h.placement} på banen · {h.after} point efter dagen</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {h.sets.map((sx, si) => (
                        <div key={si} style={{ display: "flex", alignItems: "center", gap: 10, background: C.sand, borderRadius: 12, padding: "8px 12px" }}>
                          <span style={{ fontFamily: sans, fontSize: 10.5, fontWeight: 700, letterSpacing: ".08em", color: C.muted, width: 46, textTransform: "uppercase" }}>{sx.label}</span>
                          <span style={{ flex: 1, fontFamily: sans, fontSize: 12.5, color: C.espresso }}>m. {firstName(sx.partner)} <span style={{ color: C.muted }}>vs. {sx.opps.map(firstName).join(" & ")}</span></span>
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
      </div>
    );
  };

  const renderMessages = () => {
    if (activeThread) {
      const other = playersById[activeThread];
      const msgs = threads[activeThread] || [];
      const send = () => { if (!msgDraft.trim()) return; setThreads(t => ({ ...t, [activeThread]: [...(t[activeThread] || []), { from: "me", text: msgDraft.trim(), time: new Date().toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" }) }] })); setMsgDraft(""); };
      return (
        <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 170px)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "20px 4px 14px", borderBottom: `1px solid ${C.line}` }}>
            <button onClick={() => setActiveThread(null)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}><ArrowLeft size={20} color={C.mokka} /></button>
            <Avatar name={other.name} size={40} />
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 15, color: C.espresso }}>{other.name}</div>
              <div style={{ fontFamily: sans, fontSize: 12, color: C.muted }}>#{rankOf(other.id)} · {other.points} point</div>
            </div>
            <Btn small kind="ghost" onClick={() => { setViewPlayerId(other.id); setTab("profil"); }}>Profil</Btn>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "16px 2px", display: "flex", flexDirection: "column", gap: 8 }}>
            {msgs.map((m, i) => (
              <div key={i} style={{ alignSelf: m.from === "me" ? "flex-end" : "flex-start", maxWidth: "78%" }}>
                <div style={{ background: m.from === "me" ? C.mokka : C.cream, color: m.from === "me" ? C.cream : C.espresso, border: m.from === "me" ? "none" : `1px solid ${C.line}`, borderRadius: m.from === "me" ? "18px 18px 4px 18px" : "18px 18px 18px 4px", padding: "10px 14px", fontFamily: sans, fontSize: 14.5, lineHeight: 1.45, boxShadow: softShadow }}>{m.text}</div>
                <div style={{ fontFamily: sans, fontSize: 10.5, color: C.muted, marginTop: 3, textAlign: m.from === "me" ? "right" : "left" }}>{m.time}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, padding: "10px 0 4px" }}>
            <input value={msgDraft} onChange={e => setMsgDraft(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} placeholder="Skriv en besked …" style={{ flex: 1, fontFamily: sans, fontSize: 14.5, padding: "13px 18px", borderRadius: 999, border: `1px solid ${C.line}`, background: C.cream, color: C.espresso, outline: "none" }} />
            <button onClick={send} style={{ width: 46, height: 46, borderRadius: 999, background: C.mokka, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 6px 16px rgba(122,92,67,.3)" }}><Send size={18} color={C.cream} /></button>
          </div>
        </div>
      );
    }
    const threadIds = Object.keys(threads);
    return (
      <div>
        <div style={{ padding: "26px 4px 18px" }}><Eyebrow>Beskeder</Eyebrow><H size={30} style={{ marginTop: 6 }}>Indbakke</H></div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {threadIds.map(id => {
            const last = threads[id][threads[id].length - 1];
            return (
              <Card key={id} pad={14} onClick={() => setActiveThread(id)} style={{ display: "flex", gap: 13, alignItems: "center" }}>
                <Avatar name={playersById[id].name} size={46} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 15, color: C.espresso }}>{playersById[id].name}</div>
                  <div style={{ fontFamily: sans, fontSize: 13, color: C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 2 }}>{last.from === "me" ? "Dig: " : ""}{last.text}</div>
                </div>
                <div style={{ fontFamily: sans, fontSize: 11.5, color: C.muted }}>{last.time}</div>
              </Card>
            );
          })}
          <Card pad={16} style={{ textAlign: "center", background: C.beige, border: "none" }}>
            <div style={{ fontFamily: sans, fontSize: 13.5, color: C.mokkaDeep }}>Start en ny samtale ved at åbne en spillers profil fra ranglisten</div>
          </Card>
        </div>
      </div>
    );
  };

  const renderEventDetail = (ev) => {
    const isIn = ev.registered.includes(ME), onWL = ev.waitlist.includes(ME);
    const full = ev.registered.length >= ev.capacity;
    const sorted = ev.registered.map(id => playersById[id]).sort((a, b) => b.points - a.points);
    return (
      <div>
        <button onClick={() => setEventDetailId(null)} style={{ background: "none", border: "none", color: C.mokka, fontFamily: sans, fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", gap: 6, padding: "18px 0 0", cursor: "pointer" }}><ArrowLeft size={16} /> Alle kampdage</button>
        <div style={{ padding: "20px 4px 16px" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Eyebrow>{ev.title}</Eyebrow>
            {ev.date === TODAY && <Tag tone="mokka">I dag</Tag>}
            {full && <Tag tone="clay">Fuldt</Tag>}
          </div>
          <H size={27} style={{ marginTop: 6 }}>{fmtDateLong(ev.date)}</H>
          <div style={{ fontFamily: sans, fontSize: 13.5, color: C.muted, marginTop: 8, display: "flex", gap: 14, flexWrap: "wrap" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Clock size={13} />kl. {ev.time} · 2 timer</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><User size={13} />{ev.registered.length}/{ev.capacity} pladser</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
          {ev.date === TODAY && isIn && ev.status === "åben" && <Btn onClick={() => startMatchday(ev)} style={{ flex: 1 }}><Swords size={16} /> Gå til kampdagen</Btn>}
          {!isIn && !onWL && <Btn kind={full ? "soft" : "primary"} onClick={() => joinEvent(ev.id)} style={{ flex: 1 }}>{full ? "Skriv på venteliste" : "Tilmeld dig"}</Btn>}
          {(isIn || onWL) && <Btn kind="ghost" onClick={() => leaveEvent(ev.id)} style={{ flex: 1 }}>{onWL ? "Forlad venteliste" : "Afmeld"}</Btn>}
        </div>
        <Eyebrow style={{ padding: "0 4px" }}>Tilmeldte spillere ({ev.registered.length})</Eyebrow>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
          {sorted.map(p => (
            <Card key={p.id} pad={12} onClick={() => { setViewPlayerId(p.id); setTab("profil"); }} style={{ display: "flex", alignItems: "center", gap: 12, border: p.id === ME ? `1.5px solid ${C.mokka}` : `1px solid ${C.line}` }}>
              <Avatar name={p.name} size={36} />
              <div style={{ flex: 1, fontFamily: sans, fontWeight: 600, fontSize: 14, color: C.espresso }}>{p.name}{p.id === ME && <Tag tone="mokka"> dig</Tag>}</div>
              <div style={{ fontFamily: serif, fontWeight: 700, fontSize: 16, color: C.espresso }}>{p.points} <span style={{ fontFamily: sans, fontSize: 10.5, color: C.muted, fontWeight: 500 }}>point</span></div>
            </Card>
          ))}
          {ev.registered.length === 0 && <Card pad={16} style={{ textAlign: "center", background: C.beige, border: "none", fontFamily: sans, fontSize: 13, color: C.mokkaDeep }}>Ingen tilmeldte endnu – vær den første!</Card>}
        </div>
        {ev.waitlist.length > 0 && (
          <>
            <Eyebrow style={{ padding: "18px 4px 0" }}>Venteliste ({ev.waitlist.length})</Eyebrow>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
              {ev.waitlist.map((pid, i) => (
                <Card key={pid} pad={12} style={{ display: "flex", alignItems: "center", gap: 12, opacity: .85 }}>
                  <span style={{ fontFamily: serif, fontWeight: 700, fontSize: 14, color: C.muted, width: 18, textAlign: "center" }}>{i + 1}</span>
                  <Avatar name={playersById[pid].name} size={32} />
                  <div style={{ flex: 1, fontFamily: sans, fontWeight: 500, fontSize: 13.5, color: C.espresso }}>{playersById[pid].name}</div>
                  <span style={{ fontFamily: sans, fontSize: 12, color: C.muted }}>{playersById[pid].points} point</span>
                </Card>
              ))}
            </div>
          </>
        )}
        {ev.pendingOffer && (
          <div style={{ marginTop: 14, background: C.gold + "1c", border: `1px dashed ${C.gold}`, borderRadius: 14, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
            <Smartphone size={16} color="#8a6b3c" />
            <span style={{ flex: 1, fontFamily: sans, fontSize: 12.5, color: "#8a6b3c" }}>Plads tilbudt via SMS til {firstName(playersById[ev.pendingOffer].name)}</span>
            <Btn small kind="soft" onClick={() => acceptOffer(ev.id)}>Simulér accept</Btn>
          </div>
        )}
      </div>
    );
  };

  const renderEvents = () => {
    const detail = events.find(e => e.id === eventDetailId && e.status !== "afsluttet");
    if (detail) return renderEventDetail(detail);
    return (
    <div>
      <div style={{ padding: "26px 4px 18px" }}>
        <Eyebrow>Kommende kampe</Eyebrow>
        <H size={30} style={{ marginTop: 6 }}>Ranglistedage</H>
        <p style={{ fontFamily: sans, color: C.muted, fontSize: 14, margin: "8px 0 0", lineHeight: 1.5 }}>Tilmeld dig – er der fyldt, kommer du på venteliste og får en SMS, når en plads bliver ledig.</p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {events.filter(e => e.status !== "afsluttet").map(ev => {
          const isIn = ev.registered.includes(ME), onWL = ev.waitlist.includes(ME);
          const full = ev.registered.length >= ev.capacity;
          const today = ev.date === TODAY;
          return (
            <Card key={ev.id} style={today ? { border: `1.5px solid ${C.mokka}`, background: `linear-gradient(160deg, ${C.cream}, ${C.beige}55)` } : {}}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                <div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <H size={19}>{ev.title}</H>
                    {today && <Tag tone="mokka">I dag</Tag>}
                    {full && !today && <Tag tone="clay">Fuldt</Tag>}
                  </div>
                  <div style={{ fontFamily: sans, fontSize: 13.5, color: C.muted, marginTop: 6, display: "flex", gap: 14, flexWrap: "wrap" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Calendar size={13} />{fmtDateLong(ev.date)}</span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Clock size={13} />kl. {ev.time}</span>
                  </div>
                </div>
                <div style={{ textAlign: "center", background: C.sand, borderRadius: 14, padding: "8px 12px", minWidth: 62 }}>
                  <div style={{ fontFamily: serif, fontWeight: 700, fontSize: 17, color: C.espresso }}>{ev.registered.length}<span style={{ color: C.muted, fontSize: 13 }}>/{ev.capacity}</span></div>
                  <div style={{ fontFamily: sans, fontSize: 9.5, letterSpacing: ".1em", color: C.muted, textTransform: "uppercase" }}>Pladser</div>
                </div>
              </div>
              <div style={{ display: "flex", marginTop: 14, gap: 0 }}>
                {ev.registered.slice(0, 7).map((pid, i) => <div key={pid} style={{ marginLeft: i ? -8 : 0 }}><Avatar name={playersById[pid].name} size={30} /></div>)}
                {ev.registered.length > 7 && <div style={{ marginLeft: -8, width: 30, height: 30, borderRadius: 999, background: C.mokka, color: C.cream, fontFamily: sans, fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center" }}>+{ev.registered.length - 7}</div>}
                {ev.waitlist.length > 0 && <span style={{ marginLeft: 12, alignSelf: "center", fontFamily: sans, fontSize: 12, color: C.muted }}>{ev.waitlist.length} på venteliste</span>}
              </div>
              <button onClick={() => setEventDetailId(ev.id)} style={{ marginTop: 12, width: "100%", background: C.sand, border: `1px solid ${C.line}`, borderRadius: 12, padding: "10px 14px", fontFamily: sans, fontSize: 13, fontWeight: 600, color: C.mokkaDeep, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}>Se deltagere & detaljer <ChevronRight size={15} /></button>
              {ev.pendingOffer && (
                <div style={{ marginTop: 12, background: C.gold + "1c", border: `1px dashed ${C.gold}`, borderRadius: 14, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                  <Smartphone size={16} color="#8a6b3c" />
                  <span style={{ flex: 1, fontFamily: sans, fontSize: 12.5, color: "#8a6b3c" }}>Plads tilbudt via SMS til {firstName(playersById[ev.pendingOffer].name)}</span>
                  <Btn small kind="soft" onClick={() => acceptOffer(ev.id)}>Simulér accept</Btn>
                </div>
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                {today && isIn && ev.status === "åben" && <Btn onClick={() => startMatchday(ev)} style={{ flex: 1 }}><Swords size={16} /> Gå til kampdagen</Btn>}
                {!isIn && !onWL && <Btn kind={full ? "soft" : "primary"} onClick={() => joinEvent(ev.id)} style={{ flex: 1 }}>{full ? "Skriv på venteliste" : "Tilmeld dig"}</Btn>}
                {(isIn || onWL) && <Btn kind="ghost" onClick={() => leaveEvent(ev.id)} style={today && isIn ? {} : { flex: 1 }}>{onWL ? "Forlad venteliste" : "Afmeld"}</Btn>}
                {isIn && !today && <Tag tone="olive"><Check size={11} style={{ verticalAlign: "-1.5px", marginRight: 3 }} />Tilmeldt</Tag>}
                {onWL && <Tag tone="gold">Venteliste nr. {ev.waitlist.indexOf(ME) + 1}</Tag>}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
    );
  };

  const renderMatchday = () => {
    if (!matchday) return <div style={{ padding: 40, textAlign: "center", fontFamily: sans, color: C.muted }}>Ingen aktiv kampdag. Gå til <b>Kampe</b> og start dagens begivenhed.</div>;
    const md = matchday;
    const ev = events.find(e => e.id === md.eventId);
    const minsLeft = Math.max(0, 120 - Math.floor((clock - md.startedAt) / 60000));

    if (md.stage === "lobby") return (
      <div>
        <div style={{ padding: "26px 4px 16px" }}>
          <Eyebrow>{ev.title} · kl. {ev.time}</Eyebrow>
          <H size={28} style={{ marginTop: 6 }}>Baner & niveaumatch</H>
          <p style={{ fontFamily: sans, color: C.muted, fontSize: 14, margin: "8px 0 0", lineHeight: 1.55 }}>Spillerne er matchet på niveau – de fire tætteste point på hver bane. Kampdagen varer <b>2 timer</b>: I roterer holdene og spiller så mange sæt, I når. Kampen kan startes fra 10 min. før.</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {md.courts.map((c, i) => (
            <Card key={i} pad={16} style={i === md.myCourtIdx ? { border: `1.5px solid ${C.mokka}` } : {}}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontFamily: serif, fontWeight: 600, fontSize: 17, color: C.espresso }}>Bane {i + 1}{i === md.myCourtIdx && <span style={{ fontFamily: sans, fontSize: 12, color: C.mokka, marginLeft: 8 }}>· din bane</span>}</div>
                <Tag>Ø {Math.round(c.reduce((a, id) => a + playersById[id].points, 0) / 4)} point</Tag>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
                {c.map(pid => (
                  <div key={pid} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Avatar name={playersById[pid].name} size={28} />
                    <span style={{ flex: 1, fontFamily: sans, fontSize: 13.5, fontWeight: pid === ME ? 700 : 500, color: C.espresso }}>{playersById[pid].name}</span>
                    <span style={{ fontFamily: sans, fontSize: 12.5, color: C.muted }}>{playersById[pid].points} p</span>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
        <div style={{ position: "sticky", bottom: 86, marginTop: 16 }}>
          <Btn onClick={() => setMatchday({ ...md, stage: "bane", startedAt: Date.now() })} style={{ width: "100%" }}><Swords size={17} /> Start kamp – bane {md.myCourtIdx + 1}</Btn>
          <div style={{ textAlign: "center", fontFamily: sans, fontSize: 12, color: C.muted, marginTop: 8 }}>Åbnet · kampstart om 8 min.</div>
        </div>
      </div>
    );

    const pr = currentPairing(md);
    const comboNo = (md.round % 3) + 1;
    const meLeft = pr.left.includes(ME);
    const myPartner = (meLeft ? pr.left : pr.right).find(x => x !== ME);

    if (md.stage === "bane") return (
      <div>
        <div style={{ padding: "26px 4px 14px", textAlign: "center" }}>
          <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 8 }}>
            <Tag><Clock size={11} style={{ verticalAlign: "-1.5px", marginRight: 4 }} />{minsLeft} min tilbage</Tag>
            <Tag tone="mokka">Sæt {md.round + 1}</Tag>
          </div>
          <H size={26}>Din opstilling</H>
          <p style={{ fontFamily: sans, fontSize: 13, color: C.muted, margin: "6px 0 0" }}>Holdkombination {comboNo} af 3 – rotationen fortsætter, så længe der er tid</p>
        </div>
        <Card pad={14}>
          <CourtSVG left={pr.left} right={pr.right} meId={ME} playersById={playersById} />
          <div style={{ marginTop: 12, background: C.sand, borderRadius: 14, padding: "12px 16px", fontFamily: sans, fontSize: 14, color: C.espresso, textAlign: "center", lineHeight: 1.5 }}>
            Din makker er <b>{firstName(playersById[myPartner].name)}</b> – I starter i <b>{meLeft ? "venstre" : "højre"} side</b>
          </div>
        </Card>
        {md.results.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
            {md.results.map((r, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: sans, fontSize: 12.5, color: C.muted, background: C.cream, border: `1px solid ${C.line}`, borderRadius: 12, padding: "8px 14px" }}>
                <span style={{ fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", fontSize: 10.5 }}>S{i + 1}</span>
                <span style={{ flex: 1 }}>{r.left.map(x => firstName(playersById[x].name)).join(" & ")} vs. {r.right.map(x => firstName(playersById[x].name)).join(" & ")}</span>
                <b style={{ color: C.espresso }}>{r.score[0]}–{r.score[1]}</b>
              </div>
            ))}
          </div>
        )}
        <Btn onClick={() => setMatchday({ ...md, stage: "score" })} style={{ width: "100%", marginTop: 16 }}>Sættet er spillet – indtast resultat</Btn>
        <Btn kind="ghost" disabled={md.results.length === 0} onClick={() => setMatchday({ ...md, stage: "point" })} style={{ width: "100%", marginTop: 8 }}><Trophy size={15} /> Afslut kampdag & beregn point</Btn>
        <div style={{ textAlign: "center", fontFamily: sans, fontSize: 11.5, color: C.muted, marginTop: 8 }}>Når de 2 timer er gået: indtast jeres sidste sæt og afslut kampdagen her.</div>
      </div>
    );

    if (md.stage === "score") {
      const loserOptions = md.wScore === 7 ? [5, 6] : md.wScore === 6 ? [0, 1, 2, 3, 4, 5] : [];
      const ok = md.winners && md.wScore !== null && md.lScore !== null;
      return (
        <div>
          <div style={{ padding: "26px 4px 14px", textAlign: "center" }}>
            <Eyebrow>Sæt {md.round + 1} · Resultat</Eyebrow>
            <H size={26} style={{ marginTop: 6 }}>Hvem vandt sættet?</H>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {[["L", pr.left, "Venstre"], ["R", pr.right, "Højre"]].map(([key, team, side]) => (
              <Card key={key} pad={16} onClick={() => setMatchday({ ...md, winners: key })} style={{ textAlign: "center", border: md.winners === key ? `2px solid ${C.mokka}` : `1px solid ${C.line}`, background: md.winners === key ? C.beige : C.cream }}>
                <Eyebrow style={{ letterSpacing: ".14em" }}>{side} side</Eyebrow>
                <div style={{ display: "flex", justifyContent: "center", margin: "10px 0 8px" }}>
                  <Avatar name={playersById[team[0]].name} size={34} /><div style={{ marginLeft: -8 }}><Avatar name={playersById[team[1]].name} size={34} /></div>
                </div>
                <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 13.5, color: C.espresso, lineHeight: 1.4 }}>{firstName(playersById[team[0]].name)} & {firstName(playersById[team[1]].name)}</div>
                {md.winners === key && <Tag tone="mokka">Vinder <Check size={11} style={{ verticalAlign: "-1.5px" }} /></Tag>}
              </Card>
            ))}
          </div>
          <Card style={{ marginTop: 12 }}>
            <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 13.5, color: C.espresso, marginBottom: 8 }}>Partier – vinderholdet</div>
            <Chips options={[6, 7]} value={md.wScore} onChange={v => setMatchday({ ...md, wScore: v, lScore: null })} />
            <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 13.5, color: C.espresso, margin: "16px 0 8px" }}>Partier – taberholdet</div>
            {md.wScore === null
              ? <div style={{ fontFamily: sans, fontSize: 12.5, color: C.muted }}>Vælg vinderholdets partier først</div>
              : <Chips options={loserOptions} value={md.lScore} onChange={v => setMatchday({ ...md, lScore: v })} />}
            {md.wScore === 7 && <div style={{ marginTop: 12, fontFamily: sans, fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>Et sæt vundet 7–5 afgøres efter 5–5, og 7–6 betyder tiebreak – derfor kan taberholdet kun have 5 eller 6 partier.</div>}
            {md.wScore === 6 && <div style={{ marginTop: 12, fontFamily: sans, fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>Ved 6 vundne partier kan taberholdet have 0–5 – ellers ville sættet være gået i tiebreak.</div>}
          </Card>
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <Btn kind="ghost" onClick={() => setMatchday({ ...md, stage: "bane", winners: null, wScore: null, lScore: null })}><ChevronLeft size={16} /> Tilbage</Btn>
            <Btn disabled={!ok} onClick={() => confirmSet(md)} style={{ flex: 1 }}>Gem sæt – holdene roterer</Btn>
          </div>
        </div>
      );
    }

    if (md.stage === "point") {
      const rows = dayPoints(md);
      return (
        <div>
          <div style={{ padding: "26px 4px 14px", textAlign: "center" }}>
            <Eyebrow>Bane {md.myCourtIdx + 1} · {md.results.length} sæt spillet</Eyebrow>
            <H size={26} style={{ marginTop: 6 }}>Dagens pointændringer</H>
            <p style={{ fontFamily: sans, fontSize: 13, color: C.muted, margin: "8px 0 0", lineHeight: 1.55 }}>Formlen vægter pointdifferencen: Δ = K × (faktisk − forventet) pr. sæt. Slår du spillere med flere point, tjener du ekstra – taber du som favorit, koster det mere.</p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {rows.map((r, i) => (
              <Card key={r.pid} pad={16} style={{ display: "flex", alignItems: "center", gap: 13 }}>
                <div style={{ fontFamily: serif, fontWeight: 700, fontSize: 18, color: i === 0 ? C.gold : C.muted, width: 22, textAlign: "center" }}>{i + 1}</div>
                <Avatar name={playersById[r.pid].name} size={40} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 14.5, color: C.espresso }}>{playersById[r.pid].name}{r.pid === ME ? " (dig)" : ""}</div>
                  <div style={{ fontFamily: sans, fontSize: 12, color: C.muted, marginTop: 2 }}>{r.won}/{r.n} sæt vundet · forventet {Math.round(r.E * 100 / r.n)}% – faktisk {Math.round(r.S * 100 / r.n)}%</div>
                </div>
                <div style={{ fontFamily: serif, fontWeight: 700, fontSize: 20, color: r.delta >= 0 ? C.olive : C.clay }}>{r.delta >= 0 ? "+" : ""}{r.delta}</div>
              </Card>
            ))}
          </div>
          <Btn onClick={() => applyMatchday(md)} style={{ width: "100%", marginTop: 16 }}><Trophy size={16} /> Godkend & opdater ranglisten</Btn>
          <Btn kind="ghost" onClick={() => setMatchday({ ...md, stage: "bane" })} style={{ width: "100%", marginTop: 8 }}><ChevronLeft size={15} /> Tilbage – spil et sæt mere</Btn>
        </div>
      );
    }

    return (
      <div style={{ textAlign: "center", padding: "60px 20px" }}>
        <div style={{ width: 74, height: 74, borderRadius: 999, background: C.beige, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 18px" }}><Trophy size={32} color={C.mokka} /></div>
        <H size={26}>Kampdagen er afsluttet</H>
        <p style={{ fontFamily: sans, fontSize: 14, color: C.muted, margin: "10px 0 22px", lineHeight: 1.55 }}>Point, sejre og kamphistorik er registreret på alle fire spillere.</p>
        <Btn onClick={() => { setMatchday(null); setTab("rangliste"); }}>Se den nye rangliste</Btn>
      </div>
    );
  };

  const renderAdmin = () => {
    if (!admin) return (
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
          <div style={{ display: "flex", gap: 6 }}><Btn small kind="ghost" onClick={() => setTab("rangliste")}>Til appen</Btn><Btn small kind="ghost" onClick={() => { setAdmin(false); setAdminCreds({ email: "", pass: "" }); }}>Log ud</Btn></div>
        </div>

        <Card>
          <Eyebrow>Opret ranglistedag</Eyebrow>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
            <input value={newEvent.title} onChange={e => setNewEvent({ ...newEvent, title: e.target.value })} placeholder="Titel" style={{ gridColumn: "1 / -1", fontFamily: sans, fontSize: 14, padding: "11px 14px", borderRadius: 12, border: `1px solid ${C.line}`, background: C.sand, outline: "none" }} />
            <input type="date" value={newEvent.date} onChange={e => setNewEvent({ ...newEvent, date: e.target.value })} style={{ fontFamily: sans, fontSize: 14, padding: "11px 14px", borderRadius: 12, border: `1px solid ${C.line}`, background: C.sand, outline: "none" }} />
            <input type="time" value={newEvent.time} onChange={e => setNewEvent({ ...newEvent, time: e.target.value })} style={{ fontFamily: sans, fontSize: 14, padding: "11px 14px", borderRadius: 12, border: `1px solid ${C.line}`, background: C.sand, outline: "none" }} />
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

        <div style={{ padding: "22px 4px 10px" }}><Eyebrow>SMS-log (simuleret gateway)</Eyebrow></div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {smsLog.length === 0 && <Card pad={16} style={{ background: C.beige, border: "none", textAlign: "center", fontFamily: sans, fontSize: 13, color: C.mokkaDeep }}>Ingen SMS'er sendt endnu. Afmeld en spiller fra en fuld begivenhed – eller aflys en dag – for at se notifikationer.</Card>}
          {smsLog.map((s, i) => (
            <Card key={i} pad={14} style={{ display: "flex", gap: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: 12, background: C.beige, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Smartphone size={16} color={C.mokka} /></div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: sans, fontSize: 12.5, color: C.muted }}>Til {s.name} · {s.to} · {s.time}</div>
                <div style={{ fontFamily: sans, fontSize: 13.5, color: C.espresso, marginTop: 4, lineHeight: 1.5 }}>{s.text}</div>
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

  return (
    <div style={{ minHeight: "100vh", background: C.sand, fontFamily: sans, color: C.espresso }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Outfit:wght@300;400;500;600;700&display=swap');
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        body { margin: 0; }
        ::-webkit-scrollbar { width: 6px; height: 6px; } ::-webkit-scrollbar-thumb { background: ${C.line}; border-radius: 99px; }
        button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid ${C.mokka}; outline-offset: 2px; }
        @keyframes rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .view { animation: rise .35s ease both; }
        @media (prefers-reduced-motion: reduce) { .view { animation: none; } }
      `}</style>

      <header style={{ position: "sticky", top: 0, zIndex: 20, background: C.sand + "e6", backdropFilter: "blur(10px)", borderBottom: `1px solid ${C.line}` }}>
        <div style={{ maxWidth: 560, margin: "0 auto", padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Logo />
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {admin && <Tag tone="mokka"><Shield size={11} style={{ verticalAlign: "-1.5px", marginRight: 4 }} />Admin</Tag>}
            <div onClick={() => { setViewPlayerId(null); setTab("profil"); }} style={{ cursor: "pointer" }}><Avatar name={me.name} size={36} ring /></div>
          </div>
        </div>
      </header>

      {toast && (
        <div style={{ position: "fixed", top: 74, left: "50%", transform: "translateX(-50%)", zIndex: 50, background: C.espresso, color: C.cream, fontFamily: sans, fontSize: 13.5, fontWeight: 500, padding: "11px 20px", borderRadius: 999, boxShadow: shadow, maxWidth: "88%", textAlign: "center" }}>{toast}</div>
      )}

      <main style={{ maxWidth: 560, margin: "0 auto", padding: "0 20px 120px" }}>
        <div className="view" key={tab + (viewPlayerId || "") + (activeThread || "") + (matchday ? matchday.stage : "")}>
          {tab === "rangliste" && renderRanking()}
          {tab === "kampe" && renderEvents()}
          {tab === "kampdag" && renderMatchday()}
          {tab === "beskeder" && renderMessages()}
          {tab === "profil" && renderProfile()}
          {tab === "admin" && renderAdmin()}
        </div>
        {tab !== "admin" && (
          <div style={{ textAlign: "center", padding: "34px 0 0" }}>
            <button onClick={() => setTab("admin")} style={{ background: "none", border: "none", fontFamily: sans, fontSize: 11.5, letterSpacing: ".08em", color: C.muted, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3 }}>Centeradministration</button>
            <div style={{ fontFamily: sans, fontSize: 10.5, letterSpacing: ".14em", color: C.muted, textTransform: "uppercase", marginTop: 12, opacity: .7 }}>Powered by {CENTER.platform}</div>
          </div>
        )}
      </main>

      {tab !== "admin" && <nav style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 30, background: C.cream + "f2", backdropFilter: "blur(12px)", borderTop: `1px solid ${C.line}` }}>
        <div style={{ maxWidth: 560, margin: "0 auto", display: "flex", padding: "8px 8px calc(10px + env(safe-area-inset-bottom))" }}>
          {navItems.map(item => {
            const active = tab === item.id;
            const Icon = item.icon;
            return (
              <button key={item.id} onClick={() => { setTab(item.id); if (item.id === "profil") setViewPlayerId(null); if (item.id === "beskeder") setActiveThread(null); }} style={{ flex: 1, background: "none", border: "none", cursor: "pointer", padding: "7px 2px", display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <div style={{ width: 40, height: 28, borderRadius: 999, background: active ? C.beige : "transparent", display: "flex", alignItems: "center", justifyContent: "center", transition: "background .2s" }}>
                  <Icon size={19} color={active ? C.mokkaDeep : C.muted} strokeWidth={active ? 2.4 : 2} />
                </div>
                <span style={{ fontFamily: sans, fontSize: 10, fontWeight: active ? 700 : 500, letterSpacing: ".03em", color: active ? C.mokkaDeep : C.muted }}>{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>}
    </div>
  );
}
