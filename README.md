# La Pista — Padel Ranking SaaS

A ranking web app for Danish padel centres. Players sign up for ranking days, get
matched by skill level, play sets in rotating partnerships over a fixed time window,
and gain or lose points using an ELO-inspired model. Sold as multi-tenant SaaS to
multiple centres.

> UI texts are in Danish; code, comments and commits are in English.

## Tech stack

- **Frontend:** React (Vite). The current prototype lives in `la-pista.jsx` and is the
  UI reference — not production code (state is mock/in-memory for now).
- **Backend / DB:** Supabase (PostgreSQL + Auth + Realtime + Row Level Security).
- **SMS:** Danish gateway (GatewayAPI or inMobile) via a Supabase Edge Function.
  SMS keys never live in the frontend.

## Core domain rules

- **Set score.** A set is won at 6 games with a two-game lead, otherwise play continues.
  Valid final scores: `6–0 … 6–4`, `7–5`, `7–6`. Enforced in both UI and database.
- **Match-day format.** A match day lasts **2 hours** — time, not a set count, ends it.
  The four players on a court rotate partners through the three unique combinations
  (AB/CD, AC/BD, AD/BC) and play as many sets as they can. "End match day" triggers
  point calculation.
- **Starting points.** New players start at **500**.
- **Level matching.** Registered players are sorted by points and split into courts of 4
  (closest four together); leftovers go on a waiting list / bye.
- **Waitlist.** A freed spot is offered to the player who has waited longest, one at a
  time. The offer holds the spot for six hours (never past the start), then moves on.
  A confirmed spot cannot be self-cancelled within 24h of the start — the player calls
  the center and an admin frees it.

## Points model

ELO-inspired, computed **per set** server-side (Edge Function / DB) — never in the client:

```
expected E = 1 / (1 + 10^((opp_team_avg − own_team_avg) / 400))
actual   S = own_games / (own_games + opp_games)
Δ        = K × (S − E),   K = 24
```

A team's average is the mean of its two players' points.

## Multi-tenancy & security

- Every `center` is a tenant. All data carries a `center_id`; no query may cross centres.
- Isolation is enforced with **Supabase Row Level Security**, not just in the UI.
- Two roles: `player` and `center_admin`. Admin actions are RLS-protected — hiding
  buttons is not enough.

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill in real values (never commit .env.local)
npm run dev                  # run locally
npm run build                # production build
```

Supabase:

```bash
npx supabase start           # local DB (needs Docker)
npx supabase db push         # apply migrations
npx supabase functions deploy send-sms
```

## Which center am I looking at?

Every center is a tenant, and the app resolves which one from the URL:

1. `?center=<slug>` — handy in development
2. the subdomain — `padel-lounge.lapista.dk` → `padel-lounge`
3. `VITE_DEFAULT_CENTER_SLUG` — for a single-center deployment, and on any
   host that is not a subdomain of `VITE_PLATFORM_DOMAIN` (default
   `lapista.dk`), such as `la-pista.vercel.app`

The slug is looked up in the `centers` table. Anonymous visitors can read center
branding (slug, name, city) and nothing else, which is what lets the sign-up screen
name the center before anybody has a session.

## SMS

Notifications are queued in `sms_outbox` by the database, never sent from the client.
The `send-sms` Edge Function drains the queue: it first releases expired waitlist
offers (so their replacements go out in the same run), then sends what is pending
through GatewayAPI or inMobile (`SMS_PROVIDER`).

Without `SMS_GATEWAY_API_KEY` the function sends nothing and just reports what is
queued, so it is safe to run before the gateway account exists. A `pg_cron` job
(`20261113140000_sms_schedule`) calls it every two minutes once the Vault holds
`project_url` and `cron_secret` (see docs/GO-LIVE.md). To call it by hand,
authenticate with the shared `CRON_SECRET`:

```bash
npx supabase secrets set SMS_GATEWAY_API_KEY=... SMS_GATEWAY_SENDER="La Pista" CRON_SECRET=...
curl -X POST "$SUPABASE_URL/functions/v1/send-sms" -H "x-cron-secret: $CRON_SECRET"
```

## Tests

```bash
npm test          # unit tests (vitest)
npm run test:db   # applies every migration to a scratch database, then the SQL suite
```

`npm run test:db` needs a reachable PostgreSQL 16 server and `psql`; point it at one
with `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`. It does not need the Supabase container
stack — `supabase/tests/00_shim.sql` supplies the API roles, `auth.users` and
`auth.uid()`, so the policies are exercised as the real `anon` and `authenticated`
roles. The suite covers the domain rules, tenant isolation, the waitlist offer flow,
messages and the public center lookup. CI runs all of it on every push.

## Accounts and privacy (GDPR)

- **Phone numbers are private.** Column privileges on `profiles` hide `phone`
  and the consent columns from other players; a player reads their own via
  `my_private_profile()`, a center admin their players' via
  `admin_player_contacts()`.
- **SMS needs consent.** Signup has an opt-in box; players toggle it under
  Profile (`set_sms_consent`). `queue_sms()` skips anyone who has not opted in.
- **Self-service:** players can download their data (`export_my_data`) and
  delete their account (`delete_my_account`, which also removes the login).
- **Password reset** and admin **invitations** land on a "choose a password"
  screen (`SetPasswordScreen`).
- The privacy policy is `public/privatliv.html` — still a draft.

## Live updates

The app subscribes to `events`, `event_registrations`, `court_assignments`,
`sets` and `point_adjustments` over Supabase Realtime (RLS applies per
subscriber) and refetches when they change, so a set reported on another phone
or points awarded at the end of a day show up without a reload.

## Onboarding a new center

```bash
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  node scripts/create-center.mjs --slug aarhus-padel --name "Aarhus Padel" \
  --city Aarhus --admin-email manager@aarhuspadel.dk
```

Creates the center and invites its first admin. The underlying
`platform_*` functions are callable by the service role only.

## Error monitoring

Set `VITE_SENTRY_DSN` to turn on Sentry. Without it nothing is loaded or sent.
No names, e-mails or phone numbers are attached to reports — only the user id.
A render error shows a Danish "Noget gik galt" page instead of a blank screen.

## Security notes

- Sets are written only by `report_set()` (no direct INSERT), and limited to
  one per five minutes since the day started, so results cannot be forged or
  flooded. Points are computed only in `finish_court()`.
- `vercel.json` and `public/_headers` set a Content-Security-Policy, HSTS,
  frame denial and caching rules. Keep the two files in sync.
- A production build without Supabase settings refuses to run unless
  `VITE_DEMO_MODE=true`.
- `centers.app_url` is where SMS links point (`?event=<id>` opens that day).

## Before going live

See **[docs/GO-LIVE.md](docs/GO-LIVE.md)** — everything that has to be set up
or checked in the real systems (Supabase, SMS gateway, Vercel, legal) before
real players use the app.

## Installable web app (PWA)

The app can be added to a phone's home screen and opens full screen like a
native app. On iPhone: open the deployed URL in **Safari → Share → Add to
Home Screen**.

- `public/manifest.webmanifest` — name, colours, start URL.
- `public/icons/` — `icon.svg` is the source; the PNGs (180/192/512) are
  rendered from it. Re-render them if the icon changes.
- `public/sw.js` — service worker, registered in production builds only.
  It never caches Supabase or other cross-origin traffic, so rankings are
  always live. Page loads are network-first with `offline.html` as the
  fallback; Vite's hashed `/assets/*` are cached. Bump `VERSION` in `sw.js`
  when its caching strategy changes.
- The header pads for `env(safe-area-inset-top)` so content clears the notch
  when launched from the home screen.

## Environment variables

See [`.env.example`](.env.example) for the full list. Never commit real secrets —
`.env` and `.env.*` are git-ignored (except `.env.example`).

| Variable | Where | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | frontend | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | frontend | Publishable anon key (protected by RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | Bypasses RLS — Edge Functions only |
| `SMS_GATEWAY_API_KEY` | server only | Danish SMS gateway key |
| `SMS_GATEWAY_SENDER` | server only | SMS sender name |

## Human approval required before

Running production DB migrations · sending real SMS · changing the points model or
RLS policies · deleting data.
