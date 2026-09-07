#!/usr/bin/env node
// Real-catalog startup measurements. Keep these separate from parallel test
// runs: CPU throttling is a local comparison, not a physical-device benchmark.
const assert = require("node:assert/strict");
const fs = require("node:fs");
let playwright;
try { playwright = require("playwright"); } catch { playwright = require("playwright-core"); }
const BASE = process.env.SMOKE_URL || "http://127.0.0.1:8765/karaoke_explorer.html";
const options = { headless: true };
if (process.env.CHROMIUM_PATH) options.executablePath = process.env.CHROMIUM_PATH;

(async () => {
    const browser = await playwright.chromium.launch(options);
    const samples = [];
    try {
        for (let run = 0; run < 3; run++) {
            const context = await browser.newContext({ serviceWorkers: "block" });
            if (process.env.PERF_BASELINE_JS) {
                await context.route("**/karaoke_explorer.js?*", (route) => route.fulfill({
                    path: process.env.PERF_BASELINE_JS, contentType: "application/javascript",
                }));
            }
            const page = await context.newPage();
            const errors = [];
            page.on("pageerror", (error) => errors.push(error.message));
            const client = await context.newCDPSession(page);
            await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
            await page.addInitScript(() => {
                window.startupTasks = [];
                new PerformanceObserver((list) => startupTasks.push(...list.getEntries()
                    .map((entry) => ({ start: entry.startTime, duration: entry.duration }))))
                    .observe({ type: "longtask", buffered: true });
            });
            await page.goto(BASE);
            await page.waitForFunction(() => state.songs.length && !document.querySelector(".skeleton"));
            const readyMs = await page.evaluate(() => performance.now());
            // Let PerformanceObserver deliver the final rendering task.
            await page.waitForTimeout(150);
            const sample = await page.evaluate((readyMs) => {
                const tasks = startupTasks.filter((task) => task.start < readyMs);
                return {
                    readyMs: Math.round(readyMs), songs: state.songs.length,
                    maxLongTaskMs: Math.round(Math.max(0, ...tasks.map((task) => task.duration))),
                    totalBlockingMs: Math.round(tasks.reduce((sum, task) => sum + Math.max(0, task.duration - 50), 0)),
                };
            }, readyMs);
            assert.deepEqual(errors, []);
            assert.ok(sample.songs > 30000, "Measure the real catalog, not a fixture");
            samples.push(sample);
            console.log(`run ${run + 1}: ${JSON.stringify(sample)}`);
            await context.close();
        }
        const median = (key) => samples.map((sample) => sample[key]).sort((a, b) => a - b)[1];
        const result = { cpuSlowdown: 4, samples, median: {
            readyMs: median("readyMs"), maxLongTaskMs: median("maxLongTaskMs"),
            totalBlockingMs: median("totalBlockingMs"),
        } };
        console.log(`median: ${JSON.stringify(result.median)}`);
        if (process.env.PERF_OUTPUT) fs.writeFileSync(process.env.PERF_OUTPUT, JSON.stringify(result, null, 2) + "\n");
    } finally {
        await browser.close();
    }
})().catch((error) => { console.error(error); process.exitCode = 1; });
