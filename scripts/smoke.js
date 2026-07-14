#!/usr/bin/env node
// Headless smoke test for the songbook. Serves nothing itself — expects the
// repo root at http://127.0.0.1:8765 (python3 -m http.server 8765).
// Uses `playwright` when installed (CI) and falls back to `playwright-core`
// with a preinstalled Chromium (local sandboxes, CHROMIUM_PATH to override).

let chromium;
const launchOptions = { headless: true };
try {
    ({ chromium } = require("playwright"));
} catch {
    ({ chromium } = require("playwright-core"));
    launchOptions.executablePath = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
}

const BASE = process.env.SMOKE_URL || "http://127.0.0.1:8765/karaoke_explorer.html";
const failures = [];

function check(name, condition, detail = "") {
    if (condition) {
        console.log(`ok   ${name}`);
    } else {
        failures.push(name);
        console.error(`FAIL ${name} ${detail}`);
    }
}

(async () => {
    const browser = await chromium.launch(launchOptions);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto(BASE);
    await page.waitForFunction(
        () => document.getElementById("resultsList").children.length > 0 &&
            !document.querySelector(".skeleton"),
        null,
        { timeout: 60000 }
    );

    check("discover shelves render", await page.locator(".shelf").count() >= 3);

    await page.fill("#searchInput", "dancing queen");
    await page.waitForTimeout(400);
    check("search finds results", await page.locator(".song-card").count() >= 1);
    check("match highlighting", await page.locator(".song-card mark").count() >= 1);

    await page.locator(".add-button").first().click();
    await page.waitForTimeout(300);
    check("add to setlist", (await page.locator("#setlistCount").textContent()).startsWith("1"));

    await page.fill("#searchInput", "");
    await page.waitForTimeout(400);
    await page.locator('.multi-filter[data-filter="decade"] .multi-filter-button').click();
    await page.waitForTimeout(300);
    await page.locator('.multi-filter[data-filter="decade"] .multi-option', { hasText: "80s" }).first().click();
    await page.waitForTimeout(500);
    const countLine = await page.locator("#resultCount").textContent();
    check("decade filter narrows results", /from [\d,]+ matches/.test(countLine) && !countLine.includes("37,125"), countLine);

    await page.click("#browseModeButton");
    await page.waitForTimeout(800);
    check("browse mode lists songs", await page.locator(".browse-row").count() > 0);

    check("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

    await browser.close();

    if (failures.length) {
        console.error(`\n${failures.length} smoke check(s) failed`);
        process.exit(1);
    }

    console.log("\nAll smoke checks passed");
})().catch((error) => {
    console.error("Smoke test crashed:", error);
    process.exit(1);
});
