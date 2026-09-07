#!/usr/bin/env node
// Optional bounded MusicBrainz batch. Only requests public recording metadata.
// Usage: node scripts/enrich-eras-musicbrainz.js [maximum requests, default 100]
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const normalize = (value) => String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
const quote = (value) => `"${String(value).replace(/[\\"]/g, " ")}"`;
const fields = (song) => ({ artist: song.artist, song: song.song, lookupArtist: song.lookupArtist || "", lookupSong: song.lookupSong || "" });
const identify = (song) => JSON.stringify(fields(song));
const decade = (year) => year < 2000 ? `${Math.floor(year / 10) % 10}0s` : `${Math.floor(year / 10) * 10}s`;

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
        if (result.entry && !existing.has(identify(result.entry))) {
            data.entries.push(result.entry); existing.add(identify(result.entry));
        }
    }
    const remember = (key, entry = null) => {
        checkpoint[key] = { checkedAt: new Date().toISOString(), entry };
        fs.mkdirSync(path.dirname(checkpointPath), { recursive: true });
        fs.writeFileSync(`${checkpointPath}.tmp`, JSON.stringify(checkpoint));
        fs.renameSync(`${checkpointPath}.tmp`, checkpointPath);
    };
    const seen = new Set();
    let requests = 0, added = 0, consecutiveErrors = 0;
    for (const song of [...songs].sort((a, b) => (b.popularity || 0) - (a.popularity || 0))) {
        if (song.eras?.length || existing.has(identify(song))) continue;
        const title = song.lookupSong || song.song;
        let artist = song.lookupArtist || song.artist;
        if (artist.split(",").length === 2) artist = artist.split(",").reverse().join(" ").trim();
        const key = `${normalize(artist)}\u001f${normalize(title)}`;
        if (!artist || seen.has(key) || checkpoint[key]) continue;
        seen.add(key);
        if (requests >= limit) break;
        await new Promise((resolve) => setTimeout(resolve, consecutiveErrors ? 5000 * consecutiveErrors : 1200));
        requests++;
        try {
            const url = new URL("https://musicbrainz.org/ws/2/recording/");
            url.search = new URLSearchParams({ query: `recording:${quote(title)} AND artist:${quote(artist)}`, fmt: "json", limit: "100" });
            const response = await fetch(url, { headers: { "User-Agent": "KaraokeSearchEraEnrichment/1.0 (https://github.com/dinadur/Karaoke-Search)", Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const result = await response.json();
            if (result.error || !Array.isArray(result.recordings)) throw new Error(result.error || "Invalid response");
            consecutiveErrors = 0;
            remember(key);
            if (result.count > 100) continue; // Incomplete search results cannot establish agreement.
            const matches = result.recordings.filter((recording) =>
                Number(recording.score) === 100 && normalize(recording.title) === normalize(title) &&
                normalize((recording["artist-credit"] || []).map((credit) => `${credit.name || credit.artist?.name || ""}${credit.joinphrase || ""}`).join("")) === normalize(artist));
            if (!matches.length || matches.some((recording) => !/^\d{4}/.test(recording["first-release-date"] || ""))) continue;
            const years = matches.map((recording) => Number(recording["first-release-date"].slice(0, 4)));
            const eras = [...new Set(years.map(decade))];
            if (eras.length !== 1 || years.some((year) => year < 1950 || year > new Date().getUTCFullYear())) continue;
            data.entries.push({ ...fields(song), eras, source: {
                type: "musicbrainz", confidence: "exact-name-consensus", checkedAt: new Date().toISOString().slice(0, 10),
                firstReleaseDate: matches.map((recording) => recording["first-release-date"]).sort()[0],
                recordingIds: matches.map((recording) => recording.id),
                urls: matches.map((recording) => `https://musicbrainz.org/recording/${recording.id}`),
            } });
            remember(key, data.entries[data.entries.length - 1]);
            existing.add(identify(song)); added++;
            console.log(`Matched ${artist} — ${title}: ${eras[0]}`);
        } catch (error) {
            consecutiveErrors++;
            console.error(`MusicBrainz request failed: ${error.message}`);
            if (consecutiveErrors >= 3) break; // Leave the existing data intact during an outage.
        }
    }
    const covered = new Set(data.entries.map(identify));
    const count = songs.filter((song) => !song.eras?.length && covered.has(identify(song))).length;
    data.summary.added = count; data.summary.after = data.summary.before + count;
    data.generatedAt = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(output, JSON.stringify(data, null, 2) + "\n");
    console.log(JSON.stringify({ requests, musicBrainzRowsAdded: added, stoppedForServiceErrors: consecutiveErrors >= 3 }));
})().catch((error) => { console.error(error); process.exitCode = 1; });
