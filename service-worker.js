// Simple PWA cache (GitHub Pages)
const CACHE_VERSION = "v1";
const CACHE_NAME = `dits-${CACHE_VERSION}`;
const RUNTIME = `dits-rt-${CACHE_VERSION}`;

const CORE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./public/styles.css",
  "./public/app.js",
  "./public/data/sunspots.csv",
  "./public/icons/icon-192.png",
  "./public/icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(CORE)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => (k !== CACHE_NAME && k !== RUNTIME) ? caches.delete(k) : null))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Network-first for HTML
  if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(RUNTIME);
        cache.put(req, fresh.clone());
        return fresh;
      } catch {
        const cached = await caches.match(req);
        return cached || caches.match("./index.html");
      }
    })());
    return;
  }

  // Cache-first for same-origin assets
  if (url.origin === location.origin) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const fresh = await fetch(req);
      const cache = await caches.open(RUNTIME);
      cache.put(req, fresh.clone());
      return fresh;
    })());
    return;
  }

  // Runtime cache for images + Open-Meteo
  if (
    req.destination === "image" ||
    url.hostname.includes("open-meteo.com") ||
    url.hostname.includes("tile.openstreetmap.org") ||
    url.hostname.includes("unpkg.com")
  ) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(RUNTIME);
        cache.put(req, fresh.clone());
        return fresh;
      } catch {
        return cached || Response.error();
      }
    })());
  }
});
