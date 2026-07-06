/**
 * Tenant (center) configuration.
 *
 * La Pista is multi-tenant: every center is a tenant with its own branding.
 * For now this is a static config for the demo tenant; once Supabase is wired
 * up it will be loaded from the `centers` table based on the signed-in user.
 */
export const CENTER = {
  id: "padel-lounge-aalborg",
  name: "Padel Lounge",
  city: "Aalborg",
  // Platform brand shown in the footer ("powered by").
  platform: "La Pista",
};
