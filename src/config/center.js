/**
 * Tenant defaults.
 *
 * The live center is looked up in the `centers` table from the slug in the
 * URL (see src/lib/center.js). What is left here is the platform name shown
 * in the footer, and the stand-in tenant used by demo mode when no Supabase
 * project is configured.
 */
export const PLATFORM = "La Pista";

export const DEMO_CENTER = {
  id: "demo-padel-lounge",
  slug: "padel-lounge-aalborg",
  name: "Padel Lounge",
  city: "Aalborg",
};
