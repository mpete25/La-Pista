import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase.js";

/** Tracks the Supabase auth session. In demo mode (no Supabase configured)
 *  it simply reports "not loading, no session". */
export function useAuth() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(!!supabase);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  return { session, loading };
}
