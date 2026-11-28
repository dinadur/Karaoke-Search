// Off-main-thread JSON decoding and catalog preparation for the large songbook.
// Receives the catalog ArrayBuffer and optional sidecar payloads from the main
// thread (keeping fetch() on the main thread for service-worker and browser
// route compatibility), prepares the catalog in the background, and streams
// prepared songs back in paced chunks so structured-clone deserialization never
// blocks main-thread input or painting.
const WORKER_CHUNK_SIZE = 500;
const versionSearch = self.location?.search || "";
importScripts(`search-ranking.js${versionSearch}`, `catalog-prep.js${versionSearch}`);

let pendingPrepare = null;

function sendNextPreparedChunk() {
    if (!pendingPrepare) {
        return;
    }

    const { songs, offset, meta } = pendingPrepare;
    if (offset < songs.length) {
        const end = Math.min(offset + WORKER_CHUNK_SIZE, songs.length);
        const chunk = songs.slice(offset, end);
        pendingPrepare.offset = end;
        self.postMessage({
            ok: true,
            kind: "chunk",
            chunk,
            total: songs.length,
        });
        return;
    }

    pendingPrepare = null;
    const transfer = [];
    if (meta.defaultRankedIndices?.buffer) {
        transfer.push(meta.defaultRankedIndices.buffer);
    }
    if (meta.whatsNewIndices?.buffer) {
        transfer.push(meta.whatsNewIndices.buffer);
    }
    self.postMessage({ ok: true, kind: "done", meta }, transfer);
}

self.addEventListener("message", (event) => {
    try {
        const payload = event.data;
        if (payload?.type === "next") {
            sendNextPreparedChunk();
            return;
        }

        const buffer = payload?.buffer;
        if (!(buffer instanceof ArrayBuffer)) {
            throw new Error("Missing catalog buffer");
        }
        const text = new TextDecoder().decode(buffer);
        const rawSongs = JSON.parse(text);

        if (payload.mode === "prepare") {
            const tagConsolidation = payload.tagConsolidationRaw
                ? normalizeTagConsolidation(payload.tagConsolidationRaw)
                : createEmptyTagConsolidation();
            const moodConsolidation = payload.moodConsolidationRaw
                ? normalizeMoodConsolidation(payload.moodConsolidationRaw)
                : createEmptyMoodConsolidation();
            const prepared = prepareCatalogSync(rawSongs, {
                eraEnrichment: payload.eraEnrichment || null,
                audioEnrichment: payload.audioEnrichment || null,
                whatsNewSource: payload.whatsNewSource || null,
                tagConsolidation,
                moodConsolidation,
            });
            pendingPrepare = {
                songs: prepared.songs,
                offset: 0,
                meta: {
                    promotedGenreTags: [...prepared.promotedGenreTags.entries()],
                    popularThreshold: prepared.popularThreshold,
                    defaultRankedIndices: prepared.defaultRankedIndices,
                    availableMoods: prepared.availableMoods,
                    availableGenres: prepared.availableGenres,
                    availableDecades: prepared.availableDecades,
                    availableHolidays: prepared.availableHolidays,
                    availableLengths: prepared.availableLengths,
                    whatsNewIndices: prepared.whatsNewIndices,
                    whatsNewLatest: prepared.whatsNewLatest,
                },
            };
            sendNextPreparedChunk();
            return;
        }

        if (!Array.isArray(rawSongs)) {
            self.postMessage({ ok: true, value: rawSongs, done: true });
            return;
        }
        for (let start = 0; start < rawSongs.length; start += WORKER_CHUNK_SIZE) {
            const end = Math.min(start + WORKER_CHUNK_SIZE, rawSongs.length);
            self.postMessage({
                ok: true,
                chunk: rawSongs.slice(start, end),
                done: end >= rawSongs.length,
            });
        }
        if (!rawSongs.length) {
            self.postMessage({ ok: true, chunk: [], done: true });
        }
    } catch (error) {
        pendingPrepare = null;
        self.postMessage({ ok: false, error: error?.message || "Could not prepare songbook" });
    }
});
