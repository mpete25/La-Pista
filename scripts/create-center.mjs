#!/usr/bin/env node
/**
 * Onboard a new padel center (tenant) and invite its first admin.
 *
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   node scripts/create-center.mjs --slug aarhus-padel --name "Aarhus Padel" \
 *     --city Aarhus --admin-email manager@aarhuspadel.dk [--app-url https://aarhus-padel.lapista.dk]
 *
 * To appoint an admin for a center that already exists, pass only --slug
 * and --admin-email; the center step is skipped when the slug is taken.
 *
 * Uses the service-role key, so run it from your own machine only. Never
 * put that key in the frontend or commit it.
 */
import { createClient } from "@supabase/supabase-js";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    slug: { type: "string" },
    name: { type: "string" },
    city: { type: "string" },
    "admin-email": { type: "string" },
    "admin-name": { type: "string" },
    "app-url": { type: "string" },
  },
});

const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) fail("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
if (!args.slug) fail("--slug is required.");

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const slug = args.slug.trim().toLowerCase();

// 1. The center itself (skipped if it already exists).
const { data: existing, error: lookupError } = await supabase
  .from("centers").select("id, name").eq("slug", slug).maybeSingle();
if (lookupError) fail(`Could not look up the center: ${lookupError.message}`);

if (existing) {
  console.log(`• Center "${existing.name}" (${slug}) already exists.`);
} else {
  if (!args.name) fail("--name is required to create a new center.");
  const { error } = await supabase.rpc("platform_create_center", {
    p_slug: slug, p_name: args.name, p_city: args.city ?? null,
  });
  if (error) fail(`Could not create the center: ${error.message}`);
  console.log(`✓ Created center "${args.name}" (${slug}).`);
}

// The address players reach this center on. Stored so SMS can link back to
// the right match day; without it the SMS simply carries no link.
if (args["app-url"]) {
  const { error } = await supabase.from("centers").update({ app_url: args["app-url"] }).eq("slug", slug);
  if (error) fail(`Could not store the app address: ${error.message}`);
  console.log(`✓ App address set to ${args["app-url"]}.`);
}

// 2. Its admin: invite by e-mail (or reuse an existing login), then promote.
const email = args["admin-email"]?.trim();
if (email) {
  const redirectTo = args["app-url"] ?? `https://${slug}.lapista.dk`;
  const { error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: { center_slug: slug, full_name: args["admin-name"] ?? email.split("@")[0] },
  });
  if (inviteError && !/already been registered|already exists/i.test(inviteError.message)) {
    fail(`Could not invite ${email}: ${inviteError.message}`);
  }
  console.log(inviteError ? `• ${email} already has a login.` : `✓ Invitation sent to ${email}.`);

  const { error: roleError } = await supabase.rpc("platform_set_role", {
    p_email: email, p_role: "center_admin",
  });
  if (roleError) fail(`Could not make ${email} admin: ${roleError.message}`);
  console.log(`✓ ${email} is now admin of ${slug}.`);
}

console.log(`\nThe center is live at https://${slug}.lapista.dk (or ?center=${slug}).`);
