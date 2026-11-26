// Off-main-thread JSON decoding for the large songbook catalog.
// Receives a transferred ArrayBuffer from the main thread so fetch() stays
// on the main thread (preserving service-worker and browser test interception),
// then streams the parsed array back in bounded chunks so structured-clone
// deserialization never creates a long main-thread blocking task.
const WORKER_CHUNK_SIZE = 2000;

self.addEventListener("message", (event) => {
    try {
        const buffer = event.data?.buffer;
        if (!(buffer instanceof ArrayBuffer)) {
            throw new Error("Missing catalog buffer");
        }
        const text = new TextDecoder().decode(buffer);
        const songs = JSON.parse(text);
        if (!Array.isArray(songs)) {
            self.postMessage({ ok: true, value: songs, done: true });
            return;
        }
        for (let start = 0; start < songs.length; start += WORKER_CHUNK_SIZE) {
            const end = Math.min(start + WORKER_CHUNK_SIZE, songs.length);
            self.postMessage({
                ok: true,
                chunk: songs.slice(start, end),
                done: end >= songs.length,
            });
        }
        if (!songs.length) {
            self.postMessage({ ok: true, chunk: [], done: true });
        }
    } catch (error) {
        self.postMessage({ ok: false, error: error?.message || "Could not parse songbook JSON" });
    }
});
