// Offline cache. The big files (tracking models, WASM, memes) are kept after
// the first visit, so the next visit starts instantly and works offline.
// Pages and code always try the network first, so updates show up right away.
const VERSION = "v2";
const BIG = `memecam-big-${VERSION}`;
const APP = `memecam-app-${VERSION}`;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== BIG && k !== APP).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const isBig = (url) => /^\/(models|wasm|memes)\//.test(url.pathname);

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  // range requests (video seeking) go straight to the network
  if (req.headers.has("range")) return;

  if (isBig(url)) {
    event.respondWith(
      caches.open(BIG).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok && res.status === 200) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) caches.open(APP).then((c) => c.put(req, res.clone()));
        return res;
      })
      .catch(async () => (await caches.match(req)) || (await caches.match("/index.html")) || Response.error()),
  );
});
