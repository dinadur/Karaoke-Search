#!/usr/bin/env node
const { menu, plan, notes } = require("./ui-helpers");
// A private static server simulates failed/interrupted and successful releases.
// No live deployment or production cache is modified.
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
    let failure = null;
    let failedRequests = 0;
    let interruptedResponse;
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
            if (release === current && failure && pathname === failure.path) {
                failedRequests++;
                if (failure.kind === "http") {
                    response.writeHead(503); response.end("Upgrade unavailable"); return;
                }
                if (failure.kind === "disconnect") { request.socket.destroy(); return; }
                // Deliver a partial body, then interrupt the connection from
                // the test while the new worker is still installing.
                response.writeHead(200, { "Content-Type": types[path.extname(filename)], "Content-Length": body.length });
                response.write(body.subarray(0, Math.floor(body.length / 2)));
                interruptedResponse = response;
                return;
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
        const messages = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => messages.push(`${message.type()}: ${message.text()}`));
        const base = `http://127.0.0.1:${server.address().port}/`;
        async function checkSavedOffline(version) {
            serverReachable = false;
            if (browserName !== "webkit") await context.setOffline(true);
            await page.reload();
            await page.waitForFunction(() => state.songs.length && !document.querySelector(".skeleton"));
            assert.equal(await page.evaluate(() => APP_VERSION), version);
            assert.ok(await page.evaluate(() => state.songs.length > 30000));
            assert.deepEqual(await page.evaluate(() => ({ setlist: localStorage.getItem("karaokeSetlist"), favorites: [...state.favorites], repertoire: localStorage.getItem("karaokeSavedSongsV1") })), saved);
            assert.deepEqual(await page.evaluate(() => state.songs.filter((song) => song.audioSource).map((song) => [getSongIdentity(song), song.bpm, song.referenceKey])), savedAudio);
            serverReachable = true;
            if (browserName !== "webkit") await context.setOffline(false);
        }
        async function startUpdate() {
            await page.evaluate(async () => {
                const registration = await navigator.serviceWorker.ready;
                window.upgrade = { state: null, controllerChanges: 0 };
                navigator.serviceWorker.addEventListener("controllerchange", () => window.upgrade.controllerChanges++);
                registration.addEventListener("updatefound", () => {
                    const worker = registration.installing;
                    worker.addEventListener("statechange", () => {
                        if (["activated", "redundant"].includes(worker.state)) window.upgrade.state = worker.state;
                    });
                }, { once: true });
                await registration.update();
            });
        }
        await page.goto(base);
        await page.waitForFunction(() => state.songs.length && !document.querySelector(".skeleton"));
        await page.fill("#searchInput", "dancing queen");
        await page.waitForFunction(() => state.query === "dancing queen" && !searchRenderTimer);
        await plan(page);
        await page.locator(".add-button").first().click();
        await page.locator(".favorite-button").first().click();
        await page.locator(".singer-add").click();
        await page.locator(".singer-input").fill("Alex");
        await page.locator(".singer-input").press("Enter");
        await notes(page);
        await page.fill("#repertoireNotes", "Private offline rehearsal note");
        await page.click('#songNotesForm button[type="submit"]');
        const savedAudio = await page.evaluate(() => state.songs.filter((song) => song.audioSource).map((song) => [getSongIdentity(song), song.bpm, song.referenceKey]));
        const saved = await page.evaluate(() => ({ setlist: localStorage.getItem("karaokeSetlist"), favorites: [...state.favorites], repertoire: localStorage.getItem("karaokeSavedSongsV1") }));
        await page.evaluate(async () => {
            await navigator.serviceWorker.ready;
            if (!navigator.serviceWorker.controller) await new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
        });
        await page.waitForLoadState("networkidle");
        // Activation alone is insufficient: assert that every precache entry
        // exists before disconnecting the server, including the large catalog.
        const sw = await fs.readFile(path.join(root, "sw.js"), "utf8");
        const precache = require("node:vm").runInNewContext(`${sw.split('self.addEventListener("install"')[0]}; PRECACHE_URLS`);
        async function checkPrecache(version) {
            const urls = Array.from(precache, (url) => url.replaceAll(current, version));
            const missing = await page.evaluate(async ({ version, urls }) => {
                const cache = await caches.open(`karaoke-${version}`);
                const present = await Promise.all(urls.map(async (url) => Boolean(await cache.match(url))));
                return urls.filter((url, index) => !present[index]);
            }, { version, urls });
            assert.deepEqual(missing, [], `Incomplete ${version} precache`);
        }
        await checkPrecache(old);
        await page.evaluate(async () => (await caches.open("unrelated-app")).put("/sentinel", new Response("keep")));
        release = current;
        for (const scenario of [
            { kind: "http", path: "/karaoke_songs_enriched.json" },
            { kind: "disconnect", path: "/personal-songbook.js" },
            { kind: "interrupt", path: "/karaoke_songs_enriched.json" },
            { kind: "http", path: "/icon-192.png" },
        ]) {
            failure = scenario;
            failedRequests = 0;
            interruptedResponse = null;
            await startUpdate();
            if (scenario.kind === "interrupt") {
                const deadline = Date.now() + 10000;
                while (!interruptedResponse && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
                assert.ok(interruptedResponse, "Upgrade must request the interrupted catalog");
                serverReachable = false;
                interruptedResponse.destroy();
            }
            await page.waitForFunction(() => window.upgrade.state !== null);
            assert.ok(failedRequests > 0, "Fault must reach the installing service worker");
            assert.equal(await page.evaluate(() => window.upgrade.state), "redundant", `${scenario.kind} ${scenario.path} must reject the upgrade`);
            assert.equal(await page.evaluate(() => window.upgrade.controllerChanges), 0, "Failed upgrade must keep the old controller");
            assert.ok((await page.evaluate(() => caches.keys())).includes(`karaoke-${old}`));
            await checkPrecache(old);
            await checkSavedOffline(old);
            console.log(`ok   ${browserName}: ${scenario.kind} ${scenario.path} keeps old offline catalog and saved data`);
        }
        // The active worker can see the next release's HTML online even when
        // its catalog cannot install. That HTML must not poison its fallback.
        failure = { kind: "http", path: "/karaoke_songs_enriched.json" };
        await page.goto(`${base}?q=dancing%20queen`);
        await page.waitForFunction(() => document.getElementById("status").textContent === "Songbook unavailable");
        assert.equal(await page.evaluate(() => APP_VERSION), current);
        await checkSavedOffline(old);
        console.log(`ok   ${browserName}: online visit to failed release preserves installed offline shell`);
        failure = null;
        await startUpdate();
        await page.waitForFunction(() => window.upgrade.state === "activated" && window.upgrade.controllerChanges > 0);
        await page.waitForFunction(() => navigator.serviceWorker.controller.state === "activated");
        assert.deepEqual((await page.evaluate(() => caches.keys())).sort(), [`karaoke-${current}`, "unrelated-app"].sort());
        assert.equal(await page.evaluate(async () => (await (await caches.open("unrelated-app")).match("/sentinel")).text()), "keep");
        await checkPrecache(current);
        // Also cut off the server itself. WebKit's protocol offline override
        // can reject navigation before its service worker handles it.
        serverReachable = false;
        if (browserName !== "webkit") await context.setOffline(true);
        await page.reload();
        try {
            await page.waitForFunction(() => state.songs.length && !document.querySelector(".skeleton"));
        } catch (error) {
            // Report where an offline load stopped, not only that it did.
            const snapshot = await Promise.race([
                page.evaluate(async (cacheName) => ({
                    songs: typeof state === "undefined" ? "no app state" : state.songs.length,
                    skeleton: Boolean(document.querySelector(".skeleton")),
                    status: document.getElementById("status")?.textContent,
                    openDialog: document.querySelector("dialog[open]")?.id || null,
                    controlled: Boolean(navigator.serviceWorker.controller),
                    cached: (await (await caches.open(cacheName)).keys()).map((request) => new URL(request.url).pathname),
                }), `karaoke-${current}`),
                new Promise((resolve) => setTimeout(() => resolve("page did not respond"), 5000)),
            ]);
            console.error(`offline load stalled: ${JSON.stringify({ snapshot, errors, messages: messages.slice(-20) })}`);
            throw error;
        }
        assert.equal(await page.evaluate(() => APP_VERSION), current);
        assert.ok(await page.evaluate(() => state.songs.length > 30000));
        assert.deepEqual(await page.evaluate(() => state.songs.filter((song) => song.audioSource).map((song) => [getSongIdentity(song), song.bpm, song.referenceKey])), savedAudio);
        assert.equal(await page.locator(".setlist-title").count(), 1);
        assert.match(await page.locator(".singer-chip").textContent(), /Alex/);
        assert.deepEqual(await page.evaluate(() => ({ setlist: localStorage.getItem("karaokeSetlist"), favorites: [...state.favorites], repertoire: localStorage.getItem("karaokeSavedSongsV1") })), saved);
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
        await menu(page, "#repertoireButton");
        assert.match(await page.locator("#repertoireList").textContent(), /Private offline rehearsal note/);
        await page.keyboard.press("Escape");
        await menu(page, "#chooseSongButton");
        await page.click('#chooseSongForm button[type="submit"]');
        assert.ok(await page.locator("#pickerResults article").count());
        assert.deepEqual(errors, []);
        console.log(`ok   ${browserName}: ${old} → ${current}, offline catalog/search/icons, saved singer/setlist/favorites/repertoire and offline picker`);
    } finally {
        if (browser) await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
})().catch((error) => { console.error(error); process.exitCode = 1; });
