#!/usr/bin/env node
const { menu, plan, notes } = require("./ui-helpers");
// Behavioral regressions for the review findings. Uses a deterministic catalog
// and a fresh browser context per case; run against the same server as smoke.js.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
let playwright;
try { playwright = require("playwright"); } catch { playwright = require("playwright-core"); }
const browserName = process.env.BROWSER || "chromium";
assert.ok(["chromium", "firefox", "webkit"].includes(browserName), "Unknown BROWSER");
const launchOptions = { headless: true };
if (browserName === "chromium" && process.env.CHROMIUM_PATH) {
    launchOptions.executablePath = process.env.CHROMIUM_PATH;
}
const BASE = process.env.SMOKE_URL || "http://127.0.0.1:8765/karaoke_explorer.html";
const catalog = [
    { song: "First Tune", artist: "Alpha", eras: ["70s"] },
    { song: "Second Tune", artist: "Beta", eras: ["80s"] },
    { song: "Third Tune", artist: "Gamma", eras: ["90s"] },
    { song: "Fourth Tune", artist: "Delta", eras: ["80s"] },
].map((song) => ({ ...song, status: "ok", tags: [], genres: [], moods: [], flags: [] }));

async function search(page, query) {
    await page.fill("#searchInput", query);
    // Wait for the visible search state, not a guessed debounce duration.
    await page.waitForFunction((query) => state.query === query && !searchRenderTimer, query);
}

async function add(page, query) {
    await plan(page);
    await search(page, query);
    await page.locator(".add-button").first().click();
}

const tests = [
    ["native share passes singer text and handles cancellation and failure", async (page) => {
        await page.addInitScript(() => {
            window.sharedPayload = null;
            window.shareFailure = null;
            Object.defineProperty(navigator, "share", { configurable: true, value: async (payload) => {
                if (window.shareFailure) throw new DOMException("Share unavailable", window.shareFailure);
                window.sharedPayload = payload;
            } });
        });
        await page.reload();
        await page.waitForFunction(() => state.songs.length && !document.querySelector(".skeleton"));
        await add(page, "First Tune");
        await page.locator(".singer-add").click();
        await page.locator(".singer-input").fill("Alex");
        await page.locator(".singer-input").press("Enter");
        await page.click("#shareSetlistButton");
        const payload = await page.evaluate(() => window.sharedPayload);
        assert.equal(payload.title, "Karaoke setlist");
        assert.match(payload.text, /First Tune - Alpha \(Alex\)/);
        // A dismissed OS sheet is ordinary cancellation, not a user error.
        await page.evaluate(() => { window.shareFailure = "AbortError"; hideSnackbar(); });
        await page.click("#shareSetlistButton");
        assert.equal(await page.locator("#snackbar").isVisible(), false);
        await page.evaluate(() => { window.shareFailure = "NotAllowedError"; });
        await page.click("#shareSetlistButton");
        assert.match(await page.locator("#snackbarText").textContent(), /Couldn't share.*QR or Copy/);
    }],
    ["singer editing and reordering preserve keyboard and pointer actions", async (page) => {
        await add(page, "First Tune");
        await add(page, "Second Tune");
        await page.locator(".singer-add").last().click();
        await page.locator(".singer-input").fill("Sam");
        // Clicking Remove while editing first blurs the input; that must not
        // destroy the Remove button before its click is delivered.
        await page.locator(".remove-button").last().click();
        assert.deepEqual(await page.locator(".setlist-title").allTextContents(), ["First Tune"]);
        await page.click("#snackbarAction");
        assert.match(await page.locator(".singer-chip").textContent(), /Sam/);
        await page.locator(".singer-add").first().click();
        await page.locator(".singer-input").fill("Alex");
        await page.locator(".singer-input").press("Enter");
        assert.equal(await page.locator(".singer-chip").first().evaluate((button) => button === document.activeElement), true);
        await page.locator('.setlist-item [title="Move down"]').first().click();
        assert.equal(await page.locator(".setlist-title").last().textContent(), "First Tune");
        assert.equal(await page.locator(".setlist-item").last().evaluate((item) => item.contains(document.activeElement)), true);
    }],
    ["added state stays in sync through remove and Undo", async (page) => {
        await add(page, "First Tune");
        const button = page.locator(".add-button").first();
        assert.equal(await button.textContent(), "Added");
        assert.equal(await button.getAttribute("aria-disabled"), "true");
        await page.locator(".remove-button").click();
        assert.equal(await button.textContent(), "Add");
        await page.click("#snackbarAction");
        assert.equal(await button.textContent(), "Added");
    }],
    ["artist links are exact, reloadable, and retain group/favorite focus", async (page) => {
        await page.route("**/karaoke_songs_enriched.json?*", (route) => route.fulfill({
            json: [...catalog, { ...catalog[1], song: "Another Tune", artist: "Alphaville" }],
        }));
        await page.reload();
        await page.waitForSelector(".shelf");
        await search(page, "First Tune");
        await page.locator(".song-artist").first().click();
        assert.deepEqual(await page.locator("#resultsList .browse-artist").allTextContents(), ["Alpha"]);
        assert.equal(await page.locator("#resultsList details[open]").count(), 1);
        const favorite = page.locator("#resultsList .favorite-button").first();
        await favorite.click();
        assert.equal(await favorite.evaluate((button) => button === document.activeElement), true);
        assert.equal(await favorite.getAttribute("aria-pressed"), "true");
        await page.locator("#resultsList summary").click();
        await page.click("#searchModeButton");
        assert.equal(await page.locator("#resultsList details[open]").count(), 0);
        await page.reload();
        await page.waitForSelector("#resultsList .browse-row");
        assert.deepEqual(await page.locator("#resultsList .browse-artist").allTextContents(), ["Alpha"]);
        await search(page, "Alpha");
        assert.equal(await page.locator("#resultsList .browse-row").count(), 2);
    }],
    ["narrow mobile filters scroll vertically and keep actions reachable", async (page) => {
        for (const width of [320, 390]) {
            await page.setViewportSize({ width, height: 740 });
            await page.click("#filtersToggleButton");
            await page.click('.multi-filter[data-filter="decade"] .multi-filter-button');
            assert.equal(await page.locator("#searchFilters").evaluate((sheet) => sheet.scrollWidth <= sheet.clientWidth + 1), true);
            await page.locator('.multi-filter[data-filter="decade"] .multi-option').filter({ hasText: "80s" }).click();
            await page.click("#applyFiltersButton");
            assert.equal(await page.locator("body.filters-open").count(), 0);
            assert.equal(await page.locator("#searchInput").evaluate((input) => input.clientWidth > 130), true);
            assert.equal(await page.locator("#searchModeButton span").evaluate((span) => span.scrollWidth <= span.clientWidth), true);
        }
    }],
    ["catalog failure can retry and invalid backup files show an error", async (page) => {
        await page.route("**/karaoke_songs_enriched.json?*", (route) => route.abort());
        await page.reload();
        await page.waitForSelector("#dataDialog[open]");
        await page.locator("#dataDialog summary").click();
        for (const contents of ['{broken', '[{"artist":"Alpha","song":"Broken","eras":null}]']) {
            await page.locator("#fileInput").setInputFiles({
                name: "invalid.json", mimeType: "application/json", buffer: Buffer.from(contents),
            });
            await page.waitForFunction(() => document.getElementById("dataError").textContent.length > 0);
            assert.match(await page.locator("#dataError").textContent(), /isn't a valid songbook/);
        }
        await page.unroute("**/karaoke_songs_enriched.json?*");
        await page.click("#retryDataButton");
        await page.waitForSelector("#dataDialog", { state: "hidden" });
        await page.waitForSelector(".shelf");
        assert.equal(await page.locator("#dataDialog").isVisible(), false);
        await add(page, "First Tune");
        assert.equal(await page.locator(".setlist-item").count(), 1);
    }],
    ["clear Undo works until a subsequent edit, then preserves the edit", async (page) => {
        await add(page, "First Tune");
        await page.click("#clearSetlistButton");
        await page.click("#snackbarAction");
        assert.equal(await page.locator(".setlist-title").textContent(), "First Tune");
        await page.click("#clearSetlistButton");
        await add(page, "Second Tune");
        assert.equal(await page.locator("#snackbarAction").isVisible(), false);
        await page.reload();
        await page.waitForSelector(".setlist-title", { state: "attached" });
        assert.deepEqual(await page.locator(".setlist-title").allTextContents(), ["Second Tune"]);
    }],
    ["draft Undo expires after editing a singer", async (page) => {
        await page.click("#draftSetlistButton");
        await page.locator(".singer-add").first().click();
        await page.locator(".singer-input").fill("Sam");
        await page.locator(".singer-input").press("Enter");
        assert.equal(await page.locator("#snackbarAction").isVisible(), false);
        assert.equal(await page.locator(".setlist-item").count(), 4);
        assert.match(await page.locator(".singer-chip").textContent(), /Sam/);
    }],
    ["empty search and Favorites never draft, swap, or pick unrelated songs", async (page) => {
        await add(page, "First Tune");
        for (const favorites of [false, true]) {
            await search(page, favorites ? "" : "zzzzzzzzzzzzzzzzzz");
            if (favorites) { await page.click("#filtersToggleButton"); await page.locator("label", { has: page.locator("#favoriteFilter") }).click(); await page.click("#applyFiltersButton"); }
            assert.match(await page.locator("#resultCount").textContent(), /0 matches/);
            await menu(page, "#randomButton");
            assert.equal(await page.locator("#randomPick").isVisible(), false);
            await page.click("#draftSetlistButton");
            await page.locator('[aria-label="Swap for another matching song"]').click();
            assert.deepEqual(await page.locator(".setlist-title").allTextContents(), ["First Tune"]);
        }
    }],
    ["empty search facets show zero, and open facets follow query edits", async (page) => {
        await search(page, "zzzzzzzzzzzzzzzzzz");
        await page.click("#filtersToggleButton");
        await page.click('.multi-filter[data-filter="decade"] .multi-filter-button');
        const counts = page.locator('.multi-filter[data-filter="decade"] .option-count');
        assert.deepEqual(await counts.allTextContents(), ["0", "0", "0"]);
        await page.click("#applyFiltersButton");
        await search(page, "Alpha");
        await page.click("#filtersToggleButton");
        await page.click('.multi-filter[data-filter="decade"] .multi-filter-button');
        assert.deepEqual(await counts.allTextContents(), ["1", "0", "0"]);
        await page.click("#applyFiltersButton");
        await search(page, "Beta");
        await page.click("#filtersToggleButton");
        await page.click('.multi-filter[data-filter="decade"] .multi-filter-button');
        assert.deepEqual(await counts.allTextContents(), ["0", "1", "0"]);
        assert.equal(await counts.first().isVisible(), true);
    }],
    ["legacy and current saved songs survive a QR round trip", async (page, context) => {
        await page.evaluate((song) => {
            localStorage.setItem("karaokeSetlist", JSON.stringify([
                { ...song, id: "alpha\u001ffirst tune\u001f321", singer: "Sam" },
            ]));
        }, catalog[0]);
        await page.reload();
        await page.waitForSelector(".setlist-title", { state: "attached" });
        await add(page, "Second Tune");
        await page.click("#qrSetlistButton");
        await page.waitForSelector("#qrHolder svg");
        // Capture the exact payload sent to the QR library by the shared builder.
        const url = await page.evaluate(() => buildShareUrl());
        const recipient = await context.newPage();
        await recipient.goto(url);
        await recipient.getByRole("dialog", { name: "Shared setlist" }).waitFor();
        assert.match(await recipient.locator("#importCaption").textContent(), /2 songs/);
        await recipient.click("#importReplaceButton");
        assert.deepEqual(await recipient.locator(".setlist-title").allTextContents(), ["First Tune", "Second Tune"]);
        await add(recipient, "Third Tune");
        assert.equal(await recipient.locator("#snackbarAction").isVisible(), false);
        assert.equal(await recipient.locator(".setlist-item").count(), 3);
        await recipient.close();
    }],
    ["mobile sheets contain focus, restore it, and allow a nested QR dialog", async (page) => {
        await page.setViewportSize({ width: 390, height: 844 });
        for (const [opener, closer, sheet] of [
            ["#filtersToggleButton", "#closeFiltersButton", "#searchFilters"],
            ["#mobileSetlistButton", "#closeSetlistButton", ".setlist-panel"],
        ]) {
            await page.click(opener);
            assert.equal(await page.evaluate(() => document.activeElement.id), closer.slice(1));
            await page.keyboard.press("Shift+Tab");
            assert.equal(await page.evaluate((sheet) => document.querySelector(sheet).contains(document.activeElement), sheet), true);
            // Walk enough times to cross both ends, including disabled buttons.
            for (let i = 0; i < 25; i++) {
                await page.keyboard.press("Tab");
                assert.equal(await page.evaluate((sheet) => document.querySelector(sheet).contains(document.activeElement), sheet), true);
            }
            await page.keyboard.press("/");
            assert.equal(await page.evaluate((sheet) => document.querySelector(sheet).contains(document.activeElement), sheet), true);
            await page.evaluate(() => document.getElementById("searchInput").focus());
            assert.equal(await page.evaluate((sheet) => document.querySelector(sheet).contains(document.activeElement), sheet), true);
            await page.keyboard.press("Escape");
            assert.equal(await page.evaluate(() => document.activeElement.id), opener.slice(1));
            assert.equal(await page.locator("[inert]").count(), 0);
        }
        await page.click("#mobileSetlistButton");
        await page.click("#qrSetlistButton");
        await page.waitForSelector("#qrDialog[open]");
        await page.keyboard.press("Tab");
        // Chromium may hand focus to browser chrome between native dialog
        // cycles; it must never hand it to the underlying custom sheet.
        assert.equal(await page.evaluate(() => document.activeElement === document.body ||
            document.getElementById("qrDialog").contains(document.activeElement)), true);
        await page.keyboard.press("Tab");
        assert.equal(await page.evaluate(() => document.getElementById("qrDialog").contains(document.activeElement)), true);
        await page.keyboard.press("Escape");
        assert.equal(await page.locator("#qrDialog").isVisible(), false);
        assert.equal(await page.locator("body.setlist-open").count(), 1);
        await page.click("#draftSetlistButton");
        await page.locator(".remove-button").first().click();
        await page.click("#snackbarAction");
        assert.equal(await page.locator(".setlist-item").count(), 4);
        await page.keyboard.press("Escape");
        await page.click("#filtersToggleButton");
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.waitForFunction(() => !document.querySelector("[inert]"));
        assert.equal(await page.locator("#sheetBackdrop").isVisible(), false);
    }],
    ["all manifest and touch icons are served at their declared dimensions", async (page) => {
        const manifest = await (await page.request.get(new URL("manifest.json", BASE).href)).json();
        await page.goto(BASE);
        const touchIcon = await page.locator('link[rel="apple-touch-icon"]').getAttribute("href");
        const icons = [...manifest.icons, { src: touchIcon, sizes: "180x180" }];
        for (const icon of icons) {
            const response = await page.request.get(new URL(icon.src, BASE).href);
            assert.equal(response.status(), 200, icon.src);
            if (new URL(icon.src, BASE).pathname.endsWith(".png")) {
                const png = await response.body();
                assert.equal(png.subarray(1, 4).toString(), "PNG");
                assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes);
                assert.ok(fs.existsSync(path.join(__dirname, "..", icon.src.split("?")[0])));
            }
        }
    }],
];

(async () => {
    const browser = await playwright[browserName].launch(launchOptions);
    let failed = 0;
    try {
        for (const [name, run] of tests) {
            const context = await browser.newContext({
                viewport: { width: 1280, height: 900 },
                reducedMotion: "reduce",
                serviceWorkers: "block",
            });
            const errors = [];
            context.on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)));
            await context.route("**/karaoke_songs_enriched.json?*", (route) => route.fulfill({ json: catalog }));
            const page = await context.newPage();
            try {
                await page.goto(BASE);
                await page.waitForFunction(() => state.songs.length && !document.querySelector(".skeleton"));
                await plan(page);
                await run(page, context);
                assert.deepEqual(errors, []);
                console.log(`ok   ${name}`);
            } catch (error) {
                failed++;
                console.error(`FAIL ${name}\n${error.stack}`);
            } finally {
                await context.close();
            }
        }
    } finally {
        await browser.close();
    }
    if (failed) process.exitCode = 1;
    else console.log(`\nAll ${tests.length} regression scenarios passed`);
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
