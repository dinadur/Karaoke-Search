#!/usr/bin/env node
// A private static server simulates two app releases. No live deployment or
// production cache is modified. Verify activation, saved data, and offline use.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
let playwright;
try { playwright = require("playwright"); } catch { playwright = require("playwright-core"); }
const browserName = process.env.BROWSER || "chromium";
const options = { headless: true };
if (browserName === "chromium" && process.env.CHROMIUM_PATH) options.executablePath = process.env.CHROMIUM_PATH;
const root = path.join(__dirname, "..");
const types = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };

(async () => {
    const script = await fs.readFile(path.join(root, "karaoke_explorer.js"), "utf8");
    const current = script.match(/const APP_VERSION = "([^"]+)"/)[1];
    const old = `${current}-qa-old`;
    let release = old;
    let serverReachable = true;
    const server = http.createServer(async (request, response) => {
        if (!serverReachable) { request.socket.destroy(); return; }
        try {
            const pathname = new URL(request.url, "http://localhost").pathname;
            const filename = path.resolve(root, pathname === "/" ? "karaoke_explorer.html" : `.${pathname}`);
            if (!filename.startsWith(`${root}${path.sep}`)) throw new Error("Invalid path");
            let body = await fs.readFile(filename);
            if ([".html", ".js", ".json"].includes(path.extname(filename))) {
                body = Buffer.from(body.toString().replaceAll(current, release));
            }
            response.writeHead(200, { "Content-Type": types[path.extname(filename)] || "application/octet-stream", "Cache-Control": "no-store" });
            response.end(body);
        } catch {
            response.writeHead(404); response.end();
        }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    let browser;
    try {
        browser = await playwright[browserName].launch(options);
        const context = await browser.newContext();
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const base = `http://127.0.0.1:${server.address().port}/`;
        await page.goto(base);
        await page.waitForFunction(() => state.songs.length && !document.querySelector(".skeleton"));
        await page.fill("#searchInput", "dancing queen");
        await page.waitForFunction(() => state.query === "dancing queen" && !searchRenderTimer);
        await page.locator(".add-button").first().click();
        await page.locator(".favorite-button").first().click();
        await page.locator(".singer-add").click();
        await page.locator(".singer-input").fill("Alex");
        await page.locator(".singer-input").press("Enter");
        await page.locator(".repertoire-song-button").first().click();
        await page.fill("#repertoireNotes", "Private offline rehearsal note");
        await page.click('#songNotesForm button[type="submit"]');
        const savedAudio = await page.evaluate(() => state.songs.filter((song) => song.audioSource).map((song) => [getSongIdentity(song), song.bpm, song.referenceKey]));
        const saved = await page.evaluate(() => ({ setlist: localStorage.getItem("karaokeSetlist"), favorites: [...state.favorites], repertoire: localStorage.getItem("karaokeRepertoireV1") }));
        await page.evaluate(async () => {
            await navigator.serviceWorker.ready;
            if (!navigator.serviceWorker.controller) await new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
        });
        await page.waitForLoadState("networkidle");
        release = current;
        await page.evaluate(async () => {
            const registration = await navigator.serviceWorker.ready;
            const changed = new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
            await registration.update();
            await changed;
        });
        await page.waitForFunction(() => navigator.serviceWorker.controller.state === "activated");
        assert.deepEqual(await page.evaluate(() => caches.keys()), [`karaoke-${current}`]);
        // Also cut off the server itself. WebKit's protocol offline override
        // can reject navigation before its service worker handles it.
        serverReachable = false;
        if (browserName !== "webkit") await context.setOffline(true);
        await page.reload();
        await page.waitForFunction(() => state.songs.length && !document.querySelector(".skeleton"));
        assert.equal(await page.evaluate(() => APP_VERSION), current);
        assert.ok(await page.evaluate(() => state.songs.length > 30000));
        assert.deepEqual(await page.evaluate(() => state.songs.filter((song) => song.audioSource).map((song) => [getSongIdentity(song), song.bpm, song.referenceKey])), savedAudio);
        assert.equal(await page.locator(".setlist-title").count(), 1);
        assert.match(await page.locator(".singer-chip").textContent(), /Alex/);
        assert.deepEqual(await page.evaluate(() => ({ setlist: localStorage.getItem("karaokeSetlist"), favorites: [...state.favorites], repertoire: localStorage.getItem("karaokeRepertoireV1") })), saved);
        const assets = await page.evaluate(async () => {
            const manifest = await (await fetch("manifest.json")).json();
            return ["manifest.json", ...manifest.icons.map((icon) => icon.src), document.querySelector('link[rel="apple-touch-icon"]').getAttribute("href")];
        });
        for (const asset of assets) {
            assert.equal(await page.evaluate(async (asset) => (await fetch(asset)).status, asset), 200, asset);
        }
        await page.fill("#searchInput", "bohemian rhapsody");
        await page.waitForFunction(() => state.query === "bohemian rhapsody" && !searchRenderTimer);
        assert.ok(await page.locator(".song-card").count());
        await page.click("#repertoireButton");
        assert.match(await page.locator("#repertoireList").textContent(), /Private offline rehearsal note/);
        await page.keyboard.press("Escape");
        await page.click("#chooseSongButton");
        await page.click('#chooseSongForm button[type="submit"]');
        assert.ok(await page.locator("#pickerResults article").count());
        assert.deepEqual(errors, []);
        console.log(`ok   ${browserName}: ${old} → ${current}, offline catalog/search/icons, saved singer/setlist/favorites/repertoire and offline picker`);
    } finally {
        if (browser) await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
})().catch((error) => { console.error(error); process.exitCode = 1; });
