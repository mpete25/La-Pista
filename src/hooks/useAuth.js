import { useEffect, useState } from "react";
import { supabase, authLinkType } from "../lib/supabase.js";

/** Tracks the Supabase auth session. In demo mode (no Supabase configured)
 *  it simply reports "not loading, no session".
 *
 *  needsPassword is true when the user arrived through a password-reset or
 *  invitation link: they are signed in, but must choose a password before
 *  using the app. */
export function useAuth() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(!!supabase);
  const [needsPassword, setNeedsPassword] = useState(
    authLinkType === "recovery" || authLinkType === "invite"
  );

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === "PASSWORD_RECOVERY") setNeedsPassword(true);
      if (event === "SIGNED_OUT") setNeedsPassword(false);
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return { session, loading, needsPassword, passwordSet: () => setNeedsPassword(false) };
}
