#!/usr/bin/env node
// Exercise matching and checkpoint behavior without contacting MusicBrainz.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "karaoke-era-test-"));
try {
    fs.mkdirSync(path.join(temp, "scripts"));
    const script = path.join(temp, "scripts", "enrich-eras-musicbrainz.js");
    fs.copyFileSync(path.join(__dirname, "enrich-eras-musicbrainz.js"), script);
    const songs = ["Exact", "Conflict", "Undated", "Fuzzy", "Wrong artist", "Incomplete", "Future"].map((song) => ({ artist: "Alpha", song, eras: [], popularity: 1 }));
    fs.writeFileSync(path.join(temp, "karaoke_songs_enriched.json"), JSON.stringify(songs));
    const output = path.join(temp, "era_enrichment.json");
    fs.writeFileSync(output, JSON.stringify({ summary: { before: 0 }, entries: [] }));
    const mock = path.join(temp, "mock.cjs");
    fs.writeFileSync(mock, `
        const actualTimeout = global.setTimeout;
        global.setTimeout = (callback) => actualTimeout(callback, 0);
        global.fetch = async (url) => {
            const title = url.searchParams.get("query").match(/recording:"([^"]+)"/)[1];
            const recording = { id: "11111111-1111-1111-1111-111111111111", title, score: 100, "first-release-date": "1997-01-01", "artist-credit": [{ name: "Alpha" }] };
            if (title === "Undated") delete recording["first-release-date"];
            if (title === "Fuzzy") recording.score = 99;
            if (title === "Wrong artist") recording["artist-credit"][0].name = "Beta";
            if (title === "Future") recording["first-release-date"] = "2099-01-01";
            const recordings = title === "Conflict" ? [recording, { ...recording, "first-release-date": "2001" }] : [recording];
            return new Response(JSON.stringify({ count: title === "Incomplete" ? 101 : recordings.length, recordings }));
        };
    `);
    execFileSync(process.execPath, ["--require", mock, script, "20"]);
    let data = JSON.parse(fs.readFileSync(output));
    assert.deepEqual(data.entries.map((entry) => [entry.song, entry.eras]), [["Exact", ["90s"]]]);
    assert.equal(data.entries[0].source.type, "musicbrainz");
    // Simulate losing the output after checkpointing an accepted result.
    fs.writeFileSync(output, JSON.stringify({ summary: { before: 0 }, entries: [] }));
    fs.writeFileSync(mock, 'global.fetch = async () => { throw new Error("Checkpoint should avoid network"); };');
    const log = execFileSync(process.execPath, ["--require", mock, script, "20"], { encoding: "utf8" });
    assert.match(log, /"requests":0/);
    data = JSON.parse(fs.readFileSync(output));
    assert.equal(data.entries[0].song, "Exact");
    assert.equal(data.summary.added, 1);
    console.log("ok   MusicBrainz exact matches, ambiguity rejection, and checkpoint recovery");
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
