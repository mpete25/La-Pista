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

export const supabase = url && anonKey ? createClient(url, anonKey) : null;
