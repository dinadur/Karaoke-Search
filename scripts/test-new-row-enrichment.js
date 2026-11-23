#!/usr/bin/env node
// Offline test for new-row enrichment: fake Last.fm and MusicBrainz responses.
const assert = require('node:assert/strict');
const { enrichNewRows, eraOf, primaryArtist } = require('./lib/new-row-enrichment');

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, body: { cancel: async () => {} } });
const calls = [];
const fetchImpl = async url => {
    url = new URL(url); calls.push(url.hostname + ' ' + (url.searchParams.get('artist') || url.searchParams.get('query')));
    if (url.hostname === 'ws.audioscrobbler.com') {
        const artist = url.searchParams.get('artist');
        if (artist === 'Known Artist') return json({ toptags: { tag: [{ name: 'Indie', count: 100 }, { name: 'rare', count: 2 }, { name: '1985', count: 50 }] } });
        if (artist === 'Flaky') return json({}, 503);
        return json({ toptags: { tag: [] } });
    }
    const query = url.searchParams.get('query');
    if (query.includes('Mb Only')) return json({ artists: [{ score: 100, tags: [{ name: 'rock', count: 1 }, { name: 'pop', count: 5 }] }] });
    if (query.includes('Low Score')) return json({ artists: [{ score: 60, tags: [{ name: 'jazz', count: 3 }] }] });
    return json({ artists: [] });
};
(async () => {
    assert.equal(eraOf('1985'), '80s'); assert.equal(eraOf('2010s'), '2010s'); assert.equal(eraOf('pop'), null);
    assert.equal(primaryArtist('Mb Only feat. Someone'), 'Mb Only');
    const rows = [
        { artist: 'Known Artist', song: 'Hit', lookupArtist: 'Known Artist', status: 'pending', tags: [], eras: [] },
        { artist: 'Mb Only feat. Someone', song: 'B-side', lookupArtist: 'Mb Only feat. Someone', status: 'pending', tags: [], eras: [] },
        { artist: 'Low Score', song: 'Nope', lookupArtist: 'Low Score', status: 'pending', tags: [], eras: [] },
        { artist: 'Flaky', song: 'Down', lookupArtist: 'Flaky', status: 'pending', tags: [], eras: [] },
    ];
    const counts = await enrichNewRows(rows, { lastfmKey: 'test', fetchImpl, wait: async () => {} });
    assert.deepEqual(counts, { 'lastfm-track': 1, 'mb-artist': 1, pending: 2, lastfmSkipped: false });
    assert.deepEqual(rows[0].tags, ['indie']); assert.deepEqual(rows[0].eras, ['80s']);
    assert.equal(rows[0].enrichSource, 'lastfm-track'); assert.equal(rows[0].status, 'ok');
    assert.deepEqual(rows[1].tags, ['pop', 'rock']); assert.equal(rows[1].enrichSource, 'mb-artist');
    assert.equal(rows[2].status, 'pending'); assert.equal(rows[2].enrichSource, undefined);
    assert.equal(rows[3].status, 'pending');
    // Identity fields are never changed.
    assert.equal(rows[1].artist, 'Mb Only feat. Someone'); assert.equal(rows[1].lookupArtist, 'Mb Only feat. Someone');
    // Without a key, Last.fm is skipped and MusicBrainz still runs.
    calls.length = 0;
    const plain = [{ artist: 'Mb Only', song: 'X', lookupArtist: 'Mb Only', status: 'pending' }];
    const noKey = await enrichNewRows(plain, { lastfmKey: '', fetchImpl, wait: async () => {} });
    assert.equal(noKey.lastfmSkipped, true); assert.equal(noKey['mb-artist'], 1);
    assert.ok(calls.every(call => !call.startsWith('ws.audioscrobbler.com')));
    console.log('ok   new-row enrichment: Last.fm first, MusicBrainz fallback, eras, pending on no match, no identity changes');
})().catch(error => { console.error(error); process.exitCode = 1; });
