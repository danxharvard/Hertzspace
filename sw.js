// App shell cache so Hertzspace opens offline. Audio saved by Plus members
// lives in a separate cache ("hz-offline-v1") managed by the app itself.
const SHELL = "hz-shell-v7";
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

// Network-first for the app shell, so updates show up straight away;
// the cached copy is only used when offline. Audio and API go straight to the network.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.includes("/audio/")) return;
  e.respondWith(
    caches.open(SHELL).then(async (cache) => {
      const key = e.request.mode === "navigate" ? "index.html" : e.request;
      try {
        const res = await fetch(e.request, { cache: "no-cache" });
        if (res.ok) cache.put(key, res.clone());
        return res;
      } catch {
        return (await cache.match(key, { ignoreSearch: true })) || Response.error();
      }
    })
  );
});
