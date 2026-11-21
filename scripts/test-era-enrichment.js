#!/usr/bin/env node
// Exercise matching and checkpoint behavior without contacting MusicBrainz.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "karaoke-era-test-"));
try {
    fs.mkdirSync(path.join(temp, "scripts", "lib"), { recursive: true });
    const script = path.join(temp, "scripts", "enrich-eras-musicbrainz.js");
    fs.copyFileSync(path.join(__dirname, "enrich-eras-musicbrainz.js"), script);
    fs.copyFileSync(path.join(__dirname, "lib", "music-metadata.js"), path.join(temp, "scripts", "lib", "music-metadata.js"));
    const songs = [
        ...["Exact", "Conflict", "Undated", "Fuzzy", "Wrong artist", "Incomplete", "Future", "Too many recordings", "Large body", "Large header"].map((song) => ({ artist: "Alpha", song, eras: [], popularity: 1 })),
        { artist: "Alpha", song: "Exact [Karaoke] SF123", eras: [], popularity: 1 },
        { artist: "Earth, Wind & Fire", song: "September", eras: [], popularity: 2 },
    ];
    fs.writeFileSync(path.join(temp, "karaoke_songs_enriched.json"), JSON.stringify(songs));
    const output = path.join(temp, "era_enrichment.json");
    fs.writeFileSync(output, JSON.stringify({ summary: { before: 0 }, entries: [] }));
    const mock = path.join(temp, "mock.cjs");
    fs.writeFileSync(mock, `
        const actualTimeout = global.setTimeout;
        global.setTimeout = (callback) => actualTimeout(callback, 0);
        global.fetch = async (url) => {
            const query = url.searchParams.get("query");
            const title = query.match(/recording:"([^"]+)"/)[1];
            const artist = query.match(/artist:"([^"]+)"/)[1];
            const recording = { id: "11111111-1111-1111-1111-111111111111", title, score: 100, "first-release-date": title === "September" ? "1978-11-18" : "1997-01-01", "artist-credit": [{ name: artist }] };
            if (title === "September" && artist !== "Earth, Wind & Fire") throw new Error("Comma artist was mangled: " + artist);
            if (title === "Undated") delete recording["first-release-date"];
            if (title === "Fuzzy") recording.score = 99;
            if (title === "Wrong artist") recording["artist-credit"][0].name = "Beta";
            if (title === "Future") recording["first-release-date"] = "2099-01-01";
            const recordings = title === "Conflict" ? [recording, { ...recording, "first-release-date": "2001" }] :
                title === "Too many recordings" ? Array.from({ length: 101 }, () => recording) : [recording];
            const body = JSON.stringify({ count: title === "Incomplete" ? 101 : recordings.length, recordings,
                padding: title === "Large body" ? "x".repeat(1024 * 1024) : "" });
            return new Response(body, { headers: title === "Large header" ? { "Content-Length": String(2 * 1024 * 1024) } : {} });
        };
    `);
    const run = spawnSync(process.execPath, ["--require", mock, script, "20"], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stderr, /too many recordings/);
    assert.equal((run.stderr.match(/response is too large/g) || []).length, 2);
    let data = JSON.parse(fs.readFileSync(output));
    assert.deepEqual(data.entries.map((entry) => [entry.artist, entry.song, entry.eras]), [
        ["Earth, Wind & Fire", "September", ["70s"]],
        ["Alpha", "Exact", ["90s"]],
        ["Alpha", "Exact [Karaoke] SF123", ["90s"]],
    ]);
    assert.equal(data.entries[0].source.type, "musicbrainz");
    assert.equal(data.summary.total, songs.length);
    assert.equal(data.summary.added, 3);
    // Simulate losing the output after checkpointing accepted results.
    const recoverableSongs = [...songs.slice(0, 7), songs[10], songs[11]];
    fs.writeFileSync(output, JSON.stringify({ summary: { before: 0 }, entries: [] }));
    fs.writeFileSync(path.join(temp, "karaoke_songs_enriched.json"), JSON.stringify(recoverableSongs));
    fs.writeFileSync(mock, 'global.fetch = async () => { throw new Error("Checkpoint should avoid network"); };');
    const log = execFileSync(process.execPath, ["--require", mock, script, "20"], { encoding: "utf8" });
    assert.match(log, /"requests":0/);
    data = JSON.parse(fs.readFileSync(output));
    assert.equal(data.entries.length, 3);
    assert.equal(data.summary.total, recoverableSongs.length);
    assert.equal(data.summary.added, 3);
    console.log("ok   MusicBrainz exact matches, comma preservation, version grouping, and checkpoint recovery");
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
