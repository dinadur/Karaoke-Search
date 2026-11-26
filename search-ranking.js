// Search normalization, scoring, fuzzy matching, sorting, and match highlighting.
// Loaded before filters-panel.js and karaoke_explorer.js; no side effects on parse.
// Also exports pure functions for Node unit testing when module.exports exists.

const NORMALIZE_CACHE = new Map();
const SEARCH_NORMALIZE_CACHE = new Map();

function normalize(value) {
    const raw = String(value || "");
    const cached = NORMALIZE_CACHE.get(raw);
    if (cached !== undefined) {
        return cached;
    }

    const folded = /[^\x00-\x7f]/.test(raw)
        ? raw.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        : raw.toLowerCase();
    const result = folded
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    if (NORMALIZE_CACHE.size < 300000) {
        NORMALIZE_CACHE.set(raw, result);
    }

    return result;
}

// Search-only variant of normalize() that folds apostrophes and intra-word
// dots/slashes ("Don't" -> "dont", "It's" -> "its", "AC/DC" -> "acdc",
// "R.E.M." -> "rem") without altering content-derived song identities.
function normalizeSearchText(value) {
    const raw = String(value || "");
    const cached = SEARCH_NORMALIZE_CACHE.get(raw);
    if (cached !== undefined) {
        return cached;
    }

    const folded = /[^\x00-\x7f]/.test(raw)
        ? raw.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        : raw.toLowerCase();
    const result = folded
        .replace(/['\u2018\u2019\u02bc]/g, "")
        .replace(/([a-z0-9])[./](?=[a-z0-9])/g, "$1")
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    if (SEARCH_NORMALIZE_CACHE.size < 300000) {
        SEARCH_NORMALIZE_CACHE.set(raw, result);
    }

    return result;
}

function getBrowseLetterFromNormalized(normalized) {
    if (!normalized) {
        return "#";
    }

    const first = normalized[0].toUpperCase();
    return first >= "A" && first <= "Z" ? first : "#";
}

function getBrowseLetter(value) {
    return getBrowseLetterFromNormalized(normalize(value));
}

function compareText(a, b) {
    return String(a || "").localeCompare(String(b || ""), undefined, { sensitivity: "base" });
}

function compareSortKey(a, b) {
    const left = String(a || "");
    const right = String(b || "");
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
}

function getRankingDisplayArtist(song) {
    if (typeof getDisplayArtist === "function") {
        return getDisplayArtist(song);
    }
    return song.displayArtist || song.lookupArtist || song.artist || "";
}

function compareArtistSort(a, b) {
    return compareSortKey(
        a.artistSortText || normalize(getRankingDisplayArtist(a)),
        b.artistSortText || normalize(getRankingDisplayArtist(b))
    );
}

function compareSongSort(a, b) {
    return compareSortKey(
        a.songSortText || normalize(a.song),
        b.songSortText || normalize(b.song)
    );
}

function compareDecade(a, b) {
    const aYear = Number(String(a).match(/\d+/)?.[0] || 0);
    const bYear = Number(String(b).match(/\d+/)?.[0] || 0);

    return aYear - bYear || compareText(a, b);
}

function getScopedSearchText(song, scope = (typeof state !== "undefined" ? state.searchScope : "all")) {
    if (scope === "artist") {
        return song.artistSearchText || normalizeSearchText([
            getRankingDisplayArtist(song),
            song.artist,
            song.lookupArtist,
        ].join(" "));
    }

    if (scope === "song") {
        return song.songSearchText || normalizeSearchText(song.song);
    }

    return song.allSearchText || `${song.songSearchText || normalizeSearchText(song.song)} ${song.artistSearchText || normalizeSearchText(getRankingDisplayArtist(song))}`;
}

function getScopedSearchWords(song, scope = (typeof state !== "undefined" ? state.searchScope : "all")) {
    if (scope === "artist") {
        if (!song.artistWords) {
            song.artistWords = getSearchWordsFromNormalized(
                song.artistSearchText || normalizeSearchText([getRankingDisplayArtist(song), song.artist, song.lookupArtist].join(" ")),
                song.artistSortText || normalize(getRankingDisplayArtist(song))
            );
        }
        return song.artistWords;
    }

    if (scope === "song") {
        if (!song.songWords) {
            song.songWords = getSearchWordsFromNormalized(
                song.songSearchText || normalizeSearchText(song.song),
                song.songSortText || normalize(song.song)
            );
        }
        return song.songWords;
    }

    if (!song.allWords) {
        song.allWords = [...new Set([
            ...getScopedSearchWords(song, "song"),
            ...getScopedSearchWords(song, "artist"),
        ])];
    }

    return song.allWords;
}

function getSearchWordsFromNormalized(searchText, sortText = "") {
    const words = new Set();
    if (searchText) {
        for (const word of searchText.split(" ")) {
            if (word.length > 2) words.add(word);
        }
    }
    if (sortText && sortText !== searchText) {
        for (const word of sortText.split(" ")) {
            if (word.length > 2) words.add(word);
        }
    }
    return [...words];
}

function getSearchWords(value) {
    return getSearchWordsFromNormalized(normalizeSearchText(value), normalize(value));
}

function getFuzzyTokenScore(token, words) {
    if (token.length < 4) {
        return 0;
    }

    const threshold = token.length > 6 ? 2 : 1;
    for (const word of words || []) {
        if (Math.abs(word.length - token.length) > threshold) {
            continue;
        }

        const distance = boundedEditDistance(token, word, threshold);
        if (distance <= threshold) {
            return token.length > 6 ? 5 : 4;
        }
    }

    return 0;
}

function boundedEditDistance(a, b, maxDistance) {
    if (a === b) {
        return 0;
    }

    if (Math.abs(a.length - b.length) > maxDistance) {
        return maxDistance + 1;
    }

    let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

    for (let i = 1; i <= a.length; i++) {
        const current = [i];
        let rowMin = current[0];

        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            const value = Math.min(
                previous[j] + 1,
                current[j - 1] + 1,
                previous[j - 1] + cost
            );
            current[j] = value;
            rowMin = Math.min(rowMin, value);
        }

        if (rowMin > maxDistance) {
            return maxDistance + 1;
        }

        previous = current;
    }

    return previous[b.length];
}

function rankSongs(songs, query, options = {}) {
    const hasState = typeof state !== "undefined";
    const fuzzy = options.fuzzy !== undefined ? options.fuzzy : (hasState ? state.fuzzySearch : false);
    const scope = options.scope || (hasState ? state.searchScope : "all");
    const exactArtist = options.exactArtist !== undefined ? options.exactArtist : (hasState ? state.exactArtist : false);

    if (exactArtist && scope === "artist" && query) {
        const key = typeof normalizeArtistKey === "function" ? normalizeArtistKey(query) : normalize(query);
        return songs.filter((song) => song.artistKey === key);
    }

    const tokens = normalizeSearchText(query).split(" ").filter(Boolean);
    if (!tokens.length) {
        // New songs mostly lack their own popularity yet, so they keep the
        // What's new ranking instead of falling to the end of the catalog order.
        if (hasState && state.filters.recent && state.whatsNewSongs.length) {
            return state.whatsNewSongs;
        }
        return (hasState && state.defaultRankedSongs.length) ? state.defaultRankedSongs : songs;
    }

    const phrase = tokens.join(" ");
    const matchesSongs = scope !== "artist";
    const matchesArtists = scope !== "song";
    return songs
        .map((song) => {
            const haystack = getScopedSearchText(song, scope);
            const fuzzyWords = fuzzy ? getScopedSearchWords(song, scope) : null;
            let score = 0;

            for (const token of tokens) {
                if (haystack.includes(token)) {
                    score += 8;
                    continue;
                }

                if (!fuzzy) {
                    return { song, score: 0 };
                }

                const fuzzyScore = getFuzzyTokenScore(token, fuzzyWords);
                if (!fuzzyScore) {
                    return { song, score: 0 };
                }

                score += fuzzyScore;
            }

            const songText = matchesSongs ? (song.songSearchText || normalizeSearchText(song.song)) : "";
            const displaySongText = matchesSongs ? (song.displaySongSearchText || songText) : "";
            const artistText = matchesArtists ? (song.displayArtistSearchText || normalizeSearchText(getRankingDisplayArtist(song))) : "";
            const reverseOrderText = scope === "all" ? `${artistText} ${displaySongText}` : "";

            if (haystack.includes(phrase) || (reverseOrderText && reverseOrderText.includes(phrase))) {
                score += 12;
            }

            let songBonus = 0;
            if (matchesSongs) {
                if (songText === phrase || displaySongText === phrase) {
                    songBonus = 18;
                } else if (songText.startsWith(phrase) || displaySongText.startsWith(phrase)) {
                    songBonus = 10;
                }
            }

            let artistBonus = 0;
            if (matchesArtists) {
                if (artistText === phrase) {
                    artistBonus = 18;
                } else if (artistText.startsWith(phrase)) {
                    artistBonus = 10;
                }
            }

            let crossFieldBonus = 0;
            if (scope === "all" && tokens.length >= 2) {
                const artistHaystack = song.artistSearchText || artistText;
                let hitSong = false;
                let hitArtist = false;
                for (const token of tokens) {
                    if (songText.includes(token) || displaySongText.includes(token)) hitSong = true;
                    if (artistHaystack.includes(token)) hitArtist = true;
                }
                if (hitSong && hitArtist) {
                    const exactCombo = (reverseOrderText === phrase) ||
                        (`${displaySongText} ${artistText}` === phrase) ||
                        (`${artistText} ${songText}` === phrase) ||
                        (`${songText} ${artistText}` === phrase);
                    crossFieldBonus = exactCombo ? 22 : 6;
                }
            }

            score += Math.max(songBonus, artistBonus, crossFieldBonus);
            return { song, score };
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score ||
            (b.song.popularity || 0) - (a.song.popularity || 0) ||
            compareArtistSort(a.song, b.song) ||
            compareSongSort(a.song, b.song))
        .map((item) => item.song);
}

function sortSongs(songs, mode = (typeof state !== "undefined" ? state.sortMode : "relevance")) {
    if (mode === "popular") {
        // Among new songs, rank by the What's new signal (see buildWhatsNew).
        const useWhatsNew = typeof state !== "undefined" && state.filters.recent;
        const score = useWhatsNew
            ? (song) => song.whatsNew?.score || 0
            : (song) => song.popularity || 0;
        return [...songs].sort((a, b) =>
            score(b) - score(a) ||
            compareArtistSort(a, b) ||
            compareSongSort(a, b)
        );
    }

    if (mode === "artist") {
        return [...songs].sort((a, b) => compareArtistSort(a, b) || compareSongSort(a, b));
    }

    if (mode === "song") {
        return [...songs].sort((a, b) => compareSongSort(a, b) || compareArtistSort(a, b));
    }

    if (mode === "confidence") {
        return [...songs].sort((a, b) => (b.confidence || 0) - (a.confidence || 0) || compareArtistSort(a, b));
    }

    return songs;
}

function getQueryTokens() {
    if (state.mode !== "search") {
        return [];
    }

    return normalizeSearchText(state.query).split(" ").filter(Boolean);
}

function isFoldedSearchWordChar(char) {
    if (!char) {
        return false;
    }

    return /[a-z0-9]/.test(char.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
}

function setHighlightedText(element, rawText, tokens) {
    element.textContent = "";
    const ranges = getHighlightRanges(rawText, tokens);
    if (!ranges.length) {
        element.textContent = rawText;
        return;
    }

    let cursor = 0;
    for (const [start, end] of ranges) {
        if (start > cursor) {
            element.appendChild(document.createTextNode(rawText.slice(cursor, start)));
        }

        const mark = document.createElement("mark");
        mark.textContent = rawText.slice(start, end);
        element.appendChild(mark);
        cursor = end;
    }

    if (cursor < rawText.length) {
        element.appendChild(document.createTextNode(rawText.slice(cursor)));
    }
}

function getHighlightRanges(rawText, tokens) {
    if (!tokens.length || !rawText) {
        return [];
    }

    // Rebuild normalizeSearchText() one source char at a time so normalized
    // match positions can be mapped back to raw string indices.
    const map = [];
    let normalized = "";
    let prevSpace = true;
    for (let i = 0; i < rawText.length; i++) {
        const char = rawText[i];
        if (/^['\u2018\u2019\u02bc]$/.test(char)) {
            continue;
        }
        if ((char === "." || char === "/") &&
            isFoldedSearchWordChar(rawText[i - 1]) &&
            isFoldedSearchWordChar(rawText[i + 1])) {
            continue;
        }
        let out = char === "&"
            ? " and "
            : char.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        out = out.replace(/[^a-z0-9]+/g, " ");

        for (const outChar of out) {
            if (outChar === " ") {
                if (prevSpace) {
                    continue;
                }

                normalized += " ";
                map.push(i);
                prevSpace = true;
            } else {
                normalized += outChar;
                map.push(i);
                prevSpace = false;
            }
        }
    }

    const ranges = [];
    for (const token of tokens) {
        let index = normalized.indexOf(token);
        while (index !== -1) {
            const start = map[index];
            const end = map[index + token.length - 1] + 1;
            ranges.push([start, end]);
            index = normalized.indexOf(token, index + token.length);
        }
    }

    if (!ranges.length) {
        return [];
    }

    ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const merged = [ranges[0]];
    for (const [start, end] of ranges.slice(1)) {
        const last = merged[merged.length - 1];
        if (start <= last[1]) {
            last[1] = Math.max(last[1], end);
        } else {
            merged.push([start, end]);
        }
    }

    return merged;
}

if (typeof module === "object" && module.exports) {
    module.exports = {
        normalize,
        normalizeSearchText,
        getBrowseLetterFromNormalized,
        getBrowseLetter,
        compareText,
        compareSortKey,
        compareArtistSort,
        compareSongSort,
        compareDecade,
        getScopedSearchText,
        getScopedSearchWords,
        getSearchWordsFromNormalized,
        getSearchWords,
        getFuzzyTokenScore,
        boundedEditDistance,
        rankSongs,
        sortSongs,
        isFoldedSearchWordChar,
        getHighlightRanges,
    };
}
