#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { appIdentity, parseResponse, fetchVenueSongs, planSync, syncVenue } = require('./sync-venue');
const root = path.join(__dirname, '..');
const songs = JSON.parse(fs.readFileSync(path.join(root, 'karaoke_songs_enriched.json')));
const song = (artist, title, extra = {}) => ({ artist, song: title, genres: [], moods: [], eras: [], flags: [], tags: [], ...extra });
const respond = data => new Response(JSON.stringify(data));
// Fixture imports must not publish fake additions into a workflow's outputs/summary.
delete process.env.GITHUB_OUTPUT;
delete process.env.GITHUB_STEP_SUMMARY;

(async () => {
    const frontend = fs.readFileSync(path.join(root, 'karaoke_explorer.js'), 'utf8');
    const context = vm.createContext({ CLEAN_DISPLAY_CACHE: new Map(), NORMALIZE_CACHE: new Map() });
    for (const name of ['cleanDisplayValue', 'normalize', 'normalizeArtistKey', 'getArtistKey', 'getSongIdentity']) {
        const source = frontend.match(new RegExp(`function ${name}\\([^]*?\\n\\}`));
        assert.ok(source, `Find frontend ${name}`);
        vm.runInContext(source[0], context);
    }
    for (const row of songs) assert.equal(appIdentity(row), context.getSongIdentity(row));
    console.log('ok   importer identities agree with the frontend for the whole catalog');

    const known = [song('Concra Dinamita Wvocal, La', 'A Mover el Cu', { lookupArtist: 'La Concra Dinamita Wvocal' }),
        song('Beyoncé', 'Déjà Vu'), song('Odell, Tom', 'Another Love', { lookupArtist: 'Tom Odell' }),
        song('', 'Artist - Title (Karaoke)', { lookupArtist: 'Artist', lookupSong: 'Title' })];
    const live = [{ artist: 'Concra Dinamita, La', song: 'A Mover el Cu' },
        { artist: 'BEYONCE', song: 'Deja Vu' }, { artist: 'Tom Odell', song: 'Another Love' },
        { artist: 'Artist', song: 'Title' }, { artist: 'New Band', song: 'New Song' },
        { artist: 'New Band Wvocal', song: 'New Song' }];
    const plan = planSync(known, live);
    assert.equal(plan.additions.length, 1);
    assert.equal(plan.additions[0].song, 'New Song');
    assert.equal(plan.additions[0].status, 'pending');
    assert.deepEqual(plan.additions[0].tags, []);
    assert.equal(plan.coverage, 1);
    assert.equal(planSync([...known, ...plan.additions], live).additions.length, 0);
    assert.throws(() => planSync(known, live.slice(0, 1)), /Incomplete/);
    assert.throws(() => planSync(known, live, { maxAdditions: 0 }), /Unusually large/);
    assert.throws(() => planSync(known, []), /Incomplete/);
    const missing = planSync(known, live.slice(1), { minCoverage: 0.5 });
    assert.equal(missing.missing.length, 1);
    assert.deepEqual(known[0], song('Concra Dinamita Wvocal, La', 'A Mover el Cu', { lookupArtist: 'La Concra Dinamita Wvocal' }));
    const collisions = planSync([song('Artist', 'Anchor', { lookupArtist: 'Alias' }),
        song('Other listing', 'Title', { lookupArtist: 'Alias' })],
        [{ artist: 'Artist', song: 'Anchor' }, { artist: 'Artist', song: 'Title' }]);
    assert.equal(collisions.additions.length, 0);
    assert.equal(collisions.skipped.length, 1);
    assert.equal(collisions.coverage, 1);
    const christmas = planSync([song('Presley, Elvis', 'Silver Bells', { lookupArtist: 'Elvis Presley' })],
        [{ artist: 'Christmas - Presley, Elvis', song: 'Silver Bells' },
            { artist: 'Christmas- Presley, Elvis', song: 'Another Christmas Song' }]);
    assert.equal(christmas.additions.length, 1);
    assert.equal(christmas.additions[0].lookupArtist, 'Elvis Presley');
    assert.equal(christmas.coverage, 1);
    const boundary = Array.from({ length: 20 }, (_, i) => song('Coverage Artist', `Song ${i}`));
    const partial = [...boundary.slice(0, 19), song('New Artist', 'New Song')];
    const accepted = planSync(boundary, partial);
    assert.equal(accepted.coverage, 0.95);
    assert.deepEqual(accepted.missing, [{ artist: 'Coverage Artist', song: 'Song 19' }]);
    assert.equal(accepted.additions.length, 1);
    assert.throws(() => planSync(boundary, partial.slice(1)), /Incomplete/);
    console.log('ok   aliases, accents, Wvocal, embedded titles, idempotency, missing rows and incomplete-fetch guards');

    assert.deepEqual(parseResponse([{ Artist: 88, Song: 1979 }]), [{ artist: '88', song: '1979' }]);
    assert.deepEqual(parseResponse({ suggestions: ['Not an actual song'] }), []);
    const fullQueries = [];
    await fetchVenueSongs({ fetchImpl: async url => {
        fullQueries.push(url.searchParams.get('query'));
        return respond([{ Artist: 'Artist', Song: 'Title' }]);
    } });
    assert.deepEqual(fullQueries, ['.']);
    for (const input of [{ error: 'offline' }, null, [{ Artist: null, Song: 'Bad' }], [{ Artist: 'A', Song: '' }]]) {
        assert.throws(() => parseResponse(input));
    }
    const delays = [], calls = [];
    const fetched = await fetchVenueSongs({ queries: ['a', 'b'], wait: async ms => delays.push(ms), fetchImpl: async url => {
        calls.push(url.searchParams.get('query'));
        return calls.length === 1 ? new Response('', { status: 503 }) : respond([{ Artist: 'Artist', Song: 'Title' }]);
    } });
    assert.deepEqual(calls, ['a', 'a', 'b']);
    assert.deepEqual(delays, [15000, 1500]);
    assert.equal(fetched.rows.length, 1);
    let rateLimitCalls = 0;
    await assert.rejects(fetchVenueSongs({ queries: ['a'], wait: async () => {}, fetchImpl: async () => {
        rateLimitCalls++; return new Response('', { status: 429 });
    } }), /rate limit/);
    assert.equal(rateLimitCalls, 1);
    await assert.rejects(fetchVenueSongs({ queries: ['a'], wait: async () => {}, fetchImpl: async () => { throw new Error('Offline'); } }), /four attempts/);
    const bodyDelays = [];
    let bodyCalls = 0;
    const interrupted = () => new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode('[{"Artist":"Partial'));
        controller.error(new TypeError('Fixture connection interrupted'));
    } }));
    const recovered = await fetchVenueSongs({ wait: async ms => bodyDelays.push(ms), fetchImpl: async () => {
        bodyCalls++;
        return bodyCalls <= 3 ? interrupted() : respond([{ Artist: 'Artist', Song: 'Title' }]);
    } });
    assert.equal(recovered.requests, 4);
    assert.deepEqual(recovered.rows, [{ artist: 'Artist', song: 'Title' }]);
    assert.deepEqual(bodyDelays, [15000, 30000, 60000]);
    bodyCalls = 0;
    await assert.rejects(fetchVenueSongs({ wait: async () => {}, fetchImpl: async () => {
        bodyCalls++; return interrupted();
    } }), /four attempts/);
    assert.equal(bodyCalls, 4);
    let corruptCalls = 0;
    await assert.rejects(fetchVenueSongs({ wait: async () => {}, fetchImpl: async () => {
        corruptCalls++; return new Response('[{"Artist":');
    } }), SyntaxError);
    assert.equal(corruptCalls, 1, 'Complete but corrupt JSON must fail without retrying');
    for (const status of [400, 404, 500, 503]) {
        const waits = [];
        let attempts = 0;
        await assert.rejects(fetchVenueSongs({ wait: async ms => waits.push(ms), fetchImpl: async () => {
            attempts++; return new Response('', { status });
        } }), new RegExp(`HTTP ${status}`));
        assert.equal(attempts, status >= 500 ? 4 : 1);
        assert.deepEqual(waits, status >= 500 ? [15000, 30000, 60000] : []);
    }
    console.log('ok   API schema, numeric fields, suggestions, throttling, retries and rate limits');

    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-sync-test-'));
    try {
        fs.cpSync(path.join(root, 'scripts'), path.join(temp, 'scripts'), { recursive: true });
        const files = ['karaoke_songs_enriched.json', 'audio_enrichment.json', 'era_enrichment.json',
            'karaoke_explorer.js', 'karaoke_explorer.html', 'manifest.json', 'sw.js'];
        for (const name of files) fs.copyFileSync(path.join(root, name), path.join(temp, name));
        const original = new Map(files.map(name => [name, fs.readFileSync(path.join(temp, name), 'utf8')]));
        const raw = songs.map(row => ({ Artist: row.artist, Song: row.song }));
        raw.push({ Artist: 'Sync Test Artist 8675309', Song: 'New Test Song 8675309' });
        const fetchOptions = { queries: ['a'], fetchImpl: async () => respond(raw) };
        const dry = await syncVenue({ root: temp, fetchOptions });
        assert.equal(dry.added, 1);
        for (const [name, contents] of original) assert.equal(fs.readFileSync(path.join(temp, name), 'utf8'), contents);
        await syncVenue({ root: temp, write: true, fetchOptions });
        const updated = JSON.parse(fs.readFileSync(path.join(temp, 'karaoke_songs_enriched.json')));
        assert.deepEqual(updated.slice(0, songs.length), songs);
        assert.equal(updated.length, songs.length + 1);
        const audio = JSON.parse(fs.readFileSync(path.join(temp, 'audio_enrichment.json')));
        assert.equal(audio.summary.total, updated.length);
        assert.deepEqual(audio.entries, JSON.parse(original.get('audio_enrichment.json')).entries);
        assert.equal(audio.generatedAt, JSON.parse(original.get('audio_enrichment.json')).generatedAt);
        const era = JSON.parse(fs.readFileSync(path.join(temp, 'era_enrichment.json')));
        const originalEra = JSON.parse(original.get('era_enrichment.json'));
        assert.equal(era.summary.total, updated.length);
        assert.deepEqual(era.entries, originalEra.entries);
        assert.equal(era.generatedAt, originalEra.generatedAt);
        assert.deepEqual({ ...era.summary, total: songs.length }, originalEra.summary);
        assert.notEqual(fs.readFileSync(path.join(temp, 'sw.js'), 'utf8'), original.get('sw.js'));
        const first = new Map(files.map(name => [name, fs.readFileSync(path.join(temp, name), 'utf8')]));
        const again = await syncVenue({ root: temp, write: true, fetchOptions });
        assert.equal(again.added, 0);
        for (const [name, contents] of first) assert.equal(fs.readFileSync(path.join(temp, name), 'utf8'), contents);
        // Capture workflow outputs only in this fixture's private files.
        process.env.GITHUB_OUTPUT = path.join(temp, 'fixture-output');
        process.env.GITHUB_STEP_SUMMARY = path.join(temp, 'fixture-summary');
        const unchanged = () => {
            for (const [name, contents] of first) assert.equal(fs.readFileSync(path.join(temp, name), 'utf8'), contents, name);
            assert.equal(fs.existsSync(path.join(temp, 'metadata_cache/venue-sync.lock')), false);
        };
        const noPublishedOutput = () => {
            assert.equal(fs.existsSync(process.env.GITHUB_OUTPUT), false);
            assert.equal(fs.existsSync(process.env.GITHUB_STEP_SUMMARY), false);
        };
        for (const data of [raw.slice(0, 1), [], { suggestions: ['Not listings'] },
            [{ Artist: 'Artist', Song: null }], { error: 'offline' }]) {
            await assert.rejects(syncVenue({ root: temp, write: true,
                fetchOptions: { fetchImpl: async () => respond(data) } }));
            unchanged(); noPublishedOutput();
        }
        await assert.rejects(syncVenue({ root: temp, write: true,
            fetchOptions: { fetchImpl: async () => new Response('[{"Artist":') } }), SyntaxError);
        unchanged(); noPublishedOutput();
        let exhaustedBodyCalls = 0;
        await assert.rejects(syncVenue({ root: temp, write: true,
            fetchOptions: { wait: async () => {}, fetchImpl: async () => {
                exhaustedBodyCalls++; return interrupted();
            } } }), /four attempts/);
        assert.equal(exhaustedBodyCalls, 4);
        unchanged(); noPublishedOutput();
        const excessive = [...raw, ...Array.from({ length: 501 }, (_, i) => ({ Artist: 'Excessive Fixture', Song: `New ${i}` }))];
        await assert.rejects(syncVenue({ root: temp, write: true,
            fetchOptions: { fetchImpl: async () => respond(excessive) } }), /Unusually large/);
        unchanged(); noPublishedOutput();
        // A failing validation at any phase must roll back all seven files.
        raw.push({ Artist: 'Sync Test Artist 8675309', Song: 'Second Test Song' });
        for (const name of ['bump-version.js', 'check-versions.js', 'check-era-enrichment.js', 'check-audio-enrichment.js']) {
            const script = path.join(temp, 'scripts', name);
            const source = fs.readFileSync(script, 'utf8');
            try {
                fs.writeFileSync(script, source + '\nprocess.exit(1);\n');
                await assert.rejects(syncVenue({ root: temp, write: true, fetchOptions }));
                unchanged(); noPublishedOutput();
            } finally { fs.writeFileSync(script, source); }
        }
        for (const name of ['audio_enrichment.json', 'era_enrichment.json']) {
            const file = path.join(temp, name);
            fs.writeFileSync(file, '{corrupt');
            await assert.rejects(syncVenue({ root: temp, write: true, fetchOptions }), SyntaxError);
            assert.equal(fs.readFileSync(file, 'utf8'), '{corrupt');
            for (const [other, contents] of first) if (other !== name) assert.equal(fs.readFileSync(path.join(temp, other), 'utf8'), contents);
            noPublishedOutput();
            fs.writeFileSync(file, first.get(name));
        }
        const catalogPath = path.join(temp, 'karaoke_songs_enriched.json');
        fs.writeFileSync(catalogPath, '[corrupt');
        let corruptCatalogFetches = 0;
        await assert.rejects(syncVenue({ root: temp, write: true, fetchOptions: { fetchImpl: async () => {
            corruptCatalogFetches++; return respond(raw);
        } } }), SyntaxError);
        assert.equal(corruptCatalogFetches, 0);
        assert.equal(fs.readFileSync(catalogPath, 'utf8'), '[corrupt');
        noPublishedOutput();
        fs.writeFileSync(catalogPath, first.get('karaoke_songs_enriched.json'));
        const concurrent = first.get('karaoke_songs_enriched.json') + '\n';
        await assert.rejects(syncVenue({ root: temp, write: true, fetchOptions: { fetchImpl: async () => {
            fs.writeFileSync(catalogPath, concurrent); return respond(raw);
        } } }), /Catalog changed/);
        assert.equal(fs.readFileSync(catalogPath, 'utf8'), concurrent, 'Preserve concurrent owner edit');
        noPublishedOutput();
        fs.writeFileSync(catalogPath, first.get('karaoke_songs_enriched.json'));
        unchanged();
        // A small allowed coverage gap must preserve all absent existing rows.
        const partialOptions = { fetchImpl: async () => respond(raw.slice(100)) };
        const success = await syncVenue({ root: temp, write: true, fetchOptions: partialOptions });
        assert.equal(success.added, 1);
        assert.ok(success.missing.length > 0);
        assert.deepEqual(JSON.parse(fs.readFileSync(catalogPath)).slice(0, updated.length), updated);
        assert.equal(fs.readFileSync(process.env.GITHUB_OUTPUT, 'utf8'), 'added=1\n');
        assert.match(fs.readFileSync(process.env.GITHUB_STEP_SUMMARY, 'utf8'), /1 new songs added/);
        fs.unlinkSync(process.env.GITHUB_OUTPUT); fs.unlinkSync(process.env.GITHUB_STEP_SUMMARY);
        assert.equal((await syncVenue({ root: temp, write: true, fetchOptions: partialOptions })).added, 0);
        assert.equal(fs.readFileSync(process.env.GITHUB_OUTPUT, 'utf8'), 'added=0\n');
        fs.writeFileSync(path.join(temp, 'metadata_cache/venue-sync.lock'), '');
        await assert.rejects(syncVenue({ root: temp, write: true, fetchOptions }), /EEXIST/);
        console.log('ok   write-mode aborts, sidecar evidence, every validator rollback, concurrent edits, workflow outputs and locking');
    } finally {
        delete process.env.GITHUB_OUTPUT; delete process.env.GITHUB_STEP_SUMMARY;
        fs.rmSync(temp, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
