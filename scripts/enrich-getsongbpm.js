#!/usr/bin/env node
// Offline maintenance only. Never expose GETSONGBPM_API_KEY to browser code.
// node --env-file=.env.local scripts/enrich-getsongbpm.js [maximum requests=100]
const fs = require('node:fs');
const path = require('node:path');
const { normalize, fields, identity, catalogGroups, atomicJson } = require('./lib/music-metadata');
const root = path.join(__dirname, '..');
const API = 'https://api.getsong.co/search/';
const INTERVAL = 1500; // At most 2,400 requests/hour from this importer.
const validKey = (value) => typeof value === 'string' && /^[A-G](?:#|b|♯|♭)?m?$/.test(value) ? value : null;
const number = (value, min, max) => ['number', 'string'].includes(typeof value) && String(value).trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max ? Number(value) : null;
function matchResult(result, group) {
    if (!Array.isArray(result.search)) throw new Error('Invalid search response');
    // A full result page may omit conflicting versions; do not infer consensus.
    if (result.search.length >= 100) return { status: 'ambiguous' };
    const exact = result.search.filter((song) => normalize(song.title) === normalize(group.title) && normalize(song.artist?.name) === normalize(group.artist));
    if (!exact.length) return { status: 'unmatched' };
    const consensus = (get) => {
        const values = exact.map(get);
        return values.every((value) => value !== null && value === values[0]) ? values[0] : null;
    };
    const bpm = consensus((song) => number(song.tempo, 20, 400));
    const referenceKey = consensus((song) => validKey(song.key_of));
    if (bpm === null && referenceKey === null) return { status: 'ambiguous' };
    const records = exact.map((song) => ({ id: String(song.id || ''), title: song.title, artist: song.artist.name,
        url: typeof song.uri === 'string' && /^https:\/\/getsongbpm\.com\/song\//.test(song.uri) ? song.uri : null }));
    if (records.some((song) => !song.id || !song.url)) return { status: 'ambiguous' };
    return { status: 'matched', metadata: {
        bpm, referenceKey,
        timeSignature: consensus((song) => typeof song.time_sig === 'string' && /^\d{1,2}\/\d{1,2}$/.test(song.time_sig) ? song.time_sig : null),
        danceability: consensus((song) => number(song.danceability, 0, 100)),
        acousticness: consensus((song) => number(song.acousticness, 0, 100)),
        source: { type: 'getsongbpm', confidence: 'exact-name-consensus', records },
    } };
}
async function main() {
    const limit = Number(process.argv[2] || 100);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('Choose 1–1000 requests per batch');
    const apiKey = process.env.GETSONGBPM_API_KEY;
    if (!apiKey) throw new Error('Set GETSONGBPM_API_KEY in an ignored .env.local file, then use node --env-file=.env.local');
    const songs = JSON.parse(fs.readFileSync(path.join(root, 'karaoke_songs_enriched.json')));
    const groups = catalogGroups(songs);
    const cacheDir = path.join(root, 'metadata_cache'); fs.mkdirSync(cacheDir, { recursive: true });
    const checkpointPath = path.join(cacheDir, 'getsongbpm-progress.json');
    const lockPath = path.join(cacheDir, 'getsongbpm.lock');
    let lock;
    try { lock = fs.openSync(lockPath, 'wx'); }
    catch { throw new Error('Another importer may be running. Remove metadata_cache/getsongbpm.lock only after confirming it has stopped.'); }
    try {
        let checkpoint = { results: {}, lastRequestAt: 0 };
        if (fs.existsSync(checkpointPath)) checkpoint = JSON.parse(fs.readFileSync(checkpointPath));
        if (!checkpoint.results || typeof checkpoint.results !== 'object' || Array.isArray(checkpoint.results)) throw new Error('Invalid checkpoint; preserve it and inspect before retrying');
        let requests = 0, failures = 0, stoppedReason = null;
        for (const group of groups) {
            if (checkpoint.results[group.key]) continue;
            if (requests >= limit) break;
            const delay = Math.max(0, INTERVAL - (Date.now() - (checkpoint.lastRequestAt || 0)), failures * 5000);
            if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
            const url = new URL(API);
            url.search = new URLSearchParams({ type: 'both', lookup: `song:${group.title} artist:${group.artist}`, limit: '100' });
            checkpoint.lastRequestAt = Date.now(); atomicJson(checkpointPath, checkpoint); requests++;
            try {
                const response = await fetch(url, { headers: { 'X-API-KEY': apiKey, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(20000) });
                if ([401, 403, 429].includes(response.status)) { stoppedReason = `HTTP ${response.status}; check activation or quota before retrying`; break; }
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const result = await response.json();
                if (result.error) { stoppedReason = 'API returned an error; check activation and quota'; break; }
                checkpoint.results[group.key] = { ...matchResult(result, group), checkedAt: new Date().toISOString() };
                atomicJson(checkpointPath, checkpoint); failures = 0;
            } catch {
                // Never log provider bodies or headers: they could echo the API key.
                failures++;
                if (failures >= 3) { stoppedReason = 'Three service/network failures; progress saved'; break; }
            }
        }
        const entries = [];
        for (const group of groups) {
            const result = checkpoint.results[group.key];
            if (result?.status !== 'matched') continue;
            for (const song of group.songs) entries.push({ ...fields(song), ...result.metadata,
                source: { ...result.metadata.source, checkedAt: result.checkedAt.slice(0, 10) } });
        }
        const outputPath = path.join(root, 'audio_enrichment.json');
        const existing = fs.existsSync(outputPath) ? JSON.parse(fs.readFileSync(outputPath)).entries : [];
        const catalogIds = new Set(songs.map(identity));
        const unique = [...new Map([...existing, ...entries].filter((entry) => catalogIds.has(identity(entry))).map((entry) => [identity(entry), entry])).values()];
        const coveredIds = new Set(unique.map(identity));
        const matchedRows = songs.filter((song) => coveredIds.has(identity(song))).length;
        const output = { schemaVersion: 1, generatedAt: new Date().toISOString(), summary: { total: songs.length, matchedRows, uniqueEntries: unique.length, searched: Object.keys(checkpoint.results).length, queryGroups: groups.length }, entries: unique };
        atomicJson(outputPath, output);
        console.log(JSON.stringify({ requests, ...output.summary, stoppedReason }));
    } finally { fs.closeSync(lock); fs.unlinkSync(lockPath); }
}
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { matchResult };
