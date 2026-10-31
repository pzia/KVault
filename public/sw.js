const CACHE = "kobo-vault-v097";
const ASSETS = [
  "/", "/index.html", "/app.css", "/app.js", "/crypto.js", "/storage.js", "/model.js",
  "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-512-maskable.png"
];
const NETWORK_FIRST = new Set(["/", "/index.html", "/app.css", "/app.js", "/crypto.js", "/storage.js", "/model.js", "/manifest.webmanifest"]);
self.addEventListener("install", event => event.waitUntil(
  caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
));
self.addEventListener("activate", event => event.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())
));
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (event.request.mode === "navigate" || NETWORK_FIRST.has(url.pathname)) {
    event.respondWith(fetch(event.request, { cache: "no-store" }).then(response => {
      if (response.ok) { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(url.pathname === "/" ? "/index.html" : event.request, copy)); }
      return response;
    }).catch(() => caches.match(event.request).then(hit => hit || caches.match(url.pathname === "/" ? "/index.html" : url.pathname))));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    if (response.ok) { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, copy)); }
    return response;
  })));
});
