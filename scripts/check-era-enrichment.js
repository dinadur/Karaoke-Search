#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const songs = JSON.parse(fs.readFileSync(path.join(root, "karaoke_songs_enriched.json")));
const enrichment = JSON.parse(fs.readFileSync(path.join(root, "era_enrichment.json")));
const key = (song) => JSON.stringify([song.artist, song.song, song.lookupArtist || "", song.lookupSong || ""]);
const existing = new Map(songs.map((song) => [key(song), song]));
const valid = new Set(["50s", "60s", "70s", "80s", "90s", "2000s", "2010s", "2020s"]);
const seen = new Set();
for (const entry of enrichment.entries) {
    assert.ok(existing.has(key(entry)), "Enrichment target must exist in the catalog");
    assert.ok(!seen.has(key(entry)), "Duplicate enrichment target"); seen.add(key(entry));
    assert.ok(entry.eras.length === 1 && valid.has(entry.eras[0]));
    assert.match(entry.source.checkedAt, /^\d{4}-\d{2}-\d{2}$/);
    if (entry.source.type === "catalog-consensus") {
        assert.ok(entry.source.evidence.length);
        for (const evidence of entry.source.evidence) {
            const sources = songs.filter((song) => key(song) === key(evidence) && song.eras?.length);
            assert.ok(sources.length && sources.every((source) => JSON.stringify(source.eras) === JSON.stringify(entry.eras)), "Evidence must be a real catalog entry with the stated decade");
        }
    } else {
        assert.equal(entry.source.type, "musicbrainz");
        assert.ok(entry.source.recordingIds.length);
        assert.ok(entry.source.urls.every((url) => /^https:\/\/musicbrainz.org\/recording\/[0-9a-f-]{36}$/.test(url)));
    }
}
const before = songs.filter((song) => song.eras?.length).length;
const added = songs.filter((song) => !song.eras?.length && seen.has(key(song))).length;
assert.equal(enrichment.summary.before, before);
assert.equal(enrichment.summary.added, added);
assert.equal(enrichment.summary.after, before + added);
console.log(`Era evidence verified: ${added} missing rows filled; ${before + added}/${songs.length} rows covered`);
