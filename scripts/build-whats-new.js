#!/usr/bin/env node
// Builds whats_new.json: which catalog rows the venue sync added recently, and
// when. It reads only the catalog's Git history (plus, with --worktree, an
// uncommitted sync), so it never invents metadata. Popularity ranking happens
// in the app, against whatever enrichment the catalog has at the time.
//
//   node scripts/build-whats-new.js             # committed history only
//   node scripts/build-whats-new.js --worktree  # also an uncommitted sync, dated today
//   node scripts/build-whats-new.js --check     # fail if whats_new.json is stale
//
// A row counts as "added" when its identity first appears on main's first-parent
// history and either the catalog grew by at least as many rows (a sync, even one
// enriched before committing) or the row is "pending", which is how
// scripts/sync-venue.js appends venue additions. Data repairs that rename rows
// don't grow the catalog and don't produce pending rows, so they don't count.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { appIdentity } = require('./sync-venue');

const ROOT = path.join(__dirname, '..');
const CATALOG = 'karaoke_songs_enriched.json';
const OUTPUT = path.join(ROOT, 'whats_new.json');
// Batches added within this many days of the most recent batch are "new".
const WINDOW_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

function git(args, options = {}) {
    return execFileSync('git', args, { cwd: options.cwd || ROOT, maxBuffer: 1 << 30, encoding: 'utf8' });
}

function parseCatalog(text) {
    const songs = JSON.parse(text.replace(/^﻿/, ''));
    if (!Array.isArray(songs)) throw new Error('Catalog is not an array');
    return songs;
}

function catalogAt(rev, cwd) {
    return parseCatalog(git(['show', `${rev}:${CATALOG}`], { cwd }));
}

function addedRows(current, previous) {
    const before = new Set(previous.map(appIdentity));
    const added = [];
    const seen = new Set();
    for (const song of current) {
        const id = appIdentity(song);
        if (before.has(id) || seen.has(id)) continue;
        seen.add(id);
        added.push({ id, pending: song.status === 'pending' });
    }
    const grew = current.length - previous.length >= added.length;
    return added.filter(row => grew || row.pending).map(row => row.id);
}

function buildWhatsNew({ cwd = ROOT, worktree = false, now = new Date(), windowDays = WINDOW_DAYS } = {}) {
    if (git(['rev-parse', '--is-shallow-repository'], { cwd }).trim() === 'true') {
        throw new Error('Shallow clone: fetch full history (git fetch --unshallow) before building whats_new.json');
    }

    const candidates = [];
    if (worktree) {
        const text = fs.readFileSync(path.join(cwd, CATALOG), 'utf8');
        if (git(['hash-object', CATALOG], { cwd }).trim() !== git(['rev-parse', `HEAD:${CATALOG}`], { cwd }).trim()) {
            candidates.push({ commit: 'worktree', date: now.toISOString(), load: () => parseCatalog(text), parent: 'HEAD' });
        }
    }
    const log = git(['log', '--first-parent', '--format=%H %cI', 'HEAD', '--', CATALOG], { cwd })
        .trim().split('\n').filter(Boolean);
    for (const line of log) {
        const [commit, date] = line.split(' ');
        candidates.push({ commit, date, load: () => catalogAt(commit, cwd), parent: `${commit}^` });
    }

    const batches = [];
    const claimed = new Set();
    let newest = 0;
    for (const candidate of candidates) {
        const time = Date.parse(candidate.date);
        if (newest && time < newest - windowDays * DAY_MS) break;
        let previous;
        try {
            previous = catalogAt(candidate.parent, cwd);
        } catch {
            continue; // The commit that created the catalog adds nothing "new".
        }
        // Newest first, so a song removed and re-added keeps its latest date.
        const ids = addedRows(candidate.load(), previous).filter(id => !claimed.has(id));
        if (!ids.length) continue;
        ids.forEach(id => claimed.add(id));
        if (!newest) newest = time;
        batches.push({
            date: candidate.date.slice(0, 10),
            commit: candidate.commit === 'worktree' ? 'worktree' : candidate.commit.slice(0, 12),
            ids,
        });
    }

    // Drop rows that later left the catalog; the app ignores unknown ids anyway.
    const present = new Set(parseCatalog(fs.readFileSync(path.join(cwd, CATALOG), 'utf8')).map(appIdentity));
    for (const batch of batches) batch.ids = batch.ids.filter(id => present.has(id));

    return {
        about: 'Songs the venue sync added recently. Built by scripts/build-whats-new.js from the catalog\'s Git history; popularity is ranked in the app.',
        windowDays,
        batches: batches.filter(batch => batch.ids.length),
    };
}

function serialize(data) {
    return `${JSON.stringify(data, null, 1)}\n`;
}

if (require.main === module) {
    const args = new Set(process.argv.slice(2));
    const data = buildWhatsNew({ worktree: args.has('--worktree') });
    const text = serialize(data);
    const total = data.batches.reduce((sum, batch) => sum + batch.ids.length, 0);
    if (args.has('--check')) {
        const existing = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, 'utf8') : '';
        if (existing !== text) {
            console.error('whats_new.json is out of date: run node scripts/build-whats-new.js');
            process.exit(1);
        }
        console.log(`whats_new.json is current (${total} songs in ${data.batches.length} batches)`);
    } else {
        fs.writeFileSync(OUTPUT, text);
        console.log(`Wrote whats_new.json: ${total} songs in ${data.batches.length} batches`);
        for (const batch of data.batches) console.log(`  ${batch.date} ${batch.commit}: ${batch.ids.length}`);
    }
}

module.exports = { buildWhatsNew, addedRows, serialize, WINDOW_DAYS };
