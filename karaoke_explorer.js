const APP_VERSION = "20260714-1";
const DATA_URL = `karaoke_songs_enriched.json?v=${APP_VERSION}`;
const TAG_CONSOLIDATION_URL = `tag_consolidation.json?v=${APP_VERSION}`;
const MOOD_CONSOLIDATION_URL = `mood_consolidation.json?v=${APP_VERSION}`;
const RESULT_BATCH_SIZE = 160;
const SEARCH_RENDER_DELAY = 90;
const SEARCH_SCOPES = ["all", "song", "artist"];
const TAG_GENRE_MIN_COUNT = 50;
const THEME_STORAGE_KEY = "karaokeTheme";
const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
const UI_STATE_STORAGE_KEY = "karaokeUiState";
const FAVORITES_STORAGE_KEY = "karaokeFavorites";
const LINK_MENU_STORAGE = new WeakMap();
const TAG_MENU_STORAGE = new WeakMap();
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
const loadStatusTimers = [];
let searchRenderTimer = 0;
let draggedSetlistIndex = null;
applyStoredTheme();

const state = {
    songs: [],
    visibleSongs: [],
    currentSongs: [],
    matchCount: 0,
    resultLimit: RESULT_BATCH_SIZE,
    query: "",
    searchScope: "all",
    autoFuzzy: false,
    randomPick: null,
    snackbarTimer: 0,
    snackbarAction: null,
    fuzzySearch: false,
    favoriteOnly: false,
    sortMode: "relevance",
    availableMoods: [],
    availableGenres: [],
    availableDecades: [],
    availableHolidays: [],
    defaultRankedSongs: [],
    cachedDiscoverShelves: null,
    promotedGenreTags: new Map(),
    tagConsolidation: createEmptyTagConsolidation(),
    moodConsolidation: createEmptyMoodConsolidation(),
    filters: {
        mood: "",
        genre: "",
        decade: "",
        holiday: "",
        duet: false,
        explicit: false,
    },
    mode: "search",
    browseBy: "song",
    browseLetter: "#",
    groupOpenMode: "auto",
    setlist: loadSetlist(),
    favorites: loadFavorites(),
};

const els = {
    status: document.getElementById("status"),
    searchInput: document.getElementById("searchInput"),
    randomButton: document.getElementById("randomButton"),
    clearButton: document.getElementById("clearButton"),
    themeButton: document.getElementById("themeButton"),
    searchModeButton: document.getElementById("searchModeButton"),
    browseModeButton: document.getElementById("browseModeButton"),
    searchScope: document.getElementById("searchScope"),
    searchScopeInputs: [...document.querySelectorAll('input[name="searchScope"]')],
    searchFilters: document.getElementById("searchFilters"),
    filtersToggleButton: document.getElementById("filtersToggleButton"),
    filterCountBadge: document.getElementById("filterCountBadge"),
    closeFiltersButton: document.getElementById("closeFiltersButton"),
    applyFiltersButton: document.getElementById("applyFiltersButton"),
    sheetBackdrop: document.getElementById("sheetBackdrop"),
    moodFilter: document.getElementById("moodFilter"),
    genreFilter: document.getElementById("genreFilter"),
    decadeFilter: document.getElementById("decadeFilter"),
    holidayFilter: document.getElementById("holidayFilter"),
    duetFilter: document.getElementById("duetFilter"),
    explicitFilter: document.getElementById("explicitFilter"),
    favoriteFilter: document.getElementById("favoriteFilter"),
    fuzzySearch: document.getElementById("fuzzySearch"),
    clearFiltersButton: document.getElementById("clearFiltersButton"),
    activeFilters: document.getElementById("activeFilters"),
    orderRelevanceButton: document.getElementById("orderRelevanceButton"),
    orderSongButton: document.getElementById("orderSongButton"),
    orderArtistButton: document.getElementById("orderArtistButton"),
    browseTools: document.getElementById("browseTools"),
    browseSongButton: document.getElementById("browseSongButton"),
    browseArtistButton: document.getElementById("browseArtistButton"),
    letterStrip: document.getElementById("letterStrip"),
    resultsList: document.getElementById("resultsList"),
    searchNotice: document.getElementById("searchNotice"),
    randomPick: document.getElementById("randomPick"),
    resultActions: document.getElementById("resultActions"),
    groupActions: document.getElementById("groupActions"),
    expandGroupsButton: document.getElementById("expandGroupsButton"),
    collapseGroupsButton: document.getElementById("collapseGroupsButton"),
    showMoreResultsButton: document.getElementById("showMoreResultsButton"),
    showAllResultsButton: document.getElementById("showAllResultsButton"),
    browseList: document.getElementById("browseList"),
    resultCount: document.getElementById("resultCount"),
    resultContext: document.getElementById("resultContext"),
    setlist: document.getElementById("setlist"),
    setlistCount: document.getElementById("setlistCount"),
    copySetlistButton: document.getElementById("copySetlistButton"),
    shareSetlistButton: document.getElementById("shareSetlistButton"),
    snackbar: document.getElementById("snackbar"),
    snackbarText: document.getElementById("snackbarText"),
    snackbarAction: document.getElementById("snackbarAction"),
    resultsSentinel: document.getElementById("resultsSentinel"),
    clearSetlistButton: document.getElementById("clearSetlistButton"),
    closeSetlistButton: document.getElementById("closeSetlistButton"),
    mobileSetlistButton: document.getElementById("mobileSetlistButton"),
    dataDialog: document.getElementById("dataDialog"),
    fileInput: document.getElementById("fileInput"),
};

window.addEventListener("error", (event) => {
    if (event.target !== window || state.songs.length) {
        return;
    }

    els.status.textContent = "Songbook failed to load";
});

window.addEventListener("unhandledrejection", () => {
    if (!state.songs.length) {
        els.status.textContent = "Songbook failed to load";
    }
});

init();

async function init() {
    bindEvents();
    bindResultsSentinel();
    renderThemeButton();
    applyInitialState();
    startLoadStatus();

    try {
        const tagConsolidationPromise = loadTagConsolidation();
        const moodConsolidationPromise = loadMoodConsolidation();
        const response = await fetch(DATA_URL);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const text = await response.text();
        els.status.textContent = "Preparing songbook";
        await nextFrame();

        const songs = JSON.parse(text);
        els.status.textContent = "Building songbook";
        await nextFrame();

        state.tagConsolidation = await tagConsolidationPromise;
        state.moodConsolidation = await moodConsolidationPromise;
        useSongs(songs);
    } catch (error) {
        console.error(error);
        els.status.textContent = "Songbook JSON not loaded";
        if (typeof els.dataDialog.showModal === "function") {
            els.dataDialog.showModal();
        }
    } finally {
        stopLoadStatus();
    }
}

function bindEvents() {
    els.themeButton.addEventListener("click", () => {
        const nextTheme = getTheme() === "dark" ? "light" : "dark";
        setTheme(nextTheme);
    });

    els.searchInput.addEventListener("input", () => {
        state.query = els.searchInput.value.trim();
        state.mode = "search";
        resetResultLimit();
        saveUiState();
        scheduleSearchRender();
    });

    for (const input of els.searchScopeInputs) {
        input.addEventListener("change", () => {
            state.searchScope = input.value;
            state.mode = "search";
            resetResultLimit();
            updateSearchPlaceholder();
            render();
            els.searchInput.focus();
        });
    }

    for (const [filterName, element] of [
        ["mood", els.moodFilter],
        ["genre", els.genreFilter],
        ["decade", els.decadeFilter],
        ["holiday", els.holidayFilter],
    ]) {
        element.addEventListener("change", () => {
            state.filters[filterName] = element.value;
            state.mode = "search";
            resetResultLimit();
            render();
        });
    }

    els.duetFilter.addEventListener("change", () => {
        state.filters.duet = els.duetFilter.checked;
        state.mode = "search";
        resetResultLimit();
        render();
    });

    els.explicitFilter.addEventListener("change", () => {
        state.filters.explicit = els.explicitFilter.checked;
        state.mode = "search";
        resetResultLimit();
        render();
    });

    els.favoriteFilter.addEventListener("change", () => {
        state.favoriteOnly = els.favoriteFilter.checked;
        state.mode = "search";
        resetResultLimit();
        render();
    });

    els.fuzzySearch.addEventListener("change", () => {
        state.fuzzySearch = els.fuzzySearch.checked;
        state.mode = "search";
        resetResultLimit();
        render();
    });

    els.clearFiltersButton.addEventListener("click", () => {
        clearSearchFilters();
        state.mode = "search";
        resetResultLimit();
        render();
    });

    els.orderRelevanceButton.addEventListener("click", () => setSearchOrder("relevance"));
    els.orderSongButton.addEventListener("click", () => setSearchOrder("song"));
    els.orderArtistButton.addEventListener("click", () => setSearchOrder("artist"));
    els.expandGroupsButton.addEventListener("click", () => setGroupedResultsOpen(true));
    els.collapseGroupsButton.addEventListener("click", () => setGroupedResultsOpen(false));

    els.clearButton.addEventListener("click", () => {
        clearSearchQuery();
        state.mode = "search";
        resetResultLimit();
        render();
        els.searchInput.focus();
    });

    els.searchModeButton.addEventListener("click", () => {
        state.mode = "search";
        render();
        els.searchInput.focus();
    });

    els.browseModeButton.addEventListener("click", () => {
        state.mode = "browse";
        ensureBrowseLetter();
        render();
    });

    els.browseSongButton.addEventListener("click", () => {
        state.browseBy = "song";
        ensureBrowseLetter();
        render();
    });

    els.browseArtistButton.addEventListener("click", () => {
        state.browseBy = "artist";
        ensureBrowseLetter();
        render();
    });

    els.randomButton.addEventListener("click", pickRandomSong);

    els.showMoreResultsButton.addEventListener("click", () => {
        state.resultLimit = Math.min(state.resultLimit + RESULT_BATCH_SIZE, state.matchCount);
        render();
    });

    els.showAllResultsButton.addEventListener("click", () => {
        state.resultLimit = state.matchCount;
        render();
    });

    els.mobileSetlistButton.addEventListener("click", openSetlistDrawer);
    els.closeSetlistButton.addEventListener("click", () => closeSetlistDrawer());

    els.filtersToggleButton.addEventListener("click", () => {
        if (document.body.classList.contains("filters-open")) {
            closeFiltersSheet();
        } else {
            openFiltersSheet();
        }
    });

    els.closeFiltersButton.addEventListener("click", () => closeFiltersSheet());
    els.applyFiltersButton.addEventListener("click", () => closeFiltersSheet());

    els.sheetBackdrop.addEventListener("click", () => {
        closeFiltersSheet({ restoreFocus: false });
        closeSetlistDrawer({ restoreFocus: false });
    });

    document.addEventListener("click", (event) => {
        if (!event.target.closest(".song-popout")) {
            closeSongLinkMenus();
            closeSongTagMenus();
        }
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            closeSongLinkMenus();
            closeSongTagMenus();
            closeFiltersSheet();
            closeSetlistDrawer();
            return;
        }

        if (event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey) {
            const target = event.target;
            const isTyping = target instanceof HTMLElement &&
                (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA" || target.isContentEditable);
            if (!isTyping) {
                event.preventDefault();
                els.searchInput.focus();
                els.searchInput.select();
            }
        }
    });

    els.shareSetlistButton.hidden = typeof navigator.share !== "function";
    els.shareSetlistButton.addEventListener("click", async () => {
        const text = buildSetlistText();
        if (!text) {
            return;
        }

        try {
            await navigator.share({ title: "Karaoke setlist", text });
        } catch {
            // Share sheet dismissed or unavailable; nothing to clean up.
        }
    });

    els.snackbarAction.addEventListener("click", () => {
        const action = state.snackbarAction;
        hideSnackbar();
        if (action) {
            action();
        }
    });

    els.copySetlistButton.addEventListener("click", async () => {
        const text = buildSetlistText();
        if (!text) {
            return;
        }

        try {
            await navigator.clipboard.writeText(text);
            els.copySetlistButton.classList.add("copied");
            els.copySetlistButton.title = "Copied";
            setTimeout(() => {
                els.copySetlistButton.classList.remove("copied");
                els.copySetlistButton.title = "Copy setlist";
            }, 800);
        } catch {
            els.copySetlistButton.classList.add("copy-failed");
            els.copySetlistButton.title = "Copy failed";
            setTimeout(() => {
                els.copySetlistButton.classList.remove("copy-failed");
                els.copySetlistButton.title = "Copy setlist";
            }, 1200);
        }
    });

    els.clearSetlistButton.addEventListener("click", () => {
        if (!state.setlist.length) {
            return;
        }

        const cleared = state.setlist;
        state.setlist = [];
        saveSetlist();
        renderSetlist();
        showSnackbar(
            `Setlist cleared (${cleared.length} ${cleared.length === 1 ? "song" : "songs"})`,
            () => {
                state.setlist = cleared;
                saveSetlist();
                renderSetlist();
            }
        );
    });

    els.fileInput.addEventListener("change", async () => {
        const file = els.fileInput.files[0];
        if (!file) {
            return;
        }

        const songs = JSON.parse(await file.text());
        useSongs(songs);
        els.dataDialog.close();
    });
}

function useSongs(songs) {
    const artistNames = buildCanonicalArtistNames(songs);
    const preparedSongs = songs.map((song, index) => {
        const artistKey = getArtistKey(song);
        const displayArtist = artistNames.get(artistKey) || getPrimaryArtistName(song);
        const songSearchText = normalize(song.song);
        const artistSearchText = normalize([
            displayArtist,
            song.artist,
            song.lookupArtist,
        ].join(" "));

        return {
            ...song,
            artistKey,
            displayArtist,
            id: getSongIdentity(song),
            legacyId: `${artistKey || normalize(song.artist)}\u001f${normalize(song.song)}\u001f${index}`,
            songLetter: getBrowseLetter(song.song),
            artistLetter: getBrowseLetter(displayArtist),
            songSearchText,
            artistSearchText,
            allSearchText: `${songSearchText} ${artistSearchText}`,
            songSortText: songSearchText,
            artistSortText: normalize(displayArtist),
            songWords: getSearchWords(song.song),
            artistWords: getSearchWords(artistSearchText),
        };
    });

    state.promotedGenreTags = getPromotedGenreTagMap(preparedSongs);
    state.songs = preparedSongs.map((song) => {
        const sourceGenres = getPromotedGenresForSong(song, state.promotedGenreTags);
        const allGenres = dedupeValues([...(song.genres || []), ...sourceGenres]);
        const enrichedSong = {
            ...song,
            sourceGenres,
            allGenres,
        };
        const sourceMoods = getConsolidatedMoodsForSong(enrichedSong);
        const allMoods = dedupeValues([...(song.moods || []), ...sourceMoods]);

        return {
            ...enrichedSong,
            sourceMoods,
            allMoods,
        };
    });
    state.defaultRankedSongs = [...state.songs].sort((a, b) =>
        (b.confidence || 0) - (a.confidence || 0) ||
        compareArtistSort(a, b) ||
        compareSongSort(a, b)
    );

    state.availableMoods = getAvailableValues(getSongMoods);
    state.availableGenres = getAvailableValues(getSongGenres);
    state.availableDecades = getAvailableDecades();
    state.availableHolidays = getAvailableValues(getHolidayValues);
    state.cachedDiscoverShelves = null;
    renderFilterOptions();
    updateSearchPlaceholder();
    ensureBrowseLetter();
    renderSetlist();
    renderThemeButton();
    render();
}

function startLoadStatus() {
    els.status.textContent = "Loading songbook";

    for (const [delay, message] of [
        [2000, "Downloading songbook"],
        [8000, "Still downloading songbook"],
        [16000, "Large songbook, still loading"],
    ]) {
        loadStatusTimers.push(setTimeout(() => {
            if (!state.songs.length) {
                els.status.textContent = message;
            }
        }, delay));
    }
}

function stopLoadStatus() {
    while (loadStatusTimers.length) {
        clearTimeout(loadStatusTimers.pop());
    }
}

function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(resolve));
}

function hydrateIcons(root = document) {
    for (const placeholder of root.querySelectorAll("i[data-lucide]")) {
        placeholder.replaceWith(createIcon(placeholder.dataset.lucide));
    }
}

function createIcon(name) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");

    const use = document.createElementNS(SVG_NS, "use");
    use.setAttribute("href", `#icon-${name}`);
    use.setAttributeNS(XLINK_NS, "xlink:href", `#icon-${name}`);
    svg.appendChild(use);
    return svg;
}

async function loadTagConsolidation() {
    try {
        const response = await fetch(TAG_CONSOLIDATION_URL);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        return normalizeTagConsolidation(await response.json());
    } catch (error) {
        console.warn("Tag consolidation did not load; using local genre heuristics.", error);
        return createEmptyTagConsolidation();
    }
}

function createEmptyTagConsolidation() {
    return {
        minLastFmSongs: TAG_GENRE_MIN_COUNT,
        genreTags: new Map(),
        hiddenOtherTags: new Set(),
    };
}

function normalizeTagConsolidation(raw = {}) {
    const normalized = createEmptyTagConsolidation();
    const minLastFmSongs = Number(raw.thresholds?.minLastFmSongs || raw.minLastFmSongs || TAG_GENRE_MIN_COUNT);
    normalized.minLastFmSongs = Number.isFinite(minLastFmSongs) ? minLastFmSongs : TAG_GENRE_MIN_COUNT;

    for (const item of raw.genreTags || []) {
        const key = normalize(item.tag);
        const label = item.label || toGenreLabel(item.tag);
        if (key && label) {
            normalized.genreTags.set(key, label);
        }
    }

    for (const [tag, label] of Object.entries(raw.aliases || {})) {
        const key = normalize(tag);
        if (key && label) {
            normalized.genreTags.set(key, label);
        }
    }

    for (const tag of raw.hiddenOtherTags || []) {
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

async function loadMoodConsolidation() {
    try {
        const response = await fetch(MOOD_CONSOLIDATION_URL);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        return normalizeMoodConsolidation(await response.json());
    } catch (error) {
        console.warn("Mood consolidation did not load; using catalog moods only.", error);
        return createEmptyMoodConsolidation();
    }
}

function createEmptyMoodConsolidation() {
    return {
        moods: [],
    };
}

function normalizeMoodConsolidation(raw = {}) {
    const normalized = createEmptyMoodConsolidation();

    normalized.moods = (raw.moods || [])
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

    return normalized;
}

function render() {
    cancelScheduledSearchRender();
    renderMode();
    renderSearchFilters();
    renderActiveFilters();

    if (state.mode === "browse") {
        els.searchNotice.hidden = true;
        els.randomPick.hidden = true;
        els.randomPick.innerHTML = "";
        renderBrowse();
        renderStatus(getBrowseSongs().length);
        renderResultContext();
        saveUiState();
        hydrateIcons();
        return;
    }

    let ranked = rankSongs(state.songs, state.query);
    state.autoFuzzy = false;
    if (state.query && !state.fuzzySearch && !ranked.length) {
        const closeMatches = rankSongs(state.songs, state.query, { fuzzy: true });
        if (closeMatches.length) {
            ranked = closeMatches;
            state.autoFuzzy = true;
        }
    }

    const filtered = hasSongFilters() ? applySearchFilters(ranked) : ranked;
    const sorted = sortSongs(filtered);
    const isDiscover = isDiscoverView();
    state.currentSongs = sorted;
    state.matchCount = sorted.length;
    state.visibleSongs = isDiscover ? [] : sorted.slice(0, state.resultLimit);

    renderRandomPick();
    renderSearchNotice();
    if (isDiscover) {
        renderDiscover();
    } else {
        renderResults();
    }
    renderStatus(filtered.length);
    renderResultContext();
    renderResultActions(isDiscover ? 0 : filtered.length);
    saveUiState();

    hydrateIcons();
}

function isDiscoverView() {
    return state.mode === "search" &&
        !normalize(state.query) &&
        !hasSongFilters() &&
        state.sortMode === "relevance";
}

function pickRandomSong() {
    const pool = state.mode === "search" && state.currentSongs.length
        ? state.currentSongs
        : state.songs;
    if (!pool.length) {
        return;
    }

    state.randomPick = pool[Math.floor(Math.random() * pool.length)];
    state.mode = "search";
    render();
    scrollResultsIntoView();
}

function renderRandomPick() {
    els.randomPick.innerHTML = "";
    const song = state.randomPick;
    els.randomPick.hidden = !song;
    if (!song) {
        return;
    }

    const head = document.createElement("div");
    head.className = "random-pick-head";

    const label = document.createElement("span");
    label.className = "random-pick-label";
    label.innerHTML = '<i data-lucide="dices" aria-hidden="true"></i><span>Random pick</span>';

    const spin = document.createElement("button");
    spin.className = "choice-button spin-again";
    spin.type = "button";
    spin.textContent = "Spin again";
    spin.addEventListener("click", pickRandomSong);

    const dismiss = document.createElement("button");
    dismiss.className = "icon-button dismiss-pick";
    dismiss.type = "button";
    dismiss.title = "Dismiss random pick";
    dismiss.setAttribute("aria-label", "Dismiss random pick");
    dismiss.innerHTML = '<i data-lucide="x" aria-hidden="true"></i>';
    dismiss.addEventListener("click", () => {
        state.randomPick = null;
        render();
    });

    head.append(label, spin, dismiss);
    els.randomPick.append(head, createSongCard(song));
}

function renderSearchNotice() {
    const show = state.mode === "search" && state.autoFuzzy && state.matchCount > 0;
    els.searchNotice.hidden = !show;
    els.searchNotice.textContent = show
        ? `No exact matches for “${state.query}” — showing close matches.`
        : "";
}

function bindResultsSentinel() {
    if (typeof IntersectionObserver !== "function") {
        return;
    }

    const observer = new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) {
            return;
        }

        if (state.mode !== "search" || isDiscoverView()) {
            return;
        }

        if (state.visibleSongs.length >= state.matchCount) {
            return;
        }

        state.resultLimit = Math.min(state.resultLimit + RESULT_BATCH_SIZE, state.matchCount);
        render();
    }, { rootMargin: "600px 0px" });

    observer.observe(els.resultsSentinel);
}

function openFiltersSheet() {
    document.body.classList.add("filters-open");
    els.filtersToggleButton.setAttribute("aria-expanded", "true");
    els.searchFilters.setAttribute("role", "dialog");
    els.searchFilters.setAttribute("aria-modal", "true");
    updateSheetBackdrop();
    els.closeFiltersButton.focus({ preventScroll: true });
}

function closeFiltersSheet({ restoreFocus = true } = {}) {
    if (!document.body.classList.contains("filters-open")) {
        return;
    }

    document.body.classList.remove("filters-open");
    els.filtersToggleButton.setAttribute("aria-expanded", "false");
    els.searchFilters.removeAttribute("role");
    els.searchFilters.removeAttribute("aria-modal");
    updateSheetBackdrop();
    if (restoreFocus && els.filtersToggleButton.offsetParent) {
        els.filtersToggleButton.focus({ preventScroll: true });
    }
}

function openSetlistDrawer() {
    const panel = els.setlist.closest(".setlist-panel");
    document.body.classList.add("setlist-open");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "Setlist");
    updateSheetBackdrop();
    els.closeSetlistButton.focus({ preventScroll: true });
}

function closeSetlistDrawer({ restoreFocus = true } = {}) {
    if (!document.body.classList.contains("setlist-open")) {
        return;
    }

    const panel = els.setlist.closest(".setlist-panel");
    document.body.classList.remove("setlist-open");
    panel.removeAttribute("role");
    panel.removeAttribute("aria-modal");
    panel.removeAttribute("aria-label");
    updateSheetBackdrop();
    if (restoreFocus && els.mobileSetlistButton.offsetParent) {
        els.mobileSetlistButton.focus({ preventScroll: true });
    }
}

function updateSheetBackdrop() {
    els.sheetBackdrop.hidden = !document.body.classList.contains("filters-open") &&
        !document.body.classList.contains("setlist-open");
}

function countActiveFilters() {
    return [
        state.filters.mood,
        state.filters.genre,
        state.filters.decade,
        state.filters.holiday,
    ].filter(Boolean).length +
        Number(state.filters.duet) +
        Number(state.filters.explicit) +
        Number(state.favoriteOnly) +
        Number(state.fuzzySearch);
}

function renderMode() {
    const isBrowse = state.mode === "browse";
    setToggleState(els.searchModeButton, !isBrowse);
    setToggleState(els.browseModeButton, isBrowse);
    els.browseTools.hidden = !isBrowse;
    els.searchScope.hidden = isBrowse;
    els.searchFilters.hidden = isBrowse;
    els.filtersToggleButton.hidden = isBrowse;
    if (isBrowse) {
        closeFiltersSheet({ restoreFocus: false });
    }
    els.activeFilters.hidden = isBrowse || !els.activeFilters.childElementCount;
    els.resultsList.hidden = isBrowse;
    els.resultActions.hidden = true;
    els.groupActions.hidden = true;
    els.browseList.hidden = !isBrowse;
}

function scheduleSearchRender() {
    cancelScheduledSearchRender();
    searchRenderTimer = window.setTimeout(() => {
        searchRenderTimer = 0;
        render();
    }, SEARCH_RENDER_DELAY);
}

function cancelScheduledSearchRender() {
    if (searchRenderTimer) {
        window.clearTimeout(searchRenderTimer);
        searchRenderTimer = 0;
    }
}

function rankSongs(songs, query, { fuzzy = state.fuzzySearch } = {}) {
    const tokens = normalize(query).split(" ").filter(Boolean);
    if (!tokens.length) {
        return state.defaultRankedSongs.length ? state.defaultRankedSongs : songs;
    }

    const phrase = tokens.join(" ");
    const scope = state.searchScope;
    const matchesSongs = scope !== "artist";
    const matchesArtists = scope !== "song";
    return songs
        .map((song) => {
            const haystack = getScopedSearchText(song, scope);
            const fuzzyWords = getScopedSearchWords(song, scope);
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

            if (haystack.includes(phrase)) {
                score += 12;
            }

            let songBonus = 0;
            if (matchesSongs) {
                const songText = song.songSearchText || normalize(song.song);
                if (songText === phrase) {
                    songBonus = 18;
                } else if (songText.startsWith(phrase)) {
                    songBonus = 10;
                }
            }

            let artistBonus = 0;
            if (matchesArtists) {
                const artistText = song.artistSortText || normalize(getDisplayArtist(song));
                if (artistText === phrase) {
                    artistBonus = 16;
                } else if (artistText.startsWith(phrase)) {
                    artistBonus = scope === "all" ? 9 : 10;
                }
            }

            score += Math.max(songBonus, artistBonus);
            return { song, score };
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score || compareArtistSort(a.song, b.song) || compareSongSort(a.song, b.song))
        .map((item) => item.song);
}

function applySearchFilters(songs) {
    return songs.filter((song) => {
        if (state.filters.mood && !includesValue(getSongMoods(song), state.filters.mood)) {
            return false;
        }

        if (state.filters.genre && !includesValue(getSongGenres(song), state.filters.genre)) {
            return false;
        }

        if (state.filters.decade && !(song.eras || []).includes(state.filters.decade)) {
            return false;
        }

        if (state.filters.holiday && !getHolidayValues(song).includes(state.filters.holiday)) {
            return false;
        }

        if (state.filters.duet && !hasFlag(song, "Duet")) {
            return false;
        }

        if (state.filters.explicit && !hasFlag(song, "Explicit")) {
            return false;
        }

        if (state.favoriteOnly && !isFavorite(song)) {
            return false;
        }

        return true;
    });
}

function sortSongs(songs) {
    const mode = state.sortMode;

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

function collapseSongVersions(songs) {
    const groups = new Map();

    for (const song of songs) {
        const key = getSongVersionKey(song);
        if (!groups.has(key)) {
            groups.set(key, []);
        }

        groups.get(key).push(song);
    }

    return [...groups.values()].map((group) => ({
        song: group[0],
        songs: group,
    }));
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

function setSearchOrder(mode) {
    state.sortMode = mode;
    state.groupOpenMode = "auto";
    state.mode = "search";
    resetResultLimit();
    render();
}

function resetResultLimit() {
    state.resultLimit = RESULT_BATCH_SIZE;
}

function clearSearchFilters({ resetFuzzy = true } = {}) {
    state.filters.mood = "";
    state.filters.genre = "";
    state.filters.decade = "";
    state.filters.holiday = "";
    state.filters.duet = false;
    state.filters.explicit = false;
    state.favoriteOnly = false;

    if (resetFuzzy) {
        state.fuzzySearch = false;
    }
}

function clearSearchQuery({ resetScope = true } = {}) {
    state.query = "";
    els.searchInput.value = "";

    if (resetScope) {
        state.searchScope = "all";
        syncSearchScopeInput();
        updateSearchPlaceholder();
    }
}

function renderDiscover() {
    els.resultsList.innerHTML = "";
    els.resultsList.classList.remove("is-grouped");
    els.resultsList.classList.add("is-discover");
    renderGroupActions();

    const fragment = document.createDocumentFragment();
    for (const shelf of buildDiscoverShelves()) {
        fragment.appendChild(createShelf(shelf));
    }

    const foot = document.createElement("div");
    foot.className = "discover-foot";
    foot.appendChild(createEmptyAction("Browse titles A–Z", () => {
        state.mode = "browse";
        state.browseBy = "song";
        ensureBrowseLetter();
        render();
    }));
    foot.appendChild(createEmptyAction("Browse artists A–Z", () => {
        state.mode = "browse";
        state.browseBy = "artist";
        ensureBrowseLetter();
        render();
    }));
    fragment.appendChild(foot);

    els.resultsList.appendChild(fragment);
}

function buildDiscoverShelves() {
    const shelves = [];

    const favorites = state.songs
        .filter((song) => isFavorite(song))
        .sort((a, b) => compareArtistSort(a, b) || compareSongSort(a, b));
    if (favorites.length) {
        shelves.push({
            title: "Your favorites",
            songs: favorites.slice(0, 8),
            seeAll: () => applyShelfFilter(() => {
                state.favoriteOnly = true;
            }),
        });
    }

    if (!state.cachedDiscoverShelves) {
        state.cachedDiscoverShelves = buildSampledShelves();
    }

    return [...shelves, ...state.cachedDiscoverShelves];
}

function buildSampledShelves() {
    const shelves = [];
    const tagged = state.songs.filter((song) => song.status === "ok");

    shelves.push({
        title: "Lucky dip",
        songs: sampleSongs(tagged.length ? tagged : state.songs, 8),
    });

    const seasonalHoliday = getSeasonalHoliday();
    if (seasonalHoliday) {
        shelves.push({
            title: `${seasonalHoliday} songs`,
            songs: sampleSongs(state.songs.filter((song) => getHolidayValues(song).includes(seasonalHoliday)), 8),
            seeAll: () => applyPillFilter("holiday", seasonalHoliday),
        });
    }

    for (const mood of ["Singalong", "Party"]) {
        const label = findAvailableValue(state.availableMoods, mood);
        if (!label) {
            continue;
        }

        shelves.push({
            title: label,
            songs: sampleSongs(state.songs.filter((song) => includesValue(getSongMoods(song), label)), 8),
            seeAll: () => applyPillFilter("mood", label),
        });
    }

    const duets = state.songs.filter((song) => hasFlag(song, "Duet"));
    if (duets.length) {
        shelves.push({
            title: "Duets",
            songs: sampleSongs(duets, 8),
            seeAll: () => applyShelfFilter(() => {
                state.filters.duet = true;
            }),
        });
    }

    for (const decade of ["70s", "80s", "90s"]) {
        const label = findAvailableValue(state.availableDecades, decade);
        if (!label) {
            continue;
        }

        shelves.push({
            title: `Big in the ${label}`,
            songs: sampleSongs(state.songs.filter((song) => (song.eras || []).includes(label)), 8),
            seeAll: () => applyPillFilter("decade", label),
        });
    }

    return shelves.filter((shelf) => shelf.songs.length >= 4);
}

function getSeasonalHoliday() {
    const month = new Date().getMonth();
    let target = "";
    if (month === 9) {
        target = "Halloween";
    } else if (month === 10 || month === 11) {
        target = "Christmas";
    }

    return target ? findAvailableValue(state.availableHolidays, target) : "";
}

function findAvailableValue(values, target) {
    const key = normalize(target);
    return (values || []).find((value) => normalize(value) === key) || "";
}

function sampleSongs(pool, count) {
    const shuffled = [...pool];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const picked = [];
    const usedArtists = new Set();
    for (const song of shuffled) {
        const artistKey = song.artistKey || normalize(getDisplayArtist(song));
        if (usedArtists.has(artistKey)) {
            continue;
        }

        usedArtists.add(artistKey);
        picked.push(song);
        if (picked.length === count) {
            return picked;
        }
    }

    for (const song of shuffled) {
        if (picked.length === count) {
            break;
        }

        if (!picked.includes(song)) {
            picked.push(song);
        }
    }

    return picked;
}

function applyShelfFilter(mutate) {
    mutate();
    state.mode = "search";
    resetResultLimit();
    render();
    scrollResultsIntoView();
}

function createShelf(shelf) {
    const section = document.createElement("section");
    section.className = "shelf";

    const head = document.createElement("div");
    head.className = "shelf-head";

    const title = document.createElement("h3");
    title.textContent = shelf.title;
    head.appendChild(title);

    if (shelf.seeAll) {
        const seeAll = document.createElement("button");
        seeAll.className = "see-all";
        seeAll.type = "button";
        seeAll.textContent = "See all";
        seeAll.title = `See all: ${shelf.title}`;
        seeAll.addEventListener("click", shelf.seeAll);
        head.appendChild(seeAll);
    }

    const row = document.createElement("div");
    row.className = "shelf-row";
    for (const song of shelf.songs) {
        row.appendChild(createSongCard(song));
    }

    section.append(head, row);
    return section;
}

function renderResults() {
    els.resultsList.innerHTML = "";
    els.resultsList.classList.remove("is-discover");
    els.resultsList.classList.toggle("is-grouped", shouldGroupSearchResults());
    renderGroupActions();

    if (!state.visibleSongs.length) {
        renderEmptySearchState();
        return;
    }

    if (shouldGroupSearchResults()) {
        renderGroupedSearchResults();
        return;
    }

    const fragment = document.createDocumentFragment();
    for (const item of collapseSongVersions(state.visibleSongs)) {
        fragment.appendChild(item.songs.length > 1 ? createVersionGroupCard(item.songs) : createSongCard(item.song));
    }

    els.resultsList.appendChild(fragment);
}

function renderEmptySearchState() {
    const empty = document.createElement("div");
    empty.className = "empty-state search-empty";

    const title = document.createElement("strong");
    title.textContent = "No matches";
    empty.appendChild(title);

    const suggestions = getEmptySearchSuggestions();
    if (suggestions.length) {
        const suggestionWrap = document.createElement("div");
        suggestionWrap.className = "empty-suggestions";

        const suggestionLabel = document.createElement("span");
        suggestionLabel.textContent = "Try";
        suggestionWrap.appendChild(suggestionLabel);

        for (const suggestion of suggestions) {
            const button = document.createElement("button");
            button.className = "empty-suggestion";
            button.type = "button";
            button.textContent = suggestion.label;
            button.title = suggestion.detail || suggestion.label;
            button.addEventListener("click", () => {
                state.query = suggestion.query;
                els.searchInput.value = suggestion.query;
                state.searchScope = suggestion.scope;
                state.fuzzySearch = false;
                state.mode = "search";
                syncSearchScopeInput();
                updateSearchPlaceholder();
                resetResultLimit();
                render();
                els.searchInput.focus();
            });
            suggestionWrap.appendChild(button);
        }

        empty.appendChild(suggestionWrap);
    }

    const actions = document.createElement("div");
    actions.className = "empty-actions";

    if (state.query && !state.fuzzySearch) {
        actions.appendChild(createEmptyAction("Enable fuzzy", () => {
            state.fuzzySearch = true;
            resetResultLimit();
            render();
        }));
    }

    if (hasActiveSearchFilters()) {
        actions.appendChild(createEmptyAction("Clear filters", () => {
            clearSearchFilters();
            resetResultLimit();
            render();
        }));
    }

    if (state.query) {
        actions.appendChild(createEmptyAction("Clear search", () => {
            clearSearchQuery();
            resetResultLimit();
            render();
            els.searchInput.focus();
        }));
    }

    if (actions.childElementCount) {
        empty.appendChild(actions);
    }

    els.resultsList.appendChild(empty);
}

function createEmptyAction(label, onClick) {
    const button = document.createElement("button");
    button.className = "choice-button empty-action";
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
}

function getEmptySearchSuggestions(limit = 5) {
    const tokens = normalize(state.query).split(" ").filter((token) => token.length > 2);
    if (!tokens.length || state.fuzzySearch) {
        return [];
    }

    const isArtistSearch = state.searchScope === "artist";
    const sourceSongs = hasSongFilters() ? applySearchFilters(state.songs) : state.songs;
    const seen = new Set();
    const suggestions = [];

    for (const song of sourceSongs) {
        const haystack = getScopedSearchText(song);
        const words = getScopedSearchWords(song);
        let score = 0;

        for (const token of tokens) {
            if (haystack.includes(token)) {
                score += 8;
                continue;
            }

            const fuzzyScore = getFuzzyTokenScore(token, words);
            if (fuzzyScore) {
                score += fuzzyScore;
            }
        }

        if (!score) {
            continue;
        }

        const query = isArtistSearch ? getDisplayArtist(song) : song.song;
        const key = normalize(`${state.searchScope}\u001f${query}`);
        if (!query || seen.has(key)) {
            continue;
        }

        seen.add(key);
        suggestions.push({
            query,
            scope: state.searchScope,
            label: isArtistSearch ? query : song.song,
            detail: isArtistSearch ? `${query}` : `${song.song} - ${getDisplayArtist(song)}`,
            score,
            song,
        });
    }

    return suggestions
        .sort((a, b) => b.score - a.score || compareSongSort(a.song, b.song))
        .slice(0, limit);
}

function renderGroupedSearchResults() {
    const fragment = document.createDocumentFragment();
    const sortMode = state.sortMode;

    if (sortMode === "artist") {
        for (const group of groupByArtist(state.visibleSongs)) {
            const section = createBrowseSection(group.artist, group.songs.length, false);
            const body = section.querySelector(".browse-items");
            section.open = shouldOpenGroup(group.songs.length);

            for (const song of group.songs) {
                body.appendChild(createGroupedSongRow(song, false));
            }

            fragment.appendChild(section);
        }
    } else {
        const groups = groupBySongLetter(state.visibleSongs);
        for (const group of groups) {
            const section = createBrowseSection(group.letter, group.songs.length, true);
            const body = section.querySelector(".browse-items");
            section.open = shouldOpenGroup(group.songs.length);

            for (const song of group.songs) {
                body.appendChild(createGroupedSongRow(song, true));
            }

            fragment.appendChild(section);
        }
    }

    els.resultsList.appendChild(fragment);
}

function renderGroupActions() {
    els.groupActions.hidden = !shouldGroupSearchResults() || !state.visibleSongs.length;
    els.expandGroupsButton.disabled = state.groupOpenMode === "expanded";
    els.collapseGroupsButton.disabled = state.groupOpenMode === "collapsed";
}

function setGroupedResultsOpen(open) {
    state.groupOpenMode = open ? "expanded" : "collapsed";
    for (const section of els.resultsList.querySelectorAll(".browse-section")) {
        section.open = open;
    }
    renderGroupActions();
}

function shouldOpenGroup(count) {
    if (state.groupOpenMode === "expanded") {
        return true;
    }

    if (state.groupOpenMode === "collapsed") {
        return false;
    }

    return state.sortMode === "artist" && count <= 8;
}

function createGroupedSongRow(song, showArtist) {
    const row = document.createElement("div");
    row.className = showArtist ? "browse-row" : "artist-song-row";

    const title = document.createElement("div");
    title.className = "browse-title";
    title.textContent = getDisplaySongTitle(song);

    if (showArtist) {
        row.append(title, createArtistSearchControl(song, "browse-artist"), createRowTools(song));
    } else {
        row.append(title, createRowTools(song));
    }

    return row;
}

function renderBrowse() {
    renderBrowseControls();
    els.browseList.innerHTML = "";

    const songs = getBrowseSongs();
    state.currentSongs = sortForBrowse(songs);
    if (!songs.length) {
        els.browseList.innerHTML = '<p class="empty-state">No songs in this letter</p>';
        return;
    }

    const fragment = document.createDocumentFragment();
    if (state.browseBy === "artist") {
        renderArtistBrowse(songs, fragment);
    } else {
        renderSongBrowse(songs, fragment);
    }

    els.browseList.appendChild(fragment);
}

function renderBrowseControls() {
    setToggleState(els.browseSongButton, state.browseBy === "song");
    setToggleState(els.browseArtistButton, state.browseBy === "artist");

    const counts = getLetterCounts();
    const letters = ["#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];

    els.letterStrip.innerHTML = "";
    for (const letter of letters) {
        const count = counts.get(letter) || 0;
        const button = document.createElement("button");
        button.className = "letter-button";
        button.type = "button";
        button.dataset.letter = letter;
        setToggleState(button, state.browseLetter === letter);
        button.disabled = count === 0;
        button.textContent = letter;
        button.addEventListener("click", () => {
            state.browseLetter = letter;
            render();
        });
        els.letterStrip.appendChild(button);
    }
}

function renderSongBrowse(songs, fragment) {
    const section = createBrowseSection(state.browseLetter, songs.length, true);
    const body = section.querySelector(".browse-items");

    for (const song of sortForBrowse(songs)) {
        body.appendChild(createBrowseRow(song));
    }

    fragment.appendChild(section);
}

function renderArtistBrowse(songs, fragment) {
    const groups = groupByArtist(songs);
    for (const group of groups) {
        const section = createBrowseSection(group.artist, group.songs.length, false);
        const body = section.querySelector(".browse-items");
        section.open = groups.length <= 8;

        for (const song of group.songs) {
            const row = document.createElement("div");
            row.className = "artist-song-row";

            const title = document.createElement("div");
            title.className = "browse-title";
            title.textContent = getDisplaySongTitle(song);

            row.append(title, createRowTools(song));
            body.appendChild(row);
        }

        fragment.appendChild(section);
    }
}

function createBrowseSection(label, count, open) {
    const section = document.createElement("details");
    section.className = "browse-section";
    section.open = open;

    const summary = document.createElement("summary");
    const title = document.createElement("span");
    title.textContent = label || "Unknown";

    const countLabel = document.createElement("span");
    countLabel.className = "browse-count";
    countLabel.textContent = `${Number(count || 0).toLocaleString()} ${count === 1 ? "song" : "songs"}`;

    const body = document.createElement("div");
    body.className = "browse-items";

    summary.append(title, countLabel);
    section.append(summary, body);
    return section;
}

function createBrowseRow(song) {
    const row = document.createElement("div");
    row.className = "browse-row";

    const title = document.createElement("div");
    title.className = "browse-title";
    title.textContent = getDisplaySongTitle(song);

    row.append(title, createArtistSearchControl(song, "browse-artist"), createRowTools(song));
    return row;
}

function createRowTools(song) {
    const tools = document.createElement("div");
    tools.className = "row-tools";
    tools.append(createFavoriteButton(song), createSongTags(song), createSongLinks(song), createMiniAddButton(song));
    return tools;
}

function createFavoriteButton(song) {
    const active = isFavorite(song);
    const button = document.createElement("button");
    button.className = "icon-button favorite-button";
    button.classList.toggle("is-active", active);
    button.type = "button";
    button.title = active ? "Remove favorite" : "Add favorite";
    button.setAttribute("aria-label", active ? "Remove favorite" : "Add favorite");
    button.innerHTML = '<i data-lucide="star" aria-hidden="true"></i>';
    button.addEventListener("click", () => toggleFavorite(song));
    return button;
}

function createMiniAddButton(song) {
    const button = document.createElement("button");
    button.className = "mini-add";
    button.type = "button";
    button.title = "Add to setlist";
    button.textContent = "+";
    button.addEventListener("click", () => addToSetlist(song));
    return button;
}

function createSongCard(song) {
    const card = document.createElement("article");
    card.className = "song-card";

    const text = document.createElement("div");
    const title = document.createElement("div");
    title.className = "song-title";
    title.textContent = getDisplaySongTitle(song);

    text.append(title, createArtistSearchControl(song, "song-artist"));

    const meta = document.createElement("div");
    meta.className = "meta-row";
    appendPills(meta, getSongMoods(song), "mood", "mood");
    appendPills(meta, getSongGenres(song), "genre", "genre");
    appendPills(meta, song.eras, "era", "decade");
    appendPills(meta, getHolidayValues(song), "flag", "holiday");
    appendPills(meta, getDisplayFlags(song), "flag");

    if (!meta.childElementCount && (song.tags || []).length) {
        appendPills(meta, song.tags.slice(0, 3), "");
    }

    capPills(meta, 5);

    const actions = document.createElement("div");
    actions.className = "card-actions";

    const cardTools = document.createElement("div");
    cardTools.className = "card-tools";
    cardTools.append(createFavoriteButton(song), createSongLinks(song));

    const button = document.createElement("button");
    button.className = "add-button";
    button.type = "button";
    button.textContent = "Add";
    button.addEventListener("click", () => addToSetlist(song));

    actions.append(cardTools, button);
    card.append(text, meta, actions);
    return card;
}

function createVersionGroupCard(songs) {
    const [primary, ...versions] = songs;
    const card = createSongCard(primary);
    card.classList.add("has-versions");

    const details = document.createElement("details");
    details.className = "version-group";

    const summary = document.createElement("summary");
    summary.textContent = `${songs.length} versions`;
    details.appendChild(summary);

    const list = document.createElement("div");
    list.className = "version-list";

    for (const song of versions) {
        const row = document.createElement("div");
        row.className = "version-row";

        const title = document.createElement("div");
        title.className = "version-title";
        title.textContent = getDisplaySongTitle(song);

        row.append(title, createRowTools(song));
        list.appendChild(row);
    }

    details.appendChild(list);
    card.appendChild(details);
    return card;
}

function createArtistSearchControl(song, className) {
    const artistName = getDisplayArtist(song);
    const artist = document.createElement(artistName ? "button" : "div");
    artist.className = className;
    artist.textContent = artistName || "Unknown artist";

    if (artistName) {
        artist.type = "button";
        artist.title = `Show songs by ${artistName}`;
        artist.addEventListener("click", () => applyArtistSearch(artistName));
    }

    return artist;
}

function createSongLinks(song) {
    const container = document.createElement("div");
    container.className = "song-popout song-links";

    const query = encodeURIComponent(`${getDisplayArtist(song)} ${song.song || ""}`.trim());
    const button = document.createElement("button");
    button.className = "icon-button link-popout-button";
    button.type = "button";
    button.title = "Music links";
    button.setAttribute("aria-label", "Music links");
    button.setAttribute("aria-haspopup", "true");
    button.setAttribute("aria-expanded", "false");
    button.innerHTML = '<i data-lucide="headphones" aria-hidden="true"></i>';

    const menu = document.createElement("div");
    menu.className = "song-links-popout";
    menu.hidden = true;

    const links = [
        ["Spotify", "music", `https://open.spotify.com/search/${query}`],
        ["YouTube Music", "play-circle", `https://music.youtube.com/search?q=${query}`],
    ];

    for (const [label, icon, href] of links) {
        const link = document.createElement("a");
        link.href = href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.innerHTML = `<i data-lucide="${icon}" aria-hidden="true"></i><span>${label}</span>`;
        menu.appendChild(link);
    }

    LINK_MENU_STORAGE.set(container, { button, menu });
    button.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleSongLinkMenu(container);
    });

    container.append(button, menu);
    return container;
}

function toggleSongLinkMenu(container) {
    const isOpen = container.classList.contains("is-open");
    closeSongTagMenus();
    closeSongLinkMenus();

    if (!isOpen) {
        const controls = LINK_MENU_STORAGE.get(container);
        container.classList.add("is-open");
        controls.button.setAttribute("aria-expanded", "true");
        controls.menu.hidden = false;
    }
}

function createSongTags(song) {
    const container = document.createElement("div");
    container.className = "song-popout song-tags";

    const groups = getSongTagGroups(song);
    const button = document.createElement("button");
    button.className = "icon-button link-popout-button tag-popout-button";
    button.type = "button";
    button.title = groups.length ? "Song tags" : "No tags";
    button.disabled = !groups.length;
    button.setAttribute("aria-label", groups.length ? "Song tags" : "No tags");
    button.setAttribute("aria-haspopup", "true");
    button.setAttribute("aria-expanded", "false");
    button.innerHTML = '<i data-lucide="tags" aria-hidden="true"></i>';

    const menu = document.createElement("div");
    menu.className = "song-tags-popout";
    menu.hidden = true;

    for (const group of groups) {
        const section = document.createElement("section");
        section.className = "tag-popout-group";

        const label = document.createElement("div");
        label.className = "tag-popout-label";
        label.textContent = group.label;

        const pills = document.createElement("div");
        pills.className = "tag-popout-pills";
        appendPills(pills, group.values, group.className, group.filterName, group.limit);

        section.append(label, pills);
        menu.appendChild(section);
    }

    TAG_MENU_STORAGE.set(container, { button, menu });
    button.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleSongTagMenu(container);
    });

    container.append(button, menu);
    return container;
}

function toggleSongTagMenu(container) {
    const isOpen = container.classList.contains("is-open");
    closeSongLinkMenus();
    closeSongTagMenus();

    if (!isOpen) {
        const controls = TAG_MENU_STORAGE.get(container);
        container.classList.add("is-open");
        controls.button.setAttribute("aria-expanded", "true");
        controls.menu.hidden = false;
    }
}

function closeSongTagMenus() {
    for (const container of document.querySelectorAll(".song-tags.is-open")) {
        const controls = TAG_MENU_STORAGE.get(container);
        container.classList.remove("is-open");
        if (controls) {
            controls.button.setAttribute("aria-expanded", "false");
            controls.menu.hidden = true;
        }
    }
}

function closeSongLinkMenus() {
    for (const container of document.querySelectorAll(".song-links.is-open")) {
        const controls = LINK_MENU_STORAGE.get(container);
        container.classList.remove("is-open");
        if (controls) {
            controls.button.setAttribute("aria-expanded", "false");
            controls.menu.hidden = true;
        }
    }
}

function getSongTagGroups(song) {
    const groups = [];
    const used = new Set();
    const addGroup = (label, values, className, filterName = "", limit = 8) => {
        const deduped = dedupeValues(values).slice(0, limit);
        if (!deduped.length) {
            return;
        }

        for (const value of deduped) {
            used.add(normalize(value));
        }

        groups.push({ label, values: deduped, className, filterName, limit });
    };

    addGroup("Mood", getSongMoods(song), "mood", "mood");
    addGroup("Genre", getSongGenres(song), "genre", "genre");
    addGroup("Decade", song.eras, "era", "decade");
    addGroup("Holiday", getHolidayValues(song), "flag", "holiday");
    addGroup("Details", getDisplayFlags(song), "flag");

    for (const tag of song.tags || []) {
        const key = normalize(tag);
        if (state.promotedGenreTags.has(key)) {
            used.add(key);
        }
    }

    const hiddenOtherTags = state.tagConsolidation.hiddenOtherTags;
    const otherTags = dedupeValues(song.tags).filter((value) => {
        const key = normalize(value);
        return !used.has(key) && !hiddenOtherTags.has(key);
    });
    addGroup("Other", otherTags, "", "", 10);

    return groups;
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

function appendPills(container, values = [], className, filterName = "", limit = 4) {
    for (const value of values.slice(0, limit)) {
        if (!value) continue;
        const pill = document.createElement(filterName ? "button" : "span");
        pill.className = className ? `pill ${className}` : "pill";
        pill.textContent = value;

        if (filterName) {
            pill.type = "button";
            pill.classList.add("is-clickable");
            pill.title = `Filter by ${value}`;
            pill.addEventListener("click", () => applyPillFilter(filterName, value));
        }

        container.appendChild(pill);
    }
}

function capPills(container, limit) {
    const pills = [...container.children];
    if (pills.length <= limit + 1) {
        return;
    }

    const hiddenPills = pills.slice(limit);
    for (const pill of hiddenPills) {
        pill.hidden = true;
    }

    const more = document.createElement("button");
    more.className = "pill pill-more";
    more.type = "button";
    more.textContent = `+${hiddenPills.length}`;
    more.title = `Show ${hiddenPills.length} more tags`;
    more.setAttribute("aria-label", `Show ${hiddenPills.length} more tags`);
    more.addEventListener("click", () => {
        for (const pill of hiddenPills) {
            pill.hidden = false;
        }
        more.remove();
    });
    container.appendChild(more);
}

function applyPillFilter(filterName, value) {
    state.filters[filterName] = value;
    state.mode = "search";
    state.query = "";
    state.searchScope = "all";
    state.fuzzySearch = false;
    state.sortMode = "relevance";
    state.groupOpenMode = "auto";
    els.searchInput.value = "";
    syncSearchScopeInput();
    updateSearchPlaceholder();
    resetResultLimit();
    render();
    scrollResultsIntoView();
}

function applyArtistSearch(artistName) {
    state.filters.mood = "";
    state.filters.genre = "";
    state.filters.decade = "";
    state.filters.holiday = "";
    state.filters.duet = false;
    state.filters.explicit = false;
    state.mode = "search";
    state.query = artistName;
    state.searchScope = "artist";
    state.fuzzySearch = false;
    state.sortMode = "song";
    state.groupOpenMode = "auto";
    els.searchInput.value = artistName;
    syncSearchScopeInput();
    updateSearchPlaceholder();
    resetResultLimit();
    render();
    scrollResultsIntoView();
}

function syncSearchScopeInput() {
    for (const input of els.searchScopeInputs) {
        input.checked = input.value === state.searchScope;
    }
}

function scrollResultsIntoView() {
    window.requestAnimationFrame(() => {
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        els.resultsList.closest(".results-panel")?.scrollIntoView({
            block: "start",
            behavior: reduceMotion ? "auto" : "smooth",
        });
    });
}

function renderStatus(totalMatches) {
    const enriched = state.songs.filter((song) => song.status === "ok").length;
    const total = state.songs.length.toLocaleString();
    const tagged = enriched.toLocaleString();

    els.status.textContent = `${tagged} tagged / ${total} songs`;

    if (state.mode === "browse") {
        els.resultCount.textContent = state.browseLetter;
    } else if (isDiscoverView()) {
        els.resultCount.textContent = `Fresh picks from ${total} songs`;
        els.applyFiltersButton.textContent =
            `Show ${totalMatches.toLocaleString()} ${totalMatches === 1 ? "song" : "songs"}`;
    } else {
        const shown = state.visibleSongs.length.toLocaleString();
        els.resultCount.textContent = `${shown} shown from ${totalMatches.toLocaleString()} matches`;
        els.applyFiltersButton.textContent =
            `Show ${totalMatches.toLocaleString()} ${totalMatches === 1 ? "song" : "songs"}`;
    }
}

function renderResultContext() {
    els.resultContext.innerHTML = "";
    const hasArtistSearch = state.mode === "search" && state.searchScope === "artist" && state.query;
    els.resultContext.hidden = !hasArtistSearch;

    if (!hasArtistSearch) {
        return;
    }

    const label = document.createElement("span");
    label.className = "context-label";
    label.textContent = "Artist";

    const artist = document.createElement("strong");
    artist.textContent = state.query;

    const count = document.createElement("span");
    count.className = "context-count";
    count.textContent = `${state.matchCount.toLocaleString()} matches`;

    const meta = document.createElement("div");
    meta.className = "context-meta";
    for (const value of [
        ...getTopValues(state.currentSongs, getSongGenres, 3),
        ...getTopValues(state.currentSongs, getSongMoods, 3),
    ]) {
        const chip = document.createElement("span");
        chip.className = "context-chip";
        chip.textContent = value;
        meta.appendChild(chip);
    }

    const clear = document.createElement("button");
    clear.className = "filter-clear context-clear";
    clear.type = "button";
    clear.textContent = "Clear";
    clear.addEventListener("click", () => {
        clearSearchQuery();
        state.sortMode = "relevance";
        state.groupOpenMode = "auto";
        resetResultLimit();
        render();
        els.searchInput.focus();
    });

    els.resultContext.append(label, artist, count);
    if (meta.childElementCount) {
        els.resultContext.appendChild(meta);
    }
    els.resultContext.appendChild(clear);
}

function renderResultActions(totalMatches) {
    const remaining = totalMatches - state.visibleSongs.length;
    els.resultActions.hidden = state.mode !== "search" || remaining <= 0;

    if (els.resultActions.hidden) {
        return;
    }

    const nextCount = Math.min(RESULT_BATCH_SIZE, remaining).toLocaleString();
    els.showMoreResultsButton.textContent = `Show ${nextCount} more`;
    els.showAllResultsButton.textContent = `Show all ${totalMatches.toLocaleString()}`;
    els.showAllResultsButton.hidden = totalMatches > 10000;
}

function applyInitialState() {
    applyStoredUiState();
    applyInitialRoute();
    els.searchInput.value = state.query;
    syncSearchScopeInput();
    updateSearchPlaceholder();
}

function applyStoredUiState() {
    let stored;
    try {
        stored = JSON.parse(localStorage.getItem(UI_STATE_STORAGE_KEY) || "null");
    } catch {
        return;
    }

    if (!stored || typeof stored !== "object") {
        return;
    }

    if (stored.mode === "browse" || stored.mode === "search") {
        state.mode = stored.mode;
    }

    if (stored.browseBy === "artist" || stored.browseBy === "song") {
        state.browseBy = stored.browseBy;
    }

    if (typeof stored.browseLetter === "string") {
        const cleanLetter = stored.browseLetter.trim().toUpperCase();
        state.browseLetter = cleanLetter === "#" ? "#" : cleanLetter.slice(0, 1);
    }

    if (SEARCH_SCOPES.includes(stored.searchScope)) {
        state.searchScope = stored.searchScope;
    }

    if (stored.searchScope === "song" && !stored.query) {
        state.searchScope = "all";
    }

    if (typeof stored.query === "string") {
        state.query = stored.query;
    }

    if (typeof stored.fuzzySearch === "boolean") {
        state.fuzzySearch = stored.fuzzySearch;
    }

    if (typeof stored.favoriteOnly === "boolean") {
        state.favoriteOnly = stored.favoriteOnly;
    }

    if (["relevance", "artist", "song"].includes(stored.sortMode)) {
        state.sortMode = stored.sortMode;
    }

    if (stored.filters && typeof stored.filters === "object") {
        state.filters.mood = typeof stored.filters.mood === "string" ? stored.filters.mood : "";
        state.filters.genre = typeof stored.filters.genre === "string" ? stored.filters.genre : "";
        state.filters.decade = typeof stored.filters.decade === "string" ? stored.filters.decade : "";
        state.filters.holiday = typeof stored.filters.holiday === "string" ? stored.filters.holiday : "";
        state.filters.duet = Boolean(stored.filters.duet);
        state.filters.explicit = Boolean(stored.filters.explicit);
    }
}

function applyInitialRoute() {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get("mode");
    const browseBy = params.get("by");
    const letter = params.get("letter");
    const scope = params.get("scope");
    const query = params.get("q");
    const sort = params.get("sort");
    const mood = params.get("mood");
    const genre = params.get("genre");
    const decade = params.get("decade");
    const holiday = params.get("holiday");

    if (mode === "browse") {
        state.mode = "browse";
    }

    if (browseBy === "artist" || browseBy === "song") {
        state.browseBy = browseBy;
    }

    if (letter) {
        const cleanLetter = letter.trim().toUpperCase();
        state.browseLetter = cleanLetter === "#" ? "#" : cleanLetter.slice(0, 1);
    }

    if (SEARCH_SCOPES.includes(scope)) {
        state.searchScope = scope;
        const input = els.searchScopeInputs.find((item) => item.value === scope);
        if (input) {
            input.checked = true;
        }
    }

    if (query) {
        state.query = query;
    }

    if (["relevance", "artist", "song"].includes(sort)) {
        state.sortMode = sort;
    }

    if (mood) state.filters.mood = mood;
    if (genre) state.filters.genre = genre;
    if (decade) state.filters.decade = decade;
    if (holiday) state.filters.holiday = holiday;
    if (params.get("duet") === "1") state.filters.duet = true;
    if (params.get("explicit") === "1") state.filters.explicit = true;
    if (params.get("favorites") === "1") state.favoriteOnly = true;
    if (params.get("fuzzy") === "1") state.fuzzySearch = true;
}

function saveUiState() {
    try {
        localStorage.setItem(UI_STATE_STORAGE_KEY, JSON.stringify({
            mode: state.mode,
            browseBy: state.browseBy,
            browseLetter: state.browseLetter,
            searchScope: state.searchScope,
            query: state.query,
            fuzzySearch: state.fuzzySearch,
            favoriteOnly: state.favoriteOnly,
            sortMode: state.sortMode,
            filters: state.filters,
        }));
    } catch {
        // State persistence is a convenience; search should keep working if storage is blocked.
    }

    syncUrlState();
}

function syncUrlState() {
    const params = new URLSearchParams();

    if (state.mode === "browse") {
        params.set("mode", "browse");
        if (state.browseBy !== "song") {
            params.set("by", state.browseBy);
        }
        if (state.browseLetter) {
            params.set("letter", state.browseLetter);
        }
    } else {
        if (state.query) {
            params.set("q", state.query);
        }
        if (state.searchScope !== "all") {
            params.set("scope", state.searchScope);
        }
        if (state.sortMode !== "relevance") {
            params.set("sort", state.sortMode);
        }
        if (state.filters.mood) params.set("mood", state.filters.mood);
        if (state.filters.genre) params.set("genre", state.filters.genre);
        if (state.filters.decade) params.set("decade", state.filters.decade);
        if (state.filters.holiday) params.set("holiday", state.filters.holiday);
        if (state.filters.duet) params.set("duet", "1");
        if (state.filters.explicit) params.set("explicit", "1");
        if (state.favoriteOnly) params.set("favorites", "1");
        if (state.fuzzySearch) params.set("fuzzy", "1");
    }

    const search = params.toString() ? `?${params.toString()}` : "";
    if (window.location.search !== search) {
        try {
            history.replaceState(null, "", `${window.location.pathname}${search}`);
        } catch {
            // URL sync is a convenience (e.g. blocked in sandboxed iframes); ignore.
        }
    }
}

function addToSetlist(song) {
    const exists = state.setlist.some((item) => isSameSong(item, song));
    if (!exists) {
        state.setlist.push(song);
        saveSetlist();
        renderSetlist();
    }
}

function toggleFavorite(song) {
    if (isFavorite(song)) {
        state.favorites.delete(song.id);
        if (song.legacyId) {
            state.favorites.delete(song.legacyId);
        }
    } else {
        state.favorites.add(song.id);
    }

    saveFavorites();
    render();
}

function isFavorite(song) {
    return Boolean(song?.id && (state.favorites.has(song.id) || state.favorites.has(song.legacyId)));
}

function isSameSong(left, right) {
    if (!left || !right) {
        return false;
    }

    if (left.id && right.id && left.id === right.id) {
        return true;
    }

    return getSongIdentity(left) === getSongIdentity(right);
}

function ensureBrowseLetter() {
    const counts = getLetterCounts();
    if (counts.get(state.browseLetter)) {
        return;
    }

    const letters = ["#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
    state.browseLetter = letters.find((letter) => counts.get(letter)) || "#";
}

function getLetterCounts() {
    const counts = new Map();
    for (const song of state.songs) {
        const letter = state.browseBy === "artist" ? song.artistLetter : song.songLetter;
        counts.set(letter, (counts.get(letter) || 0) + 1);
    }
    return counts;
}

function getBrowseSongs() {
    return state.songs.filter((song) => {
        const letter = state.browseBy === "artist" ? song.artistLetter : song.songLetter;
        return letter === state.browseLetter;
    });
}

function sortForBrowse(songs) {
    return [...songs].sort((a, b) => {
        if (state.browseBy === "artist") {
            return compareArtistSort(a, b) || compareSongSort(a, b);
        }

        return compareSongSort(a, b) || compareArtistSort(a, b);
    });
}

function groupByArtist(songs) {
    const groups = new Map();
    const sortedSongs = [...songs].sort((a, b) =>
        compareArtistSort(a, b) || compareSongSort(a, b)
    );

    for (const song of sortedSongs) {
        const artist = getDisplayArtist(song) || "Unknown artist";
        const key = song.artistKey || normalizeArtistKey(artist) || artist;
        if (!groups.has(key)) {
            groups.set(key, { artist, songs: [] });
        }
        groups.get(key).songs.push(song);
    }

    return [...groups.values()]
        .sort((a, b) => compareText(a.artist, b.artist));
}

function groupBySongLetter(songs) {
    const groups = new Map();
    for (const song of [...songs].sort((a, b) => compareSongSort(a, b) || compareArtistSort(a, b))) {
        const letter = getBrowseLetter(song.song);
        if (!groups.has(letter)) {
            groups.set(letter, []);
        }
        groups.get(letter).push(song);
    }

    const order = ["#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
    return [...groups.entries()]
        .map(([letter, letterSongs]) => ({ letter, songs: letterSongs }))
        .sort((a, b) => order.indexOf(a.letter) - order.indexOf(b.letter));
}

function shouldGroupSearchResults() {
    return state.mode === "search" &&
        (state.sortMode === "artist" || state.sortMode === "song");
}

function renderSetlist() {
    els.setlist.innerHTML = "";
    els.setlistCount.textContent = `${state.setlist.length} ${state.setlist.length === 1 ? "song" : "songs"}`;
    els.copySetlistButton.disabled = !state.setlist.length;
    els.clearSetlistButton.disabled = !state.setlist.length;
    els.mobileSetlistButton.querySelector("span").textContent =
        state.setlist.length ? `Setlist (${state.setlist.length})` : "Setlist";
    els.mobileSetlistButton.setAttribute(
        "aria-label",
        state.setlist.length ? `Open setlist, ${state.setlist.length} songs` : "Open setlist"
    );

    if (!state.setlist.length) {
        els.setlist.innerHTML = '<li class="empty-state">Nothing queued</li>';
        return;
    }

    const fragment = document.createDocumentFragment();
    state.setlist.forEach((song, index) => {
        const item = document.createElement("li");
        item.className = "setlist-item";
        item.draggable = true;
        item.dataset.index = String(index);

        item.addEventListener("dragstart", (event) => {
            draggedSetlistIndex = index;
            item.classList.add("is-dragging");
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", String(index));
        });

        item.addEventListener("dragover", (event) => {
            event.preventDefault();
            item.classList.add("is-drop-target");
        });

        item.addEventListener("dragleave", () => {
            item.classList.remove("is-drop-target");
        });

        item.addEventListener("drop", (event) => {
            event.preventDefault();
            item.classList.remove("is-drop-target");
            const fromIndex = Number(event.dataTransfer.getData("text/plain") || draggedSetlistIndex);
            reorderSetlist(fromIndex, index);
        });

        item.addEventListener("dragend", () => {
            draggedSetlistIndex = null;
            item.classList.remove("is-dragging", "is-drop-target");
        });

        const title = document.createElement("span");
        title.className = "setlist-title";
        title.textContent = getDisplaySongTitle(song);

        const artist = document.createElement("span");
        artist.className = "setlist-artist";
        artist.textContent = getDisplayArtist(song) || "Unknown artist";

        const controls = document.createElement("div");
        controls.className = "setlist-controls";

        const handle = document.createElement("span");
        handle.className = "setlist-handle";
        handle.title = "Drag to reorder";
        handle.innerHTML = '<i data-lucide="grip-vertical" aria-hidden="true"></i>';

        const up = document.createElement("button");
        up.className = "setlist-icon-button";
        up.type = "button";
        up.title = "Move up";
        up.disabled = index === 0;
        up.innerHTML = '<i data-lucide="chevron-up" aria-hidden="true"></i>';
        up.addEventListener("click", () => moveSetlistItem(index, -1));

        const down = document.createElement("button");
        down.className = "setlist-icon-button";
        down.type = "button";
        down.title = "Move down";
        down.disabled = index === state.setlist.length - 1;
        down.innerHTML = '<i data-lucide="chevron-down" aria-hidden="true"></i>';
        down.addEventListener("click", () => moveSetlistItem(index, 1));

        const remove = document.createElement("button");
        remove.className = "setlist-icon-button remove-button";
        remove.type = "button";
        remove.title = "Remove";
        remove.innerHTML = '<i data-lucide="x" aria-hidden="true"></i>';
        remove.addEventListener("click", () => {
            const [removed] = state.setlist.splice(index, 1);
            saveSetlist();
            renderSetlist();
            showSnackbar(`Removed “${getDisplaySongTitle(removed)}”`, () => {
                state.setlist.splice(Math.min(index, state.setlist.length), 0, removed);
                saveSetlist();
                renderSetlist();
            });
        });

        controls.append(handle, up, down, remove);
        item.append(title, artist, controls);
        fragment.appendChild(item);
    });

    els.setlist.appendChild(fragment);
    hydrateIcons();
}

function buildSetlistText() {
    return state.setlist
        .map((song, index) => `${index + 1}. ${getDisplaySongTitle(song)} - ${getDisplayArtist(song) || "Unknown artist"}`)
        .join("\n");
}

function showSnackbar(message, onAction) {
    window.clearTimeout(state.snackbarTimer);
    state.snackbarAction = onAction || null;
    els.snackbarText.textContent = message;
    els.snackbarAction.hidden = !onAction;
    els.snackbar.hidden = false;
    state.snackbarTimer = window.setTimeout(hideSnackbar, 6000);
}

function hideSnackbar() {
    window.clearTimeout(state.snackbarTimer);
    state.snackbarTimer = 0;
    state.snackbarAction = null;
    els.snackbar.hidden = true;
}

function moveSetlistItem(index, direction) {
    reorderSetlist(index, index + direction);
}

function reorderSetlist(fromIndex, toIndex) {
    if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex) || fromIndex === toIndex) {
        return;
    }

    if (fromIndex < 0 || fromIndex >= state.setlist.length || toIndex < 0 || toIndex >= state.setlist.length) {
        return;
    }

    const [song] = state.setlist.splice(fromIndex, 1);
    state.setlist.splice(toIndex, 0, song);
    saveSetlist();
    renderSetlist();
}

function saveSetlist() {
    try {
        localStorage.setItem("karaokeSetlist", JSON.stringify(state.setlist));
    } catch {
        // Setlist remains available in memory for the current page.
    }
}

function loadSetlist() {
    try {
        return JSON.parse(localStorage.getItem("karaokeSetlist") || "[]");
    } catch {
        return [];
    }
}

function saveFavorites() {
    try {
        localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify([...state.favorites]));
    } catch {
        // Favorites are still usable for the current page if storage is unavailable.
    }
}

function loadFavorites() {
    try {
        const values = JSON.parse(localStorage.getItem(FAVORITES_STORAGE_KEY) || "[]");
        return new Set(Array.isArray(values) ? values : []);
    } catch {
        return new Set();
    }
}

function applyStoredTheme() {
    document.documentElement.dataset.theme = getStoredTheme();
}

function getStoredTheme() {
    try {
        const stored = localStorage.getItem(THEME_STORAGE_KEY);
        if (stored === "dark" || stored === "light") {
            return stored;
        }
    } catch {
        return getSystemTheme();
    }

    return getSystemTheme();
}

function getSystemTheme() {
    try {
        return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } catch {
        return "light";
    }
}

function getTheme() {
    return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    try {
        localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
        // Theme persistence is a nicety; the UI should still toggle if storage is unavailable.
    }
    renderThemeButton();
}

function renderThemeButton() {
    const isDark = getTheme() === "dark";
    els.themeButton.title = isDark ? "Light mode" : "Dark mode";
    els.themeButton.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
    els.themeButton.innerHTML = `<i data-lucide="${isDark ? "sun" : "moon"}" aria-hidden="true"></i>`;

    hydrateIcons();
}

function updateSearchPlaceholder() {
    const placeholders = {
        all: "Search songs and artists",
        song: "Search song titles",
        artist: "Search artists",
    };

    els.searchInput.placeholder = placeholders[state.searchScope] || placeholders.all;
    els.searchInput.setAttribute("aria-label", els.searchInput.placeholder);
}

function getScopedSearchText(song, scope = state.searchScope) {
    if (scope === "artist") {
        return song.artistSearchText || normalize([
            getDisplayArtist(song),
            song.artist,
            song.lookupArtist,
        ].join(" "));
    }

    if (scope === "song") {
        return song.songSearchText || normalize(song.song);
    }

    return song.allSearchText || `${song.songSearchText || normalize(song.song)} ${song.artistSearchText || normalize(getDisplayArtist(song))}`;
}

function getScopedSearchWords(song, scope = state.searchScope) {
    if (scope === "artist") {
        return song.artistWords;
    }

    if (scope === "song") {
        return song.songWords;
    }

    if (!song.allWords) {
        song.allWords = [...new Set([...(song.songWords || []), ...(song.artistWords || [])])];
    }

    return song.allWords;
}

function getSearchWords(value) {
    return [...new Set(normalize(value).split(" ").filter((word) => word.length > 2))];
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

function renderFilterOptions() {
    fillSelectOptions(els.moodFilter, "Any mood", state.availableMoods);
    fillSelectOptions(els.genreFilter, "Any genre", state.availableGenres);
    fillSelectOptions(els.decadeFilter, "Any decade", state.availableDecades);
    fillSelectOptions(els.holidayFilter, "Any holiday", state.availableHolidays);
}

function fillSelectOptions(select, emptyLabel, values) {
    select.innerHTML = "";

    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = emptyLabel;
    select.appendChild(emptyOption);

    for (const value of values) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        select.appendChild(option);
    }
}

function renderSearchFilters() {
    els.moodFilter.value = state.filters.mood;
    els.genreFilter.value = state.filters.genre;
    els.decadeFilter.value = state.filters.decade;
    els.holidayFilter.value = state.filters.holiday;
    els.duetFilter.checked = state.filters.duet;
    els.explicitFilter.checked = state.filters.explicit;
    els.favoriteFilter.checked = state.favoriteOnly;
    els.fuzzySearch.checked = state.fuzzySearch;
    els.clearFiltersButton.hidden = !hasActiveSearchFilters();

    const activeCount = countActiveFilters();
    els.filterCountBadge.hidden = !activeCount;
    els.filterCountBadge.textContent = activeCount ? String(activeCount) : "";

    setToggleState(els.orderRelevanceButton, state.sortMode === "relevance");
    setToggleState(els.orderSongButton, state.sortMode === "song");
    setToggleState(els.orderArtistButton, state.sortMode === "artist");
}

function setToggleState(button, isActive) {
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
}

function renderActiveFilters() {
    els.activeFilters.innerHTML = "";
    if (state.mode === "browse") {
        els.activeFilters.hidden = true;
        return;
    }

    const scopeChipLabels = {
        all: "Search",
        song: "Song",
        artist: "Artist",
    };
    const chips = [];
    if (state.query) {
        chips.push({
            label: `${scopeChipLabels[state.searchScope] || "Search"}: ${state.query}`,
            onClear: () => clearSearchQuery({ resetScope: false }),
        });
    }

    for (const [filterName, label] of [
        ["mood", "Mood"],
        ["genre", "Genre"],
        ["decade", "Decade"],
        ["holiday", "Holiday"],
    ]) {
        if (state.filters[filterName]) {
            chips.push({
                label: `${label}: ${state.filters[filterName]}`,
                onClear: () => {
                    state.filters[filterName] = "";
                },
            });
        }
    }

    if (state.filters.duet) {
        chips.push({
            label: "Duet",
            onClear: () => {
                state.filters.duet = false;
            },
        });
    }

    if (state.filters.explicit) {
        chips.push({
            label: "Explicit",
            onClear: () => {
                state.filters.explicit = false;
            },
        });
    }

    if (state.favoriteOnly) {
        chips.push({
            label: "Favorites",
            onClear: () => {
                state.favoriteOnly = false;
            },
        });
    }

    if (state.fuzzySearch) {
        chips.push({
            label: "Fuzzy",
            onClear: () => {
                state.fuzzySearch = false;
            },
        });
    }

    for (const chip of chips) {
        els.activeFilters.appendChild(createActiveFilterChip(chip.label, chip.onClear));
    }

    if (chips.length > 1) {
        const clearAll = document.createElement("button");
        clearAll.className = "active-filter-clear";
        clearAll.type = "button";
        clearAll.textContent = "Clear all";
        clearAll.addEventListener("click", () => {
            clearSearchQuery();
            clearSearchFilters();
            state.sortMode = "relevance";
            state.groupOpenMode = "auto";
            resetResultLimit();
            render();
            els.searchInput.focus();
        });
        els.activeFilters.appendChild(clearAll);
    }

    els.activeFilters.hidden = !chips.length;
}

function createActiveFilterChip(label, onClear) {
    const chip = document.createElement("button");
    chip.className = "active-filter-chip";
    chip.type = "button";
    chip.title = `Remove ${label}`;
    const text = document.createElement("span");
    text.textContent = label;
    const icon = document.createElement("i");
    icon.setAttribute("data-lucide", "x");
    icon.setAttribute("aria-hidden", "true");
    chip.append(text, icon);
    chip.addEventListener("click", () => {
        onClear();
        resetResultLimit();
        render();
        els.searchInput.focus();
    });
    return chip;
}

function hasActiveSearchFilters() {
    return Boolean(state.filters.mood) ||
        Boolean(state.filters.genre) ||
        Boolean(state.filters.decade) ||
        Boolean(state.filters.holiday) ||
        state.filters.duet ||
        state.filters.explicit ||
        state.favoriteOnly ||
        state.fuzzySearch;
}

function hasSongFilters() {
    return Boolean(state.filters.mood) ||
        Boolean(state.filters.genre) ||
        Boolean(state.filters.decade) ||
        Boolean(state.filters.holiday) ||
        state.filters.duet ||
        state.filters.explicit ||
        state.favoriteOnly;
}

function getAvailableDecades() {
    const values = new Set();

    for (const song of state.songs) {
        for (const era of song.eras || []) {
            if (era) {
                values.add(era);
            }
        }
    }

    return [...values].sort(compareDecade);
}

function getAvailableValues(getValues) {
    const values = new Set();

    for (const song of state.songs) {
        for (const value of getValues(song) || []) {
            if (value) {
                values.add(value);
            }
        }
    }

    return [...values].sort(compareText);
}

function getTopValues(songs, getValues, limit) {
    const counts = new Map();
    const labels = new Map();

    for (const song of songs || []) {
        const seen = new Set();
        for (const value of getValues(song) || []) {
            const key = normalize(value);
            if (!key || seen.has(key)) {
                continue;
            }

            seen.add(key);
            counts.set(key, (counts.get(key) || 0) + 1);
            if (!labels.has(key)) {
                labels.set(key, value);
            }
        }
    }

    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || compareText(labels.get(a[0]), labels.get(b[0])))
        .slice(0, limit)
        .map(([key]) => labels.get(key));
}

function getPromotedGenreTagMap(songs) {
    const counts = new Map();
    const labelsByKey = new Map();

    for (const song of songs) {
        const seen = new Set();
        for (const tag of song.tags || []) {
            const key = normalize(tag);
            if (!key || seen.has(key)) {
                continue;
            }

            seen.add(key);
            counts.set(key, (counts.get(key) || 0) + 1);

            if (!labelsByKey.has(key)) {
                labelsByKey.set(key, new Map());
            }

            const labels = labelsByKey.get(key);
            labels.set(tag, (labels.get(tag) || 0) + 1);
        }
    }

    const consolidatedGenres = state.tagConsolidation.genreTags;
    if (consolidatedGenres.size) {
        return new Map([...counts.entries()]
            .filter(([key, count]) => count >= state.tagConsolidation.minLastFmSongs && consolidatedGenres.has(key))
            .map(([key]) => [key, consolidatedGenres.get(key)])
            .sort((a, b) => compareText(a[1], b[1])));
    }

    return new Map([...counts.entries()]
        .filter(([key, count]) => count >= TAG_GENRE_MIN_COUNT && isGenreLikeTag(key))
        .map(([key]) => [key, formatGenreTagLabel(key, labelsByKey.get(key))])
        .sort((a, b) => compareText(a[1], b[1])));
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

function getPromotedGenresForSong(song, promotedGenreTags = state.promotedGenreTags) {
    const values = [];

    for (const tag of song.tags || []) {
        const label = promotedGenreTags.get(normalize(tag));
        if (label) {
            values.push(label);
        }
    }

    return dedupeValues(values);
}

function buildCanonicalArtistNames(songs) {
    const variantsByKey = new Map();

    for (const song of songs) {
        const key = getArtistKey(song);
        if (!key) {
            continue;
        }

        if (!variantsByKey.has(key)) {
            variantsByKey.set(key, new Map());
        }

        const variants = variantsByKey.get(key);
        for (const name of getArtistNameCandidates(song)) {
            variants.set(name, (variants.get(name) || 0) + 1);
        }
    }

    return new Map([...variantsByKey.entries()].map(([key, variants]) => [
        key,
        chooseArtistNameVariant(variants),
    ]));
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
    return cleanDisplayValue(song.displayArtist) || getPrimaryArtistName(song);
}

function normalizeArtistKey(value) {
    return normalize(String(value || "").replace(/[’'!?.]/g, ""));
}

function getDisplaySongTitle(song) {
    const raw = String(song.song || "");
    const cleaned = raw
        .replace(/[\[(][^\])]*\b(karaoke|instrumental|backing track)\b[^\])]*[\])]/gi, " ")
        .replace(/\bwvocals?\b/gi, " ")
        .replace(/[\[({]\s*[\])}]/g, " ")
        .replace(/(^|\s)[\])}]+(?=\s|$)/g, " ")
        .replace(/(^|\s)[\[({]+(?=\s|$)/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    return cleaned || raw || "Untitled";
}

function cleanDisplayValue(value) {
    return String(value || "")
        .replace(/\bwvocals?\b/gi, " ")
        .replace(/\bw\s*\/?\s*vocals?\b/gi, " ")
        .replace(/[\[(]\s*karaoke\s*[\])]/gi, " ")
        .replace(/\bkaraoke\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function getConsolidatedMoodsForSong(song) {
    const values = [];
    const rules = state.moodConsolidation.moods || [];
    if (!rules.length) {
        return values;
    }

    const sourceKeys = new Set([
        ...(song.tags || []),
        ...getSongGenres(song),
    ].map(normalize).filter(Boolean));
    const sourceText = normalize([
        song.artist,
        song.lookupArtist,
        song.song,
        song.lookupSong,
        ...(song.tags || []),
        ...getSongGenres(song),
    ].join(" "));

    for (const rule of rules) {
        const hasExactMatch = [...rule.tags].some((tag) => sourceKeys.has(tag));
        const hasPhraseMatch = rule.contains.some((phrase) => sourceText.includes(phrase));

        if (hasExactMatch || hasPhraseMatch) {
            values.push(rule.label);
        }
    }

    return dedupeValues(values);
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
    const values = new Set();
    const text = normalize([
        song.artist,
        song.song,
        ...(song.genres || []),
        ...(song.tags || []),
        ...(song.flags || []),
    ].join(" "));

    if (/(^| )(christmas|xmas|santa|noel|jingle|yule|yuletide)( |$)/.test(text)) values.add("Christmas");
    if (/(^| )(hanukkah|chanukah)( |$)/.test(text)) values.add("Hanukkah");
    if (/(^| )(halloween|spooky)( |$)/.test(text)) values.add("Halloween");
    if (/(^| )(new year|new years|auld lang syne)( |$)/.test(text)) values.add("New Year");
    if (/(^| )(thanksgiving)( |$)/.test(text)) values.add("Thanksgiving");
    if (/(^| )(valentine|valentines)( |$)/.test(text)) values.add("Valentine's Day");
    if (/(^| )(st patrick|saint patrick)( |$)/.test(text)) values.add("St. Patrick's Day");
    if (/(^| )(easter)( |$)/.test(text)) values.add("Easter");

    if (!values.size && hasFlag(song, "Holiday")) {
        values.add("Holiday");
    }

    return [...values];
}

function hasFlag(song, flag) {
    return (song.flags || []).some((value) => normalize(value) === normalize(flag));
}

function getDisplayFlags(song) {
    const holidays = getHolidayValues(song).map(normalize);
    return (song.flags || []).filter((flag) => {
        if (normalize(flag) === "holiday" && holidays.some((holiday) => holiday !== "holiday")) {
            return false;
        }

        return true;
    });
}

function normalize(value) {
    return String(value || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function getBrowseLetter(value) {
    const normalized = normalize(value);
    if (!normalized) {
        return "#";
    }

    const first = normalized[0].toUpperCase();
    return first >= "A" && first <= "Z" ? first : "#";
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

function compareArtistSort(a, b) {
    return compareSortKey(
        a.artistSortText || normalize(getDisplayArtist(a)),
        b.artistSortText || normalize(getDisplayArtist(b))
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
