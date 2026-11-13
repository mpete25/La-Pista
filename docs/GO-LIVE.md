# Tjekliste før La Pista går rigtigt live

Appen er bygget som MVP. Alt nedenfor er kode, der er skrevet og testet lokalt,
men som **skal tjekkes eller sættes op i de rigtige systemer**, før rigtige
spillere og rigtige data kommer ind. Sæt kryds efterhånden.

> Ifølge `CLAUDE.md` kræver kørsel af migrationer mod produktion, udsendelse af
> rigtige SMS'er, ændringer i RLS og sletning af data altid et menneskeligt ja.

---

## 1. Juridisk og privatliv (GDPR) – skal være på plads

- [ ] **Privatlivspolitikken** (`public/privatliv.html`) er et *udkast*. Udfyld
      felterne i `[firkantede parenteser]` (firmanavn, CVR, kontakt, dato,
      udbydere), og få den gennemlæst – helst af en jurist. Fjern derefter den
      røde "Udkast"-boks.
- [ ] **Databehandleraftaler** med alle udbydere: Supabase, SMS-gatewayen
      (GatewayAPI/inMobile), Vercel og Sentry (hvis det bruges).
- [ ] **Aftale med hvert center**: centeret er dataansvarligt, La Pista er
      databehandler. Der skal være en databehandleraftale mellem jer.
- [ ] **Supabase-projektet ligger i en EU-region** (f.eks. Frankfurt).
- [ ] **Eksisterende spillere og SMS:** Alle profiler, der fandtes før
      migrationen `20261113120000_privacy_and_accounts`, har nu SMS *slået fra*,
      fordi de aldrig har givet samtykke. De får ingen SMS, før de selv slår det
      til under Profil. Beslut om det er OK (det er det juridisk sikre valg).
- [ ] Beslut en regel for **inaktive profiler** (f.eks. slet efter 24 måneder
      uden login) og skriv den ind i politikken. Den er ikke automatiseret endnu.

## 2. Supabase (database og login)

- [ ] Kør migrationerne mod **et test-/staging-projekt først**
      (`npx supabase db push`), og tjek appen der, før produktion.
- [ ] Kør dem mod produktion (kræver dit ja).
- [ ] **Tjek efter migrationen** som almindelig spiller:
  - [ ] Ranglisten indlæses (der er ændret på, hvilke kolonner spillere må læse).
  - [ ] Du kan *ikke* se andres mobilnumre (prøv i browserens netværksfane).
  - [ ] Som admin kan du se spillernes numre under Admin → Spillere.
- [ ] **Slet konto virker helt**: Opret en testspiller, slet den under
      Profil → Slet min konto, og tjek i Supabase → Authentication → Users, at
      brugeren også er væk dér. (Funktionen sletter fra `auth.users`; det er
      testet på almindelig PostgreSQL, ikke på Supabase.)
- [ ] **Authentication → URL Configuration:** Sæt *Site URL* og tilføj alle
      adresser under *Redirect URLs* (Vercel-adressen og `https://*.lapista.dk`).
      Ellers virker "Glemt adgangskode" og invitationslinks ikke.
- [ ] **E-mail-skabeloner på dansk** (Authentication → Email Templates):
      bekræft tilmelding, nulstil adgangskode, invitation.
- [ ] **Egen SMTP-server** (f.eks. Postmark, Resend, Brevo): Supabases
      indbyggede mail sender kun nogle få mails i timen og er kun til test.
- [ ] Overvej at slå *Confirm email* til, så folk ikke kan oprette sig med
      andres e-mail. Appen håndterer det allerede ("Tjek din e-mail …").
- [ ] **Realtime:** Åbn appen på to telefoner, indberet et sæt på den ene, og
      tjek, at det dukker op på den anden uden at genindlæse.

## 3. SMS (koster penge – kræver dit ja)

Der er to sikkerhedslåse: intet sendes, før **både** gateway-nøglen **og**
Vault-hemmelighederne er sat.

- [ ] Opret konto hos GatewayAPI eller inMobile.
- [ ] Sæt hemmelighederne på Edge Function'en:
      ```bash
      npx supabase secrets set SMS_GATEWAY_API_KEY=... SMS_GATEWAY_SENDER="La Pista" CRON_SECRET=<lang tilfældig streng> SMS_DRY_RUN=true
      npx supabase functions deploy send-sms
      ```
- [ ] Slå den automatiske kørsel til (hvert 2. minut) ved at gemme to
      hemmeligheder i Vault. Kør i Supabase → SQL Editor:
      ```sql
      select vault.create_secret('https://<projekt-ref>.supabase.co', 'project_url');
      select vault.create_secret('<samme CRON_SECRET som ovenfor>', 'cron_secret');
      ```
- [ ] Tjek at jobbet kører: `select * from cron.job_run_details order by start_time desc limit 5;`
- [ ] Med `SMS_DRY_RUN=true`: tjek Admin → SMS-log, at beskederne ser rigtige ud.
- [ ] Send én rigtig SMS til dit eget nummer (sæt `SMS_DRY_RUN=false`).
- [ ] Sæt et forbrugsloft hos SMS-udbyderen.
- [ ] **Ret linket i SMS'en.** Tilbuddet om en ledig plads linker til
      `https://lapista.dk/e/<id>`. Den adresse har intet center og ingen side
      for `/e/`, så linket lander på "Ingen padelcenter angivet". Linket skal
      pege på centerets egen adresse og åbne den rigtige kampdag.

## 4. Hosting (Vercel) og domæne

- [ ] Miljøvariabler i Vercel (se `.env.example`):
      `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
      `VITE_DEFAULT_CENTER_SLUG` (dit første centers slug),
      `VITE_PLATFORM_DOMAIN=lapista.dk`, evt. `VITE_SENTRY_DSN`.
      **Uden Supabase-variablerne kører appen i demo-tilstand.**
- [ ] **Aldrig** `SUPABASE_SERVICE_ROLE_KEY` eller SMS-nøgler i Vercel/frontend.
- [ ] Domæne: `lapista.dk` + wildcard `*.lapista.dk` peget på Vercel, så hvert
      center får sin egen adresse.
- [ ] Test "Føj til hjemmeskærm" på en rigtig iPhone (Safari) og Android.

## 5. Fejlovervågning

- [ ] Opret et Sentry-projekt (gratis niveau er nok i starten), og sæt
      `VITE_SENTRY_DSN` i Vercel.
- [ ] Udløs en testfejl, og tjek at den dukker op i Sentry *uden* navn, e-mail
      eller telefonnummer.

## 6. Nyt center (onboarding)

- [ ] Prøv scriptet på staging:
      ```bash
      SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
        node scripts/create-center.mjs --slug aarhus-padel --name "Aarhus Padel" \
        --city Aarhus --admin-email leder@aarhuspadel.dk
      ```
      Admin'en får en invitationsmail og vælger selv adgangskode.
- [ ] Kør det kun fra din egen computer – det bruger service-role-nøglen.

---

## Bevidst ikke bygget endnu

- **Betaling/abonnement for centre (Stripe).** Kræver en beslutning om pris og
  model samt en Stripe-konto. Indtil da faktureres centre manuelt.
- **Admin-side til at oprette centre.** Der er et script (punkt 6) i stedet.
- **Automatisk sletning af inaktive profiler** (se punkt 1).
- Når en spiller sletter sin konto, står vedkommende som "—" i andres
  sæthistorik. Det er med vilje (resultaterne bevares, navnet slettes).
