#!/usr/bin/env node
// Fast Node unit tests for catalog-prep.js (shared by catalog-worker.js and the main thread).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const context = vm.createContext({
    Uint32Array,
    Map,
    Set,
    URL,
    console,
});
vm.runInContext(fs.readFileSync(path.join(root, "search-ranking.js"), "utf8"), context, { filename: "search-ranking.js" });
vm.runInContext(fs.readFileSync(path.join(root, "catalog-prep.js"), "utf8"), context, { filename: "catalog-prep.js" });

const {
    prepareCatalogSync,
    normalizeTagConsolidation,
    normalizeMoodConsolidation,
    getSongIdentity,
    getDisplaySongTitle,
    getDisplayArtist,
} = context;

// 1. Display cleanup
assert.equal(getDisplaySongTitle({ artist: "Queen", song: "Bohemian Rhapsody (Karaoke) - SF1234" }), "Bohemian Rhapsody");
assert.equal(getDisplaySongTitle({ artist: "David Bowie", song: "Heroes-David Bowie" }), "Heroes");
assert.equal(getDisplayArtist({ artist: "Sc8608" }), "");
assert.equal(getDisplayArtist({ artist: "ABBA Wvocal" }), "ABBA");

// 2. Full prepareCatalogSync pipeline (enrichment overlay, duet/holiday, length, ranking, What's new)
const rawSongs = [
    { artist: "ABBA", song: "Dancing Queen", status: "ok", popularity: 900, seconds: 230, genres: ["Pop"], moods: ["Party"], eras: [], flags: [], tags: ["disco"] },
    { artist: "ABBA", song: "Mamma Mia", status: "ok", popularity: 700, seconds: 212, genres: ["Pop"], moods: [], eras: ["70s"], flags: [], tags: [] },
    { artist: "ABBA", song: "Waterloo", status: "pending", popularity: 0, seconds: 165, genres: [], moods: [], eras: [], flags: [], tags: [] },
    { artist: "Elton John", song: "Rocket Man", status: "ok", popularity: 800, seconds: 280, genres: ["Rock"], moods: [], eras: ["70s"], flags: [], tags: [] },
    { artist: "Elton John", song: "Tiny Dancer", status: "ok", popularity: 750, seconds: 375, genres: ["Rock"], moods: [], eras: ["70s"], flags: [], tags: [] },
    { artist: "Kiki Dee", song: "I've Got the Music in Me", status: "ok", popularity: 300, seconds: 220, genres: ["Pop"], moods: [], eras: ["70s"], flags: [], tags: [] },
    { artist: "Kiki Dee", song: "Amoureuse", status: "ok", popularity: 200, seconds: 240, genres: ["Pop"], moods: [], eras: ["70s"], flags: [], tags: [] },
    { artist: "Elton John & Kiki Dee", song: "Don't Go Breaking My Heart", status: "ok", popularity: 850, seconds: 265, genres: ["Pop"], moods: ["Singalong"], eras: ["70s"], flags: [], tags: [] },
    { artist: "David Guetta feat. Sia", song: "Titanium", status: "ok", popularity: 880, seconds: 245, genres: ["Dance"], moods: [], eras: ["2010s"], flags: [], tags: [] },
    { artist: "Mariah Carey", song: "All I Want for Christmas Is You", status: "ok", popularity: 950, seconds: 241, genres: ["Pop"], moods: [], eras: ["90s"], flags: [], tags: [] },
];

const waterlooId = getSongIdentity(rawSongs[2]);
const prepared = prepareCatalogSync(rawSongs.map((s) => ({ ...s })), {
    eraEnrichment: {
        entries: [{ artist: "ABBA", song: "Dancing Queen", eras: ["70s"], source: { type: "musicbrainz" } }],
    },
    audioEnrichment: {
        entries: [{
            artist: "ABBA",
            song: "Dancing Queen",
            bpm: 101,
            referenceKey: "A",
            danceability: 78,
            acousticness: 12,
            source: { type: "getsongbpm", records: [{ url: "https://getsongbpm.com/song/dancing-queen/123" }] },
        }],
    },
    whatsNewSource: {
        batches: [{ date: "2026-11-20", ids: [waterlooId] }],
    },
    tagConsolidation: normalizeTagConsolidation({ thresholds: { minLastFmSongs: 1 }, genreTags: [{ tag: "disco", label: "Disco" }] }),
    moodConsolidation: normalizeMoodConsolidation({ moods: [{ label: "Feel-good", tags: ["disco"] }] }),
});

assert.equal(prepared.songs.length, rawSongs.length);
const dancingQueen = prepared.songs[0];
assert.deepEqual(dancingQueen.eras, ["70s"]);
assert.equal(dancingQueen.bpm, 101);
assert.equal(dancingQueen.referenceKey, "A");
assert.ok(dancingQueen.filterKeys.genres.has("disco"));
assert.ok(dancingQueen.filterKeys.moods.has("feel good"));
assert.equal(dancingQueen.lengthBucket, "Standard (3–5 min)");

const waterloo = prepared.songs[2];
assert.equal(waterloo.lengthBucket, "Short (< 3 min)");
assert.equal(prepared.whatsNewLatest, "2026-11-20");
assert.equal(prepared.whatsNewIndices.length, 1);
assert.equal(prepared.songs[prepared.whatsNewIndices[0]].song, "Waterloo");
assert.equal(waterloo.whatsNew.basis, "artist");
assert.equal(waterloo.whatsNew.score, 800); // median of ABBA's 900 and 700

const tinyDancer = prepared.songs[4];
assert.equal(tinyDancer.lengthBucket, "Long (5+ min)");

const duetSong = prepared.songs[7];
assert.equal(duetSong.duetSource, "likely");
assert.equal(duetSong.isDuet, true);

const producerCollab = prepared.songs[8];
assert.equal(producerCollab.isDuet, false, "Producer feat. Singer should not be flagged as duet");

const christmas = prepared.songs[9];
assert.deepEqual(Array.from(christmas.holidayValues), ["Christmas"]);
assert.equal(prepared.songs[prepared.defaultRankedIndices[0]].song, "All I Want for Christmas Is You");

// 3. Invalid catalog rejection
assert.throws(() => prepareCatalogSync([]), /Invalid songbook data/);
assert.throws(() => prepareCatalogSync([{ artist: "Only artist" }]), /Invalid songbook data/);
assert.throws(() => prepareCatalogSync([{ artist: "A", song: "B", tags: [123] }]), /Invalid songbook data/);

console.log("ok   catalog-prep.js unit tests passed");
