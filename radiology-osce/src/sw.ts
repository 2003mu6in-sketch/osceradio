/// <reference lib="webworker" />
// Service worker: precaches the whole app (code, question bank, every image) so it works offline.
declare const __PRECACHE__: string[];
declare const __VERSION__: string;
const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = `osce-${__VERSION__}`;

sw.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(__PRECACHE__)).then(() => sw.skipWaiting()));
});

sw.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("osce-") && k !== CACHE).map((k) => caches.delete(k))))
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
  e.respondWith(caches.match(req, { cacheName: CACHE, ignoreSearch: true }).then((hit) => hit ?? fetch(req)));
});

sw.addEventListener("message", (e) => {
  if (e.data === "version") e.source?.postMessage({ version: __VERSION__ });
});
