// Junimo Planner service worker: lets the installed app open offline.
// Pages are network-first (so a new version shows up right away) with the cached copy as a fallback;
// scripts, styles, data, images and Google Fonts are served from the cache and refreshed in the background.
// Nothing else (sign-in, cloud sync, visitor counts) is touched.
const CACHE = "junimo-v1";
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(["./", "privacy.html", "manifest.webmanifest", "img/icons/junimo-192.png"])));
  self.skipWaiting();
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// keep one copy per file: when a new ?v= version is cached, drop the older ones of the same path
async function put(cache, req, res) {
  const url = new URL(req.url);
  if (url.origin === location.origin && url.searchParams.has("v")) {
    for (const old of await cache.keys()) {
      const o = new URL(old.url);
      if (o.pathname === url.pathname && o.search !== url.search) await cache.delete(old);
    }
  }
  await cache.put(req, res);
}
const cacheable = url => url.origin === location.origin || FONT_HOSTS.includes(url.hostname);

self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || !cacheable(url)) return;
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(url.pathname === "/" ? "./" : req, res.clone());
        return res;
      } catch {
        return (await cache.match(req, { ignoreSearch: true })) || (await cache.match("./"));
      }
    })());
    return;
  }
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    const fresh = fetch(req).then(res => { if (res.ok || res.type === "opaque") put(cache, req, res.clone()); return res; });
    if (hit) { e.waitUntil(fresh.catch(() => {})); return hit; }
    return fresh;
  })());
});

// the page sends the files it loaded, so they're available offline from the first visit
self.addEventListener("message", e => {
  if (e.data?.type !== "cache") return;
  e.waitUntil(caches.open(CACHE).then(async cache => {
    for (const u of e.data.urls) {
      try {
        const url = new URL(u);
        if (!cacheable(url) || await cache.match(u)) continue;
        const res = await fetch(u, url.origin === location.origin ? {} : { mode: "no-cors" });
        if (res.ok || res.type === "opaque") await put(cache, new Request(u), res);
      } catch {}
    }
  }));
});
