#!/usr/bin/env node
// Exercise input during real-catalog preparation with native scheduling and
// the fallback path. Run separately from performance measurements.
const assert = require("node:assert/strict");
let playwright;
try { playwright = require("playwright"); } catch { playwright = require("playwright-core"); }
const BASE = process.env.SMOKE_URL || "http://127.0.0.1:8765/karaoke_explorer.html";
const options = { headless: true };
if (process.env.CHROMIUM_PATH) options.executablePath = process.env.CHROMIUM_PATH;

(async () => {
    const browser = await playwright.chromium.launch(options);
    try {
        for (const fallback of [false, true]) {
            const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
            const page = await context.newPage();
            const errors = [];
            page.on("pageerror", (error) => errors.push(error.message));
            if (fallback) await page.addInitScript(() => {
                Object.defineProperty(window, "scheduler", { value: undefined, configurable: true });
            });
            const client = await context.newCDPSession(page);
            await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
            await page.goto(BASE, { waitUntil: "domcontentloaded" });
            await page.waitForFunction(() => document.querySelector("#status").textContent === "Building songbook");
            await page.fill("#searchInput", "dancing queen");
            assert.equal(await page.evaluate(() => state.songs.length), 0, "Input must land during preparation");
            assert.equal(await page.inputValue("#searchInput"), "dancing queen");
            await page.click("#browseModeButton");
            assert.ok(await page.locator(".skeleton").first().isVisible(), "Browse retains loading feedback");
            await page.waitForFunction(() => state.songs.length && !document.querySelector(".skeleton"));
            assert.equal(await page.evaluate(() => state.mode), "browse");
            assert.equal(await page.evaluate(() => state.query), "dancing queen");
            await page.click("#searchModeButton");
            assert.ok(await page.locator(".song-card").count());
            assert.equal(await page.locator("#resultsList").getAttribute("aria-busy"), null);
            assert.deepEqual(errors, []);
            console.log(`ok   input and Browse survive catalog preparation (${fallback ? "timer fallback" : "native scheduler"})`);
            await context.close();
        }
    } finally {
        await browser.close();
    }
})().catch((error) => { console.error(error); process.exitCode = 1; });
