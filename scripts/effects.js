#!/usr/bin/env node
const { menu, plan } = require("./ui-helpers");
// Stage effects (stage-effects.js): they play only when motion is allowed,
// clean up after themselves, never intercept input, and never change what the
// app does. Uses a deterministic catalog; run against the same server as smoke.js.
const assert = require("node:assert/strict");
let playwright;
try { playwright = require("playwright"); } catch { playwright = require("playwright-core"); }
const browserName = process.env.BROWSER || "chromium";
assert.ok(["chromium", "firefox", "webkit"].includes(browserName), "Unknown BROWSER");
const launchOptions = { headless: true };
if (browserName === "chromium" && process.env.CHROMIUM_PATH) {
    launchOptions.executablePath = process.env.CHROMIUM_PATH;
}
const BASE = process.env.SMOKE_URL || "http://127.0.0.1:8765/karaoke_explorer.html";
const catalog = Array.from({ length: 14 }, (_, index) => ({
    song: `Tune ${String.fromCharCode(65 + index)}`, artist: `Singer ${index}`,
    status: "ok", tags: [], genres: [], moods: [], flags: [], eras: [],
}));

// Records every fx-* class that appears and every view transition started.
function recordEffects() {
    window.fxSeen = new Set();
    window.viewTransitions = 0;
    const note = (element) => {
        for (const name of element.classList || []) {
            if (name.startsWith("fx-")) fxSeen.add(name);
        }
    };
    new MutationObserver((records) => {
        for (const record of records) {
            if (record.type === "attributes") note(record.target);
            for (const node of record.addedNodes) {
                if (node.nodeType !== 1) continue;
                note(node);
                node.querySelectorAll("[class*='fx-']").forEach(note);
            }
        }
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
    // View transitions route clicks to the page itself while they run, so
    // no effect may start one.
    const start = document.startViewTransition;
    if (typeof start === "function") {
        document.startViewTransition = function (...args) {
            viewTransitions++;
            return start.apply(this, args);
        };
    }
}

const ready = (page) => page.waitForFunction(() => state.songs.length && !document.querySelector(".skeleton"));
const seen = (page, ...names) => page.waitForFunction((names) => names.every((name) => fxSeen.has(name)), names);
// No effect element or effect class is left behind.
const settled = (page) => page.waitForFunction(
    () => !document.querySelector(".fx-layer, [class^='fx-'], [class*=' fx-']"), null, { timeout: 5000 }
);

async function search(page, query) {
    await page.fill("#searchInput", query);
    await page.waitForFunction((query) => state.query === query && !searchRenderTimer, query);
}

const motion = { reducedMotion: "no-preference" };
const tests = [
    ["effects play only when motion is allowed and clean up after themselves", motion, async (page) => {
        // Loading reads like a karaoke lyric until the songbook is ready.
        await page.waitForSelector('#resultsList[aria-busy="true"]', { state: "attached" });
        assert.match(await page.locator("#status").evaluate((node) => getComputedStyle(node).animationName), /fx-lyric/);
        await ready(page);
        assert.equal(await page.locator("#status").evaluate((node) => getComputedStyle(node).animationName), "none");

        // The stage lights come up once the songbook is in use.
        assert.equal(await page.evaluate(() => document.documentElement.classList.contains("songbook-ready")), true);
        assert.equal(await page.evaluate(() => getComputedStyle(document.body, "::before").animationName), "fx-lights-up");

        await search(page, "Tune");
        await seen(page, "fx-sing");
        // Cards rebuilt by a later render keep a steady highlight.
        assert.equal(await page.evaluate(() => { render(); return document.querySelectorAll("#resultsList .fx-sing").length; }), 0);
        await settled(page);
        // After the fill, a highlight is the ordinary static highlight.
        assert.equal(await page.locator("#resultsList mark").first()
            .evaluate((mark) => getComputedStyle(mark).backgroundImage), "none");

        const card = page.locator("#resultsList .song-card").first();
        if (await page.evaluate(() => matchMedia("(hover: hover) and (pointer: fine)").matches)) {
            const box = await card.boundingBox();
            await page.mouse.move(box.x + 30, box.y + 30);
            await page.mouse.move(box.x + 60, box.y + 40);
            await page.waitForFunction(() => document.querySelector("#resultsList .song-card").style.getPropertyValue("--spot-x"));
        }

        await card.locator(".favorite-button").click();
        const layer = await page.waitForSelector(".fx-layer", { state: "attached" });
        assert.deepEqual(await layer.evaluate((node) => [
            node.getAttribute("aria-hidden"), getComputedStyle(node).pointerEvents, node.querySelectorAll("button, a, input, [tabindex]").length,
        ]), ["true", "none", 0]);
        await seen(page, "fx-pop", "fx-spark");
        assert.equal(await card.locator(".favorite-button").getAttribute("aria-pressed"), "true");

        await plan(page);
        await page.locator("#resultsList .add-button").first().click();
        await seen(page, "fx-flight", "fx-landed");

        await menu(page, "#randomButton");
        await seen(page, "fx-reel", "fx-spinning", "fx-roll");

        await page.click("#draftSetlistButton");
        await seen(page, "fx-confetti");
        assert.equal(await page.locator(".setlist-item").count(), 10);

        // The theme changes with the click itself; the bloom only decorates it.
        await menu(page, "#themeButton");
        assert.deepEqual(await page.evaluate(() => [document.documentElement.dataset.theme, localStorage.getItem("karaokeTheme"),
            document.getElementById("themeButton").getAttribute("aria-label")]), ["dark", "dark", "Switch to light mode"]);
        await seen(page, "fx-bloom");
        // Keyboard activation has no pointer position and still switches.
        await page.click("#moreToolsButton");
        await page.focus("#themeButton");
        await page.keyboard.press("Enter");
        assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
        assert.equal(await page.evaluate(() => viewTransitions), 0);

        await settled(page);
        // Everything an effect hid or moved is back in place.
        assert.deepEqual(await page.locator(".setlist-item").evaluateAll((items) => items.map((item) => getComputedStyle(item).opacity)),
            Array(10).fill("1"));
        assert.equal(await page.locator("#randomPick .card-head-text").evaluate((node) => getComputedStyle(node).opacity), "1");
        assert.equal(await page.locator("#randomPick .cover-tile").evaluate((node) => node.children.length), 0);
    }],
    ["reduced motion skips every effect and switches the theme at once", { reducedMotion: "reduce" }, async (page) => {
        await page.waitForSelector('#resultsList[aria-busy="true"]', { state: "attached" });
        assert.equal(await page.locator("#status").evaluate((node) => getComputedStyle(node).animationName), "none");
        await ready(page);
        await search(page, "Tune");
        await page.locator("#resultsList .favorite-button").first().click();
        await plan(page);
        await page.locator("#resultsList .add-button").first().click();
        await menu(page, "#randomButton");
        await page.click("#draftSetlistButton");
        await menu(page, "#themeButton");
        assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
        assert.deepEqual(await page.evaluate(() => [...fxSeen]), []);
        assert.equal(await page.evaluate(() => viewTransitions), 0);
        // Static decoration stays; only motion is removed.
        assert.equal(await page.getByRole("heading", { level: 1 }).textContent(), "Find tonight's song");
    }],
    ["effects never intercept clicks or typing", motion, async (page) => {
        await ready(page);
        await plan(page);
        await search(page, "Tune");
        const adds = page.locator("#resultsList .add-button");
        for (let index = 0; index < 4; index++) await adds.nth(index).click();
        assert.equal(await page.locator(".setlist-item").count(), 4);

        // Raw clicks land on the page while songs are in flight...
        await adds.nth(4).click();
        const box = await page.locator("#searchInput").boundingBox();
        await page.mouse.click(box.x + 20, box.y + box.height / 2);
        assert.equal(await page.evaluate(() => document.activeElement.id), "searchInput");

        // ...and while the theme bloom plays.
        await menu(page, "#themeButton");
        await page.mouse.click(box.x + 20, box.y + box.height / 2);
        assert.equal(await page.evaluate(() => document.activeElement.id), "searchInput");
        await page.keyboard.press("End");
        await page.keyboard.type(" B");
        await page.waitForFunction(() => state.query === "Tune B" && !searchRenderTimer);
        assert.equal(await page.locator("#resultsList .song-title").first().textContent(), "Tune B");
        await settled(page);
        assert.equal(await page.locator(".setlist-item").count(), 5);
    }],
    ["a random pick added mid-spin flies its own cover, not a decoy", motion, async (page) => {
        await ready(page);
        await plan(page);
        await search(page, "Tune");
        await menu(page, "#randomButton");
        await page.locator("#randomPick .add-button").click();
        const [flyer, expected, spinning] = await page.evaluate(() => {
            const tile = document.querySelector(".fx-flyer");
            return [
                { initials: tile.textContent.trim(), reel: Boolean(tile.querySelector(".fx-reel")), spinning: tile.classList.contains("fx-spinning") },
                getArtistInitials(getDisplayArtist(state.randomPick)),
                Boolean(document.querySelector("#randomPick .fx-reel")),
            ];
        });
        assert.ok(spinning, "the add happened while the reel was still spinning");
        assert.deepEqual(flyer, { initials: expected, reel: false, spinning: false });
        await settled(page);
    }],
    ["failed or missing loads leave nothing busy and no celebration", motion, async (page) => {
        await ready(page);
        const quiet = () => page.evaluate(() => ({
            busy: document.getElementById("resultsList").getAttribute("aria-busy"),
            ready: document.documentElement.classList.contains("songbook-ready"),
            lyric: getComputedStyle(document.getElementById("status")).animationName,
            lights: getComputedStyle(document.body, "::before").animationName,
        }));
        // The catalog request fails: the error dialog, not the "ready" moment.
        await page.route("**/karaoke_songs_enriched.json?*", (route) => route.fulfill({ status: 500, body: "" }));
        await page.reload();
        await page.waitForSelector("#dataDialog[open]");
        assert.deepEqual(await quiet(), { busy: null, ready: false, lyric: "none", lights: "none" });
        // The main script never starts: the page must not claim to be busy.
        await page.route("**/karaoke_explorer.js?*", (route) => route.fulfill({ contentType: "application/javascript", body: "" }));
        await page.reload();
        await page.waitForLoadState("load");
        assert.deepEqual(await quiet(), { busy: null, ready: false, lyric: "none", lights: "none" });
    }],
    ["sparks show above modal dialogs, and dialog adds skip the flight", motion, async (page) => {
        await ready(page);
        await menu(page, "#chooseSongButton");
        await page.click('#chooseSongForm button[type="submit"]');
        await page.locator("#pickerResults .favorite-button").first().click();
        // A modal dialog is in the top layer, above anything added to <body>.
        await page.waitForSelector("#chooseSongDialog .fx-layer .fx-spark", { state: "attached" });
        await page.locator("#pickerResults .mini-add").first().click();
        assert.equal(await page.locator(".setlist-item").count(), 1);
        await settled(page);
        assert.equal(await page.evaluate(() => fxSeen.has("fx-flight")), false);
    }],
    ["phone adds fly into the floating setlist button", { ...motion, viewport: { width: 390, height: 844 } }, async (page) => {
        await ready(page);
        await plan(page);
        await search(page, "Tune");
        await page.locator("#resultsList .add-button").first().click();
        await seen(page, "fx-flight", "fx-bump");
        await settled(page);
        assert.equal((await page.locator("#mobileSetlistButton").textContent()).trim(), "Setlist (1)");

        // Drafting grows the drawer and moves its Draft button up; the burst
        // starts where the button is now, not where it was tapped.
        await page.click("#mobileSetlistButton");
        const before = await page.locator("#draftSetlistButton").boundingBox();
        await page.click("#draftSetlistButton");
        const [origin, center] = await page.evaluate(() => {
            const piece = document.querySelector(".fx-confetti");
            const rect = document.getElementById("draftSetlistButton").getBoundingClientRect();
            return [[parseFloat(piece.style.left), parseFloat(piece.style.top)], [rect.left + rect.width / 2, rect.top + rect.height / 2]];
        });
        assert.ok(center[1] < before.y, "the Draft button moves as the drawer fills");
        assert.ok(Math.abs(origin[0] - center[0]) < 2 && Math.abs(origin[1] - center[1]) < 2, `burst at ${origin}, button at ${center}`);
        await settled(page);
    }],
];

if (browserName === "chromium") {
    // Chromium reports the pre-forced text fill, so check that the gradient
    // text (a transparent fill over a background) is not applied at all.
    tests.push(["forced colors keep the gradient title legible", { forcedColors: "active" }, async (page) => {
        await ready(page);
        const [fill, image] = await page.locator(".title-accent").evaluate((node) => {
            const style = getComputedStyle(node);
            return [style.webkitTextFillColor, style.backgroundImage];
        });
        assert.notEqual(fill, "rgba(0, 0, 0, 0)");
        assert.equal(image, "none");
    }]);
}

(async () => {
    const browser = await playwright[browserName].launch(launchOptions);
    let failed = 0;
    try {
        for (const [name, options, run] of tests) {
            const context = await browser.newContext({
                viewport: { width: 1280, height: 900 }, serviceWorkers: "block", ...options,
            });
            const errors = [];
            context.on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)));
            // A short delay keeps the loading state observable.
            await context.route("**/karaoke_songs_enriched.json?*", async (route) => {
                await new Promise((resolve) => setTimeout(resolve, 700));
                await route.fulfill({ json: catalog });
            });
            await context.addInitScript(recordEffects);
            const page = await context.newPage();
            try {
                await page.goto(BASE);
                await run(page);
                assert.deepEqual(errors, []);
                console.log(`ok   ${name}`);
            } catch (error) {
                failed++;
                console.error(`FAIL ${name}\n${error.stack || error}`);
            } finally {
                await context.close();
            }
        }
    } finally {
        await browser.close();
    }
    if (failed) process.exitCode = 1;
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
