// Pure catalog preparation, normalization, enrichment overlay, duet/holiday
// detection, and What's new ranking. Shared by the main thread (via defer
// script after search-ranking.js), catalog-worker.js (via importScripts), and
// Node unit tests (via module.exports).

const POPULAR_PILL_PERCENTILE = 0.9;
const TAG_GENRE_MIN_COUNT = 50;

const SMALL_ARTIST_WORDS = new Set([
    "a",
    "an",
    "and",
    "at",
    "by",
    "for",
    "from",
    "in",
    "of",
    "on",
    "or",
    "the",
    "to",
    "with",
    "vs",
]);

const GENRE_TAG_PHRASES = [
    "acoustic",
    "adult contemporary",
    "ambient",
    "americana",
    "aor",
    "ballad",
    "bluegrass",
    "blues",
    "britpop",
    "ccm",
    "celtic",
    "classical",
    "country",
    "dance",
    "disco",
    "doo wop",
    "dub",
    "easy listening",
    "electro",
    "electronic",
    "electronica",
    "emo",
    "folk",
    "funk",
    "gospel",
    "grime",
    "grunge",
    "hardcore",
    "hip hop",
    "house",
    "industrial",
    "jazz",
    "latin",
    "mariachi",
    "metal",
    "motown",
    "musical",
    "new wave",
    "oldies",
    "opera",
    "pop",
    "punk",
    "ranchera",
    "rap",
    "reggae",
    "rhythm and blues",
    "rnb",
    "rock",
    "rockabilly",
    "salsa",
    "shoegaze",
    "singer songwriter",
    "ska",
    "soul",
    "soundtrack",
    "swing",
    "synthpop",
    "techno",
    "trance",
    "world",
];

const NON_GENRE_TAGS = new Set([
    "alabama",
    "all",
    "american",
    "american idol",
    "australia",
    "australian",
    "british",
    "california",
    "canada",
    "canadian",
    "chicago",
    "christmas",
    "detroit",
    "england",
    "eurovision",
    "country group",
    "female",
    "female vocalist",
    "female vocalists",
    "female voices",
    "finnish",
    "frank sinatra",
    "french",
    "funny",
    "george strait",
    "georgia",
    "german",
    "girl group",
    "girl groups",
    "guitar",
    "guilty pleasure",
    "home collection",
    "humor",
    "ireland",
    "irish",
    "japanese",
    "king of pop",
    "legend",
    "love",
    "male",
    "male vocalist",
    "male vocalists",
    "manchester",
    "mexican",
    "mexico",
    "my top songs",
    "need to rate",
    "new york",
    "oklahoma",
    "parody",
    "piano",
    "political",
    "puerto rico",
    "queen of pop",
    "romantic",
    "scottish",
    "seattle",
    "sexy",
    "spain",
    "spotify",
    "sweden",
    "swedish",
    "texas",
    "the beatles",
    "uk",
    "usa",
    "vocal",
    "x factor",
]);

const GENRE_TAG_LABELS = {
    aor: "AOR",
    ccm: "CCM",
    "doo wop": "Doo-wop",
    "g funk": "G-funk",
    "hip hop": "Hip hop",
    "lo fi": "Lo-fi",
    "neo soul": "Neo-soul",
    "nu metal": "Nu metal",
    "r and b": "R&B",
    rnb: "R&B",
    "singer songwriter": "Singer-songwriter",
};

const CLEAN_DISPLAY_CACHE = new Map();
const ANY_HOLIDAY_PATTERN = /(^| )(christmas|xmas|santa|noel|jingle|yule|yuletide|hanukkah|chanukah|halloween|spooky|new year|new years|auld lang syne|thanksgiving|valentine|valentines|st patrick|saint patrick|easter)( |$)/;
const DUET_COLLAB_PATTERN = /\b(?:feat\.?|ft\.?|featuring|duet)\b/i;
const DUET_PAREN_WITH_PATTERN = /\(\s*with\s+(?!vocals?\b)[^)]+\)/i;
const SOLO_ARTIST_SEP_PATTERN = /[&+]|\b(?:feat\.?|ft\.?|featuring|and|with|vs\.?|versus|duet)\b/i;
const DUET_BACKING_GROUP_PATTERN = /^(?:the\s+|his\s+|her\s+)|^(?:wings|friends|company|band|orchestra|chorus|singers|quartet|trio|ensemble|players|crew|cast|family|gang|boys|girls|brothers|sisters|bandmates)$|\b(?:band|orchestra|chorus|singers|quartet|trio|ensemble|players|all[\s-]*stars?|experience|movement|revolution|heartbreakers|e street band|wailers|supremes|miracles|pips|diamonds|bad seeds|attractions|imposters|news|shondells|vandellas|marvelettes|four seasons|blackhearts|crickets|drifters|comets|blue caps|silver bullet band|rhythm kings|sunshine band|soul syndicate|family stone|crazy horse|stray gators|range|spiders from mars|saints|angels|revelations|jets|breakers|strangers|drifting cowboys|texas playboys|blue moon boys)\b/i;

// Producer/DJ acts are credited as artists but usually don't sing, so a
// "Producer feat. Singer" or "Producer & Singer" credit is a solo vocal.
// Both "First Last" and catalog-style "Last, First" spellings are listed.
const DUET_NON_VOCAL_ARTISTS = [
    "David Guetta", "Guetta, David", "Calvin Harris", "Harris, Calvin", "Mark Ronson", "Ronson, Mark",
    "Clean Bandit", "Avicii", "Kygo", "Sigala", "Tiesto", "Afrojack", "DJ Khaled", "Khaled, DJ",
    "Lost Frequencies", "Sigma", "Rudimental", "Martin Garrix", "Garrix, Martin", "Zedd", "Marshmello",
    "Disclosure", "Jax Jones", "Jones, Jax", "Jonas Blue", "Blue, Jonas", "Alesso", "Swedish House Mafia",
    "Major Lazer", "The Chainsmokers", "Chainsmokers", "Chainsmokers, The", "Duke Dumont", "Dumont, Duke", "Diplo",
    "Steve Aoki", "Aoki, Steve", "Armin van Buuren", "Robin Schulz", "Schulz, Robin", "Felix Jaehn",
    "Jaehn, Felix", "Klangkarussell", "Freemations", "Besomorph", "Coopex", "Joel Corry", "Corry, Joel",
    "Galantis", "Cheat Codes", "Illenium", "Gryffin", "Kungs", "Purple Disco Machine", "Meduza",
    "Kaskade", "Alan Walker", "Walker, Alan", "Basement Jaxx", "Chase & Status", "Wilkinson",
];
let duetNonVocalKeys = null;
const DUET_CREDIT_SPLIT_PATTERN = /\s+(?:and|feat|ft|featuring|with|x|vs|versus)\s+/;
const DUET_TITLE_FEATURE_PATTERN = /\b(?:feat\.?|ft\.?|featuring)\s+([^)\]]+)/i;
const VALID_ENRICHMENT_ERAS = new Set(["50s", "60s", "70s", "80s", "90s", "2000s", "2010s", "2020s"]);

function createEmptyTagConsolidation() {
    return {
        minLastFmSongs: TAG_GENRE_MIN_COUNT,
        genreTags: new Map(),
        hiddenOtherTags: new Set(),
    };
}

function normalizeTagConsolidation(raw = {}) {
    const normalized = createEmptyTagConsolidation();
    const minLastFmSongs = Number(raw?.thresholds?.minLastFmSongs || raw?.minLastFmSongs || TAG_GENRE_MIN_COUNT);
    normalized.minLastFmSongs = Number.isFinite(minLastFmSongs) ? minLastFmSongs : TAG_GENRE_MIN_COUNT;

    for (const item of raw?.genreTags || []) {
        const key = normalize(item.tag);
        const label = item.label || toGenreLabel(item.tag);
        if (key && label) {
            normalized.genreTags.set(key, label);
        }
    }

    for (const [tag, label] of Object.entries(raw?.aliases || {})) {
        const key = normalize(tag);
        if (key && label) {
            normalized.genreTags.set(key, label);
        }
    }

    for (const tag of raw?.hiddenOtherTags || []) {
        const key = normalize(tag);
        if (key) {
            normalized.hiddenOtherTags.add(key);
        }
    }

    for (const key of normalized.genreTags.keys()) {
        normalized.hiddenOtherTags.add(key);
    }

    return normalized;
}

function createEmptyMoodConsolidation() {
    return {
        moods: [],
        tagToLabels: new Map(),
        phraseRules: [],
    };
}

function normalizeMoodConsolidation(raw = {}) {
    const normalized = createEmptyMoodConsolidation();

    normalized.moods = (raw?.moods || [])
        .map((rule) => {
            const label = String(rule.label || "").trim();
            const tags = new Set([
                ...(rule.tags || []),
                ...(rule.genres || []),
            ].map(normalize).filter(Boolean));
            const contains = (rule.contains || []).map(normalize).filter(Boolean);

            return { label, tags, contains };
        })
        .filter((rule) => rule.label && (rule.tags.size || rule.contains.length));

    for (const rule of normalized.moods) {
        for (const tag of rule.tags) {
            let labels = normalized.tagToLabels.get(tag);
            if (!labels) {
                labels = [];
                normalized.tagToLabels.set(tag, labels);
            }
            if (!labels.includes(rule.label)) {
                labels.push(rule.label);
            }
        }
        if (rule.contains.length) {
            normalized.phraseRules.push(rule);
        }
    }

    return normalized;
}

function getSongLengthBucket(song) {
    const seconds = Number(song?.seconds);
    if (!Number.isFinite(seconds) || seconds <= 0) {
        return "";
    }
    if (seconds < 180) {
        return "Short (< 3 min)";
    }
    if (seconds <= 300) {
        return "Standard (3–5 min)";
    }
    return "Long (5+ min)";
}

function dedupeValues(values = []) {
    const seen = new Set();
    const deduped = [];

    for (const value of values || []) {
        const key = normalize(value);
        if (!key || seen.has(key)) {
            continue;
        }

        seen.add(key);
        deduped.push(value);
    }

    return deduped;
}

function getSongVersionKey(song) {
    const artistKey = song.artistKey || getArtistKey(song) || normalize(song.lookupArtist || song.artist);
    const titleKey = normalizeVersionTitle(song.lookupSong || song.song);
    return `${artistKey}\u001f${titleKey || normalize(song.song)}`;
}

function normalizeVersionTitle(value) {
    let text = String(value || "");
    text = text
        .replace(/[\[(][^\])]*(karaoke|instrumental|vocal|version|clean|explicit|key|coros?)[^\])]*[\])]/gi, " ")
        .replace(/\b(karaoke|instrumental|backing track|guide vocal|guide vocals|with vocals|without vocals|no lead vocals|clean version|explicit version|radio edit|album version)\b/gi, " ");

    return normalize(text);
}

function isGenreLikeTag(key) {
    if (!key || NON_GENRE_TAGS.has(key) || /^(female|male|my) /.test(key)) {
        return false;
    }

    return GENRE_TAG_PHRASES.some((phrase) => {
        return key === phrase ||
            key.startsWith(`${phrase} `) ||
            key.endsWith(` ${phrase}`) ||
            key.includes(` ${phrase} `);
    });
}

function formatGenreTagLabel(key, labels = new Map()) {
    if (GENRE_TAG_LABELS[key]) {
        return GENRE_TAG_LABELS[key];
    }

    const [popularLabel] = [...labels.entries()].sort((a, b) => b[1] - a[1] || compareText(a[0], b[0]))[0] || [key];
    return toGenreLabel(popularLabel);
}

function toGenreLabel(value) {
    const normalized = normalize(value);
    if (GENRE_TAG_LABELS[normalized]) {
        return GENRE_TAG_LABELS[normalized];
    }

    return normalized.split(" ").map((word, index) => {
        if (["and", "en", "of"].includes(word)) {
            return word;
        }

        if (["aor", "ccm"].includes(word)) {
            return word.toUpperCase();
        }

        return index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word;
    }).join(" ");
}

function chooseArtistNameVariant(variants) {
    return [...variants.entries()]
        .sort((a, b) => getArtistNameScore(b[0], b[1]) - getArtistNameScore(a[0], a[1]) ||
            b[1] - a[1] ||
            compareText(a[0], b[0]))
        [0]?.[0] || "";
}

function getArtistNameScore(name, count) {
    let score = count;

    if (name.includes("&")) {
        score += 100;
    }

    if (/[!?]/.test(name)) {
        score += 100;
    }

    if (name.includes(",")) {
        score -= 600;
    }

    const words = name.match(/[A-Za-z]+/g) || [];
    words.forEach((word, index) => {
        const lower = word.toLowerCase();
        if (index > 0 && SMALL_ARTIST_WORDS.has(lower)) {
            score += word === lower ? 400 : -200;
        }
    });

    return score;
}

function getArtistNameCandidates(song) {
    return [
        song.lookupArtist,
        song.artist,
    ].map(cleanDisplayValue)
        .filter(Boolean)
        .filter((value, index, values) => values.indexOf(value) === index);
}

function getArtistKey(song) {
    const primaryName = cleanDisplayValue(song.lookupArtist) || cleanDisplayValue(song.artist);
    return normalizeArtistKey(primaryName);
}

function getSongIdentity(song) {
    return [
        getArtistKey(song) || normalize(song.artist),
        normalize(song.lookupSong || song.song),
        normalize(song.song),
    ].filter(Boolean).join("\u001f");
}

function getPrimaryArtistName(song) {
    return cleanDisplayValue(song.lookupArtist) || cleanDisplayValue(song.artist);
}

function getDisplayArtist(song) {
    const name = cleanDisplayValue(song.displayArtist) || getPrimaryArtistName(song);
    // Source-catalog codes like "Sc8608" masquerade as artist names.
    return /^[A-Za-z]{1,3}\d{3,6}$/.test(name) ? "" : name;
}

function normalizeArtistKey(value) {
    return normalize(String(value || "").replace(/[’'!?.]/g, ""));
}

function getDisplaySongTitle(song) {
    const raw = String(song.song || "");
    let cleaned = raw
        .replace(/[\[(][^\])]*\b(karaoke|instrumental|backing track|multiplex)\b[^\])]*[\])]/gi, " ")
        .replace(/[\[(][^\])]*$/, " ")
        .replace(/[-\s]+\b(?:sf|sbi|sb|mm|hmx|sc|sm)\d{3,6}\b/gi, " ")
        .replace(/\bmultiplex\b/gi, " ")
        .replace(/\bwvocals?\b/gi, " ")
        .replace(/[\[({]\s*[\])}]/g, " ")
        .replace(/(^|\s)[\])}]+(?=\s|$)/g, " ")
        .replace(/(^|\s)[\[({]+(?=\s|$)/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    cleaned = stripTrailingArtist(cleaned, song);

    return cleaned || raw || "Untitled";
}

function stripTrailingArtist(title, song) {
    // Some source titles embed the artist ("Heroes-David Bowie"); drop a
    // trailing dash segment when it just repeats the song's own artist.
    const artistKeys = new Set(
        [song.displayArtist, song.artist, song.lookupArtist]
            .map(normalize)
            .filter(Boolean)
    );
    if (!artistKeys.size) {
        return title;
    }

    let result = title;
    for (let guard = 0; guard < 3; guard++) {
        const index = result.lastIndexOf("-");
        if (index <= 0) {
            break;
        }

        const tail = normalize(result.slice(index + 1));
        if (!tail || !artistKeys.has(tail)) {
            break;
        }

        result = result.slice(0, index).trim();
    }

    return result || title;
}

function cleanDisplayValue(value) {
    const raw = String(value || "");
    const cached = CLEAN_DISPLAY_CACHE.get(raw);
    if (cached !== undefined) {
        return cached;
    }

    const result = raw
        .replace(/\bwvocals?\b/gi, " ")
        .replace(/\bw\s*\/?\s*vocals?\b/gi, " ")
        .replace(/[\[(]\s*karaoke\s*[\])]/gi, " ")
        .replace(/\bkaraoke\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim();

    if (CLEAN_DISPLAY_CACHE.size < 150000) {
        CLEAN_DISPLAY_CACHE.set(raw, result);
    }

    return result;
}

function getConsolidatedMoodsForSong(song, normalizedTags = null, normalizedGenres = null, moodConsolidation = null) {
    const consolidation = moodConsolidation || (typeof state !== "undefined" ? state.moodConsolidation : null);
    if (!consolidation) {
        return [];
    }
    const tagToLabels = consolidation.tagToLabels;
    const phraseRules = consolidation.phraseRules || [];
    if ((!tagToLabels || !tagToLabels.size) && !phraseRules.length) {
        return [];
    }

    const values = [];
    const seenLabels = new Set();
    const addLabel = (label) => {
        if (!seenLabels.has(label)) {
            seenLabels.add(label);
            values.push(label);
        }
    };

    if (tagToLabels && tagToLabels.size) {
        const tagKeys = normalizedTags || (song.tags || []).map(normalize);
        for (const key of tagKeys) {
            const labels = tagToLabels.get(key);
            if (labels) {
                for (const label of labels) addLabel(label);
            }
        }
        const genreKeys = normalizedGenres || getSongGenres(song).map(normalize);
        for (const key of genreKeys) {
            const labels = tagToLabels.get(key);
            if (labels) {
                for (const label of labels) addLabel(label);
            }
        }
    }

    if (phraseRules.length) {
        const sourceText = [
            song.artist,
            song.lookupArtist,
            song.song,
            song.lookupSong,
            ...(song.tags || []),
            ...getSongGenres(song),
        ].map(normalize).join(" ");

        for (const rule of phraseRules) {
            if (!seenLabels.has(rule.label) && rule.contains.some((phrase) => sourceText.includes(phrase))) {
                addLabel(rule.label);
            }
        }
    }

    return values;
}

function getSongGenres(song) {
    return song.allGenres || song.genres || [];
}

function getSongMoods(song) {
    return song.allMoods || song.moods || [];
}

function includesValue(values, target) {
    const normalizedTarget = normalize(target);
    return (values || []).some((value) => normalize(value) === normalizedTarget);
}

function getHolidayValues(song) {
    if (song.holidayValues) {
        return song.holidayValues;
    }

    return computeHolidayValues(song);
}

function computeHolidayValues(song, precomputed = null) {
    // Artist names are deliberately excluded: "Bullet For My Valentine" and
    // "Noel Gourdin" are not holiday music.
    let text;
    if (precomputed) {
        const parts = [];
        if (precomputed.songSortText) parts.push(precomputed.songSortText);
        for (const v of precomputed.rawGenres) if (v) parts.push(v);
        for (const v of precomputed.tags) if (v) parts.push(v);
        for (const v of precomputed.flags) if (v) parts.push(v);
        text = parts.join(" ");
    } else {
        text = normalize([
            song.song,
            ...(song.genres || []),
            ...(song.tags || []),
            ...(song.flags || []),
        ].join(" "));
    }

    if (!ANY_HOLIDAY_PATTERN.test(text)) {
        return hasFlag(song, "Holiday") ? ["Holiday"] : [];
    }

    const values = [];
    if (/(^| )(christmas|xmas|santa|noel|jingle|yule|yuletide)( |$)/.test(text)) values.push("Christmas");
    if (/(^| )(hanukkah|chanukah)( |$)/.test(text)) values.push("Hanukkah");
    if (/(^| )(halloween|spooky)( |$)/.test(text)) values.push("Halloween");
    if (/(^| )(new year|new years|auld lang syne)( |$)/.test(text)) values.push("New Year");
    if (/(^| )(thanksgiving)( |$)/.test(text)) values.push("Thanksgiving");
    if (/(^| )(valentine|valentines)( |$)/.test(text)) values.push("Valentine's Day");
    if (/(^| )(st patrick|saint patrick)( |$)/.test(text)) values.push("St. Patrick's Day");
    if (/(^| )(easter)( |$)/.test(text)) values.push("Easter");

    if (!values.length && hasFlag(song, "Holiday")) {
        values.push("Holiday");
    }

    return values;
}

function recordSoloArtistCount(soloArtistCounts, rawArtist) {
    const cleaned = String(rawArtist || "").replace(/\s*\([^)]*\)\s*/g, " ").trim();
    if (!cleaned || SOLO_ARTIST_SEP_PATTERN.test(cleaned)) {
        return;
    }
    const key = normalize(cleaned);
    if (key) {
        soloArtistCounts.set(key, (soloArtistCounts.get(key) || 0) + 1);
    }
    if (cleaned.includes(",")) {
        const parts = cleaned.split(",").map((part) => part.trim()).filter(Boolean);
        if (parts.length === 2 && !/^the$/i.test(parts[1])) {
            const flipped = normalize(`${parts[1]} ${parts[0]}`);
            if (flipped) {
                soloArtistCounts.set(flipped, (soloArtistCounts.get(flipped) || 0) + 1);
            }
        }
    }
}

function resolveDuetArtistPart(rawPart, soloArtistCounts) {
    const cleaned = String(rawPart || "").trim();
    if (!cleaned) {
        return "";
    }
    if (cleaned.includes(",")) {
        const parts = cleaned.split(",").map((part) => part.trim()).filter(Boolean);
        if (parts.length === 2 && !/^the$/i.test(parts[1])) {
            const flipped = normalize(`${parts[1]} ${parts[0]}`);
            if ((soloArtistCounts.get(flipped) || 0) >= 2) {
                return flipped;
            }
        }
    }
    return normalize(cleaned);
}

// Built lazily: normalize() lives in search-ranking.js.
function getDuetNonVocalKeys() {
    duetNonVocalKeys ||= DUET_NON_VOCAL_ARTISTS.map(normalize).sort((a, b) => b.length - a.length);
    return duetNonVocalKeys;
}

function countVocalCreditsForArtist(rawArtist, titleFeature) {
    if (!rawArtist) {
        return Infinity;
    }
    const credits = [normalize(rawArtist)];
    if (titleFeature) {
        credits.push(titleFeature);
    }
    let text = ` ${credits.join(" and ")} `;
    let foundNonVocal = false;
    for (const name of getDuetNonVocalKeys()) {
        const padded = ` ${name} `;
        while (text.includes(padded)) {
            text = text.replace(padded, " and ");
            foundNonVocal = true;
        }
    }
    if (!foundNonVocal) {
        return Infinity;
    }
    return text.split(DUET_CREDIT_SPLIT_PATTERN)
        .map((part) => part.trim())
        .filter((part) => part && !/^(?:and|feat|ft|featuring|with|x|vs|versus)$/.test(part))
        .length;
}

function countVocalCredits(song) {
    const titleMatch = String(song.song || "").match(DUET_TITLE_FEATURE_PATTERN);
    const titleFeature = titleMatch ? normalize(titleMatch[1]) : "";
    // Check both raw artist and lookupArtist: legacy comma-flipped lookupArtist
    // strings like "David ft Sia Guetta" or "Ariana Ft Zedd Grande" can split
    // a producer or singer name across the feature keyword.
    const artistCount = countVocalCreditsForArtist(song.artist, titleFeature);
    if (!song.lookupArtist || song.lookupArtist === song.artist) {
        return artistCount;
    }
    return Math.min(artistCount, countVocalCreditsForArtist(song.lookupArtist, titleFeature));
}

function detectDuetSource(song, normalizedFlags, normalizedTags, soloArtistCounts) {
    if (normalizedFlags.includes("duet")) {
        return "tagged";
    }
    if (normalizedTags.includes("duet") || normalizedTags.includes("duets")) {
        return "tagged";
    }
    return isLikelyDuetCredit(song, soloArtistCounts) && countVocalCredits(song) >= 2 ? "likely" : "";
}

function isLikelyDuetCredit(song, soloArtistCounts) {
    const artistText = `${song.artist || ""} ${song.lookupArtist || ""}`;
    if (
        DUET_COLLAB_PATTERN.test(artistText) ||
        DUET_COLLAB_PATTERN.test(song.song || "") ||
        DUET_PAREN_WITH_PATTERN.test(artistText)
    ) {
        return true;
    }
    const primary = String(song.lookupArtist || song.artist || "");
    if (!primary.includes("&")) {
        return false;
    }
    const parts = primary.split(/\s*&\s*/).map((part) => part.trim()).filter(Boolean);
    if (parts.length !== 2 || DUET_BACKING_GROUP_PATTERN.test(parts[1])) {
        return false;
    }
    const left = resolveDuetArtistPart(parts[0], soloArtistCounts);
    const right = resolveDuetArtistPart(parts[1], soloArtistCounts);
    return Boolean(
        left &&
        right &&
        left !== right &&
        (soloArtistCounts.get(left) || 0) >= 2 &&
        (soloArtistCounts.get(right) || 0) >= 2
    );
}

function hasFlag(song, flag) {
    return (song.flags || []).some((value) => normalize(value) === normalize(flag));
}

function getDisplayFlags(song) {
    const holidays = getHolidayValues(song).map(normalize);
    const flags = (song.flags || []).filter((flag) => {
        if (normalize(flag) === "holiday" && holidays.some((holiday) => holiday !== "holiday")) {
            return false;
        }

        return true;
    });
    if (song.isDuet && !flags.some((flag) => normalize(flag) === "duet")) {
        flags.push(song.duetSource === "likely" ? "Likely duet" : "Duet");
    }
    return flags;
}

function buildEraEnrichmentMap(enrichment) {
    if (!enrichment || !Array.isArray(enrichment.entries) || !enrichment.entries.length) {
        return null;
    }
    const byId = new Map();
    for (const entry of enrichment.entries) {
        if (!entry || typeof entry.song !== "string" || typeof entry.artist !== "string") continue;
        if (!Array.isArray(entry.eras) || !entry.eras.length) continue;
        if (!entry.eras.every((era) => VALID_ENRICHMENT_ERAS.has(era))) continue;
        byId.set(getSongIdentity(entry), entry);
    }
    return byId.size ? byId : null;
}

function getAudioTargetKey(song) {
    return `${song.artist}\u001f${song.song}\u001f${song.lookupArtist || ""}\u001f${song.lookupSong || ""}`;
}

function buildAudioEnrichmentMap(enrichment) {
    if (!Array.isArray(enrichment?.entries) || !enrichment.entries.length) {
        return null;
    }
    const byId = new Map();
    for (const entry of enrichment.entries) {
        if (!entry || typeof entry.song !== "string" || typeof entry.artist !== "string" ||
            entry.source?.type !== "getsongbpm" || !Array.isArray(entry.source.records)) {
            continue;
        }
        const url = entry.source.records.find(
            (record) => typeof record?.url === "string" && /^https:\/\/getsongbpm\.com\/song\//.test(record.url)
        )?.url;
        if (!url) continue;
        const bpm = typeof entry.bpm === "number" && Number.isFinite(entry.bpm) && entry.bpm >= 20 && entry.bpm <= 400 ? entry.bpm : null;
        const referenceKey = typeof entry.referenceKey === "string" && /^[A-G](?:#|b|♯|♭)?m?$/.test(entry.referenceKey) ? entry.referenceKey : null;
        const danceability = typeof entry.danceability === "number" && Number.isFinite(entry.danceability) && entry.danceability >= 0 && entry.danceability <= 100 ? entry.danceability : null;
        const acousticness = typeof entry.acousticness === "number" && Number.isFinite(entry.acousticness) && entry.acousticness >= 0 && entry.acousticness <= 100 ? entry.acousticness : null;
        if (bpm === null && referenceKey === null) continue;
        byId.set(getAudioTargetKey(entry), {
            bpm,
            referenceKey,
            danceability,
            acousticness,
            audioSource: { url, type: "getsongbpm" },
        });
    }
    return byId.size ? byId : null;
}

function buildWhatsNewIndex(songs, source) {
    const addedOn = new Map();
    for (const batch of Array.isArray(source?.batches) ? source.batches : []) {
        if (!batch || !/^\d{4}-\d{2}-\d{2}$/.test(batch.date) || !Array.isArray(batch.ids)) continue;
        for (const id of batch.ids) {
            if (typeof id === "string" && !addedOn.has(id)) addedOn.set(id, batch.date);
        }
    }
    if (!addedOn.size) {
        return { indices: new Uint32Array(0), songs: [], latest: "" };
    }

    const versionBest = new Map();
    const artistRanks = new Map();
    for (let i = 0; i < songs.length; i++) {
        const song = songs[i];
        const rank = song.popularity || 0;
        if (rank <= 0) continue;
        const versionKey = getSongVersionKey(song);
        versionBest.set(versionKey, Math.max(versionBest.get(versionKey) || 0, rank));
        if (song.artistKey) {
            let ranks = artistRanks.get(song.artistKey);
            if (!ranks) {
                ranks = [];
                artistRanks.set(song.artistKey, ranks);
            }
            ranks.push(rank);
        }
    }

    const artistMedian = new Map();
    const artistUses = new Map();
    const freshIndices = [];
    let latest = "";
    for (let i = 0; i < songs.length; i++) {
        const song = songs[i];
        const date = addedOn.get(song.id);
        if (!date) continue;
        let score = song.popularity || 0;
        let basis = score ? "song" : "";
        if (!score) {
            score = versionBest.get(getSongVersionKey(song)) || 0;
            if (score) basis = "version";
        }
        if (!score && artistRanks.has(song.artistKey)) {
            if (!artistMedian.has(song.artistKey)) {
                const ranks = artistRanks.get(song.artistKey).sort((a, b) => a - b);
                const mid = ranks.length >> 1;
                artistMedian.set(song.artistKey, ranks.length % 2 ? ranks[mid] : (ranks[mid - 1] + ranks[mid]) / 2);
            }
            const uses = artistUses.get(song.artistKey) || 0;
            artistUses.set(song.artistKey, uses + 1);
            score = Math.round(artistMedian.get(song.artistKey) * 0.9 ** uses);
            basis = "artist";
        }
        song.whatsNew = { addedOn: date, score, basis };
        if (date > latest) latest = date;
        freshIndices.push(i);
    }

    freshIndices.sort((ia, ib) => {
        const a = songs[ia];
        const b = songs[ib];
        return b.whatsNew.score - a.whatsNew.score ||
            b.whatsNew.addedOn.localeCompare(a.whatsNew.addedOn) ||
            compareArtistSort(a, b) ||
            compareSongSort(a, b);
    });

    const indices = Uint32Array.from(freshIndices);
    const freshSongs = freshIndices.map((index) => songs[index]);
    return { indices, songs: freshSongs, latest };
}

function validateRawSong(song) {
    if (!song || typeof song.song !== "string" || typeof song.artist !== "string") {
        throw new Error("Invalid songbook data");
    }
    for (const key of ["genres", "moods", "eras", "tags", "flags"]) {
        const list = song[key];
        if (list !== undefined) {
            if (!Array.isArray(list)) {
                throw new Error("Invalid songbook data");
            }
            for (let i = 0; i < list.length; i++) {
                if (typeof list[i] !== "string") {
                    throw new Error("Invalid songbook data");
                }
            }
        }
    }
}

// Synchronous full catalog preparation used inside catalog-worker.js and unit
// tests. Mirrors useSongs() field-for-field so worker and fallback paths stay
// indistinguishable.
function prepareCatalogSync(rawSongs, options = {}) {
    if (!Array.isArray(rawSongs) || !rawSongs.length) {
        throw new Error("Invalid songbook data");
    }

    const tagConsolidation = options.tagConsolidation || createEmptyTagConsolidation();
    const moodConsolidation = options.moodConsolidation || createEmptyMoodConsolidation();
    const eraMap = buildEraEnrichmentMap(options.eraEnrichment);
    const audioMap = buildAudioEnrichmentMap(options.audioEnrichment);
    const whatsNewSource = options.whatsNewSource || null;
    const useConsolidatedGenres = tagConsolidation.genreTags.size > 0;

    const variantsByKey = new Map();
    const soloArtistCounts = new Map();
    const tagCounts = new Map();
    const tagLabelsByKey = new Map();

    // Pass 1: validate schema, overlay optional era/audio sidecars in place,
    // gather artist name variants, solo artist counts, and tag frequencies.
    for (let i = 0; i < rawSongs.length; i++) {
        const song = rawSongs[i];
        validateRawSong(song);

        if (eraMap && !song.eras?.length) {
            const match = eraMap.get(getSongIdentity(song));
            if (match) {
                song.eras = match.eras;
                song.eraSource = match.source;
            }
        }
        if (audioMap) {
            const match = audioMap.get(getAudioTargetKey(song));
            if (match) {
                song.bpm = match.bpm;
                song.referenceKey = match.referenceKey;
                song.danceability = match.danceability;
                song.acousticness = match.acousticness;
                song.audioSource = match.audioSource;
            }
        }

        const artistKey = getArtistKey(song);
        if (artistKey) {
            let variants = variantsByKey.get(artistKey);
            if (!variants) {
                variants = new Map();
                variantsByKey.set(artistKey, variants);
            }
            for (const name of getArtistNameCandidates(song)) {
                variants.set(name, (variants.get(name) || 0) + 1);
            }
        }
        recordSoloArtistCount(soloArtistCounts, song.lookupArtist || song.artist);

        const tags = song.tags;
        if (tags && tags.length) {
            const seen = new Set();
            for (let j = 0; j < tags.length; j++) {
                const tag = tags[j];
                const key = normalize(tag);
                if (!key || seen.has(key)) continue;
                seen.add(key);
                tagCounts.set(key, (tagCounts.get(key) || 0) + 1);
                if (!useConsolidatedGenres) {
                    let labels = tagLabelsByKey.get(key);
                    if (!labels) {
                        labels = new Map();
                        tagLabelsByKey.set(key, labels);
                    }
                    labels.set(tag, (labels.get(tag) || 0) + 1);
                }
            }
        }
    }

    const artistNames = new Map();
    for (const [key, variants] of variantsByKey.entries()) {
        artistNames.set(key, chooseArtistNameVariant(variants));
    }

    const consolidatedGenres = tagConsolidation.genreTags;
    const promotedGenreTags = useConsolidatedGenres
        ? new Map([...tagCounts.entries()]
            .filter(([key, count]) => count >= tagConsolidation.minLastFmSongs && consolidatedGenres.has(key))
            .map(([key]) => [key, consolidatedGenres.get(key)])
            .sort((a, b) => compareText(a[1], b[1])))
        : new Map([...tagCounts.entries()]
            .filter(([key, count]) => count >= TAG_GENRE_MIN_COUNT && isGenreLikeTag(key))
            .map(([key]) => [key, formatGenreTagLabel(key, tagLabelsByKey.get(key))])
            .sort((a, b) => compareText(a[1], b[1])));

    const scores = [];
    const availableMoodsSet = new Set();
    const availableGenresSet = new Set();
    const availableDecadesSet = new Set();
    const availableHolidaysSet = new Set();
    const availableLengthsSet = new Set();

    // Pass 2: build each prepared song object in a single allocation.
    const enrichedSongs = new Array(rawSongs.length);
    for (let index = 0; index < rawSongs.length; index++) {
        const song = rawSongs[index];
        const artistKey = getArtistKey(song);
        const displayArtist = artistNames.get(artistKey) || getPrimaryArtistName(song);
        const artistSources = `${displayArtist} ${song.artist || ""} ${song.lookupArtist || ""}`;
        const songSortText = normalize(song.song);
        const artistSortText = normalize(displayArtist);
        const songSearchText = normalizeSearchText(song.song);
        const displaySongSearchText = normalizeSearchText(getDisplaySongTitle(song));
        const artistSearchText = normalizeSearchText(artistSources);
        const displayArtistSearchText = normalizeSearchText(displayArtist);
        const normalizedArtist = artistKey || normalize(song.artist);
        const rawTags = song.tags || [];
        const rawGenres = song.genres || [];
        const rawMoods = song.moods || [];
        const rawEras = song.eras || [];
        const rawFlags = song.flags || [];

        const normalizedTags = rawTags.length ? rawTags.map(normalize) : [];
        const normalizedRawGenres = rawGenres.length ? rawGenres.map(normalize) : [];
        const normalizedFlags = rawFlags.length ? rawFlags.map(normalize) : [];

        const promotedValues = [];
        for (let j = 0; j < normalizedTags.length; j++) {
            const label = promotedGenreTags.get(normalizedTags[j]);
            if (label) promotedValues.push(label);
        }
        const sourceGenres = promotedValues.length ? dedupeValues(promotedValues) : [];
        const allGenres = sourceGenres.length
            ? dedupeValues([...rawGenres, ...sourceGenres])
            : (rawGenres.length ? dedupeValues(rawGenres) : []);
        const genreKeys = allGenres.map(normalize);

        const preparedSong = {
            ...song,
            artistKey,
            displayArtist,
            id: getSongIdentity(song),
            legacyId: `${normalizedArtist}\u001f${songSortText}\u001f${index}`,
            songLetter: getBrowseLetterFromNormalized(songSortText),
            artistLetter: getBrowseLetterFromNormalized(artistSortText),
            songSearchText,
            displaySongSearchText,
            artistSearchText,
            displayArtistSearchText,
            allSearchText: `${songSearchText} ${artistSearchText}`,
            songSortText,
            artistSortText,
            sourceGenres,
            allGenres,
        };

        const sourceMoods = getConsolidatedMoodsForSong(preparedSong, normalizedTags, genreKeys, moodConsolidation);
        const allMoods = sourceMoods.length
            ? dedupeValues([...rawMoods, ...sourceMoods])
            : (rawMoods.length ? dedupeValues(rawMoods) : []);
        preparedSong.sourceMoods = sourceMoods;
        preparedSong.allMoods = allMoods;

        preparedSong.holidayValues = computeHolidayValues(preparedSong, {
            songSortText,
            rawGenres: normalizedRawGenres,
            tags: normalizedTags,
            flags: normalizedFlags,
        });
        preparedSong.duetSource = detectDuetSource(song, normalizedFlags, normalizedTags, soloArtistCounts);
        preparedSong.isDuet = Boolean(preparedSong.duetSource);
        const lengthBucket = getSongLengthBucket(song);
        preparedSong.lengthBucket = lengthBucket;
        preparedSong.filterKeys = {
            moods: new Set(allMoods.map(normalize)),
            genres: new Set(genreKeys),
            decades: new Set(rawEras.map(normalize)),
            holidays: new Set(preparedSong.holidayValues.map(normalize)),
            lengths: lengthBucket ? new Set([normalize(lengthBucket)]) : new Set(),
        };

        if (song.popularity) scores.push(song.popularity);
        for (const value of allMoods) if (value) availableMoodsSet.add(value);
        for (const value of allGenres) if (value) availableGenresSet.add(value);
        for (const value of rawEras) if (value) availableDecadesSet.add(value);
        for (const value of preparedSong.holidayValues) if (value) availableHolidaysSet.add(value);
        if (lengthBucket) availableLengthsSet.add(lengthBucket);

        enrichedSongs[index] = preparedSong;
    }

    scores.sort((a, b) => a - b);
    const popularThreshold = scores.length
        ? scores[Math.floor(scores.length * POPULAR_PILL_PERCENTILE)]
        : 0;

    // Sort indices rather than duplicating song references so worker transfers
    // can pass a zero-copy Uint32Array instead of cloning 37k songs twice.
    const defaultRankedIndices = new Uint32Array(enrichedSongs.length);
    for (let i = 0; i < enrichedSongs.length; i++) {
        defaultRankedIndices[i] = i;
    }
    defaultRankedIndices.sort((ia, ib) => {
        const a = enrichedSongs[ia];
        const b = enrichedSongs[ib];
        return (b.popularity || 0) - (a.popularity || 0) ||
            (b.confidence || 0) - (a.confidence || 0) ||
            compareArtistSort(a, b) ||
            compareSongSort(a, b);
    });

    const availableMoods = [...availableMoodsSet].sort(compareText);
    const availableGenres = [...availableGenresSet].sort(compareText);
    const availableDecades = [...availableDecadesSet].sort(compareDecade);
    const availableHolidays = [...availableHolidaysSet].sort(compareText);
    const availableLengths = ["Short (< 3 min)", "Standard (3–5 min)", "Long (5+ min)"]
        .filter((value) => availableLengthsSet.has(value));
    const whatsNew = buildWhatsNewIndex(enrichedSongs, whatsNewSource);

    return {
        songs: enrichedSongs,
        promotedGenreTags,
        popularThreshold,
        defaultRankedIndices,
        availableMoods,
        availableGenres,
        availableDecades,
        availableHolidays,
        availableLengths,
        whatsNewIndices: whatsNew.indices,
        whatsNewLatest: whatsNew.latest,
    };
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        POPULAR_PILL_PERCENTILE,
        TAG_GENRE_MIN_COUNT,
        createEmptyTagConsolidation,
        normalizeTagConsolidation,
        createEmptyMoodConsolidation,
        normalizeMoodConsolidation,
        getSongLengthBucket,
        dedupeValues,
        getSongVersionKey,
        normalizeVersionTitle,
        isGenreLikeTag,
        formatGenreTagLabel,
        toGenreLabel,
        chooseArtistNameVariant,
        getArtistNameScore,
        getArtistNameCandidates,
        getArtistKey,
        getSongIdentity,
        getPrimaryArtistName,
        getDisplayArtist,
        normalizeArtistKey,
        getDisplaySongTitle,
        stripTrailingArtist,
        cleanDisplayValue,
        getConsolidatedMoodsForSong,
        getSongGenres,
        getSongMoods,
        includesValue,
        getHolidayValues,
        computeHolidayValues,
        recordSoloArtistCount,
        detectDuetSource,
        hasFlag,
        getDisplayFlags,
        buildEraEnrichmentMap,
        buildAudioEnrichmentMap,
        buildWhatsNewIndex,
        prepareCatalogSync,
    };
}
