const fs = require('node:fs');
const normalize = (value) => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const fields = (song) => ({ artist: song.artist, song: song.song, lookupArtist: song.lookupArtist || '', lookupSong: song.lookupSong || '' });
const identity = (song) => JSON.stringify(fields(song));
const stripArtistNoise = (song) => String(song.lookupArtist || song.artist || '').replace(/\bwvocals?\b|\bw\s*\/?\s*vocals?\b|\bkaraoke\b/gi, ' ').replace(/\(\s*\)|\[\s*\]/g, '').replace(/\s+/g, ' ').trim();
function normalizeArtistName(rawArtist, known) {
    let artist = rawArtist;
    const collab = artist.match(/^([^,&]+,\s*[^,&]+?)\s*(&|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b)\s*(.+)$/i);
    if (collab) {
        const parts = collab[1].split(',');
        if (parts.length === 2) {
            const flipped = `${parts[1].trim()} ${parts[0].trim()}`;
            if (known.has(normalize(flipped))) artist = `${flipped} ${collab[2]} ${collab[3].trim()}`;
        }
        return artist;
    }
    const parts = artist.split(',');
    if (parts.length === 2 && known.has(normalize(`${parts[1]} ${parts[0]}`))) artist = `${parts[1].trim()} ${parts[0].trim()}`;
    return artist;
}
function cleanTitleForLookup(song) {
    return String(song.lookupSong || song.song || '')
        .replace(/[\[(][^\])]*\b(karaoke|instrumental|backing track|multiplex)\b[^\])]*[\])]/gi, ' ')
        .replace(/[\[(][^\])]*(?:karaok|instru|backing|multiplex|vocal|sf\d|sbi\d)[^\])]*$/gi, ' ')
        .replace(/[\[(]\s*k?$/gi, ' ')
        .replace(/[-\s]+\b(?:sf|sbi|sb|mm|hmx|sc|sm)\d{3,6}\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function catalogGroups(songs) {
    const known = new Set(songs.map((song) => normalize(stripArtistNoise(song))));
    const groups = new Map();
    for (const song of [...songs].sort((a, b) => (b.popularity || 0) - (a.popularity || 0))) {
        const artist = normalizeArtistName(stripArtistNoise(song), known);
        const title = cleanTitleForLookup(song);
        if (!normalize(artist) || !normalize(title)) continue;
        const key = `${normalize(artist)}\u001f${normalize(title)}`;
        const group = groups.get(key) || { key, artist, title, songs: [] };
        group.songs.push(song); groups.set(key, group);
    }
    return [...groups.values()];
}
function atomicJson(filename, data) {
    fs.writeFileSync(`${filename}.tmp`, JSON.stringify(data, null, 2) + '\n');
    fs.renameSync(`${filename}.tmp`, filename);
}
module.exports = { normalize, fields, identity, stripArtistNoise, normalizeArtistName, cleanTitleForLookup, catalogGroups, atomicJson };
