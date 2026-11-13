import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // The app still runs on mock data without Supabase configured;
  // warn instead of crashing so the demo keeps working.
  console.warn(
    "Supabase env vars missing (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY) — running in demo mode."
  );
}

/** What kind of e-mail link opened the app, if any ("recovery" for a
 *  password reset, "invite" for a new center admin). Read before the client
 *  is created, because the client strips the token from the URL. */
export const authLinkType = (() => {
  try {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const query = new URLSearchParams(window.location.search);
    return hash.get("type") || query.get("type") || null;
  } catch {
    return null;
  }
})();

export const supabase = url && anonKey ? createClient(url, anonKey) : null;
