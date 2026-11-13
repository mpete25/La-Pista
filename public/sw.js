/*
 * La Pista service worker.
 *
 * Deliberately conservative: rankings and points must always be live, so
 * we never cache API traffic. Only same-origin static files are cached.
 *  - Page navigations: network first; when offline, show offline.html.
 *  - /assets/* (content-hashed by Vite, immutable): cache first.
 *  - Icons/manifest: cache first, refreshed in the background.
 * Cross-origin requests (Supabase, Google Fonts) are not intercepted at all.
 *
 * Bump VERSION to drop old caches when this file's strategy changes.
 */
const VERSION = "v2";
const CACHE = `la-pista-${VERSION}`;
const OFFLINE_URL = new URL("offline.html", self.registration.scope).href;
const PRECACHE = [
  OFFLINE_URL,
  new URL("icons/icon-192.png", self.registration.scope).href,
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("la-pista-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase, fonts, etc. go straight to the network

  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  if (url.pathname.includes("/assets/")) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }))
    );
    return;
  }

  if (url.pathname.includes("/icons/") || url.pathname.endsWith(".webmanifest")) {
    event.respondWith(
      caches.match(req).then((hit) => {
        const refresh = fetch(req).then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
          return res;
        }).catch(() => hit);
        return hit || refresh;
      })
    );
  }
});
