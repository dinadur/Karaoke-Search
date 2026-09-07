#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { identity, normalize, catalogGroups } = require('./lib/music-metadata');
const root = path.join(__dirname, '..');
const songs = JSON.parse(fs.readFileSync(path.join(root, 'karaoke_songs_enriched.json')));
const data = JSON.parse(fs.readFileSync(path.join(root, 'audio_enrichment.json')));
const known = new Set(songs.map(identity));
const seen = new Set();
const queries = new Map(catalogGroups(songs).flatMap(group => group.songs.map(song => [identity(song), group])));
assert.equal(data.schemaVersion, 1);
for (const entry of data.entries) {
    const id = identity(entry);
    assert.ok(known.has(id) && !seen.has(id), 'Unknown or duplicate target'); seen.add(id);
    assert.ok(entry.bpm === null || typeof entry.bpm === 'number' && entry.bpm >= 20 && entry.bpm <= 400);
    assert.ok(entry.referenceKey === null || /^[A-G](?:#|b|♯|♭)?m?$/.test(entry.referenceKey));
    assert.ok(entry.bpm !== null || entry.referenceKey !== null);
    for (const field of ['danceability', 'acousticness']) assert.ok(entry[field] === null || typeof entry[field] === 'number' && entry[field] >= 0 && entry[field] <= 100);
    assert.equal(entry.source.type, 'getsongbpm');
    assert.equal(entry.source.confidence, 'exact-name-consensus');
    assert.match(entry.source.checkedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(entry.source.records.length);
    for (const record of entry.source.records) {
        assert.ok(typeof record.id === 'string' && record.id.length > 0);
        assert.ok(typeof record.title === 'string' && typeof record.artist === 'string');
        assert.equal(normalize(record.title), normalize(queries.get(id).title));
        assert.equal(normalize(record.artist), normalize(queries.get(id).artist));
        const url = new URL(record.url);
        assert.ok(url.protocol === 'https:' && url.hostname === 'getsongbpm.com' && url.pathname.startsWith('/song/'));
    }
}
assert.equal(data.summary.total, songs.length);
assert.equal(data.summary.uniqueEntries, seen.size);
assert.equal(data.summary.matchedRows, songs.filter((song) => seen.has(identity(song))).length);
console.log(`Audio metadata verified: ${data.summary.matchedRows}/${songs.length} rows`);
