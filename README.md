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
3. `VITE_DEFAULT_CENTER_SLUG` — for a single-center deployment

The slug is looked up in the `centers` table. Anonymous visitors can read center
branding (slug, name, city) and nothing else, which is what lets the sign-up screen
name the center before anybody has a session.

## SMS

Notifications are queued in `sms_outbox` by the database, never sent from the client.
The `send-sms` Edge Function drains the queue: it first releases expired waitlist
offers (so their replacements go out in the same run), then sends what is pending
through GatewayAPI or inMobile (`SMS_PROVIDER`).

Without `SMS_GATEWAY_API_KEY` the function sends nothing and just reports what is
queued, so it is safe to run before the gateway account exists. Schedule it every few
minutes and authenticate with the shared `CRON_SECRET`:

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
