// Bump CACHE_VERSION together with APP_VERSION in karaoke_explorer.js so a
// deploy invalidates the previous offline cache.
const CACHE_VERSION = "20261002-1";
const CACHE_NAME = `karaoke-${CACHE_VERSION}`;

const PRECACHE_URLS = [
    "/",
    "/karaoke_explorer.html",
    `/karaoke_explorer.css?v=${CACHE_VERSION}`,
    `/karaoke_explorer.js?v=${CACHE_VERSION}`,
    `/qrcode.js?v=${CACHE_VERSION}`,
    `/personal-songbook.js?v=${CACHE_VERSION}`,
    `/stage-effects.js?v=${CACHE_VERSION}`,
    `/era_enrichment.json?v=${CACHE_VERSION}`,
    `/audio_enrichment.json?v=${CACHE_VERSION}`,
    `/karaoke_songs_enriched.json?v=${CACHE_VERSION}`,
    `/tag_consolidation.json?v=${CACHE_VERSION}`,
    `/mood_consolidation.json?v=${CACHE_VERSION}`,
    "/fonts/space-grotesk-latin-wght-normal.woff2",
    "/manifest.json",
    "/app-icon.svg",
    `/icon-192.png?v=${CACHE_VERSION}`,
    `/icon-512.png?v=${CACHE_VERSION}`,
    `/icon-maskable-512.png?v=${CACHE_VERSION}`,
    `/apple-touch-icon.png?v=${CACHE_VERSION}`,
];

self.addEventListener("install", (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        // Commit the complete release atomically. If any response fails or is
        // interrupted, reject installation and leave the old worker/cache in
        // service. Reload avoids reusing an unversioned shell from HTTP cache.
        await cache.addAll(PRECACHE_URLS.map((url) => new Request(url, { cache: "reload" })));
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
                // Keep the installed shell paired with its precached assets.
                // An online visit to a newer, failed release must not replace
                // our known-good offline fallback with that release's HTML.
                return response;
            } catch {
                const cached = await cache.match("/") ||
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
            // Keep the fetch event alive until the write finishes, while a
            // quota/storage failure still permits the online response.
            await cache.put(request, response.clone()).catch(() => {});
        }
        return response;
    })());
});
