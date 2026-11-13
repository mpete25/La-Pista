import React, { useEffect, useRef, useState } from "react";
import { C, G, softShadow, serif, sans, avatarTint } from "../theme.js";

/* ================= SMALL BUILDING BLOCKS ================= */

export const initials = (name) => name.split(" ").map(n => n[0]).slice(0, 2).join("");
export const firstName = (name) => name.split(" ")[0];

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export const Avatar = ({ name, size = 40, ring = false, ringColor = C.mokka }) => {
  const [from, to, ink] = avatarTint(name);
  return (
    <div style={{ width: size, height: size, borderRadius: 999, background: `linear-gradient(145deg, ${from}, ${to})`, color: ink, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: sans, fontWeight: 600, fontSize: size * 0.36, letterSpacing: ".02em", border: ring ? `2px solid ${ringColor}` : "1px solid rgba(255,255,255,.7)", boxShadow: ring ? `0 0 0 3px ${C.cream}` : "0 1px 2px rgba(46,37,25,.08)", flexShrink: 0 }}>
      {initials(name)}
    </div>
  );
};

/** A card. Clickable cards get press feedback and keyboard support. */
export const Card = ({ children, style = {}, onClick, pad = 20, className = "" }) => (
  <div
    onClick={onClick}
    {...(onClick ? { role: "button", tabIndex: 0, onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(e); } } } : {})}
    className={(onClick ? "lp-press " : "") + className}
    style={{ background: C.cream, border: `1px solid ${C.line}`, borderRadius: 22, padding: pad, boxShadow: softShadow, cursor: onClick ? "pointer" : "default", ...style }}
  >{children}</div>
);

export const Eyebrow = ({ children, style = {} }) => (
  <div style={{ fontFamily: sans, fontSize: 11, fontWeight: 600, letterSpacing: ".18em", textTransform: "uppercase", color: C.muted, ...style }}>{children}</div>
);

export const H = ({ children, size = 26, style = {} }) => (
  <h2 style={{ fontFamily: serif, fontWeight: 600, fontSize: size, color: C.espresso, margin: 0, lineHeight: 1.15, letterSpacing: "-.01em", ...style }}>{children}</h2>
);

export const Btn = ({ children, onClick, kind = "primary", disabled, small, style = {} }) => {
  const base = { fontFamily: sans, fontWeight: 600, fontSize: small ? 13 : 15, borderRadius: 999, padding: small ? "9px 16px" : "14px 22px", minHeight: small ? 36 : 48, border: "1px solid transparent", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.45 : 1, display: "inline-flex", alignItems: "center", gap: 8, justifyContent: "center" };
  const kinds = {
    primary: { background: G.primary, color: C.cream, boxShadow: "0 8px 20px rgba(94,70,50,.30), inset 0 1px 0 rgba(255,255,255,.16)" },
    court: { background: G.court, color: C.cream, boxShadow: "0 8px 20px rgba(72,86,58,.30), inset 0 1px 0 rgba(255,255,255,.18)" },
    ghost: { background: C.cream + "aa", color: C.mokkaDeep, border: `1px solid ${C.line}` },
    soft: { background: C.beige, color: C.mokkaDeep },
    danger: { background: "transparent", color: C.clay, border: `1px solid ${C.clay}55` },
  };
  return <button className="lp-btn" disabled={disabled} onClick={onClick} style={{ ...base, ...kinds[kind], ...style }}>{children}</button>;
};

export const Tag = ({ children, tone = "beige" }) => {
  const tones = {
    beige: [C.beige, C.mokkaDeep], olive: [C.olive + "22", "#55653C"], clay: [C.clay + "1e", "#9A553C"],
    mokka: [C.mokka, C.cream], gold: [C.gold + "26", "#7A5F2E"], court: [C.courtSoft, C.courtDeep],
    ball: [C.ball, "#4A3D12"],
  };
  const [bg, col] = tones[tone];
  return <span style={{ background: bg, color: col, fontFamily: sans, fontSize: 11.5, fontWeight: 600, padding: "4px 10px", borderRadius: 999, letterSpacing: ".04em", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 4 }}>{children}</span>;
};

/** A small padel ball. `live` adds the pulse used for "happening now". */
export const BallDot = ({ size = 9, live = false, style = {} }) => (
  <span aria-hidden style={{ width: size, height: size, borderRadius: 999, background: G.ball, display: "inline-block", flexShrink: 0, animation: live ? "lp-pulse 1.8s ease-out infinite" : "none", ...style }} />
);

export const Logo = ({ light = false, center }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
    <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden>
      <defs><linearGradient id="sun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={C.gold} /><stop offset="1" stopColor={C.mokka} /></linearGradient></defs>
      <path d="M4 19 a11 11 0 0 1 22 0" fill="url(#sun)" />
      <line x1="2" y1="19" x2="28" y2="19" stroke={light ? C.cream : C.espresso} strokeWidth="2" strokeLinecap="round" />
      <line x1="7" y1="24" x2="23" y2="24" stroke={light ? C.cream : C.mokka} strokeWidth="2" strokeLinecap="round" opacity=".55" />
    </svg>
    <div>
      <div style={{ fontFamily: serif, fontWeight: 700, fontSize: 19, letterSpacing: ".06em", color: light ? C.cream : C.espresso, lineHeight: 1, textTransform: "uppercase" }}>{center.name}</div>
      <div style={{ fontFamily: sans, fontSize: 9.5, letterSpacing: ".3em", color: light ? C.cream + "bb" : C.muted, textTransform: "uppercase", marginTop: 2 }}>{center.city} · Rangliste</div>
    </div>
  </div>
);

/** Animates a number towards its value (e.g. points after a match day). */
export function useCountUp(value, duration = 900) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reducedMotion() || typeof value !== "number") { setShown(value); from.current = value; return; }
    const start = from.current === value ? 0 : from.current;
    const t0 = performance.now();
    let raf;
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(start + (value - start) * eased));
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return shown;
}

export const CountUp = ({ value, prefix = "", suffix = "", duration }) => {
  const n = useCountUp(value, duration);
  return <>{prefix}{n}{suffix}</>;
};

/** A thin progress track with a faded fill. `value` is 0..1. */
export const Bar = ({ value, height = 6, fill = G.bar, track = C.beige, style = {} }) => (
  <div style={{ height, borderRadius: 999, background: track, overflow: "hidden", ...style }}>
    <div className="lp-grow" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, height: "100%", borderRadius: 999, background: fill }} />
  </div>
);

/** A bouncing ball: the app's loading indicator. */
export const BallLoader = ({ label }) => (
  <div role="status" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
    <div style={{ position: "relative", width: 40, height: 44 }}>
      <div style={{ position: "absolute", left: 11, top: 16, width: 18, height: 18, borderRadius: 999, background: G.ball, boxShadow: "inset -2px -3px 5px rgba(140,115,40,.35)", animation: "lp-bounce .7s infinite" }} />
      <div style={{ position: "absolute", left: 8, bottom: 2, width: 24, height: 5, borderRadius: 999, background: C.espresso, animation: "lp-shadow .7s infinite" }} />
    </div>
    {label && <div style={{ fontFamily: sans, fontSize: 14, color: C.muted, textAlign: "center", maxWidth: 300, lineHeight: 1.5 }}>{label}</div>}
  </div>
);

/** Padel court seen from above, with both pairs placed on their side. */
export const CourtSVG = ({ left, right, meId, playersById }) => {
  const chip = (pid, x, y) => {
    const me = pid === meId;
    return (
      <g key={pid + x}>
        <rect x={x - 62} y={y - 16} width="124" height="32" rx="16" fill={me ? C.ball : "rgba(255,253,248,.94)"} stroke={me ? C.ballDeep : "rgba(255,255,255,.6)"} strokeWidth="1" />
        <text x={x} y={y + 4.5} textAnchor="middle" fontFamily={sans} fontWeight={me ? 700 : 600} fontSize="12.5" fill={me ? "#4A3D12" : C.espresso}>{firstName(playersById[pid].name)}{me ? " (dig)" : ""}</text>
      </g>
    );
  };
  return (
    <svg viewBox="0 0 400 236" style={{ width: "100%", display: "block" }} role="img" aria-label="Banen set oppefra med de to hold">
      <defs>
        <linearGradient id="courtFill" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#7E9163" /><stop offset="1" stopColor={C.courtDeep} /></linearGradient>
        <linearGradient id="courtGlass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FFFFFF" stopOpacity=".5" /><stop offset="1" stopColor="#FFFFFF" stopOpacity=".12" /></linearGradient>
      </defs>
      {/* glass walls */}
      <rect x="6" y="6" width="388" height="224" rx="20" fill={C.courtSoft} />
      <rect x="6" y="6" width="388" height="224" rx="20" fill="url(#courtGlass)" />
      {/* playing surface */}
      <rect x="16" y="16" width="368" height="204" rx="12" fill="url(#courtFill)" />
      <g stroke="#FFFDF8" strokeLinecap="round" fill="none">
        <rect x="16" y="16" width="368" height="204" rx="12" strokeWidth="2.5" opacity=".95" />
        <line x1="84" y1="16" x2="84" y2="220" strokeWidth="1.8" opacity=".8" />
        <line x1="316" y1="16" x2="316" y2="220" strokeWidth="1.8" opacity=".8" />
        <line x1="84" y1="118" x2="316" y2="118" strokeWidth="1.8" opacity=".8" />
      </g>
      {/* net */}
      <line x1="200" y1="10" x2="200" y2="226" stroke={C.espresso} strokeWidth="4" opacity=".55" />
      <line x1="200" y1="10" x2="200" y2="226" stroke="#FFFDF8" strokeWidth="1.4" strokeDasharray="3 5" />
      <text x="50" y="34" textAnchor="middle" fontFamily={sans} fontSize="9.5" fontWeight="600" letterSpacing="2" fill="#FFFDF8" opacity=".85">VENSTRE</text>
      <text x="350" y="34" textAnchor="middle" fontFamily={sans} fontSize="9.5" fontWeight="600" letterSpacing="2" fill="#FFFDF8" opacity=".85">HØJRE</text>
      {/* a slow rally across the net */}
      <g style={{ "--rx": "150px", "--ry": "-34px", animation: "lp-rally 3.4s ease-in-out infinite" }}>
        <circle cx="126" cy="136" r="6" fill={C.ball} stroke={C.ballDeep} strokeWidth="1" />
      </g>
      {chip(left[0], 110, 78)}
      {chip(left[1], 110, 168)}
      {chip(right[0], 290, 78)}
      {chip(right[1], 290, 168)}
    </svg>
  );
};

/** Chip picker with dynamic options (padel score rules live in the caller). */
export const Chips = ({ options, value, onChange, label }) => (
  <div role="radiogroup" aria-label={label} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
    {options.map(n => {
      const on = value === n;
      return (
        <button key={n} role="radio" aria-checked={on} className="lp-btn" onClick={() => onChange(n)} style={{ width: 48, height: 48, borderRadius: 15, border: `1.5px solid ${on ? C.courtDeep : C.line}`, background: on ? G.court : C.cream, color: on ? C.cream : C.espresso, fontFamily: serif, fontWeight: 700, fontSize: 19, cursor: "pointer", boxShadow: on ? "0 6px 14px rgba(72,86,58,.28)" : "none" }}>{n}</button>
      );
    })}
  </div>
);

/** A few balls flying out from a point: the "day finished" flourish. */
export const BallBurst = () => {
  const balls = [[-78, -58], [70, -72], [-104, 6], [98, -8], [-46, -104], [40, -112], [-70, 56], [76, 48]];
  return (
    <div aria-hidden style={{ position: "absolute", left: "50%", top: "50%", width: 0, height: 0, pointerEvents: "none" }}>
      {balls.map(([dx, dy], i) => (
        <span key={i} style={{ position: "absolute", left: -5, top: -5, width: i % 3 ? 10 : 7, height: i % 3 ? 10 : 7, borderRadius: 999, background: i % 4 === 1 ? C.court : G.ball, opacity: 0, "--dx": `${dx}px`, "--dy": `${dy}px`, animation: `lp-burst 1.1s cubic-bezier(.2,.7,.3,1) ${0.15 + i * 0.04}s both` }} />
      ))}
    </div>
  );
};
