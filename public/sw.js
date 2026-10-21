// RSIC service worker: keeps the files that never change on the device.
//
// Hostinger's CDN often misses on the stylesheet, script and images, so every
// page view paid for them again. After the first visit this serves them from
// the device instead:
//   - /styles.css?v=... and /script.js?v=... (the version changes whenever the
//     file does, so a cached copy is never out of date), /assets/*, and the
//     Google fonts: from the device, fetched once
//   - pages: from the network first, so text and the registration switch are
//     always current, falling back to the last copy only when offline
//   - /api, the dashboards and anything that is not a GET: never touched
//
// To switch it off for everyone, replace this file with one that calls
// self.registration.unregister() in its activate handler, and deploy.
const VERSION = "rsic-2026-10-21";
const STATIC = VERSION + "-static";
const PAGES = VERSION + "-pages";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (!key.startsWith(VERSION)) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

const fromDeviceFirst = async (request) => {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok || res.type === "opaque") cache.put(request, res.clone());
  return res;
};

const fromNetworkFirst = async (request) => {
  const cache = await caches.open(PAGES);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw err;
  }
};

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (/^\/(api|admindashboard|regidash|admin)(\/|$|\.)/.test(url.pathname))
      return;
    const versioned =
      (url.pathname === "/styles.css" || url.pathname === "/script.js") &&
      url.searchParams.has("v");
    if (versioned || url.pathname.startsWith("/assets/"))
      return event.respondWith(fromDeviceFirst(request));
    if (request.mode === "navigate")
      return event.respondWith(fromNetworkFirst(request));
    return;
  }

  if (
    url.hostname === "fonts.googleapis.com" ||
    url.hostname === "fonts.gstatic.com"
  )
    event.respondWith(fromDeviceFirst(request));
});
