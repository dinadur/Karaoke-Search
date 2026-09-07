#!/usr/bin/env node
const { menu, plan, notes } = require("./ui-helpers");
const assert = require("node:assert/strict");
let pw; try { pw = require("playwright"); } catch { pw = require("playwright-core"); }
const browserName = process.env.BROWSER || "chromium";
const options = { headless: true };
if (browserName === "chromium" && process.env.CHROMIUM_PATH) options.executablePath = process.env.CHROMIUM_PATH;
const BASE = process.env.SMOKE_URL || "http://127.0.0.1:8765/karaoke_explorer.html";
const catalog = Array.from({ length: 8 }, (_, index) => ({
    artist: `Artist ${index}`, song: `Tune ${index}`, genres: [], tags: [],
    moods: index % 2 ? ["Mellow"] : ["Party"], eras: index ? ["90s"] : [],
    flags: index < 3 ? ["Duet"] : [], status: "ok",
}));
catalog.push({ ...catalog[0], song: "Tune 0 (Karaoke)", lookupSong: "Tune 0" });
const search = async (p, query) => { await p.fill("#searchInput", query); await p.waitForFunction((q) => state.query === q && !searchRenderTimer, query); };
const tests = [
    ["repertoire saves, reloads, filters, edits, and keeps notes out of sharing", async (page) => {
        await search(page, "Tune 0");
        await notes(page);
        await page.selectOption("#repertoireStatus", "sung");
        await page.selectOption("#repertoireComfort", "4");
        await page.fill("#repertoireKey", "G minor");
        await page.fill("#repertoireNotes", "PRIVATE rehearsal note <img src=x>");
        await page.click('#songNotesForm button[type="submit"]');
        await plan(page);
        await page.locator(".add-button").first().click();
        assert.doesNotMatch(await page.evaluate(() => buildSetlistText()), /PRIVATE|G minor/);
        assert.doesNotMatch(await page.evaluate(() => buildShareUrl()), /PRIVATE|G minor/);
        await page.reload(); await page.waitForFunction(() => state.songs.length && !songbookLoadPending);
        await menu(page, "#repertoireButton");
        assert.match(await page.locator("#repertoireList").textContent(), /Sung before.*Comfort 4\/5.*G minor/s);
        assert.match(await page.locator(".repertoire-note").textContent(), /PRIVATE/);
        assert.equal(await page.locator("#repertoireList img").count(), 0);
        await page.selectOption("#repertoireFilter", "want");
        assert.equal(await page.locator("#repertoireList article").count(), 0);
        await page.selectOption("#repertoireFilter", "all");
        await page.locator("#repertoireList .repertoire-song-button").click();
        await page.fill("#repertoireNotes", "Discard me"); await page.keyboard.press("Escape");
        assert.match(await page.locator(".repertoire-note").textContent(), /PRIVATE/);
        await page.locator("#repertoireList .repertoire-song-button").click();
        await page.click("#repertoireRemove");
        await page.waitForFunction(() => !document.querySelector("#repertoireList article"));
        assert.equal(await page.locator("#repertoireList article").count(), 0);
    }],
    ["storage failure retains edits and leaves the saved library unchanged", async (page) => {
        await search(page, "Tune 1"); await notes(page);
        await page.fill("#repertoireNotes", "Keep this draft");
        await page.evaluate(() => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key === REPERTOIRE_STORAGE_KEY) throw new DOMException("Full", "QuotaExceededError"); return original.call(this, key, value); }; });
        await page.click('#songNotesForm button[type="submit"]');
        assert.ok(await page.locator("#songNotesDialog").isVisible());
        assert.equal(await page.inputValue("#repertoireNotes"), "Keep this draft");
        assert.match(await page.locator("#repertoireError").textContent(), /Couldn't save/);
        assert.equal(await page.evaluate(() => Object.keys(repertoire).length), 1);
        assert.equal(await page.evaluate(() => Object.values(repertoire)[0].notes), "");
    }],
    ["picker honors familiarity, duet, energy, current scope, and queued songs", async (page) => {
        await search(page, "Tune 0"); await page.locator(".favorite-button").first().click();
        await plan(page);
        await search(page, "Tune"); await menu(page, "#chooseSongButton");
        await page.check('[name="familiarity"][value="familiar"]');
        await page.check('[name="voices"][value="duet"]');
        await page.check('[name="energy"][value="energetic"]');
        await page.click('#chooseSongForm button[type="submit"]');
        assert.deepEqual(await page.locator("#pickerResults h3").allTextContents(), ["Tune 0"]);
        assert.match(await page.locator("#pickerResults").textContent(), /saved songs.*duet.*Energetic/s);
        await page.locator("#pickerResults .mini-add").click();
        await page.click('#chooseSongForm button[type="submit"]');
        assert.equal(await page.locator("#pickerResults article").count(), 0);
        await page.check('[name="familiarity"][value="adventurous"]');
        await page.check('[name="voices"][value="any"]');
        await page.check('[name="energy"][value="any"]');
        await page.click('#chooseSongForm button[type="submit"]');
        assert.equal(await page.locator("#pickerResults article").count(), 5);
        assert.ok(!(await page.locator("#pickerResults h3").allTextContents()).includes("Tune 0"));
        await page.keyboard.press("Escape"); await search(page, "zzzzzzzz"); await menu(page, "#chooseSongButton");
        await page.click('#chooseSongForm button[type="submit"]');
        assert.equal(await page.locator("#pickerResults article").count(), 0);
    }],
    ["era enrichment fills missing tags without overwriting existing dates", async (page) => {
        assert.deepEqual(await page.evaluate(() => state.songs[0].eras), ["80s"]);
        assert.deepEqual(await page.evaluate(() => state.songs[1].eras), ["90s"]);
        await search(page, "Tune 0");
        assert.match(await page.locator(".pill.era").getAttribute("aria-label"), /inferred/);
    }],
    ["new dialogs reflow at 320px and pass accessibility checks", async (page) => {
        await page.setViewportSize({ width: 320, height: 740 });
        await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
        const inspect = async () => {
            const problems = await page.evaluate(async () => (await axe.run({ runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } })).violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })));
            assert.deepEqual(problems, []);
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
            assert.ok(await page.locator("dialog[open]").last().evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth));
        };
        await menu(page, "#chooseSongButton"); await inspect();
        await page.click('#chooseSongForm button[type="submit"]'); await inspect();
        await page.locator("#pickerResults .favorite-button").first().click();
        await page.locator("#pickerResults .favorite-button").first().click(); await inspect();
        await page.click('#songNotesForm button[type="submit"]'); await page.keyboard.press("Escape");
        await menu(page, "#repertoireButton"); await inspect();
        await page.keyboard.press("Escape"); await menu(page, "#themeButton");
        await menu(page, "#repertoireButton"); await inspect();
    }],
];
(async () => {
    const browser = await pw[browserName].launch(options);
    try {
        for (const [name, run] of tests) {
            const context = await browser.newContext({ serviceWorkers: "block", reducedMotion: "reduce" });
            const page = await context.newPage(); const errors = [];
            page.on("pageerror", (error) => errors.push(error.message));
            await context.route("**/karaoke_songs_enriched.json?*", (route) => route.fulfill({ json: catalog }));
            await context.route("**/era_enrichment.json?*", (route) => route.fulfill({ json: { entries: catalog.slice(0, 2).map((song) => ({ ...song, eras: ["80s"], source: { type: "catalog-consensus" } })) } }));
            try {
                await page.goto(BASE); await page.waitForFunction(() => state.songs.length && !songbookLoadPending);
                await run(page); assert.deepEqual(errors, []); console.log(`ok   ${name}`);
            } finally { await context.close(); }
        }
    } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
