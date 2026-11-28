#!/usr/bin/env node
// Unit tests for api/youtube-search.js ranking, duration parsing, URL extraction,
// and Vercel serverless handler behavior (unconfigured, quota-exceeded, cached).
const assert = require("node:assert/strict");
const handler = require("../api/youtube-search.js");
const {
    rankKaraokeVideos,
    parseIsoDuration,
    buildYoutubeSearchUrl,
    extractYoutubeVideoId,
    fetchYoutubeCandidates,
} = handler;

// 1. ISO 8601 duration parsing
assert.equal(parseIsoDuration("PT3M51S"), 231);
assert.equal(parseIsoDuration("PT1H2M5S"), 3725);
assert.equal(parseIsoDuration("PT45S"), 45);
assert.equal(parseIsoDuration("invalid"), 0);

// 2. YouTube video ID extraction
assert.equal(extractYoutubeVideoId("dQw4w9WgXcQ"), "dQw4w9WgXcQ");
assert.equal(extractYoutubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30"), "dQw4w9WgXcQ");
assert.equal(extractYoutubeVideoId("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
assert.equal(extractYoutubeVideoId("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
assert.equal(extractYoutubeVideoId("https://youtube.com/shorts/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
assert.equal(extractYoutubeVideoId("https://example.com/watch?v=dQw4w9WgXcQ"), "");
assert.equal(extractYoutubeVideoId("not-valid"), "");

// 3. Search URL builder
assert.equal(
    buildYoutubeSearchUrl("Dancing Queen", "ABBA"),
    "https://www.youtube.com/results?search_query=ABBA%20Dancing%20Queen%20karaoke"
);

// 4. Karaoke ranking prefers trusted embeddable karaoke tracks over official videos, covers, vocals, and shorts
const ranked = rankKaraokeVideos([
    { id: "OfficialVid", title: "ABBA - Dancing Queen (Official Music Video)", channel: "ABBA", durationSec: 232, views: 500_000_000, embeddable: true },
    { id: "WithVocals1", title: "Dancing Queen - ABBA Karaoke With Vocals", channel: "Random Uploads", durationSec: 231, views: 200_000, embeddable: true },
    { id: "BlockedVid1", title: "ABBA - Dancing Queen (Karaoke Version)", channel: "Sing King", durationSec: 230, views: 900_000, embeddable: false },
    { id: "ShortClip01", title: "Dancing Queen Karaoke #shorts", channel: "KaraFun Karaoke", durationSec: 32, views: 1_000_000, embeddable: true },
    { id: "LowerKey001", title: "ABBA - Dancing Queen (Karaoke Version Lower Key)", channel: "Sing King", durationSec: 232, views: 300_000, embeddable: true },
    { id: "SingKing001", title: "ABBA - Dancing Queen (Karaoke Version with Lyrics)", channel: "Sing King", durationSec: 232, views: 450_000, embeddable: true },
    { id: "KaraFun0001", title: "Dancing Queen - ABBA | Karaoke Version | KaraFun", channel: "KaraFun Karaoke", durationSec: 235, views: 350_000, embeddable: true },
], { song: "Dancing Queen", artist: "ABBA", seconds: 231 });

assert.ok(ranked.every((item) => item.id !== "BlockedVid1"), "Non-embeddable videos must be excluded");
assert.equal(ranked[0].id, "SingKing001", "Trusted karaoke track with lyrics should rank #1");
assert.equal(ranked[1].id, "KaraFun0001", "Second trusted standard-key karaoke track should rank #2");
assert.equal(ranked[2].id, "LowerKey001", "Alternate key track should stay available behind standard key");
assert.ok(ranked[0].score > ranked[ranked.length - 1].score);
assert.equal(ranked[0].embedUrl, "https://www.youtube-nocookie.com/embed/SingKing001?rel=0&modestbranding=1");

// 5. Handler behavior (method check, missing params, unconfigured fallback, quota fallback)
function mockRes() {
    const res = {
        statusCode: 200,
        headers: {},
        body: null,
        setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
        status(code) { this.statusCode = code; return this; },
        json(data) { this.body = data; return this; },
    };
    return res;
}

(async () => {
    const r405 = mockRes();
    await handler({ method: "POST", query: {} }, r405);
    assert.equal(r405.statusCode, 405);

    const r400 = mockRes();
    await handler({ method: "GET", query: {} }, r400);
    assert.equal(r400.statusCode, 400);

    const savedKey = process.env.YOUTUBE_API_KEY;
    delete process.env.YOUTUBE_API_KEY;
    const rUnconf = mockRes();
    await handler({ method: "GET", query: { song: "Mr. Brightside", artist: "The Killers" } }, rUnconf);
    assert.equal(rUnconf.statusCode, 200);
    assert.equal(rUnconf.body.configured, false);
    assert.deepEqual(rUnconf.body.candidates, []);
    assert.match(rUnconf.body.searchUrl, /The%20Killers%20Mr\.%20Brightside%20karaoke/);

    // Mock fetchYoutubeCandidates quota exceeded
    const quota = await fetchYoutubeCandidates({
        song: "Mr. Brightside",
        artist: "The Killers",
        apiKey: "fake-key",
        fetchImpl: async () => ({ status: 403, ok: false }),
    });
    assert.equal(quota.quotaExceeded, true);
    assert.deepEqual(quota.candidates, []);

    if (savedKey !== undefined) process.env.YOUTUBE_API_KEY = savedKey;
    console.log("ok   api/youtube-search.js unit tests passed");
})().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
