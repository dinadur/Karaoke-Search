// Bump CACHE_VERSION together with APP_VERSION in karaoke_explorer.js so a
// deploy invalidates the previous offline cache.
const CACHE_VERSION = "20260715-9";
const CACHE_NAME = `karaoke-${CACHE_VERSION}`;

const PRECACHE_URLS = [
    "/",
    "/karaoke_explorer.html",
    `/karaoke_explorer.css?v=${CACHE_VERSION}`,
    `/karaoke_explorer.js?v=${CACHE_VERSION}`,
    `/qrcode.js?v=${CACHE_VERSION}`,
    `/karaoke_songs_enriched.json?v=${CACHE_VERSION}`,
    `/tag_consolidation.json?v=${CACHE_VERSION}`,
    `/mood_consolidation.json?v=${CACHE_VERSION}`,
    "/fonts/space-grotesk-latin-wght-normal.woff2",
];

self.addEventListener("install", (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        // Best-effort: a failed precache (e.g. offline install) must not
        // block activation; runtime caching fills any gaps.
        await Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url)));
        await self.skipWaiting();
    })());
});

self.addEventListener("activate", (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys
            .filter((key) => key.startsWith("karaoke-") && key !== CACHE_NAME)
            .map((key) => caches.delete(key)));
        await self.clients.claim();
    })());
});

self.addEventListener("fetch", (event) => {
    const request = event.request;
    if (request.method !== "GET") {
        return;
    }

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) {
        return;
    }

    if (request.mode === "navigate") {
        // App shell: prefer the network so deploys land, fall back to cache offline.
        event.respondWith((async () => {
            const cache = await caches.open(CACHE_NAME);
            try {
                const response = await fetch(request);
                if (response.ok) {
                    cache.put(request, response.clone());
                }
                return response;
            } catch {
                const cached = await cache.match(request) ||
                    await cache.match("/") ||
                    await cache.match("/karaoke_explorer.html");
                return cached || Response.error();
            }
        })());
        return;
    }

    // Static assets are version-busted by query string, so cache-first is safe.
    event.respondWith((async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(request);
        if (cached) {
            return cached;
        }

        const response = await fetch(request);
        if (response.ok) {
            cache.put(request, response.clone());
        }
        return response;
    })());
});
