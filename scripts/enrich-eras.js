#!/usr/bin/env node
// Reproducible, conservative sidecar enrichment. Never edits the source catalog.
// Existing era tags are evidence, not independently verified release dates.
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const songs = JSON.parse(fs.readFileSync(path.join(root, "karaoke_songs_enriched.json")));
const output = path.join(root, "era_enrichment.json");
const normalize = (value) => String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
const clean = (value) => String(value || "").replace(/\bwvocals?\b/gi, " ").replace(/\bw\s*\/?\s*vocals?\b/gi, " ").replace(/[\[(]\s*karaoke\s*[\])]/gi, " ").replace(/\bkaraoke\b/gi, " ").replace(/\s+/g, " ").trim();
const artist = (song) => normalize((clean(song.lookupArtist) || clean(song.artist)).replace(/[’'!?.]/g, ""));
const knownArtists = new Set(songs.map(artist));
const aliases = new Map();
for (const song of songs) {
    const parts = (clean(song.lookupArtist) || clean(song.artist)).split(",");
    if (parts.length === 2) {
        const reversed = normalize(`${parts[1].trim()} ${parts[0].trim()}`.replace(/[’'!?.]/g, ""));
        if (knownArtists.has(reversed)) aliases.set(artist(song), reversed);
    }
}
const title = (song) => normalize(String(song.lookupSong || song.song)
    .replace(/[\[(][^\])]*\b(karaoke|instrumental|backing track|multiplex)\b[^\])]*[\])]/gi, " ")
    .replace(/[-\s]+\b(?:sf|sbi|sb|mm|hmx|sc|sm)\d{3,6}\b/gi, " "));
const key = (song) => `${aliases.get(artist(song)) || artist(song)}\u001f${title(song)}`;
const fields = (song) => ({ artist: song.artist, song: song.song, lookupArtist: song.lookupArtist || "", lookupSong: song.lookupSong || "" });
const valid = new Set(["50s", "60s", "70s", "80s", "90s", "2000s", "2010s", "2020s"]);
const groups = new Map();
for (const song of songs) {
    if (!artist(song) || !title(song)) continue;
    const group = groups.get(key(song)) || [];
    group.push(song); groups.set(key(song), group);
}
const entries = [];
let conflicts = 0;
for (const song of songs) {
    if (song.eras?.length) continue;
    const evidence = (groups.get(key(song)) || []).filter((row) => row.eras?.length);
    if (!evidence.length) continue;
    const eras = [...new Set(evidence.flatMap((row) => row.eras))];
    // Require a single consistent decade across exact artist/title matches.
    if (eras.length !== 1 || !valid.has(eras[0])) { conflicts++; continue; }
    entries.push({ ...fields(song), eras, source: {
        type: "catalog-consensus", confidence: "inferred", checkedAt: new Date().toISOString().slice(0, 10),
        matching: "Normalized lookup title and artist; comma-reversed artist allowed only when that exact name also exists; karaoke source codes removed; all dated matches agree on one decade",
        evidence: evidence.slice(0, 3).map((row) => ({ ...fields(row), eras: row.eras })),
    } });
}
// Keep separately reviewed MusicBrainz matches when regenerating local matches.
if (fs.existsSync(output)) {
    const existing = JSON.parse(fs.readFileSync(output));
    for (const entry of existing.entries || []) {
        if (entry.source?.type === "musicbrainz") entries.push(entry);
    }
}
const unique = [...new Map(entries.map((entry) => [JSON.stringify(fields(entry)), entry])).values()];
const before = songs.filter((song) => song.eras?.length).length;
const covered = new Set(unique.map((entry) => JSON.stringify(fields(entry))));
const added = songs.filter((song) => !song.eras?.length && covered.has(JSON.stringify(fields(song)))).length;
fs.writeFileSync(output, JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString().slice(0, 10), summary: { total: songs.length, before, added, after: before + added, conflictsSkipped: conflicts }, entries: unique }, null, 2) + "\n");
console.log({ before, added, after: before + added, conflictsSkipped: conflicts });
