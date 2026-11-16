// App shell cache so Hertzspace opens offline. Audio saved by Plus members
// lives in a separate cache ("hz-offline-v1") managed by the app itself.
const SHELL = "hz-shell-v5";
const FILES = [
  "./", "index.html", "css/style.css", "js/config.js", "js/app.js", "js/auth.js", "js/player.js", "js/viz.js",
  "data/catalog.json", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("hz-shell") && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Stale-while-revalidate for same-origin shell files; audio and API go straight to the network.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.includes("/audio/")) return;
  e.respondWith(
    caches.open(SHELL).then(async (cache) => {
      const key = e.request.mode === "navigate" ? "index.html" : e.request;
      const cached = await cache.match(key, { ignoreSearch: true });
      const network = fetch(e.request)
        .then((res) => { if (res.ok && e.request.mode !== "navigate") cache.put(e.request, res.clone()); return res; })
        .catch(() => cached);
      return cached || network;
    })
  );
});
