/// <reference lib="webworker" />
// Service worker: precaches the app, every question bank file and the radiology images so it works offline;
// other subjects' images are cached on first view (or when downloaded for offline use) in a cache kept across updates.
declare const __PRECACHE__: string[];
declare const __VERSION__: string;
const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = `osce-${__VERSION__}`;
/** Images of the other subjects: cached when first shown (or downloaded for offline use) and kept across app updates. */
const IMG_CACHE = "osce-img-v2";

sw.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(__PRECACHE__)).then(() => sw.skipWaiting()));
});

sw.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("osce-") && k !== CACHE && k !== IMG_CACHE).map((k) => caches.delete(k))))
      .then(() => sw.clients.claim()),
  );
});

sw.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== sw.location.origin) return;
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match("./", { cacheName: CACHE }).then((r) => r ?? Response.error())));
    return;
  }
  const isImg = new URL(req.url).pathname.includes("/content/img/");
  e.respondWith(caches.match(req, { cacheName: CACHE, ignoreSearch: true }).then((hit) => {
    if (hit) return hit;
    if (!isImg) return fetch(req);
    return caches.open(IMG_CACHE).then((c) => c.match(req, { ignoreSearch: true }).then((h2) => h2 ?? fetch(req).then((res) => {
      if (res.ok) c.put(req, res.clone());
      return res;
    })));
  }));
});

sw.addEventListener("message", (e) => {
  if (e.data === "version") e.source?.postMessage({ version: __VERSION__ });
});
