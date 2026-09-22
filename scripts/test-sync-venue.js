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
    console.log('ok   aliases, accents, Wvocal, embedded titles, idempotency, missing rows and incomplete-fetch guards');

    assert.deepEqual(parseResponse([{ Artist: 88, Song: 1979 }]), [{ artist: '88', song: '1979' }]);
    assert.deepEqual(parseResponse({ suggestions: ['Not an actual song'] }), []);
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
        const first = new Map(files.map(name => [name, fs.readFileSync(path.join(temp, name), 'utf8')]));
        const again = await syncVenue({ root: temp, write: true, fetchOptions });
        assert.equal(again.added, 0);
        for (const [name, contents] of first) assert.equal(fs.readFileSync(path.join(temp, name), 'utf8'), contents);
        // A failing validation must roll back the catalog, sidecars and versions together.
        fs.writeFileSync(path.join(temp, 'scripts/check-versions.js'), 'process.exit(1);');
        raw.push({ Artist: 'Sync Test Artist 8675309', Song: 'Second Test Song' });
        await assert.rejects(syncVenue({ root: temp, write: true, fetchOptions }));
        for (const [name, contents] of first) assert.equal(fs.readFileSync(path.join(temp, name), 'utf8'), contents);
        assert.equal(fs.existsSync(path.join(temp, 'metadata_cache/venue-sync.lock')), false);
        fs.writeFileSync(path.join(temp, 'metadata_cache/venue-sync.lock'), '');
        await assert.rejects(syncVenue({ root: temp, write: true, fetchOptions }), /EEXIST/);
        console.log('ok   real catalog dry run, append-only write, metadata/version checks, no-op rerun, rollback and locking');
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
