import React, { useState } from "react";
import { supabase } from "../lib/supabase.js";
import { PLATFORM } from "../config/center.js";
import { C, softShadow, serif, sans } from "../theme.js";

const inputStyle = {
  fontFamily: sans,
  fontSize: 14.5,
  padding: "13px 16px",
  borderRadius: 14,
  border: `1px solid ${C.line}`,
  background: C.cream,
  color: C.espresso,
  outline: "none",
  width: "100%",
};

const mapError = (e) => {
  const msg = e?.message || "";
  if (msg.includes("Invalid login credentials")) return "Forkert e-mail eller adgangskode.";
  if (msg.includes("already registered")) return "Der findes allerede en konto med denne e-mail.";
  if (msg.includes("at least 6 characters")) return "Adgangskoden skal være mindst 6 tegn.";
  if (msg.includes("valid email")) return "Indtast en gyldig e-mailadresse.";
  return "Noget gik galt — prøv igen. (" + msg + ")";
};

export default function AuthScreen({ center }) {
  const [mode, setMode] = useState("login"); // 'login' | 'signup'
  const [form, setForm] = useState({ email: "", password: "", fullName: "", phone: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    if (busy) return;
    if (!form.email.trim() || !form.password) { setError("Udfyld e-mail og adgangskode."); return; }
    if (mode === "signup" && !form.fullName.trim()) { setError("Skriv dit fulde navn."); return; }
    setBusy(true);
    setError(null);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email: form.email.trim(),
          password: form.password,
          options: {
            data: {
              center_slug: center.slug,
              full_name: form.fullName.trim(),
              phone: form.phone.trim(),
            },
          },
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: form.email.trim(),
          password: form.password,
        });
        if (error) throw error;
      }
      // Success: useAuth's onAuthStateChange swaps AuthScreen out for the app.
    } catch (e) {
      setError(mapError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: C.sand, fontFamily: sans, color: C.espresso, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Outfit:wght@300;400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; }
        input:focus-visible, button:focus-visible { outline: 2px solid ${C.mokka}; outline-offset: 2px; }
      `}</style>
      <div style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ textAlign: "center", marginBottom: 26 }}>
          <svg width="44" height="44" viewBox="0 0 30 30" aria-hidden>
            <defs><linearGradient id="sunAuth" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={C.gold} /><stop offset="1" stopColor={C.mokka} /></linearGradient></defs>
            <path d="M4 19 a11 11 0 0 1 22 0" fill="url(#sunAuth)" />
            <line x1="2" y1="19" x2="28" y2="19" stroke={C.espresso} strokeWidth="2" strokeLinecap="round" />
            <line x1="7" y1="24" x2="23" y2="24" stroke={C.mokka} strokeWidth="2" strokeLinecap="round" opacity=".55" />
          </svg>
          <div style={{ fontFamily: serif, fontWeight: 700, fontSize: 26, letterSpacing: ".05em", textTransform: "uppercase", marginTop: 10 }}>{center.name}</div>
          <div style={{ fontFamily: sans, fontSize: 11, letterSpacing: ".28em", color: C.muted, textTransform: "uppercase", marginTop: 4 }}>{center.city} · Rangliste</div>
        </div>

        <div style={{ background: C.cream, border: `1px solid ${C.line}`, borderRadius: 22, padding: 24, boxShadow: softShadow }}>
          <div style={{ display: "flex", background: C.beige, borderRadius: 999, padding: 4, marginBottom: 18 }}>
            {[["login", "Log ind"], ["signup", "Opret profil"]].map(([m, label]) => (
              <button key={m} onClick={() => { setMode(m); setError(null); }} style={{ flex: 1, fontFamily: sans, fontWeight: 600, fontSize: 13.5, padding: "9px 0", borderRadius: 999, border: "none", cursor: "pointer", background: mode === m ? C.cream : "transparent", color: mode === m ? C.espresso : C.muted, boxShadow: mode === m ? softShadow : "none", transition: "background .15s" }}>{label}</button>
            ))}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {mode === "signup" && (
              <>
                <input value={form.fullName} onChange={set("fullName")} placeholder="Fulde navn" autoComplete="name" style={inputStyle} />
                <input value={form.phone} onChange={set("phone")} placeholder="Mobilnummer (til SMS ved ledige pladser)" autoComplete="tel" style={inputStyle} />
              </>
            )}
            <input value={form.email} onChange={set("email")} type="email" placeholder="E-mail" autoComplete="email" style={inputStyle} />
            <input value={form.password} onChange={set("password")} type="password" placeholder="Adgangskode" autoComplete={mode === "signup" ? "new-password" : "current-password"} onKeyDown={(e) => e.key === "Enter" && submit()} style={inputStyle} />
            {error && <div style={{ fontFamily: sans, fontSize: 13, color: C.clay, lineHeight: 1.45, padding: "2px 4px" }}>{error}</div>}
            <button onClick={submit} disabled={busy} style={{ fontFamily: sans, fontWeight: 600, fontSize: 15, borderRadius: 999, padding: "13px 22px", border: "none", cursor: busy ? "wait" : "pointer", opacity: busy ? 0.6 : 1, background: C.mokka, color: C.cream, boxShadow: "0 6px 16px rgba(122,92,67,.28)", marginTop: 4 }}>
              {busy ? "Vent…" : mode === "signup" ? "Opret profil" : "Log ind"}
            </button>
          </div>

          {mode === "signup" && (
            <p style={{ fontFamily: sans, fontSize: 12, color: C.muted, lineHeight: 1.5, margin: "14px 0 0", textAlign: "center" }}>
              Du starter på 500 point og bliver en del af ranglisten hos {center.name} med det samme.
            </p>
          )}
        </div>

        <div style={{ textAlign: "center", fontFamily: sans, fontSize: 10.5, letterSpacing: ".14em", color: C.muted, textTransform: "uppercase", marginTop: 18, opacity: 0.7 }}>
          Powered by {PLATFORM}
        </div>
      </div>
    </div>
  );
}
