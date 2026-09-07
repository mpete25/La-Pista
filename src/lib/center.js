import { supabase } from "./supabase.js";

/**
 * Tenant resolution.
 *
 * Every center is its own tenant, so the app has to know which one it is
 * showing before anybody signs in. The slug comes from the URL — a
 * subdomain in production (padel-lounge.lapista.dk), or ?center= while
 * developing — with VITE_DEFAULT_CENTER_SLUG as the fallback for a
 * single-center deployment.
 */

// Subdomains that are the platform itself, never a center.
const RESERVED = new Set(["www", "app", "api", "admin", "staging", "preview"]);

export function centerSlugFromLocation(location) {
  const loc = location || (typeof window !== "undefined" ? window.location : null);
  if (!loc) return import.meta.env?.VITE_DEFAULT_CENTER_SLUG || null;

  const fromQuery = new URLSearchParams(loc.search || "").get("center");
  if (fromQuery) return fromQuery.trim().toLowerCase();

  const host = (loc.hostname || "").toLowerCase();
  const labels = host.split(".");
  const isIp = /^\d+(\.\d+)*$/.test(host);

  // "padel-lounge.lapista.dk" -> "padel-lounge". A bare "lapista.dk" or
  // "localhost" carries no tenant.
  if (!isIp && labels.length >= 3 && !RESERVED.has(labels[0])) {
    return labels[0];
  }

  return import.meta.env?.VITE_DEFAULT_CENTER_SLUG || null;
}

/** Reads the branding a signed-out visitor is allowed to see. */
export async function fetchCenterBySlug(slug) {
  if (!supabase || !slug) return null;
  const { data, error } = await supabase
    .from("centers")
    .select("id, slug, name, city")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  return data;
}
