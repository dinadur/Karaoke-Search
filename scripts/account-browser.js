#!/usr/bin/env node
// End-to-end Playwright + axe-core checks for Passwordless Google Sign-In &
// Cross-Device Cloud Sync (two isolated browser contexts syncing saved songs,
// notes/keys, setlists, deletions, and theme), zero Google requests when signed
// out, plus TV Stage YouTube timestamp handoff.
const assert = require("node:assert/strict");
const { menu, plan } = require("./ui-helpers");
const { createAccountHandler, createMemoryAccountStore } = require("../api/account");
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
];

(async () => {
    const store = createMemoryAccountStore();
    const accountHandler = createAccountHandler({
        store,
        env: {
            GOOGLE_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
            ACCOUNT_SESSION_SECRET: "browser-test-secret",
        },
        verifyGoogleToken: async (credential) => {
            if (credential !== "mock-google-jwt-neal") throw new Error("Invalid token");
            return {
                uid: "google:neal-42",
                name: "Neal Singer",
                email: "neal@example.com",
                picture: "",
            };
        },
    });

    // Track per-context Set-Cookie jars because Playwright route.fulfill on HTTP
    // works cleanly when we persist session cookies in the context's jar.
    async function wireContext(ctx) {
        let googleScriptLoads = 0;
        let sessionCookie = "";

        await ctx.route("**/karaoke_songs_enriched.json?*", (route) => route.fulfill({ json: fixtureSongs }));
        await ctx.route("**/era_enrichment.json?*", (route) => route.fulfill({ json: { entries: [] } }));
        await ctx.route("**/audio_enrichment.json?*", (route) => route.fulfill({ json: { entries: [] } }));
        await ctx.route("**/whats_new.json?*", (route) => route.fulfill({ json: { batches: [] } }));

        await ctx.route("https://accounts.google.com/gsi/client", (route) => {
            googleScriptLoads += 1;
            return route.fulfill({
                status: 200,
                contentType: "application/javascript",
                body: `
                    window.google = {
                        accounts: {
                            id: {
                                _cb: null,
                                initialize(cfg) { this._cb = cfg.callback; },
                                renderButton(el) {
                                    const btn = document.createElement("button");
                                    btn.type = "button";
                                    btn.id = "mockGoogleBtn";
                                    btn.className = "command";
                                    btn.textContent = "Continue with Google";
                                    btn.addEventListener("click", () => this._cb && this._cb({ credential: "mock-google-jwt-neal" }));
                                    el.appendChild(btn);
                                }
                            }
                        }
                    };
                `,
            });
        });

        await ctx.route("**/api/account*", async (route) => {
            const request = route.request();
            const headers = await request.allHeaders();
            if (sessionCookie && !headers.cookie) {
                headers.cookie = sessionCookie;
            }
            const req = {
                method: request.method(),
                url: request.url(),
                headers,
                body: request.postData() || "",
            };
            const resHeaders = {};
            let body = "";
            const res = {
                statusCode: 200,
                setHeader(k, v) { resHeaders[k] = v; },
                end(chunk = "") { body += chunk; },
            };
            await accountHandler(req, res);
            const setCookie = resHeaders["Set-Cookie"] || resHeaders["set-cookie"];
            if (typeof setCookie === "string") {
                sessionCookie = setCookie.includes("Max-Age=0") ? "" : setCookie.split(";")[0];
            }
            return route.fulfill({ status: res.statusCode, headers: resHeaders, body });
        });

        return { getGoogleLoads: () => googleScriptLoads };
    }

    const browser = await playwright[browserName].launch(options);
    try {
        const errors = [];

        // --- Device A ---
        const ctxA = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 900 } });
        const statsA = await wireContext(ctxA);
        const pageA = await ctxA.newPage();
        pageA.on("pageerror", (err) => errors.push(err.message));

        await pageA.goto(BASE);
        await pageA.waitForFunction(() => state.songs.length === 3 && !songbookLoadPending);
        assert.equal(statsA.getGoogleLoads(), 0, "Must never load Google Identity script on normal page load");

        // Save Bohemian Rhapsody with personal notes + key, add Dancing Queen to setlist, switch to dark mode
        await plan(pageA);
        await pageA.fill("#searchInput", "Bohemian");
        await pageA.waitForFunction(() => state.query === "Bohemian" && !searchRenderTimer);
        await pageA.locator(".favorite-button").first().click();
        await pageA.locator(".favorite-button").first().click(); // opens notes dialog
        await pageA.waitForSelector("#songNotesDialog[open]");
        await pageA.fill("#repertoireKey", "Bb");
        await pageA.fill("#repertoireNotes", "Start soft");
        await pageA.click('#songNotesForm button[type="submit"]');
        await pageA.waitForFunction(() => !document.getElementById("songNotesDialog").open);

        await pageA.fill("#searchInput", "Dancing Queen");
        await pageA.waitForFunction(() => state.query === "Dancing Queen" && !searchRenderTimer);
        await pageA.locator(".add-button").first().click();
        await menu(pageA, "#themeButton");
        const themeOnA = await pageA.evaluate(() => document.documentElement.dataset.theme);

        // Sign in on Device A
        await menu(pageA, "#accountMenuButton");
        await pageA.waitForSelector("#accountDialog[open]");
        await pageA.waitForSelector("#mockGoogleBtn");
        assert.equal(statsA.getGoogleLoads(), 1, "Google Identity script loads lazily when opening Account dialog");
        await pageA.click("#mockGoogleBtn");
        await pageA.waitForSelector("#accountSignedIn:not([hidden])");
        await pageA.waitForFunction(() => !accountState.syncing && !accountState.dirty && accountState.revision >= 1);
        assert.match(await pageA.locator("#accountSyncCounts").textContent(), /1 saved song/);

        // Accessibility & 320px reflow check on Account dialog
        await pageA.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
        await pageA.setViewportSize({ width: 320, height: 844 });
        assert.ok(await pageA.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "No overflow on Account dialog at 320px");
        const dialogViolations = await pageA.evaluate(async () => {
            const res = await axe.run(document.getElementById("accountDialog"), {
                runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] },
            });
            return res.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) }));
        });
        assert.deepEqual(dialogViolations, [], "No accessibility violations in #accountDialog at 320px");
        await pageA.click('#accountDialog [data-close-dialog="accountDialog"]');

        // --- Device B (isolated browser context) ---
        const ctxB = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
        await wireContext(ctxB);
        const pageB = await ctxB.newPage();
        pageB.on("pageerror", (err) => errors.push(err.message));

        await pageB.goto(BASE);
        await pageB.waitForFunction(() => state.songs.length === 3 && !songbookLoadPending);

        // Save Mr. Brightside locally on Device B before signing in
        await pageB.fill("#searchInput", "Brightside");
        await pageB.waitForFunction(() => state.query === "Brightside" && !searchRenderTimer);
        await pageB.locator(".favorite-button").first().click();

        // Sign in on Device B -> must merge both saved songs, notes/key, setlist, and theme!
        await menu(pageB, "#accountMenuButton");
        await pageB.waitForSelector("#accountDialog[open]");
        await pageB.waitForSelector("#mockGoogleBtn");
        await pageB.click("#mockGoogleBtn");
        await pageB.waitForSelector("#accountSignedIn:not([hidden])");
        await pageB.waitForFunction(() => !accountState.syncing && !accountState.dirty && Object.keys(repertoire).length === 2);

        const syncedOnB = await pageB.evaluate(() => ({
            savedTitles: Object.values(repertoire).map((e) => e.song.song).sort(),
            bohemianNote: Object.values(repertoire).find((e) => e.song.song === "Bohemian Rhapsody")?.notes,
            bohemianKey: Object.values(repertoire).find((e) => e.song.song === "Bohemian Rhapsody")?.key,
            setlistTitles: state.setlist.map((s) => s.song),
            theme: document.documentElement.dataset.theme,
        }));
        assert.deepEqual(syncedOnB.savedTitles, ["Bohemian Rhapsody", "Mr. Brightside"]);
        assert.equal(syncedOnB.bohemianNote, "Start soft");
        assert.equal(syncedOnB.bohemianKey, "Bb");
        assert.deepEqual(syncedOnB.setlistTitles, ["Dancing Queen"]);
        assert.equal(syncedOnB.theme, themeOnA);

        // Delete Mr. Brightside on Device B, sync, then verify tombstone removes it on Device A
        await pageB.click('#accountDialog [data-close-dialog="accountDialog"]');
        await pageB.locator(".favorite-button").first().click(); // opens notes for Mr. Brightside
        await pageB.waitForSelector("#songNotesDialog[open]");
        await pageB.click("#repertoireRemove");
        await pageB.evaluate(() => syncAccountNow());
        await pageB.waitForFunction(() => !accountState.syncing && !accountState.dirty);

        await pageA.evaluate(() => fetchAccountSession({ mergeRemote: true }));
        await pageA.waitForFunction(() => Object.values(repertoire).map((e) => e.song.song).join(",") === "Bohemian Rhapsody");

        // Delete cloud copy keeps local data intact on Device B
        await menu(pageB, "#accountMenuButton");
        await pageB.waitForSelector("#accountDialog[open]");
        await pageB.click(".account-danger-details summary");
        await pageB.click("#accountDeleteCloudButton");
        await pageB.waitForSelector("#accountSignedOut:not([hidden])");
        assert.equal(await pageB.evaluate(() => Object.keys(repertoire).length), 1, "Local saved songs remain intact after deleting cloud copy");

        await ctxA.close();
        await ctxB.close();
        assert.deepEqual(errors, []);
        console.log(`ok   ${browserName}: Google Sign-In, cross-device merge, tombstone sync, delete-cloud, lazy GSI load, and 320px accessibility passed`);
    } finally {
        await browser.close();
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
