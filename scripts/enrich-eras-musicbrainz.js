#!/usr/bin/env node
// Optional bounded MusicBrainz batch. Only requests public recording metadata.
// Usage: node scripts/enrich-eras-musicbrainz.js [maximum requests, default 100]
const fs = require("node:fs");
const path = require("node:path");
const { normalize, fields, identity: identify, catalogGroups, atomicJson } = require("./lib/music-metadata");
const root = path.join(__dirname, "..");
const quote = (value) => `"${String(value).replace(/[\\"]/g, " ")}"`;
const decade = (year) => year < 2000 ? `${Math.floor(year / 10) % 10}0s` : `${Math.floor(year / 10) * 10}s`;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_RECORDINGS = 100;

const readBoundedJson = async (response) => {
    const contentLength = response.headers.get("content-length");
    if (contentLength && /^\d+$/.test(contentLength.trim()) && Number(contentLength) > MAX_RESPONSE_BYTES) {
        throw new Error("MusicBrainz response is too large");
    }
    if (!response.body) throw new Error("MusicBrainz response has no body");
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > MAX_RESPONSE_BYTES) {
                await reader.cancel();
                throw new Error("MusicBrainz response is too large");
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }
    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(body));
};

(async () => {
    const limit = Number(process.argv[2] || 100);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("Choose 1–1000 requests per batch");
    const songs = JSON.parse(fs.readFileSync(path.join(root, "karaoke_songs_enriched.json")));
    const output = path.join(root, "era_enrichment.json");
    const data = JSON.parse(fs.readFileSync(output));
    const checkpointPath = path.join(root, "metadata_cache", "era-musicbrainz-progress.json");
    let checkpoint = {};
    try { checkpoint = JSON.parse(fs.readFileSync(checkpointPath)); } catch { /* First run. */ }
    const existing = new Set(data.entries.map(identify));
    for (const result of Object.values(checkpoint)) {
        const recovered = Array.isArray(result.entries) ? result.entries : result.entry ? [result.entry] : [];
        for (const entry of recovered) {
            if (entry && !existing.has(identify(entry))) {
                data.entries.push(entry); existing.add(identify(entry));
            }
        }
    }
    const remember = (key, entries = []) => {
        checkpoint[key] = { checkedAt: new Date().toISOString(), entries };
        fs.mkdirSync(path.dirname(checkpointPath), { recursive: true });
        fs.writeFileSync(`${checkpointPath}.tmp`, JSON.stringify(checkpoint));
        fs.renameSync(`${checkpointPath}.tmp`, checkpointPath);
    };
    let requests = 0, added = 0, consecutiveErrors = 0;
    for (const group of catalogGroups(songs)) {
        const targets = group.songs.filter((song) => !song.eras?.length && !existing.has(identify(song)));
        if (!targets.length || checkpoint[group.key]) continue;
        if (requests >= limit) break;
        await new Promise((resolve) => setTimeout(resolve, consecutiveErrors ? 5000 * consecutiveErrors : 1200));
        requests++;
        try {
            const url = new URL("https://musicbrainz.org/ws/2/recording/");
            url.search = new URLSearchParams({ query: `recording:${quote(group.title)} AND artist:${quote(group.artist)}`, fmt: "json", limit: "100" });
            const response = await fetch(url, { headers: { "User-Agent": "KaraokeSearchEraEnrichment/1.0 (https://github.com/dinadur/Karaoke-Search)", Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const result = await readBoundedJson(response);
            if (result.error || !Array.isArray(result.recordings)) throw new Error(result.error || "Invalid response");
            if (result.recordings.length > MAX_RECORDINGS) throw new Error("MusicBrainz response has too many recordings");
            consecutiveErrors = 0;
            remember(group.key);
            if (result.count > 100) continue; // Incomplete search results cannot establish agreement.
            const matches = result.recordings.filter((recording) =>
                Number(recording.score) === 100 && normalize(recording.title) === normalize(group.title) &&
                normalize((recording["artist-credit"] || []).map((credit) => `${credit.name || credit.artist?.name || ""}${credit.joinphrase || ""}`).join("")) === normalize(group.artist));
            if (!matches.length || matches.some((recording) => !/^\d{4}/.test(recording["first-release-date"] || ""))) continue;
            const years = matches.map((recording) => Number(recording["first-release-date"].slice(0, 4)));
            const eras = [...new Set(years.map(decade))];
            if (eras.length !== 1 || years.some((year) => year < 1950 || year > new Date().getUTCFullYear())) continue;
            const source = {
                type: "musicbrainz", confidence: "exact-name-consensus", checkedAt: new Date().toISOString().slice(0, 10),
                firstReleaseDate: matches.map((recording) => recording["first-release-date"]).sort()[0],
                recordingIds: matches.map((recording) => recording.id),
                urls: matches.map((recording) => `https://musicbrainz.org/recording/${recording.id}`),
            };
            const created = targets.map((song) => ({ ...fields(song), eras, source }));
            for (const entry of created) {
                if (existing.has(identify(entry))) continue;
                data.entries.push(entry);
                existing.add(identify(entry));
                added++;
            }
            remember(group.key, created);
            console.log(`Matched ${group.artist} — ${group.title}: ${eras[0]}`);
        } catch (error) {
            consecutiveErrors++;
            console.error(`MusicBrainz request failed: ${error.message}`);
            if (consecutiveErrors >= 3) break; // Leave the existing data intact during an outage.
        }
    }
    const covered = new Set(data.entries.map(identify));
    const before = songs.filter((song) => song.eras?.length).length;
    const count = songs.filter((song) => !song.eras?.length && covered.has(identify(song))).length;
    data.summary = { ...(data.summary || {}), total: songs.length, before, added: count, after: before + count };
    data.generatedAt = new Date().toISOString().slice(0, 10);
    atomicJson(output, data);
    console.log(JSON.stringify({ requests, musicBrainzRowsAdded: added, stoppedForServiceErrors: consecutiveErrors >= 3 }));
})().catch((error) => { console.error(error); process.exitCode = 1; });
