import React, { useState } from "react";
import { supabase } from "../lib/supabase.js";
import { PLATFORM } from "../config/center.js";
import { C, G, softShadow, serif, sans, globalCss } from "../theme.js";

export const PRIVACY_URL = `${import.meta.env.BASE_URL}privatliv.html`;

const inputStyle = {
  fontFamily: sans,
  fontSize: 16, // 16px+ stops iOS Safari from zooming in on focus
  padding: "13px 16px",
  borderRadius: 14,
  border: `1px solid ${C.line}`,
  background: C.cream,
  color: C.espresso,
  outline: "none",
  width: "100%",
};

const linkBtn = {
  background: "none", border: "none", padding: 0, cursor: "pointer",
  fontFamily: sans, fontSize: 13, fontWeight: 600, color: C.mokka,
};

/* Same shape the database accepts: digits and spaces, optional leading +. */
const cleanPhone = (raw) => raw.replace(/[-().]/g, " ").replace(/\s+/g, " ").trim();

const mapError = (e) => {
  const msg = e?.message || "";
  if (msg.includes("Invalid login credentials")) return "Forkert e-mail eller adgangskode.";
  if (msg.includes("already registered")) return "Der findes allerede en konto med denne e-mail.";
  if (msg.includes("at least 6 characters") || msg.includes("Password should be")) return "Adgangskoden skal være mindst 6 tegn.";
  if (msg.includes("valid email")) return "Indtast en gyldig e-mailadresse.";
  if (msg.includes("same as the old") || msg.includes("different from the old")) return "Vælg en anden adgangskode end den gamle.";
  if (msg.includes("rate limit") || msg.includes("security purposes")) return "Du har prøvet for mange gange – vent et øjeblik og prøv igen.";
  return "Noget gik galt – prøv igen. (" + msg + ")";
};

/* Shared frame: logo, center name, card, footer. */
function AuthFrame({ center, children }) {
  return (
    <div style={{ minHeight: "100dvh", background: G.page, fontFamily: sans, color: C.espresso, display: "flex", alignItems: "center", justifyContent: "center", padding: "calc(20px + env(safe-area-inset-top)) 20px calc(20px + env(safe-area-inset-bottom))" }}>
      <style>{globalCss}</style>
      <div className="view" style={{ width: "100%", maxWidth: 400 }}>
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
          {children}
        </div>
        <div style={{ textAlign: "center", fontFamily: sans, fontSize: 10.5, letterSpacing: ".14em", color: C.muted, textTransform: "uppercase", marginTop: 18, opacity: 0.7 }}>
          Powered by {PLATFORM} · <a href={PRIVACY_URL} target="_blank" rel="noreferrer" style={{ color: C.muted }}>Privatliv</a>
        </div>
      </div>
    </div>
  );
}

const PrimaryBtn = ({ busy, onClick, children }) => (
  <button className="lp-btn" onClick={onClick} disabled={busy} style={{ fontFamily: sans, fontWeight: 600, fontSize: 15, borderRadius: 999, padding: "14px 22px", minHeight: 48, border: "none", cursor: busy ? "wait" : "pointer", opacity: busy ? 0.6 : 1, background: G.primary, color: C.cream, boxShadow: "0 8px 20px rgba(94,70,50,.30), inset 0 1px 0 rgba(255,255,255,.16)", marginTop: 4 }}>
    {busy ? "Vent…" : children}
  </button>
);

const ErrorText = ({ children }) => children
  ? <div role="alert" style={{ fontFamily: sans, fontSize: 13, color: C.clay, lineHeight: 1.45, padding: "2px 4px" }}>{children}</div>
  : null;

const Check = ({ checked, onChange, children }) => (
  <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontFamily: sans, fontSize: 13, lineHeight: 1.45, color: C.espresso, cursor: "pointer", padding: "2px 2px" }}>
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ width: 18, height: 18, marginTop: 1, accentColor: C.mokka, flexShrink: 0 }} />
    <span>{children}</span>
  </label>
);

export default function AuthScreen({ center }) {
  const [mode, setMode] = useState("login"); // 'login' | 'signup' | 'forgot'
  const [form, setForm] = useState({ email: "", password: "", fullName: "", phone: "" });
  const [privacyOk, setPrivacyOk] = useState(false);
  const [smsOk, setSmsOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const switchMode = (m) => { setMode(m); setError(null); setInfo(null); };

  const submit = async () => {
    if (busy) return;
    setError(null);
    setInfo(null);
    if (!form.email.trim()) { setError("Udfyld din e-mail."); return; }
    if (mode !== "forgot" && !form.password) { setError("Udfyld e-mail og adgangskode."); return; }
    if (mode === "signup") {
      if (!form.fullName.trim()) { setError("Skriv dit fulde navn."); return; }
      if (!privacyOk) { setError("Du skal acceptere privatlivspolitikken for at oprette en profil."); return; }
      if (form.password.length < 8) { setError("Vælg en adgangskode på mindst 8 tegn."); return; }
      if (form.phone.trim() && !/^\+?[0-9][0-9 ]{6,18}$/.test(cleanPhone(form.phone))) { setError("Mobilnummeret ser ikke rigtigt ud."); return; }
      if (smsOk && !form.phone.trim()) { setError("Skriv dit mobilnummer, hvis du vil have SMS."); return; }
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: form.email.trim(),
          password: form.password,
          options: {
            emailRedirectTo: window.location.origin + window.location.pathname + window.location.search,
            data: {
              center_slug: center.slug,
              full_name: form.fullName.trim(),
              phone: cleanPhone(form.phone),
              sms_consent: smsOk,
              privacy_accepted: privacyOk,
            },
          },
        });
        if (error) throw error;
        // With e-mail confirmation on, there is no session until the link is clicked.
        if (!data.session) setInfo("Tjek din e-mail og klik på linket for at bekræfte din profil.");
      } else if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(form.email.trim(), {
          redirectTo: window.location.origin + window.location.pathname + window.location.search,
        });
        if (error) throw error;
        // Same message whether or not the address exists, so nobody can probe for accounts.
        setInfo("Hvis der findes en profil med den e-mail, har vi sendt et link, så du kan vælge en ny adgangskode.");
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

  const onEnter = (e) => e.key === "Enter" && submit();

  if (mode === "forgot") {
    return (
      <AuthFrame center={center}>
        <div style={{ fontFamily: serif, fontWeight: 700, fontSize: 20, marginBottom: 6 }}>Glemt adgangskode?</div>
        <p style={{ fontFamily: sans, fontSize: 13.5, color: C.muted, lineHeight: 1.5, margin: "0 0 16px" }}>
          Skriv din e-mail, så sender vi dig et link til at vælge en ny adgangskode.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <input value={form.email} onChange={set("email")} onKeyDown={onEnter} type="email" placeholder="E-mail" autoComplete="email" style={inputStyle} />
          <ErrorText>{error}</ErrorText>
          {info && <div role="status" style={{ fontFamily: sans, fontSize: 13, color: C.olive, lineHeight: 1.45, padding: "2px 4px" }}>{info}</div>}
          <PrimaryBtn busy={busy} onClick={submit}>Send link</PrimaryBtn>
          <button onClick={() => switchMode("login")} style={{ ...linkBtn, marginTop: 6 }}>Tilbage til log ind</button>
        </div>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame center={center}>
      <div style={{ display: "flex", background: C.beige, borderRadius: 999, padding: 4, marginBottom: 18 }}>
        {[["login", "Log ind"], ["signup", "Opret profil"]].map(([m, label]) => (
          <button key={m} onClick={() => switchMode(m)} style={{ flex: 1, fontFamily: sans, fontWeight: 600, fontSize: 13.5, padding: "9px 0", borderRadius: 999, border: "none", cursor: "pointer", background: mode === m ? C.cream : "transparent", color: mode === m ? C.espresso : C.muted, boxShadow: mode === m ? softShadow : "none", transition: "background .15s" }}>{label}</button>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {mode === "signup" && (
          <>
            <input value={form.fullName} onChange={set("fullName")} placeholder="Fulde navn" autoComplete="name" style={inputStyle} />
            <input value={form.phone} onChange={set("phone")} type="tel" placeholder="Mobilnummer (valgfrit)" autoComplete="tel" style={inputStyle} />
          </>
        )}
        <input value={form.email} onChange={set("email")} type="email" placeholder="E-mail" autoComplete="email" style={inputStyle} />
        <input value={form.password} onChange={set("password")} type="password" placeholder="Adgangskode" autoComplete={mode === "signup" ? "new-password" : "current-password"} onKeyDown={onEnter} style={inputStyle} />

        {mode === "login" && (
          <button onClick={() => switchMode("forgot")} style={{ ...linkBtn, alignSelf: "flex-end", fontWeight: 500, color: C.muted }}>Glemt adgangskode?</button>
        )}

        {mode === "signup" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, margin: "4px 0 2px" }}>
            <Check checked={privacyOk} onChange={setPrivacyOk}>
              Jeg har læst og accepterer <a href={PRIVACY_URL} target="_blank" rel="noreferrer" style={{ color: C.mokka, fontWeight: 600 }}>privatlivspolitikken</a>.
            </Check>
            <Check checked={smsOk} onChange={setSmsOk}>
              Send mig en SMS, når der bliver en plads ledig, eller en kampdag bliver aflyst. Du kan altid slå det fra under Profil.
            </Check>
          </div>
        )}

        <ErrorText>{error}</ErrorText>
        {info && <div role="status" style={{ fontFamily: sans, fontSize: 13, color: C.olive, lineHeight: 1.45, padding: "2px 4px" }}>{info}</div>}
        <PrimaryBtn busy={busy} onClick={submit}>{mode === "signup" ? "Opret profil" : "Log ind"}</PrimaryBtn>
      </div>

      {mode === "signup" && (
        <p style={{ fontFamily: sans, fontSize: 12, color: C.muted, lineHeight: 1.5, margin: "14px 0 0", textAlign: "center" }}>
          Du starter på 500 point og bliver en del af ranglisten hos {center.name} med det samme.
        </p>
      )}
    </AuthFrame>
  );
}

/** Shown after a password-reset or invitation link: the user is signed in
 *  and picks a (new) password before entering the app. */
export function SetPasswordScreen({ center, onDone }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async () => {
    if (busy) return;
    setError(null);
    if (pw.length < 8) { setError("Adgangskoden skal være mindst 8 tegn."); return; }
    if (pw !== pw2) { setError("De to adgangskoder er ikke ens."); return; }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) throw error;
      onDone();
    } catch (e) {
      setError(mapError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame center={center}>
      <div style={{ fontFamily: serif, fontWeight: 700, fontSize: 20, marginBottom: 6 }}>Vælg en adgangskode</div>
      <p style={{ fontFamily: sans, fontSize: 13.5, color: C.muted, lineHeight: 1.5, margin: "0 0 16px" }}>
        Du er logget ind. Vælg den adgangskode, du vil bruge fremover.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input value={pw} onChange={(e) => setPw(e.target.value)} type="password" placeholder="Ny adgangskode" autoComplete="new-password" style={inputStyle} />
        <input value={pw2} onChange={(e) => setPw2(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} type="password" placeholder="Gentag adgangskode" autoComplete="new-password" style={inputStyle} />
        <ErrorText>{error}</ErrorText>
        <PrimaryBtn busy={busy} onClick={submit}>Gem adgangskode</PrimaryBtn>
      </div>
    </AuthFrame>
  );
}
