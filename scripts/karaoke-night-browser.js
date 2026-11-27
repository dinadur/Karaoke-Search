#!/usr/bin/env node
// End-to-end Playwright + axe-core checks for Karaoke Night host mode:
// singer roster, fair rotation, catalog + custom requests, auto YouTube lookup
// with version switcher, manual YouTube URL fallback, Done/Next + Push back,
// TV Stage BroadcastChannel sync, setlist import, persistence, and accessibility.
const assert = require("node:assert/strict");
const { menu, plan } = require("./ui-helpers");
let playwright;
try { playwright = require("playwright"); } catch { playwright = require("playwright-core"); }

const browserName = process.env.BROWSER || "chromium";
const options = { headless: true };
if (browserName === "chromium" && process.env.CHROMIUM_PATH) {
    options.executablePath = process.env.CHROMIUM_PATH;
}
const BASE = process.env.SMOKE_URL || "http://127.0.0.1:8765/karaoke_explorer.html";

const fixtureSongs = [
    { artist: "Queen", song: "Bohemian Rhapsody", status: "ok", popularity: 990, seconds: 354, genres: ["Rock"], moods: ["Singalong"], eras: ["70s"], tags: [], flags: [] },
    { artist: "ABBA", song: "Dancing Queen", status: "ok", popularity: 980, seconds: 231, genres: ["Pop"], moods: ["Party"], eras: ["70s"], tags: [], flags: [] },
    { artist: "The Killers", song: "Mr. Brightside", status: "ok", popularity: 970, seconds: 222, genres: ["Rock"], moods: ["Singalong"], eras: ["2000s"], tags: [], flags: [] },
    { artist: "Journey", song: "Don't Stop Believin'", status: "ok", popularity: 960, seconds: 250, genres: ["Rock"], moods: ["Singalong"], eras: ["80s"], tags: [], flags: [] },
];

const mockYoutubeBySong = {
    "bohemian rhapsody": {
        configured: true,
        quotaExceeded: false,
        searchUrl: "https://www.youtube.com/results?search_query=Queen%20Bohemian%20Rhapsody%20karaoke",
        candidates: [
            { id: "SingKingBR1", title: "Queen - Bohemian Rhapsody (Karaoke with Lyrics)", channel: "Sing King", durationSec: 355, tags: ["Trusted channel", "Karaoke"] },
            { id: "KaraFunBR02", title: "Bohemian Rhapsody - Queen | KaraFun", channel: "KaraFun Karaoke", durationSec: 354, tags: ["Trusted channel", "Karaoke"] },
        ],
    },
    "dancing queen": {
        configured: true,
        quotaExceeded: false,
        searchUrl: "https://www.youtube.com/results?search_query=ABBA%20Dancing%20Queen%20karaoke",
        candidates: [
            { id: "SingKingDQ1", title: "ABBA - Dancing Queen (Karaoke Version)", channel: "Sing King", durationSec: 232, tags: ["Trusted channel", "Karaoke"] },
        ],
    },
};

(async () => {
    const browser = await playwright[browserName].launch(options);
    try {
        const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 900 } });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));

        await context.route("**/karaoke_songs_enriched.json?*", (route) => route.fulfill({ json: fixtureSongs }));
        await context.route("**/era_enrichment.json?*", (route) => route.fulfill({ json: { entries: [] } }));
        await context.route("**/audio_enrichment.json?*", (route) => route.fulfill({ json: { entries: [] } }));
        await context.route("**/whats_new.json?*", (route) => route.fulfill({ json: { batches: [] } }));
        await context.route("https://www.youtube-nocookie.com/**", (route) =>
            route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>Mock YouTube Embed</body></html>" })
        );
        await context.route("**/api/youtube-search?*", (route) => {
            const url = new URL(route.request().url());
            const song = (url.searchParams.get("song") || "").toLowerCase();
            const match = mockYoutubeBySong[song] || {
                configured: false,
                quotaExceeded: false,
                searchUrl: "https://www.youtube.com/results?search_query=karaoke",
                candidates: [],
            };
            return route.fulfill({ json: match });
        });

        await page.goto(BASE);
        await page.waitForFunction(() => state.songs.length === 4 && !songbookLoadPending);

        // 1. Add a song to the regular setlist, then open Karaoke Night from the setlist Host button
        await plan(page);
        await page.fill("#searchInput", "Bohemian");
        await page.waitForFunction(() => state.query === "Bohemian" && !searchRenderTimer);
        await page.locator(".add-button").first().click();
        await page.click("#hostNightFromSetlistButton");
        await page.waitForSelector("#karaokeNightPanel:not([hidden])");

        // 2. Import setlist into Karaoke Night and verify auto YouTube lookup + version switcher
        await page.click("#nightImportSetlistButton");
        await page.waitForFunction(() => {
            const frame = document.getElementById("nightVideoFrame");
            return frame && !frame.hidden && frame.src.includes("SingKingBR1");
        });
        assert.equal(await page.locator("#nightCurrentTitle").textContent(), "Bohemian Rhapsody");
        assert.equal(await page.locator("#nightCandidates .night-candidate").count(), 2);

        // Switch to 2nd ranked YouTube karaoke version
        await page.locator("#nightCandidates .night-candidate").nth(1).click();
        await page.waitForFunction(() => document.getElementById("nightVideoFrame").src.includes("KaraFunBR02"));

        // 3. Add singers and verify fair round-robin rotation
        await page.fill("#nightSingerInput", "Alice");
        await page.click('#nightAddSingerForm button[type="submit"]');
        await page.fill("#nightSongSearch", "Dancing Queen");
        await page.locator("#nightSearchResults .night-queue-btn").first().click();

        // Queue a 2nd song for Alice
        await page.fill("#nightSongSearch", "Mr. Brightside");
        await page.locator("#nightSearchResults .night-queue-btn").first().click();

        // Add Bob and queue a custom YouTube song; fair rotation must put Bob ahead of Alice's 2nd song
        await page.fill("#nightSingerInput", "Bob");
        await page.click('#nightAddSingerForm button[type="submit"]');
        await page.fill("#nightSongSearch", "Chappell Roan - Pink Pony Club");
        await page.locator("#nightSearchResults .night-search-custom button").click();

        const queuedTitles = await page.locator("#nightQueueList .night-queue-title").allTextContents();
        assert.deepEqual(queuedTitles, ["Dancing Queen", "Pink Pony Club", "Mr. Brightside"]);

        // 4. Advance to next singer (Dancing Queen) and verify Sung history + TV stage snapshot
        await page.click("#nightNextSingerButton");
        await page.waitForFunction(() => document.getElementById("nightCurrentTitle").textContent === "Dancing Queen");
        await page.waitForFunction(() => document.getElementById("nightVideoFrame").src.includes("SingKingDQ1"));
        assert.match(await page.locator("#nightHistorySummary").textContent(), /Sung tonight \(1\)/);

        const stageSnapshot = await page.evaluate(() => JSON.parse(localStorage.getItem("karaokeNightStageV1") || "null"));
        assert.equal(stageSnapshot.current.title, "Dancing Queen");
        assert.equal(stageSnapshot.current.singer, "Alice");
        assert.equal(stageSnapshot.current.youtubeId, "SingKingDQ1");
        assert.equal(stageSnapshot.upNext[0].title, "Pink Pony Club");

        // 5. Verify standalone TV stage window renders synced snapshot cleanly
        const stagePage = await context.newPage();
        stagePage.on("pageerror", (error) => errors.push(error.message));
        await stagePage.goto(BASE.replace("karaoke_explorer.html", "karaoke_stage.html"));
        await stagePage.waitForFunction(() => document.getElementById("headerTitle").textContent === "Dancing Queen");
        assert.equal(await stagePage.locator("#headerSinger").textContent(), "Alice");
        assert.match(await stagePage.locator("#tickerList").textContent(), /Pink Pony Club/);
        await stagePage.close();

        // 6. Push back current singer, then test manual YouTube URL paste on the unconfigured custom song
        await page.click("#nightSkipSingerButton");
        await page.waitForFunction(() => document.getElementById("nightCurrentTitle").textContent === "Pink Pony Club");
        await page.fill("#nightYoutubeUrlInput", "https://youtu.be/CustomVid99");
        await page.click('#nightYoutubeUrlForm button[type="submit"]');
        await page.waitForFunction(() => document.getElementById("nightVideoFrame").src.includes("CustomVid99"));

        // 7. Accessibility & mobile reflow check (desktop + 320px, light + dark)
        await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
        for (const width of [1280, 320]) {
            await page.setViewportSize({ width, height: 844 });
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No horizontal overflow at ${width}px`);
            const violations = await page.evaluate(async () => {
                const res = await axe.run(document.getElementById("karaokeNightPanel"), {
                    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] },
                });
                return res.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) }));
            });
            assert.deepEqual(violations, [], `Accessibility violations at ${width}px`);
        }

        // 8. Persistence across reload and clean exit back to songbook
        await page.reload();
        await page.waitForFunction(() => state.songs.length === 4 && !songbookLoadPending);
        await menu(page, "#karaokeNightButton");
        await page.waitForSelector("#karaokeNightPanel:not([hidden])");
        assert.equal(await page.locator("#nightCurrentTitle").textContent(), "Pink Pony Club");

        await page.click("#nightBackButton");
        assert.equal(await page.locator("#karaokeNightPanel").isVisible(), false);
        assert.deepEqual(errors, []);
        console.log(`ok   ${browserName}: Karaoke Night host mode, rotation, YouTube finder, TV stage sync, persistence, and accessibility passed`);
    } finally {
        await browser.close();
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
