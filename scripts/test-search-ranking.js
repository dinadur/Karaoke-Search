#!/usr/bin/env node
// Fast Node unit tests for search-ranking.js: normalization, relevance
// tie-breaking, cross-field queries, fuzzy matching, highlighting, and
// real-catalog karaoke benchmark queries.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
    normalize,
    normalizeSearchText,
    rankSongs,
    sortSongs,
    getHighlightRanges,
    boundedEditDistance,
    getFuzzyTokenScore,
} = require("../search-ranking.js");

const makeSong = (artist, song, popularity = 0, extra = {}) => {
    const displayArtist = extra.displayArtist || artist;
    const songSearchText = normalizeSearchText(song);
    const displaySongSearchText = normalizeSearchText(extra.displaySong || song);
    const artistSearchText = normalizeSearchText(`${displayArtist} ${artist}`);
    const displayArtistSearchText = normalizeSearchText(displayArtist);
    return {
        artist,
        song,
        displayArtist,
        popularity,
        songSearchText,
        displaySongSearchText,
        artistSearchText,
        displayArtistSearchText,
        allSearchText: `${songSearchText} ${artistSearchText}`,
        songSortText: normalize(song),
        artistSortText: normalize(displayArtist),
        ...extra,
    };
};

// 1. Normalization & diacritic/punctuation folding
assert.equal(normalize("Über"), "uber");
assert.equal(normalize("Simon & Garfunkel"), "simon and garfunkel");
assert.equal(normalizeSearchText("Don't Stop Believin'"), "dont stop believin");
assert.equal(normalizeSearchText("AC/DC"), "acdc");
assert.equal(normalizeSearchText("R.E.M."), "rem");

// 2. Relevance tie-breaking: exact artist vs exact title broken by popularity
{
    const obscureExactTitle = makeSong("Loren Gray", "Queen", 12000);
    const queenHit = makeSong("Queen", "Bohemian Rhapsody", 950000);
    const queenMinor = makeSong("Queen", "Flash", 40000);
    const partial = makeSong("ABBA", "Dancing Queen", 900000);
    const ranked = rankSongs([obscureExactTitle, partial, queenMinor, queenHit], "queen", { scope: "all" });
    assert.equal(ranked[0].song, "Bohemian Rhapsody", "Popular exact-artist hit should outrank low-popularity exact title");
    assert.equal(ranked[1].song, "Flash");
    assert.equal(ranked[2].song, "Queen");
    assert.equal(ranked[3].song, "Dancing Queen");
}

// 3. Display title exact match (karaoke suffix stripped)
{
    const exactWithNoise = makeSong("Queen", "Bohemian Rhapsody [Karaoke]", 500000, { displaySong: "Bohemian Rhapsody" });
    const longerTitle = makeSong("Queen", "Bohemian Rhapsody Live 1985", 600000);
    const ranked = rankSongs([longerTitle, exactWithNoise], "bohemian rhapsody", { scope: "all" });
    assert.equal(ranked[0].song, "Bohemian Rhapsody [Karaoke]");
}

// 4. Cross-field multi-token queries ("adele hello") beat single-field substring matches
{
    const intended = makeSong("Adele", "Hello", 500000);
    const titleOnly = makeSong("Other Artist", "Adele Hello Tribute", 800000);
    const ranked = rankSongs([titleOnly, intended], "adele hello", { scope: "all" });
    assert.equal(ranked[0].artist, "Adele");
}

// 5. Fuzzy matching & edit distance
assert.equal(boundedEditDistance("rhapsody", "rapsody", 2), 1);
assert.ok(getFuzzyTokenScore("bohemien", ["bohemian", "rhapsody"]) > 0);
{
    const songs = [makeSong("Queen", "Bohemian Rhapsody", 950000)];
    assert.equal(rankSongs(songs, "bohemien rapsody", { scope: "all", fuzzy: false }).length, 0);
    assert.equal(rankSongs(songs, "bohemien rapsody", { scope: "all", fuzzy: true }).length, 1);
}

// 6. Highlighting across punctuation & accents
{
    const ranges = getHighlightRanges("Don't Stop Believin'", ["dont"]);
    assert.deepEqual(ranges, [[0, 5]]);
    const accentRanges = getHighlightRanges("Déjà Vu", ["deja"]);
    assert.deepEqual(accentRanges, [[0, 4]]);
}

// 7. Sort helper
{
    const a = makeSong("Beta", "Alpha", 100);
    const b = makeSong("Alpha", "Beta", 500);
    assert.equal(sortSongs([a, b], "popular")[0].popularity, 500);
    assert.equal(sortSongs([a, b], "artist")[0].artist, "Alpha");
    assert.equal(sortSongs([a, b], "song")[0].song, "Alpha");
}

// 8. Real catalog karaoke relevance spot-checks
{
    const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "karaoke_songs_enriched.json"), "utf8"));
    const prepared = catalog.map((song) => {
        const displayArtist = song.lookupArtist || song.artist || "";
        const displaySong = song.lookupSong || song.song || "";
        const songSearchText = normalizeSearchText(song.song);
        const displaySongSearchText = normalizeSearchText(displaySong);
        const artistSearchText = normalizeSearchText(`${displayArtist} ${song.artist || ""} ${song.lookupArtist || ""}`);
        const displayArtistSearchText = normalizeSearchText(displayArtist);
        return {
            ...song,
            displayArtist,
            songSearchText,
            displaySongSearchText,
            artistSearchText,
            displayArtistSearchText,
            allSearchText: `${songSearchText} ${artistSearchText}`,
            songSortText: normalize(song.song),
            artistSortText: normalize(displayArtist),
        };
    });

    const queenTop = rankSongs(prepared, "queen", { scope: "all" }).slice(0, 3);
    assert.ok(queenTop.length >= 3, "queen query returns results");
    assert.equal(normalize(queenTop[0].displayArtist), "queen", `Expected Queen at #1 for "queen", got ${queenTop[0].displayArtist} - ${queenTop[0].song}`);

    const bohemianTop = rankSongs(prepared, "bohemian rhapsody", { scope: "all" });
    assert.ok(bohemianTop.length > 0);
    assert.match(normalizeSearchText(bohemianTop[0].song), /bohemian rhapsody/);

    const adeleHello = rankSongs(prepared, "adele hello", { scope: "all" });
    assert.ok(adeleHello.length > 0);
    assert.equal(normalize(adeleHello[0].displayArtist), "adele");
    assert.match(normalizeSearchText(adeleHello[0].song), /\bhello\b/);

    const mrBrightside = rankSongs(prepared, "mr brightside", { scope: "all" });
    assert.ok(mrBrightside.length > 0);
    assert.match(normalizeSearchText(mrBrightside[0].song), /mr brightside/);
}

console.log("ok   search-ranking unit & real-catalog relevance checks passed");
