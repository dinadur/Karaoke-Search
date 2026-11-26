#!/usr/bin/env node
// Reproducible, conservative sidecar enrichment. Never edits the source catalog.
// Existing era tags are evidence, not independently verified release dates.
const fs = require("node:fs");
const path = require("node:path");
const { normalize, fields, identity, stripArtistNoise, normalizeArtistName, cleanTitleForLookup, atomicJson } = require("./lib/music-metadata");
const root = path.join(__dirname, "..");
const songs = JSON.parse(fs.readFileSync(path.join(root, "karaoke_songs_enriched.json")));
const output = path.join(root, "era_enrichment.json");
const known = new Set(songs.map((song) => normalize(stripArtistNoise(song))));
const artist = (song) => normalize(
    normalizeArtistName(stripArtistNoise(song), known)
        .replace(/[’'!?.]/g, "")
        .replace(/\b(?:feat|ft|featuring)\b/gi, "feat")
        .replace(/^the\s+/i, "")
        .replace(/,\s*the$/i, "")
);
const title = (song) => normalize(
    cleanTitleForLookup(song)
        .replace(/,\s*(?:the|a|an)$/i, "")
        .replace(/^(?:the|a|an)\s+/i, "")
        .replace(/[’']/g, "")
);
const key = (song) => `${artist(song)}\u001f${title(song)}`;
const valid = new Set(["50s", "60s", "70s", "80s", "90s", "2000s", "2010s", "2020s"]);
const currentYear = new Date().getUTCFullYear();
const decadeTagPattern = /^(?:19)?([5-9]0)['’]?s$|^(20[0-2]0)['’]?s$|^(00)['’]?s$/;
const yearTagPattern = /^(19[5-9]\d|20[0-2]\d)$/;
const parseDecadeTag = (tag) => {
    const text = String(tag || "").trim().toLowerCase();
    const match = text.match(decadeTagPattern);
    if (match) return match[1] ? `${match[1]}s` : match[2] ? `${match[2]}s` : "2000s";
    const yearMatch = text.match(yearTagPattern);
    if (!yearMatch) return null;
    const year = Number(yearMatch[1]);
    if (year < 1950 || year > currentYear) return null;
    return year < 2000 ? `${Math.floor(year / 10) % 10}0s` : `${Math.floor(year / 10) * 10}s`;
};
const groups = new Map();
for (const song of songs) {
    if (!artist(song) || !title(song)) continue;
    const group = groups.get(key(song)) || [];
    group.push(song); groups.set(key(song), group);
}
const entries = [];
let conflicts = 0;
const checkedAt = new Date().toISOString().slice(0, 10);
for (const song of songs) {
    if (song.eras?.length) continue;
    const evidence = (groups.get(key(song)) || []).filter((row) => row.eras?.length);
    if (evidence.length) {
        const eras = [...new Set(evidence.flatMap((row) => row.eras))];
        // Require a single consistent decade across exact artist/title matches.
        if (eras.length !== 1 || !valid.has(eras[0])) { conflicts++; continue; }
        entries.push({ ...fields(song), eras, source: {
            type: "catalog-consensus", confidence: "inferred", checkedAt,
            matching: "Normalized lookup title and artist (leading/trailing articles, apostrophes, karaoke source codes, and truncated brackets normalized; comma-reversed artist allowed only when that exact name also exists); all dated matches agree on one decade",
            evidence: evidence.slice(0, 3).map((row) => ({ ...fields(row), eras: row.eras })),
        } });
        continue;
    }
    // Only trust decade tags on track-level rows (confidence >= 0.7); lower-confidence
    // rows carry artist-level fallback tags whose decade may not match the track.
    if ((song.confidence || 0) < 0.7) continue;
    const tagMatches = (song.tags || []).map((raw) => [raw, parseDecadeTag(raw)]).filter(([, dec]) => dec && valid.has(dec));
    const uniqueTagDecades = [...new Set(tagMatches.map(([, dec]) => dec))];
    if (uniqueTagDecades.length === 1) {
        entries.push({ ...fields(song), eras: uniqueTagDecades, source: {
            type: "catalog-tag", confidence: "inferred", checkedAt,
            matchedTag: tagMatches[0][0],
            matching: "Unambiguous single decade tag present in track-level catalog tags[] (confidence >= 0.7)",
        } });
    } else if (uniqueTagDecades.length > 1) {
        conflicts++;
    }
}
// Keep separately reviewed MusicBrainz matches when regenerating local matches.
if (fs.existsSync(output)) {
    const existing = JSON.parse(fs.readFileSync(output));
    for (const entry of existing.entries || []) {
        if (entry.source?.type === "musicbrainz") entries.push(entry);
    }
}
const unique = [...new Map(entries.map((entry) => [identity(entry), entry])).values()];
const before = songs.filter((song) => song.eras?.length).length;
const covered = new Set(unique.map(identity));
const added = songs.filter((song) => !song.eras?.length && covered.has(identity(song))).length;
atomicJson(output, { schemaVersion: 1, generatedAt: checkedAt, summary: { total: songs.length, before, added, after: before + added, conflictsSkipped: conflicts }, entries: unique });
console.log({ before, added, after: before + added, conflictsSkipped: conflicts });
