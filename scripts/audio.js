#!/usr/bin/env node
const { menu, plan, notes } = require("./ui-helpers");
const assert = require('node:assert/strict');
let pw; try { pw = require('playwright'); } catch { pw = require('playwright-core'); }
const engine = process.env.BROWSER || 'chromium';
const options = { headless: true };
if (engine === 'chromium' && process.env.CHROMIUM_PATH) options.executablePath = process.env.CHROMIUM_PATH;
const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:8765/karaoke_explorer.html';
const songs = [{ artist: 'Alpha', song: 'Known', eras: [], genres: [], moods: [], tags: [] }, { artist: 'Beta', song: 'Unknown', eras: [], genres: [], moods: [], tags: [] }];
songs.push({ ...songs[0], song: 'KNOWN' });
const entry = { ...songs[0], bpm: 122, referenceKey: 'Em', source: { type: 'getsongbpm', records: [{ url: 'https://getsongbpm.com/song/known/abc' }] } };
(async () => {
    const browser = await pw[engine].launch(options);
    try {
        for (const scenario of ['valid', 'unavailable', 'invalid']) {
            const context = await browser.newContext({ viewport: { width: 320, height: 800 }, serviceWorkers: 'block' });
            try {
                const errors = [];
                const page = await context.newPage(); page.on('pageerror', (e) => errors.push(e.message));
                await context.route('**/karaoke_songs_enriched.json?*', (r) => r.fulfill({ json: songs }));
                await context.route('**/audio_enrichment.json?*', (r) => scenario === 'unavailable' ? r.abort() : r.fulfill({ json: { entries: [scenario === 'invalid' ? { ...entry, bpm: -10, referenceKey: '<img src=x>', source: { type: 'getsongbpm', records: [{ url: 'javascript:alert(1)' }] } } : entry, { ...songs[1], bpm: 123, referenceKey: "C", source: { type: "getsongbpm", records: {} } }] } }));
                await page.goto(BASE); await page.waitForFunction(() => state.songs.length === 3 && !songbookLoadPending);
                await page.fill('#searchInput', 'Known'); await page.waitForFunction(() => state.query === 'Known' && !searchRenderTimer);
                if (scenario === 'valid') {
                    await page.getByRole('link', { name: /^122 BPM/ }).first().waitFor();
                    assert.equal(await page.getByRole('link', { name: /^Ref\. key Em/ }).first().getAttribute('href'), entry.source.records[0].url);
                    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
                    await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
                    const violations = await page.evaluate(async () => (await axe.run({ runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21aa','wcag22aa'] } })).violations.map(v=>v.id));
                    assert.deepEqual(violations, []);
                    // Metadata is not a singer's preferred key and cannot overwrite it.
                    await notes(page);
                    assert.equal(await page.inputValue('#repertoireKey'), '');
                    await page.fill('#repertoireKey', 'D minor'); await page.click('#songNotesForm button[type="submit"]');
                    await page.reload(); await page.waitForFunction(() => state.songs.length === 3 && !songbookLoadPending);
                    assert.equal(await page.evaluate(() => Object.values(repertoire)[0].key), 'D minor');
                    const popover = await page.evaluate(() => { const tags=createSongTags(state.songs[0]); document.body.append(tags); tags.querySelector('button').click(); return tags.textContent; });
                    assert.match(popover, /Reference recording.*122 BPM.*Ref\. key Em.*Karaoke arrangements/s);
                    assert.equal(await page.evaluate(() => state.songs[1].bpm), undefined);
                    assert.equal(await page.evaluate(() => state.songs[2].bpm), undefined, 'Normalized identity must not expand the explicit import targets');
                } else assert.equal(await page.locator('.audio-metadata').count(), 0);
                assert.deepEqual(errors, []);
                console.log(`ok   ${engine} audio metadata: ${scenario}`);
            } finally { await context.close(); }
        }
    } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1});
