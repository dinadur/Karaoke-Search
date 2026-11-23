// Tags newly imported venue rows only. Last.fm track tags first, MusicBrainz
// artist tags as the fallback. Rows with no match stay `pending`. Existing
// catalog rows are never passed in, so their data and identities are untouched.
const UA = 'KaraokeSearch/1.0 (https://karaokesearch.uk)';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const SPLIT = /\s+(?:feat\.?|ft\.?|featuring|&|and|with|x|vs\.?)\s+|\s*\/\s*/i;
const primaryArtist = name => String(name).split(SPLIT)[0].trim();
const yearLike = tag => String(tag).match(/^(19|20)(\d)\d?s?$/);
function eraOf(tag) {
    const m = String(tag).match(/^(?:(19|20)(\d)\d)s?$/);
    if (!m) return null;
    const decade = Number(m[1] + m[2] + '0');
    return decade < 2000 ? `${String(decade).slice(2)}s` : `${decade}s`;
}

async function requestJson(fetchImpl, url, { wait, delays = [0, 5000, 15000], interval }) {
    for (const delay of delays) {
        if (delay) await wait(delay);
        await wait(interval);
        let response;
        try {
            response = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'application/json' },
                signal: AbortSignal.timeout(20000) });
        } catch { continue; }
        if (response.status === 429 || response.status >= 500) { await response.body?.cancel?.(); continue; }
        if (!response.ok) return { failed: true };
        try { return { data: await response.json() }; } catch { return { failed: true }; }
    }
    return { failed: true };
}

async function lastfmTags(artist, track, { key, fetchImpl, wait }) {
    const url = new URL('https://ws.audioscrobbler.com/2.0/');
    url.search = new URLSearchParams({ method: 'track.gettoptags', artist, track, autocorrect: '1', api_key: key, format: 'json' });
    const { data } = await requestJson(fetchImpl, url, { wait, interval: 250, delays: [0, 3000, 10000] });
    if (!data || data.error) return [];
    return (data.toptags?.tag || []).filter(tag => Number(tag.count) >= 10).map(tag => String(tag.name).toLowerCase());
}

async function musicbrainzTags(artist, { fetchImpl, wait }) {
    const url = new URL('https://musicbrainz.org/ws/2/artist');
    url.search = new URLSearchParams({ query: `artist:"${artist.replace(/["\\]/g, ' ')}"`, fmt: 'json', limit: '3' });
    const { data } = await requestJson(fetchImpl, url, { wait, interval: 1100 });
    const match = (data?.artists || []).find(candidate => (candidate.score ?? 0) >= 90);
    return match ? (match.tags || []).sort((a, b) => (b.count || 0) - (a.count || 0)).map(tag => String(tag.name)) : [];
}

function applyTags(row, tags, source) {
    row.eras = [...new Set(tags.map(eraOf).filter(Boolean))];
    row.tags = tags.filter(tag => !yearLike(tag)).slice(0, 10);
    row.status = 'ok';
    row.confidence = 0.5;
    row.enrichSource = source;
}

// Mutates `rows` (new additions only). Returns counts by source.
async function enrichNewRows(rows, { lastfmKey = process.env.LASTFM_API_KEY, fetchImpl = fetch, wait = sleep, log = () => {} } = {}) {
    const counts = { 'lastfm-track': 0, 'mb-artist': 0, pending: 0, lastfmSkipped: !lastfmKey };
    const artistCache = new Map();
    for (const [index, row] of rows.entries()) {
        const artist = row.lookupArtist || row.artist, track = row.lookupSong || row.song;
        let tags = [];
        if (lastfmKey) {
            tags = await lastfmTags(artist, track, { key: lastfmKey, fetchImpl, wait });
            if (!tags.length && primaryArtist(artist) !== artist) tags = await lastfmTags(primaryArtist(artist), track, { key: lastfmKey, fetchImpl, wait });
            if (tags.length) { applyTags(row, tags, 'lastfm-track'); counts['lastfm-track']++; continue; }
        }
        for (const name of [...new Set([artist, primaryArtist(artist)])]) {
            if (!artistCache.has(name)) artistCache.set(name, await musicbrainzTags(name, { fetchImpl, wait }));
            tags = artistCache.get(name);
            if (tags.length) break;
        }
        if (tags.length) { applyTags(row, tags, 'mb-artist'); counts['mb-artist']++; } else counts.pending++;
        if ((index + 1) % 100 === 0) log(`enriched ${index + 1}/${rows.length}`);
    }
    return counts;
}

module.exports = { enrichNewRows, eraOf, primaryArtist };
