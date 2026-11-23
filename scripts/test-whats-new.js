#!/usr/bin/env node
// Checks scripts/build-whats-new.js against a temporary Git history:
// venue additions are found and dated, repairs are ignored, the window holds,
// and an uncommitted sync is included with --worktree.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { buildWhatsNew } = require('./build-whats-new');
const { appIdentity } = require('./sync-venue');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'whats-new-'));
const git = (...args) => execFileSync('git', args, { cwd: temp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const row = (artist, song, status = 'ok') => ({ artist, song, status });
let catalog = [];
const commit = (rows, date, message) => {
    catalog = rows;
    fs.writeFileSync(path.join(temp, 'karaoke_songs_enriched.json'), `﻿${JSON.stringify(rows)}`);
    git('add', '.');
    execFileSync('git', ['commit', '-q', '-m', message], { cwd: temp, env: { ...process.env,
        GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
};

try {
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'Test');
    commit([row('Alpha', 'One'), row('Beta', 'Two')], '2026-01-01T00:00:00Z', 'Initial catalog');
    commit([...catalog, row('Gamma', 'Old Addition', 'pending')], '2026-03-01T00:00:00Z', 'Old sync');
    commit([...catalog, row('Delta', 'September', 'pending')], '2026-09-20T00:00:00Z', 'Earlier sync');
    // A repair that renames a row and enriches an earlier addition adds nothing new.
    commit([row('Alpha', 'One (Remastered)'), ...catalog.slice(1).map(song => ({ ...song, status: 'ok' }))],
        '2026-10-01T00:00:00Z', 'Data repair');
    commit([...catalog, row('Epsilon', 'Fresh', 'pending'), row('Zeta', 'Fresher', 'pending')],
        '2026-11-16T00:00:00Z', 'Latest sync');

    const data = buildWhatsNew({ cwd: temp });
    assert.equal(data.windowDays, 60);
    assert.deepEqual(data.batches.map(batch => [batch.date, batch.ids]), [
        ['2026-11-16', [appIdentity(row('Epsilon', 'Fresh')), appIdentity(row('Zeta', 'Fresher'))]],
        ['2026-09-20', [appIdentity(row('Delta', 'September'))]],
    ], 'Recent venue additions only: not the repair, not the March batch outside the window');
    assert.match(data.batches[0].commit, /^[0-9a-f]{12}$/);

    // An uncommitted sync is the newest batch, dated by the run.
    fs.writeFileSync(path.join(temp, 'karaoke_songs_enriched.json'),
        JSON.stringify([...catalog, row('Eta', 'Tonight', 'pending')]));
    const withWorktree = buildWhatsNew({ cwd: temp, worktree: true, now: new Date('2026-11-23T09:30:00Z') });
    assert.deepEqual(withWorktree.batches[0], { date: '2026-11-23', commit: 'worktree', ids: [appIdentity(row('Eta', 'Tonight'))] });
    // The window now runs from 25 September, so the 20 September batch drops out.
    assert.deepEqual(withWorktree.batches.map(batch => batch.date), ['2026-11-23', '2026-11-16']);
    // Without the flag, the uncommitted row is not yet "added".
    assert.equal(buildWhatsNew({ cwd: temp }).batches[0].date, '2026-11-16');

    // A row that later leaves the catalog is dropped.
    git('checkout', '-q', '--', '.');
    commit(catalog.filter(song => song.artist !== 'Zeta'), '2026-11-20T00:00:00Z', 'Remove a row');
    assert.deepEqual(buildWhatsNew({ cwd: temp }).batches[0].ids, [appIdentity(row('Epsilon', 'Fresh'))]);
    console.log('build-whats-new tests passed');
} finally {
    fs.rmSync(temp, { recursive: true, force: true });
}
