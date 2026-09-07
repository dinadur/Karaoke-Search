const fs = require('node:fs');
const normalize = (value) => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const fields = (song) => ({ artist: song.artist, song: song.song, lookupArtist: song.lookupArtist || '', lookupSong: song.lookupSong || '' });
const identity = (song) => JSON.stringify(fields(song));
function catalogGroups(songs) {
    const cleanArtist = (song) => String(song.lookupArtist || song.artist || '').replace(/\bwvocals?\b|\bw\s*\/?\s*vocals?\b|\bkaraoke\b/gi, ' ').replace(/\(\s*\)|\[\s*\]/g, '').trim();
    const known = new Set(songs.map((song) => normalize(cleanArtist(song))));
    const groups = new Map();
    for (const song of [...songs].sort((a, b) => (b.popularity || 0) - (a.popularity || 0))) {
        let artist = cleanArtist(song);
        const parts = artist.split(',');
        if (parts.length === 2 && known.has(normalize(`${parts[1]} ${parts[0]}`))) artist = `${parts[1].trim()} ${parts[0].trim()}`;
        const title = String(song.lookupSong || song.song || '').replace(/[\[(][^\])]*\b(karaoke|instrumental|backing track|multiplex)\b[^\])]*[\])]/gi, ' ').replace(/[-\s]+\b(?:sf|sbi|sb|mm|hmx|sc|sm)\d{3,6}\b/gi, ' ').trim();
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
module.exports = { normalize, fields, identity, catalogGroups, atomicJson };
