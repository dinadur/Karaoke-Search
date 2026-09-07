#!/usr/bin/env node
const { menu, plan, notes } = require("./ui-helpers");
// Automated checks supplement keyboard tests and screenshot review; they do
// not certify accessibility or replace testing with assistive technology.
const assert = require("node:assert/strict");
let playwright;
try { playwright = require("playwright"); } catch { playwright = require("playwright-core"); }
const browserName = process.env.BROWSER || "chromium";
if (!["chromium", "firefox", "webkit"].includes(browserName)) throw new Error("Unknown BROWSER");
const launchOptions = { headless: true };
if (browserName === "chromium" && process.env.CHROMIUM_PATH) {
    launchOptions.executablePath = process.env.CHROMIUM_PATH;
}

const BASE = process.env.SMOKE_URL || "http://127.0.0.1:8765/karaoke_explorer.html";

(async () => {
    const browser = await playwright[browserName].launch(launchOptions);
    const page = await browser.newPage({ reducedMotion: "reduce" });
    let failures = 0;
    const client = browserName === "chromium" ? await page.context().newCDPSession(page) : null;
    const accessibilityTree = async () => {
        // Playwright's DOM-based ariaSnapshot does not model inert subtrees.
        // Use Chromium's actual accessibility tree for exclusion assertions.
        const { nodes } = await client.send("Accessibility.getFullAXTree");
        return nodes.filter((node) => !node.ignored)
            .map((node) => `${node.role.value} "${node.name?.value || ""}"`).join("\n");
    };
    const inspect = async (name) => {
        const violations = await page.evaluate(async () => {
            const results = await axe.run({ runOnly: {
                type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"],
            } });
            return results.violations.map((item) => ({
                rule: item.id, impact: item.impact,
                targets: item.nodes.map((node) => node.target),
            }));
        });
        if (violations.length) {
            failures++;
            console.error(`FAIL ${name}: ${JSON.stringify(violations)}`);
        } else {
            console.log(`ok   ${name}`);
        }
    };
    try {
        await page.goto(BASE);
        await page.waitForFunction(() => state.songs.length && !document.querySelector(".skeleton"));
        await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
        await page.fill("#searchInput", "dancing queen");
        await page.waitForFunction(() => state.query === "dancing queen" && !searchRenderTimer);
        for (const width of [1440, 1024, 768, 390, 320]) {
            await page.setViewportSize({ width, height: 900 });
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
            await inspect(`search at ${width}px`);
        }
        await page.click("#filtersToggleButton");
        await page.click('.multi-filter[data-filter="decade"] .multi-filter-button');
        await inspect("mobile filters and expanded options");
        if (client) {
            const filterTree = await accessibilityTree();
            assert.match(filterTree, /dialog "Filter search results"/);
            assert.doesNotMatch(filterTree, /searchbox "Search/);
            assert.doesNotMatch(filterTree, /heading "Setlist"/);
        }
        await page.keyboard.press("Escape");
        await plan(page);
        await page.locator(".add-button").first().click();
        await page.click("#mobileSetlistButton");
        await page.click("#clearSetlistButton");
        await inspect("mobile setlist and Undo");
        if (client) {
            const setlistTree = await accessibilityTree();
            assert.match(setlistTree, /button "Undo"/i);
            assert.doesNotMatch(setlistTree, /searchbox "Search/);
        }
        await page.keyboard.press("Escape");
        await menu(page, "#themeButton");
        await inspect("dark search and Undo");
        await page.click("#mobileSetlistButton");
        await page.click("#qrSetlistButton");
        await page.waitForSelector("#qrDialog[open]");
        await inspect("QR dialog");
        if (client) {
            const qrTree = await accessibilityTree();
            assert.match(qrTree, /dialog "Scan to open"/i);
            assert.doesNotMatch(qrTree, /button "Draft/);
            console.log("ok   browser accessibility tree exposes dialogs and Undo while hiding background controls");
        }
    } finally {
        await browser.close();
    }
    if (failures) process.exitCode = 1;
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
