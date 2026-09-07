#!/usr/bin/env node
const assert = require('node:assert/strict');
const { menu, plan, notes } = require('./ui-helpers');
let pw; try { pw = require('playwright'); } catch { pw = require('playwright-core'); }
const engine = process.env.BROWSER || 'chromium';
const options = { headless: true };
if (engine === 'chromium' && process.env.CHROMIUM_PATH) options.executablePath = process.env.CHROMIUM_PATH;
const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:8765/karaoke_explorer.html';
const songs = ['First', 'Second', 'Third'].map(song => ({ song, artist: 'Artist', genres: [], moods: ['Party', 'Singalong', 'Mellow', 'High energy'], eras: ['90s'], tags: [], flags: [], status: 'ok' }));
const ready = page => page.waitForFunction(() => state.songs.length === 3 && !songbookLoadPending);
const tests = [
    ['first visit is quiet; saving, More, filters and planning work at desktop and mobile widths', async page => {
        assert.equal(await page.locator('#clearButton').isVisible(), false);
        await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
        await page.fill('#searchInput', 'First');
        await page.waitForFunction(() => state.query === 'First' && !searchRenderTimer);
        for (const width of [1440, 390, 320]) {
            await page.setViewportSize({ width, height: 844 });
            assert.equal(await page.locator('.setlist-panel').isVisible(), false);
            assert.equal(await page.locator('#mobileSetlistButton').isVisible(), false);
            assert.equal(await page.locator('#chooseSongButton').isVisible(), false);
            assert.equal(await page.locator('#repertoireButton').isVisible(), false);
            assert.equal(await page.locator('#searchFilters').isVisible(), false);
            assert.equal(await page.locator('.song-card .repertoire-song-button').count(), 0);
            assert.equal(await page.locator('.add-button').first().isVisible(), false);
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
            await page.click('#moreToolsButton');
            assert.ok(await page.locator('#repertoireButton').isVisible());
            // Audit the disclosure itself; accessibility.js covers the unobscured page.
            // A floating menu intentionally covers portions of underlying song controls.
            const violations = await page.evaluate(async () => (await axe.run(document.getElementById('moreTools'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } })).violations.map(v => ({id:v.id, nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})));
            assert.deepEqual(violations, []);
            await page.keyboard.press('Escape');
            assert.equal(await page.locator('#moreTools').getAttribute('open'), null);
            assert.equal(await page.evaluate(() => document.activeElement.id), 'moreToolsButton');
            await page.click('#filtersToggleButton');
            assert.ok(await page.locator('#searchFilters').isVisible());
            await page.keyboard.press('Shift+Tab');
            assert.ok(await page.locator('#searchFilters').evaluate(el => el.contains(document.activeElement)));
            await page.click('#applyFiltersButton');
            assert.equal(await page.evaluate(() => document.activeElement.id), 'filtersToggleButton');
            await plan(page);
            assert.ok(await page.locator('.add-button').first().isVisible());
            if (await page.locator('.add-button').first().isEnabled()) await page.locator('.add-button').first().click();
            await page.click('#finishPlanningButton');
            assert.equal(await page.locator('.setlist-panel').isVisible(), false);
            assert.equal(await page.evaluate(() => state.setlist.length), 1);
        }
        const details = page.locator('.pill-more').first();
        await details.click();
        assert.equal(await details.getAttribute('aria-expanded'), 'true');
        await details.click();
        assert.equal(await details.getAttribute('aria-expanded'), 'false');
        assert.ok(await details.evaluate(el => el === document.activeElement));
        assert.ok(await page.locator('#clearButton').isVisible());
        await page.locator('.favorite-button').first().click();
        assert.equal(await page.locator('#songNotesDialog').isVisible(), false);
        assert.equal(await page.evaluate(() => Object.keys(repertoire).length), 1);
        await menu(page, '#repertoireButton');
        assert.equal(await page.locator('#repertoireList article').count(), 1);
        await page.keyboard.press('Escape');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'moreToolsButton');
        await page.reload(); await ready(page);
        assert.equal(await page.evaluate(() => Object.keys(repertoire).length), 1);
        assert.equal(await page.locator('.setlist-panel').isVisible(), false);
    }],
    ['legacy favorites merge with notes once and removed songs stay removed', async page => {
        await page.evaluate(() => {
            localStorage.removeItem(REPERTOIRE_STORAGE_KEY);
            localStorage.setItem('karaokeFavorites', JSON.stringify([state.songs[0].legacyId, state.songs[0].id, state.songs[1].id]));
            localStorage.setItem('karaokeRepertoireV1', JSON.stringify({ [getSongIdentity(state.songs[0])]: { song: toSetlistEntry(state.songs[0]), status: 'sung', comfort: 5, key: 'G minor', notes: 'Keep my notes' } }));
        });
        await page.reload(); await ready(page);
        assert.equal(await page.evaluate(() => Object.keys(repertoire).length), 2);
        assert.deepEqual(await page.evaluate(() => { const { status, comfort, key, notes } = repertoire[getSongIdentity(state.songs[0])]; return { status, comfort, key, notes }; }), { status: 'sung', comfort: 5, key: 'G minor', notes: 'Keep my notes' });
        await menu(page, '#repertoireButton');
        await page.locator('#repertoireList .repertoire-song-button').first().click();
        await page.click('#repertoireRemove');
        await page.reload(); await ready(page);
        assert.equal(await page.evaluate(() => Object.keys(repertoire).length), 1);
        assert.equal(await page.evaluate(() => isFavorite(state.songs[0])), false);
        assert.ok(await page.evaluate(() => localStorage.getItem('karaokeRepertoireV1').includes('Keep my notes')));
    }],
    ['failed migration retains legacy data and retries successfully', async page => {
        await page.evaluate(() => {
            localStorage.removeItem(REPERTOIRE_STORAGE_KEY);
            localStorage.setItem('karaokeFavorites', JSON.stringify([state.songs[0].legacyId]));
        });
        await page.addInitScript(() => {
            const original = Storage.prototype.setItem;
            Storage.prototype.setItem = function(key, value) {
                if (key === 'karaokeSavedSongsV1' && !window.allowSave) throw new DOMException('Full', 'QuotaExceededError');
                return original.call(this, key, value);
            };
        });
        await page.reload(); await ready(page);
        assert.equal(await page.evaluate(() => Object.keys(repertoire).length), 1);
        assert.equal(await page.evaluate(() => localStorage.getItem(REPERTOIRE_STORAGE_KEY)), null);
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('karaokeFavorites')).length), 1);
        await page.fill('#searchInput', 'Second');
        await page.waitForFunction(() => state.query === 'Second' && !searchRenderTimer);
        await page.locator('.favorite-button[aria-pressed="false"]').first().click();
        assert.equal(await page.evaluate(() => Object.keys(repertoire).length), 1, 'Failed save must not appear successful');
        await page.evaluate(() => { window.allowSave = true; });
        await page.locator('.favorite-button[aria-pressed="false"]').first().click();
        assert.equal(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem(REPERTOIRE_STORAGE_KEY)).songs).length), 2);
        await page.reload(); await ready(page);
        assert.equal(await page.evaluate(() => Object.keys(repertoire).length), 2);
    }],
];
(async () => {
    const browser = await pw[engine].launch(options);
    try {
        for (const [name, run] of tests) {
            const context = await browser.newContext({ serviceWorkers: 'block', reducedMotion: 'reduce' });
            try {
                await context.route('**/karaoke_songs_enriched.json?*', r => r.fulfill({ json: songs }));
                const page = await context.newPage(); const errors = [];
                page.on('pageerror', e => errors.push(e.message));
                await page.goto(BASE); await ready(page);
                await run(page); assert.deepEqual(errors, []);
                console.log(`ok   ${engine}: ${name}`);
            } finally { await context.close(); }
        }
    } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
