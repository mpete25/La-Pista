# La Pista — Padel-rangliste SaaS

En rangliste-webapp til danske padelcentre. Spillere tilmelder sig ranglistedage,
matches på niveau, spiller sæt i roterende hold, og optjener/mister point efter en
ELO-inspireret model. Sælges som SaaS til flere centre (multi-tenant).

## Tech stack
- **Frontend:** React (Vite), nuværende prototype ligger i `la-pista.jsx` — den er
  UI-referencen, ikke produktionskode. Al state er pt. mock/in-memory.
- **Backend/DB:** Supabase (PostgreSQL + Auth + Realtime + Row Level Security).
- **SMS:** Dansk gateway (GatewayAPI eller inMobile) via en Supabase Edge Function.
  Aldrig SMS-nøgler i frontend.
- **Sprog:** UI-tekster på dansk. Kode, kommentarer og commits på engelsk.

## Kommandoer
- `npm run dev` — kør lokalt
- `npm run build` — produktionsbuild
- `npx supabase start` / `npx supabase db push` — lokal DB + migrationer
(Opdatér når scripts er sat op.)

## DOMÆNEREGLER — padel (MÅ ALDRIG BRYDES)

**Sæt-score.** Et sæt vindes med 6 partier med to partiers forspring, ellers spilles
videre. Gyldige slutscorer for et sæt:
- 6–0, 6–1, 6–2, 6–3, 6–4  (vinder har 6)
- 7–5  (efter 5–5 spilles til 7)
- 7–6  (tiebreak ved 6–6)
Derfor: **vælger man 7 til vinderholdet, kan taberholdet kun have 5 eller 6.
Vælger man 6, kan taberholdet kun have 0–4.** Taberens partier kan altså være 0.
(6–5 er ALDRIG et gyldigt slutresultat — ved 5–5 spilles videre til 7–5 eller 7–6.
Bekræftet af produktejeren 2026-07-06.)
Denne validering skal håndhæves både i UI og i databasen (constraint/trigger).

**Kampdags-format.** En kampdag varer **2 timer**. Det er TIDEN, ikke antal sæt, der
afgør hvornår man er færdig. Inden for de 2 timer spiller de 4 på en bane så mange
sæt de kan og **roterer makkere**, så alle spiller sammen. Der findes 3 unikke
holdkombinationer for 4 spillere (AB/CD, AC/BD, AD/BC) — rotationen cykler gennem dem.
En kampdag kan ende på 3 sæt eller mange flere. En "Afslut kampdag"-handling stopper
dagen og udløser pointberegning.

**Startpoint.** Alle nye spillere starter på **500 point**.

**Niveaumatch.** På en kampdag sorteres tilmeldte efter point og deles i baner à 4
(de 4 tætteste sammen). Håndtér spillerantal der ikke går op i 4 (venteliste/bye).

## POINTMODEL
ELO-inspireret, beregnet **pr. sæt** og summeret over dagen:

    forventet E = 1 / (1 + 10^((modstanderhold_snit − eget_hold_snit) / 400))
    faktisk   S = egne_partier / (egne_partier + modstander_partier)
    Δ         = K × (S − E),  K = 24

Holdets snit = gennemsnit af de to spilleres point. Effekt: en lavt rangeret spiller
der klarer sig godt mod stærkere modstandere tjener ekstra; en favorit der taber
straffes hårdere. Beregningen skal ligge **server-side** (Edge Function / DB), aldrig
i klienten — ellers kan point manipuleres.

## MULTI-TENANCY & SIKKERHED (kritisk)
- Hver `center` er en tenant. Al data (players, events, matches) hænger på et
  `center_id`. Ingen forespørgsel må returnere data på tværs af centre.
- Håndhæv isolation med **Supabase Row Level Security**, ikke kun i UI.
- To roller: `player` og `center_admin`. Admin-funktioner (opret/redigér/aflys events,
  håndtér deltagere) skal være RLS-beskyttede — det er ikke nok at skjule knapper.
- Auth via Supabase Auth. Ingen hardcodede logins i produktion.

## MENNESKELIG GODKENDELSE PÅKRÆVET FØR
- Kørsel af database-migrationer mod produktion
- Udsendelse af rigtige SMS'er (kan koste penge / spamme brugere)
- Ændringer i pointmodellen eller RLS-policies
- Sletning af data

## ARBEJDSFORM
- Foreslå en plan før større ændringer; vent på grønt lys på ovenstående punkter.
- Små, gennemgåede commits. Forklar hvad og hvorfor.
- Spørg hvis en padelregel er uklar frem for at gætte.
