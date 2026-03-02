const CACHE_VERSION = "v1";
const CACHE_NAME = `dits-${CACHE_VERSION}`;
const CORE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./public/styles.css",
  "./public/app.js",
  "./public/data/pubs.csv",
  "./public/icons/icon-192.png",
  "./public/icons/icon-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(CORE)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.map(k => (k !== CACHE_NAME) ? caches.delete(k) : null))));
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      try { return await fetch(req); }
      catch { return (await caches.match("./index.html")) || Response.error(); }
    })());
    return;
  }
  e.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    const fresh = await fetch(req);
    const c = await caches.open(CACHE_NAME);
    c.put(req, fresh.clone());
    return fresh;
  })());
});
