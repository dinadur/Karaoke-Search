#!/usr/bin/env node
// Unit tests for karaoke-night.js fair singer rotation, wait estimates, and
// YouTube URL/ID extraction.
const assert = require("node:assert/strict");
const {
    normalizeSingerKey,
    rebalanceNightQueue,
    insertIntoNightQueue,
    computeNightWaitMinutes,
    extractNightYoutubeId,
    buildNightYoutubeSearchUrl,
} = require("../karaoke-night.js");

const entry = (uid, singer, title, status = "queued", seconds = 210) => ({
    uid,
    singer,
    title,
    artist: "Artist",
    status,
    seconds,
});

// 1. Singer key normalization
assert.equal(normalizeSingerKey("  Alex   M. "), "alex m.");

// 2. Round-robin fairness keeps sung & performing anchored and interleaves queued turns
let queue = [
    entry("s1", "Alice", "Song A1", "sung"),
    entry("p1", "Alice", "Song A2", "performing"),
    entry("q1", "Alice", "Song A3", "queued"),
    entry("q2", "Alice", "Song A4", "queued"),
    entry("q3", "Bob", "Song B1", "queued"),
    entry("q4", "Bob", "Song B2", "queued"),
];

const balanced = rebalanceNightQueue(queue);
assert.deepEqual(
    balanced.map((item) => item.uid),
    ["s1", "p1", "q3", "q4", "q1", "q2"],
    "Bob (0 sung/active) should get rounds 0 and 1 before Alice's round 2 and 3"
);

// 3. Newcomer joining late slots ahead of regulars' later rounds
const withNewcomer = insertIntoNightQueue(balanced, entry("q5", "Cara", "Song C1"), { autoBalance: true });
assert.deepEqual(
    withNewcomer.map((item) => item.uid),
    ["s1", "p1", "q3", "q5", "q4", "q1", "q2"],
    "Cara joins round 0 right behind Bob's first song, ahead of Bob's second and Alice's third"
);

// 4. Auto-balance disabled appends at the end without shuffling
const manual = insertIntoNightQueue(balanced, entry("q6", "Cara", "Song C1"), { autoBalance: false });
assert.equal(manual[manual.length - 1].uid, "q6");

// 5. Unassigned open-mic entries don't collapse onto one singer
const openMic = rebalanceNightQueue([
    entry("o1", "", "Open 1"),
    entry("a1", "Alice", "Alice 1"),
    entry("o2", "", "Open 2"),
    entry("a2", "Alice", "Alice 2"),
]);
assert.deepEqual(openMic.map((i) => i.uid), ["o1", "a1", "o2", "a2"]);

// 6. Cumulative wait-time estimates
const waits = computeNightWaitMinutes([
    entry("p1", "Alice", "Now", "performing", 240), // 4 min
    entry("q1", "Bob", "Next", "queued", 180),      // waits 4m
    entry("q2", "Cara", "Third", "queued", 240),    // waits 4 + 3 = 7m
]);
assert.equal(waits.get("q1"), 4);
assert.equal(waits.get("q2"), 7);

// 7. YouTube extraction & search link
assert.equal(extractNightYoutubeId("https://youtu.be/abcDEF12345?si=xyz"), "abcDEF12345");
assert.equal(extractNightYoutubeId("https://www.youtube.com/watch?v=abcDEF12345"), "abcDEF12345");
assert.equal(extractNightYoutubeId("abcDEF12345"), "abcDEF12345");
assert.equal(extractNightYoutubeId("bad"), "");
assert.equal(
    buildNightYoutubeSearchUrl("Bohemian Rhapsody", "Queen"),
    "https://www.youtube.com/results?search_query=Queen%20Bohemian%20Rhapsody%20karaoke"
);

console.log("ok   karaoke-night.js unit tests passed");
