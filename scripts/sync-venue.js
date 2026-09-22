#!/usr/bin/env node
// Public venue API importer. Dry run by default; raw responses stay out of Git.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { identity: metadataIdentity, atomicJson } = require('./lib/music-metadata');

const SOURCE = 'https://karaoke-search.onrender.com';
const QUERIES = [...'abcdefghijklmnopqrstuvwxyz0123456789', '&', '-', '.', "'", '#'];
const INTERVAL = 1500;
const RETRY_DELAYS = [15000, 30000, 60000]; // Allow the Render service to wake.
const normalize = value => String(value ?? '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const clean = value => String(value ?? '').replace(/\bwvocals?\b/gi, ' ')
    .replace(/\bw\s*\/?\s*vocals?\b/gi, ' ').replace(/[\[(]\s*karaoke\s*[\])]/gi, ' ')
    .replace(/\bkaraoke\b/gi, ' ').replace(/\s+/g, ' ').trim();
const artistKey = value => normalize(clean(value).replace(/[’'!?.]/g, ''));
// Earlier catalog repairs moved the venue's Christmas category prefix out of
// artist names. Treat that source label as an alias, not a new performer.
const sourceArtistNames = value => {
    const raw = String(value ?? '');
    return [...new Set([raw, raw.replace(/^christmas\s*-\s*/i, '')])];
};

// Keep in step with getSongIdentity in the app; test-sync-venue checks parity
// against the real frontend functions and every catalog row.
function appIdentity(song) {
    return [artistKey(clean(song.lookupArtist) || clean(song.artist)) || normalize(song.artist),
        normalize(song.lookupSong || song.song), normalize(song.song)].filter(Boolean).join('\u001f');
}

function pairKeys(song) {
    const artists = new Set([song.artist, song.lookupArtist].filter(value => value !== undefined)
        .flatMap(sourceArtistNames).map(artistKey));
    const titles = new Set([song.song, song.lookupSong].filter(Boolean).map(normalize));
    return [...artists].flatMap(artist => [...titles].map(title => JSON.stringify([artist, title])));
}

function parseResponse(data) {
    // Suggestions are not catalog results and must never become song entries.
    if (data && !Array.isArray(data) && typeof data === 'object' &&
        (Array.isArray(data.suggestions) || typeof data.suggestion === 'string') &&
        Object.keys(data).every(key => ['suggestions', 'suggestion'].includes(key))) return [];
    if (!Array.isArray(data)) throw new Error('Unexpected venue response; catalog left unchanged');
    return data.map(row => {
        if (!row || !['string', 'number'].includes(typeof row.Artist) ||
            !['string', 'number'].includes(typeof row.Song)) throw new Error('Invalid venue song row');
        const artist = String(row.Artist).trim(), song = String(row.Song).trim();
        if (!song || song.length > 1000 || artist.length > 1000 || /[\u0000-\u001f]/.test(artist + song)) {
            throw new Error('Invalid venue song text');
        }
        return { artist, song };
    });
}

async function fetchVenueSongs({ fetchImpl = fetch, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), queries = QUERIES } = {}) {
    const rows = new Map();
    let requests = 0;
    for (const query of queries) {
        const url = new URL('/search', SOURCE);
        url.search = new URLSearchParams({ query, filter: '' });
        let data;
        for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
            if (requests) await wait(attempt ? RETRY_DELAYS[attempt - 1] : INTERVAL);
            requests++;
            let response;
            try {
                response = await fetchImpl(url, { headers: { Accept: 'application/json',
                    'User-Agent': 'KaraokeSearchWeeklySync/1.0 (https://karaokesearch.uk)' },
                redirect: 'error', signal: AbortSignal.timeout(60000) });
            } catch {
                if (attempt < RETRY_DELAYS.length) continue;
                throw new Error('Venue unavailable after four attempts; catalog left unchanged');
            }
            if (response.status === 429) throw new Error('Venue rate limit reached; stop until a later run');
            if (response.status >= 500 && attempt < RETRY_DELAYS.length) { await response.body?.cancel(); continue; }
            if (!response.ok) throw new Error(`Venue returned HTTP ${response.status} for query ${JSON.stringify(query)}; catalog left unchanged`);
            data = parseResponse(await response.json());
            break;
        }
        for (const row of data) rows.set(JSON.stringify([row.artist, row.song]), row);
    }
    return { rows: [...rows.values()], requests, queries: [...queries] };
}

function planSync(songs, rows, { minCoverage = 0.95, maxAdditions = 500 } = {}) {
    const known = new Map(), ids = new Map(), aliases = new Map();
    for (const [index, song] of songs.entries()) {
        const id = appIdentity(song);
        if (!ids.has(id)) ids.set(id, new Set());
        ids.get(id).add(index);
        for (const key of pairKeys(song)) {
            if (!known.has(key)) known.set(key, new Set());
            known.get(key).add(index);
        }
        for (const name of sourceArtistNames(song.artist)) {
            const key = artistKey(name);
            if (!aliases.has(key)) aliases.set(key, new Map());
            if (song.lookupArtist) aliases.get(key).set(artistKey(song.lookupArtist), clean(song.lookupArtist));
        }
    }
    const matched = new Set(), additions = [], skipped = [];
    // Sort new rows so server ordering never changes the resulting patch.
    const ordered = [...rows].sort((a, b) => a.artist.localeCompare(b.artist, 'en') || a.song.localeCompare(b.song, 'en'));
    for (const row of ordered) {
        const keys = pairKeys(row);
        let exists = false;
        for (const key of keys) {
            if (!known.has(key)) continue;
            exists = true;
            for (const index of known.get(key)) matched.add(index);
        }
        if (exists) continue;
        const sourceArtist = sourceArtistNames(row.artist).at(-1);
        const names = aliases.get(artistKey(sourceArtist));
        const lookupArtist = names?.size === 1 ? [...names.values()][0] : clean(sourceArtist);
        const candidate = { artist: row.artist, song: row.song, lookupArtist,
            status: 'pending', confidence: 0, genres: [], moods: [], eras: [], flags: [], tags: [] };
        const id = appIdentity(candidate);
        if (!normalize(row.song) || !id) throw new Error('A new song cannot be represented by the app identity rules');
        if (ids.has(id)) {
            for (const index of ids.get(id)) matched.add(index);
            skipped.push(row); continue;
        }
        ids.set(id, new Set());
        additions.push(candidate);
        // Alias variants within this same fetch must also collapse.
        for (const key of pairKeys(candidate)) if (!known.has(key)) known.set(key, new Set());
    }
    const coverage = matched.size / songs.length;
    if (!songs.length || !rows.length || coverage < minCoverage) {
        throw new Error(`Incomplete venue results (${matched.size}/${songs.length} existing rows matched); catalog left unchanged`);
    }
    if (additions.length > maxAdditions) throw new Error(`Unusually large update (${additions.length} additions); review before importing`);
    return { additions, skipped, coverage, matched: matched.size,
        missing: songs.filter((song, index) => !matched.has(index)).map(song => ({ artist: song.artist, song: song.song })) };
}

function refreshSummaries(root, songs) {
    for (const name of ['audio_enrichment.json', 'era_enrichment.json']) {
        const file = path.join(root, name);
        if (!fs.existsSync(file)) continue;
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        data.summary.total = songs.length;
        const covered = new Set(data.entries.map(metadataIdentity));
        if (name === 'audio_enrichment.json') {
            data.summary.uniqueEntries = covered.size;
            data.summary.matchedRows = songs.filter(song => covered.has(metadataIdentity(song))).length;
        } else {
            data.summary.before = songs.filter(song => song.eras?.length).length;
            data.summary.added = songs.filter(song => !song.eras?.length && covered.has(metadataIdentity(song))).length;
            data.summary.after = data.summary.before + data.summary.added;
        }
        // Enrichment timestamps/evidence remain untouched: no new metadata lookup occurred.
        atomicJson(file, data);
    }
}

async function syncVenue({ root = path.join(__dirname, '..'), write = false, fetchOptions } = {}) {
    const cacheDir = path.join(root, 'metadata_cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    const lockPath = path.join(cacheDir, 'venue-sync.lock');
    const lock = fs.openSync(lockPath, 'wx');
    try {
        const catalogPath = path.join(root, 'karaoke_songs_enriched.json');
        const original = fs.readFileSync(catalogPath, 'utf8');
        const songs = JSON.parse(original);
        const fetched = await fetchVenueSongs(fetchOptions);
        const plan = planSync(songs, fetched.rows);
        const report = { source: SOURCE, checkedAt: new Date().toISOString(), write,
            requests: fetched.requests, queries: fetched.queries, venueRows: fetched.rows.length,
            before: songs.length, added: plan.additions.length, after: songs.length + plan.additions.length,
            coverage: plan.coverage, additions: plan.additions, missing: plan.missing, identityCollisionsSkipped: plan.skipped };
        atomicJson(path.join(cacheDir, 'venue-sync-report.json'), report);
        if (write && plan.additions.length) {
            const files = ['karaoke_songs_enriched.json', 'audio_enrichment.json', 'era_enrichment.json',
                'karaoke_explorer.js', 'karaoke_explorer.html', 'manifest.json', 'sw.js'];
            const backups = new Map(files.filter(name => fs.existsSync(path.join(root, name)))
                .map(name => [name, fs.readFileSync(path.join(root, name))]));
            if (fs.readFileSync(catalogPath, 'utf8') !== original) throw new Error('Catalog changed during sync; retry on a clean checkout');
            try {
                // Append without reserializing existing rows or changing any saved identities.
                const end = original.lastIndexOf(']');
                const updated = original.slice(0, end).trimEnd() + ',' +
                    plan.additions.map(song => JSON.stringify(song)).join(',') + original.slice(end);
                fs.writeFileSync(`${catalogPath}.tmp`, updated);
                fs.renameSync(`${catalogPath}.tmp`, catalogPath);
                refreshSummaries(root, [...songs, ...plan.additions]);
                for (const script of ['bump-version.js', 'check-versions.js', 'check-era-enrichment.js', 'check-audio-enrichment.js']) {
                    if (script === 'check-audio-enrichment.js' && !fs.existsSync(path.join(root, 'audio_enrichment.json'))) continue;
                    execFileSync(process.execPath, [path.join(root, 'scripts', script)], { cwd: root, stdio: 'pipe' });
                }
            } catch (error) {
                for (const [name, content] of backups) fs.writeFileSync(path.join(root, name), content);
                throw error;
            }
        }
        if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `added=${report.added}\n`);
        if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
            `### Venue songbook sync\n\n${report.venueRows} venue listings checked in ${report.requests} requests. ` +
            `${report.added} new songs ${write ? 'added' : 'found (dry run)'}. ${report.missing.length} existing rows absent from the search results; none removed.\n`);
        console.log(JSON.stringify({ ...report, additions: undefined, missing: report.missing.length,
            identityCollisionsSkipped: report.identityCollisionsSkipped.length }));
        return report;
    } finally { fs.closeSync(lock); fs.unlinkSync(lockPath); }
}

if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.some(arg => arg !== '--write')) { console.error('Usage: node scripts/sync-venue.js [--write]'); process.exitCode = 1; }
    else syncVenue({ write: args.includes('--write') }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { appIdentity, parseResponse, fetchVenueSongs, planSync, syncVenue };
