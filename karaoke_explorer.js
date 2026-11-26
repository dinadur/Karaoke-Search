const APP_VERSION = "20261126-2";
const DATA_URL = `karaoke_songs_enriched.json?v=${APP_VERSION}`;
const TAG_CONSOLIDATION_URL = `tag_consolidation.json?v=${APP_VERSION}`;
const MOOD_CONSOLIDATION_URL = `mood_consolidation.json?v=${APP_VERSION}`;
const RESULT_BATCH_SIZE = 160;
const POPULAR_PILL_PERCENTILE = 0.9;
const SEARCH_RENDER_DELAY = 90;
const SEARCH_SCOPES = ["all", "song", "artist"];
// Params that fully describe a shared view (init() runs before later consts,
// so this must live with the top-level constants).
const ROUTE_PARAMS = ["q", "scope", "sort", "mood", "genre", "decade", "holiday",
    "duet", "popular", "new", "favorites", "fuzzy", "mode", "by", "letter", "exact"];

// MULTI_FILTER_DEFS and multiFilterControls live in filters-panel.js.
const TAG_GENRE_MIN_COUNT = 50;
const THEME_STORAGE_KEY = "karaokeTheme";
const COMPACT_VIEW_STORAGE_KEY = "karaokeCompactView";
const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
const UI_STATE_STORAGE_KEY = "karaokeUiState";
const UI_STATE_VERSION = 2;
const FAVORITES_STORAGE_KEY = "karaokeFavorites";
const RECENT_SEARCHES_STORAGE_KEY = "karaokeRecentSearches";
const RECENT_SEARCHES_LIMIT = 8;
const LINK_MENU_STORAGE = new WeakMap();
const TAG_MENU_STORAGE = new WeakMap();
const ADD_BUTTON_SONGS = new WeakMap();
const FAVORITE_BUTTON_SONGS = new WeakMap();
const SEARCH_NORMALIZE_CACHE = new Map();
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
let songbookLoadPending = false;
let activeSheet = null;
let renderedMode = "";
let lastSungQuery = "";
let sheetSnackbarAnchor = null;
const sheetInertElements = new Map();
applyStoredTheme();

const state = {
    songs: [],
    visibleSongs: [],
    currentSongs: [],
    matchCount: 0,
    resultLimit: RESULT_BATCH_SIZE,
    browseLimit: RESULT_BATCH_SIZE,
    query: "",
    searchScope: "all",
    exactArtist: false,
    autoFuzzy: false,
    randomPick: null,
    snackbarTimer: 0,
    snackbarAction: null,
    pushHistory: false,
    pendingSharedSetlist: "",
    fuzzySearch: false,
    favoriteOnly: false,
    sortMode: "relevance",
    availableMoods: [],
    availableGenres: [],
    availableDecades: [],
    availableHolidays: [],
    defaultRankedSongs: [],
    queryScopedSongs: [],
    popularThreshold: 0,
    // whats_new.json as loaded, and the recently added songs ranked from it.
    whatsNewSource: null,
    whatsNewSongs: [],
    whatsNewLatest: "",
    cachedDiscoverShelves: null,
    promotedGenreTags: new Map(),
    tagConsolidation: createEmptyTagConsolidation(),
    moodConsolidation: createEmptyMoodConsolidation(),
    filters: {
        moods: [],
        genres: [],
        decades: [],
        holidays: [],
        duet: false,
        popular: false,
        recent: false,
    },
    mode: "search",
    browseBy: "song",
    browseLetter: "#",
    groupOpenMode: "auto",
    groupOpenStates: new Map(),
    setlist: loadSetlist(),
    favorites: loadFavorites(),
    recentSearches: loadRecentSearches(),
};

const els = {
    status: document.getElementById("status"),
    homeButton: document.getElementById("homeButton"),
    searchInput: document.getElementById("searchInput"),
    randomButton: document.getElementById("randomButton"),
    clearButton: document.getElementById("clearButton"),
    compactViewButton: document.getElementById("compactViewButton"),
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
    popularFilter: document.getElementById("popularFilter"),
    recentFilter: document.getElementById("recentFilter"),
    duetFilter: document.getElementById("duetFilter"),
    favoriteFilter: document.getElementById("favoriteFilter"),
    fuzzySearch: document.getElementById("fuzzySearch"),
    clearFiltersButton: document.getElementById("clearFiltersButton"),
    activeFilters: document.getElementById("activeFilters"),
    orderRelevanceButton: document.getElementById("orderRelevanceButton"),
    orderPopularButton: document.getElementById("orderPopularButton"),
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
    shuffleShelvesButton: document.getElementById("shuffleShelvesButton"),
    expandGroupsButton: document.getElementById("expandGroupsButton"),
    collapseGroupsButton: document.getElementById("collapseGroupsButton"),
    showMoreResultsButton: document.getElementById("showMoreResultsButton"),
    showAllResultsButton: document.getElementById("showAllResultsButton"),
    browseList: document.getElementById("browseList"),
    resultsTitle: document.getElementById("resultsTitle"),
    resultCount: document.getElementById("resultCount"),
    resultContext: document.getElementById("resultContext"),
    setlist: document.getElementById("setlist"),
    setlistCount: document.getElementById("setlistCount"),
    copySetlistButton: document.getElementById("copySetlistButton"),
    draftSetlistButton: document.getElementById("draftSetlistButton"),
    shareSetlistButton: document.getElementById("shareSetlistButton"),
    snackbar: document.getElementById("snackbar"),
    snackbarText: document.getElementById("snackbarText"),
    snackbarAction: document.getElementById("snackbarAction"),
    resultsSentinel: document.getElementById("resultsSentinel"),
    clearSetlistButton: document.getElementById("clearSetlistButton"),
    closeSetlistButton: document.getElementById("closeSetlistButton"),
    mobileSetlistButton: document.getElementById("mobileSetlistButton"),
    dataDialog: document.getElementById("dataDialog"),
    retryDataButton: document.getElementById("retryDataButton"),
    dataError: document.getElementById("dataError"),
    fileInput: document.getElementById("fileInput"),
    qrSetlistButton: document.getElementById("qrSetlistButton"),
    qrDialog: document.getElementById("qrDialog"),
    qrHolder: document.getElementById("qrHolder"),
    qrCaption: document.getElementById("qrCaption"),
    importDialog: document.getElementById("importDialog"),
    importCaption: document.getElementById("importCaption"),
    importAddButton: document.getElementById("importAddButton"),
    importReplaceButton: document.getElementById("importReplaceButton"),
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
    buildMultiFilters();
    bindEvents();
    bindPersonalFeatures();
    bindResultsSentinel();
    registerServiceWorker();
    renderThemeButton();
    applyStoredCompactView();
    applyInitialState();
    await loadSongbook();
}

async function loadSongbook() {
    if (songbookLoadPending) return;
    songbookLoadPending = true;
    els.retryDataButton.disabled = true;
    els.fileInput.disabled = true;
    els.dataError.textContent = "";
    startLoadStatus();

    try {
        const eraPromise = fetch(`era_enrichment.json?v=${APP_VERSION}`)
            .then((response) => response.ok ? response.json() : null).catch(() => null);
        const audioPromise = fetch(`audio_enrichment.json?v=${APP_VERSION}`)
            .then((response) => response.ok ? response.json() : null).catch(() => null);
        const whatsNewPromise = fetch(`whats_new.json?v=${APP_VERSION}`)
            .then((response) => response.ok ? response.json() : null).catch(() => null);
        const tagConsolidationPromise = loadTagConsolidation();
        const moodConsolidationPromise = loadMoodConsolidation();
        const response = await fetch(DATA_URL);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const text = await response.text();
        stopLoadStatus();
        els.status.textContent = "Preparing songbook";
        await nextFrame();

        const songs = JSON.parse(text);
        els.status.textContent = "Building songbook";
        await nextFrame();

        state.tagConsolidation = await tagConsolidationPromise;
        state.moodConsolidation = await moodConsolidationPromise;
        state.whatsNewSource = await whatsNewPromise;
        await useSongs(await applyAudioEnrichment(await applyEraEnrichment(songs, await eraPromise), await audioPromise));
        els.dataDialog.close();
    } catch (error) {
        console.error(error);
        els.status.textContent = "Songbook unavailable";
        els.resultCount.textContent = "Songbook unavailable";
        if (typeof els.dataDialog.showModal === "function") {
            els.dataDialog.showModal();
        }
    } finally {
        stopLoadStatus();
        songbookLoadPending = false;
        els.resultsList.removeAttribute("aria-busy");
        els.retryDataButton.disabled = false;
        els.fileInput.disabled = false;
    }
}

function bindEvents() {
    els.homeButton.addEventListener("click", goToDiscover);

    els.compactViewButton?.addEventListener("click", () => {
        setCompactView(!document.body.classList.contains("is-compact"));
    });

    els.themeButton.addEventListener("click", (event) => {
        setTheme(getTheme() === "dark" ? "light" : "dark");
        // Keyboard clicks have no pointer position; the menu button stays visible.
        window.StageFx?.themeChanged(event.detail
            ? { x: event.clientX, y: event.clientY }
            : getElementCenter(document.getElementById("moreToolsButton")));
    });

    els.searchInput.addEventListener("input", () => {
        leaveArtistView();
        state.query = els.searchInput.value.trim();
        state.mode = "search";
        resetResultLimit();
        saveUiState();
        scheduleSearchRender();
    });

    els.searchInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            recordRecentSearch(els.searchInput.value);
        }
    });

    for (const input of els.searchScopeInputs) {
        input.addEventListener("change", () => {
            leaveArtistView();
            state.searchScope = input.value;
            syncSearchScopeInput();
            state.mode = "search";
            resetResultLimit();
            updateSearchPlaceholder();
            render();
            els.searchInput.focus();
        });
    }

    els.popularFilter.addEventListener("change", () => {
        state.filters.popular = els.popularFilter.checked;
        state.mode = "search";
        resetResultLimit();
        render();
    });

    els.recentFilter.addEventListener("change", () => {
        state.filters.recent = els.recentFilter.checked;
        state.mode = "search";
        resetResultLimit();
        render();
    });

    els.duetFilter.addEventListener("change", () => {
        state.filters.duet = els.duetFilter.checked;
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
        // The button hides once nothing is left to clear; keep focus in the sheet.
        els.applyFiltersButton.focus({ preventScroll: true });
    });

    els.orderRelevanceButton.addEventListener("click", () => setSearchOrder("relevance"));
    els.orderPopularButton.addEventListener("click", () => setSearchOrder("popular"));
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
        state.pushHistory = true;
        state.mode = "browse";
        resetBrowseLimit();
        ensureBrowseLetter();
        render();
    });

    els.browseSongButton.addEventListener("click", () => {
        state.browseBy = "song";
        resetBrowseLimit();
        ensureBrowseLetter();
        render();
    });

    els.browseArtistButton.addEventListener("click", () => {
        state.browseBy = "artist";
        resetBrowseLimit();
        ensureBrowseLetter();
        render();
    });

    els.randomButton.addEventListener("click", pickRandomSong);

    els.shuffleShelvesButton.addEventListener("click", () => {
        state.cachedDiscoverShelves = null;
        render();
        window.StageFx?.roll(els.shuffleShelvesButton);
    });

    els.showMoreResultsButton.addEventListener("click", () => {
        if (state.mode === "browse" && state.browseBy === "song") {
            appendSongBrowseBatch(state.browseLimit + RESULT_BATCH_SIZE);
            return;
        }
        state.resultLimit = Math.min(state.resultLimit + RESULT_BATCH_SIZE, state.matchCount);
        render();
    });

    els.showAllResultsButton.addEventListener("click", () => {
        if (state.mode === "browse" && state.browseBy === "song") {
            appendSongBrowseBatch(state.matchCount);
            return;
        }
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

    for (const list of [els.setlist, document.getElementById("repertoireList"), document.getElementById("pickerResults")]) {
        list.addEventListener("click", returnToResults);
    }
    // Floating tag popouts stay where they opened, so close them when the list
    // (or page) they belong to moves.
    document.addEventListener("scroll", closeFloatingSongTagMenus, { capture: true, passive: true });
    window.addEventListener("resize", () => closeFloatingSongTagMenus());
    // Escape closes open tags first, leaving the dialog or sheet around them
    // open. It listens on the document because Safari does not focus a clicked
    // button, so focus may be outside the tags.
    document.addEventListener("keydown", (event) => {
        const open = event.key === "Escape" && document.querySelector(".song-tags.is-open");
        if (!open) return;
        event.preventDefault();
        event.stopPropagation();
        closeSongTagMenus();
        TAG_MENU_STORAGE.get(open)?.button.focus({ preventScroll: true });
    }, true);
    // Tags opened while a sheet slides in move with it; once it stops, place
    // them against the viewport again.
    document.addEventListener("animationend", (event) => {
        const open = document.querySelector(".song-tags.is-open.is-floating");
        if (open && event.target.contains(open)) placeSongPopout(open, TAG_MENU_STORAGE.get(open).menu);
    });

    els.sheetBackdrop.addEventListener("click", () => {
        closeFiltersSheet({ restoreFocus: false });
        closeSetlistDrawer({ restoreFocus: false });
    });

    document.addEventListener("click", (event) => {
        if (!event.target.closest(".song-popout")) {
            closeSongLinkMenus();
            closeSongTagMenus();
        }

        if (!event.target.closest(".multi-filter")) {
            closeMultiFilterPopovers();
        }
    });

    document.addEventListener("keydown", (event) => {
        // Native dialogs (e.g. QR above the setlist) own their keyboard events.
        if (document.querySelector("dialog[open]")) {
            return;
        }
        if (activeSheet && event.key === "Tab") {
            trapSheetFocus(event);
            return;
        }
        if (event.key === "Escape") {
            closeSongLinkMenus();
            closeSongTagMenus();
            closeMultiFilterPopovers();
            closeFiltersSheet();
            closeSetlistDrawer();
            return;
        }

        if (!activeSheet && event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey) {
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

    document.addEventListener("focusin", (event) => {
        if (activeSheet && !activeSheet.contains(event.target) &&
            !document.querySelector("dialog[open]")) {
            getSheetFocusTargets()[0]?.focus({ preventScroll: true });
        }
    });
    window.matchMedia("(max-width: 720px)").addEventListener("change", (event) => {
        if (!event.matches) {
            closeFiltersSheet({ restoreFocus: false });
            closeSetlistDrawer({ restoreFocus: false });
        }
    });

    els.draftSetlistButton.addEventListener("click", draftSetlist);
    els.qrSetlistButton.addEventListener("click", openQrDialog);

    els.shareSetlistButton.hidden = typeof navigator.share !== "function";
    els.shareSetlistButton.addEventListener("click", async () => {
        const text = buildSetlistText();
        if (!text) {
            return;
        }

        try {
            await navigator.share({ title: "Karaoke setlist", text });
        } catch (error) {
            if (error.name !== "AbortError") {
                showSnackbar("Couldn't share the setlist. Try the QR or Copy button.");
            }
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
            showSnackbar("Setlist copied");
            els.copySetlistButton.classList.add("copied");
            els.copySetlistButton.title = "Copied";
            setTimeout(() => {
                els.copySetlistButton.classList.remove("copied");
                els.copySetlistButton.title = "Copy setlist";
            }, 800);
        } catch {
            els.copySetlistButton.classList.add("copy-failed");
            showSnackbar("Couldn't copy the setlist. Try sharing it with the QR button.");
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

    els.retryDataButton.addEventListener("click", loadSongbook);
    els.fileInput.addEventListener("change", async () => {
        const file = els.fileInput.files[0];
        if (!file || songbookLoadPending) {
            return;
        }

        songbookLoadPending = true;
        els.retryDataButton.disabled = true;
        els.fileInput.disabled = true;
        try {
            const songs = JSON.parse(await file.text());
            await useSongs(songs);
            els.dataDialog.close();
        } catch {
            els.dataError.textContent = "This file isn't a valid songbook. Choose a songbook backup or try loading again.";
        } finally {
            songbookLoadPending = false;
            els.retryDataButton.disabled = false;
            els.fileInput.disabled = false;
            els.fileInput.value = "";
        }
    });
}

// Bound CPU-heavy catalog passes so typing, painting, and keyboard controls
// can run between batches, including browsers without the Scheduler API.
function yieldSongbookWork() {
    if (globalThis.scheduler?.postTask) {
        // Background priority also lets ordinary timers and assistive/browser
        // tooling run; boosted yield continuations can starve those tasks.
        return globalThis.scheduler.postTask(() => {}, { priority: "background" });
    }
    return new Promise((resolve) => setTimeout(resolve, 0));
}

async function forEachSongbookInChunks(items, visit) {
    let sliceStart = performance.now();
    for (let index = 0; index < items.length; index++) {
        visit(items[index], index);
        if ((index & 31) === 31 && performance.now() - sliceStart >= 8) {
            await yieldSongbookWork();
            sliceStart = performance.now();
        }
    }
    await yieldSongbookWork();
}

async function mapSongbookInChunks(items, transform) {
    const result = new Array(items.length);
    let sliceStart = performance.now();
    for (let index = 0; index < items.length; index++) {
        result[index] = transform(items[index], index);
        if ((index & 31) === 31 && performance.now() - sliceStart >= 8) {
            await yieldSongbookWork();
            sliceStart = performance.now();
        }
    }
    // Also separate shorter passes from the next pass/first render.
    await yieldSongbookWork();
    return result;
}

async function sortSongbookInChunks(items, compare) {
    const runSize = 2048;
    if (items.length <= runSize) {
        return [...items].sort(compare);
    }

    let runs = [];
    for (let start = 0; start < items.length; start += runSize) {
        runs.push(items.slice(start, start + runSize).sort(compare));
        await yieldSongbookWork();
    }

    while (runs.length > 1) {
        const nextRuns = [];
        for (let i = 0; i < runs.length; i += 2) {
            if (i + 1 >= runs.length) {
                nextRuns.push(runs[i]);
                continue;
            }
            const left = runs[i];
            const right = runs[i + 1];
            const merged = new Array(left.length + right.length);
            let a = 0;
            let b = 0;
            let out = 0;
            let sliceStart = performance.now();
            while (a < left.length && b < right.length) {
                merged[out++] = compare(left[a], right[b]) <= 0 ? left[a++] : right[b++];
                if ((out & 127) === 0 && performance.now() - sliceStart >= 8) {
                    await yieldSongbookWork();
                    sliceStart = performance.now();
                }
            }
            while (a < left.length) merged[out++] = left[a++];
            while (b < right.length) merged[out++] = right[b++];
            nextRuns.push(merged);
            await yieldSongbookWork();
        }
        runs = nextRuns;
    }

    return runs[0] || [];
}

async function useSongs(songs) {
    if (!Array.isArray(songs) || !songs.length) {
        throw new Error("Invalid songbook data");
    }

    const variantsByKey = new Map();
    const soloArtistCounts = new Map();
    const tagCounts = new Map();
    const tagLabelsByKey = new Map();
    const useConsolidatedGenres = state.tagConsolidation.genreTags.size > 0;

    // Pass 1: validate schema, gather artist variants, track solo artists for
    // duet detection, and count tags in one scan.
    await forEachSongbookInChunks(songs, (song) => {
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
            for (let i = 0; i < tags.length; i++) {
                const tag = tags[i];
                const key = normalize(tag);
                if (!key || seen.has(key)) {
                    continue;
                }
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
    });

    const artistNames = new Map();
    for (const [key, variants] of variantsByKey.entries()) {
        artistNames.set(key, chooseArtistNameVariant(variants));
    }
    await yieldSongbookWork();

    const consolidatedGenres = state.tagConsolidation.genreTags;
    const promotedGenreTags = useConsolidatedGenres
        ? new Map([...tagCounts.entries()]
            .filter(([key, count]) => count >= state.tagConsolidation.minLastFmSongs && consolidatedGenres.has(key))
            .map(([key]) => [key, consolidatedGenres.get(key)])
            .sort((a, b) => compareText(a[1], b[1])))
        : new Map([...tagCounts.entries()]
            .filter(([key, count]) => count >= TAG_GENRE_MIN_COUNT && isGenreLikeTag(key))
            .map(([key]) => [key, formatGenreTagLabel(key, tagLabelsByKey.get(key))])
            .sort((a, b) => compareText(a[1], b[1])));
    await yieldSongbookWork();

    const scores = [];
    const availableMoodsSet = new Set();
    const availableGenresSet = new Set();
    const availableDecadesSet = new Set();
    const availableHolidaysSet = new Set();

    // Pass 2: build each prepared & enriched song object in a single allocation,
    // keeping fuzzy word lists lazy and collecting available facets inline.
    const enrichedSongs = await mapSongbookInChunks(songs, (song, index) => {
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
        for (let i = 0; i < normalizedTags.length; i++) {
            const label = promotedGenreTags.get(normalizedTags[i]);
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

        const sourceMoods = getConsolidatedMoodsForSong(preparedSong, normalizedTags, genreKeys);
        const allMoods = sourceMoods.length
            ? dedupeValues([...rawMoods, ...sourceMoods])
            : (rawMoods.length ? dedupeValues(rawMoods) : []);
        preparedSong.sourceMoods = sourceMoods;
        preparedSong.allMoods = allMoods;

        // Precomputed lookup structures keep per-keystroke filtering and
        // faceted counting off the regex/normalize hot path.
        preparedSong.holidayValues = computeHolidayValues(preparedSong, {
            songSortText,
            rawGenres: normalizedRawGenres,
            tags: normalizedTags,
            flags: normalizedFlags,
        });
        // "tagged" comes from catalog flags/tags; "likely" is inferred from
        // artist credits and is labelled as a guess in the UI.
        preparedSong.duetSource = detectDuetSource(song, normalizedFlags, normalizedTags, soloArtistCounts);
        preparedSong.isDuet = Boolean(preparedSong.duetSource);
        preparedSong.filterKeys = {
            moods: new Set(allMoods.map(normalize)),
            genres: new Set(genreKeys),
            decades: new Set(rawEras.map(normalize)),
            holidays: new Set(preparedSong.holidayValues.map(normalize)),
        };

        if (song.popularity) scores.push(song.popularity);
        for (const value of allMoods) if (value) availableMoodsSet.add(value);
        for (const value of allGenres) if (value) availableGenresSet.add(value);
        for (const value of rawEras) if (value) availableDecadesSet.add(value);
        for (const value of preparedSong.holidayValues) if (value) availableHolidaysSet.add(value);

        return preparedSong;
    });

    // "Popular" marks the top decile of songs that have a popularity score.
    scores.sort((a, b) => a - b);
    const popularThreshold = scores.length
        ? scores[Math.floor(scores.length * POPULAR_PILL_PERCENTILE)]
        : 0;
    await yieldSongbookWork();

    const defaultRankedSongs = await sortSongbookInChunks(enrichedSongs, (a, b) =>
        (b.popularity || 0) - (a.popularity || 0) ||
        (b.confidence || 0) - (a.confidence || 0) ||
        compareArtistSort(a, b) ||
        compareSongSort(a, b)
    );
    const availableMoods = [...availableMoodsSet].sort(compareText);
    const availableGenres = [...availableGenresSet].sort(compareText);
    const availableDecades = [...availableDecadesSet].sort(compareDecade);
    const availableHolidays = [...availableHolidaysSet].sort(compareText);
    const whatsNew = buildWhatsNew(enrichedSongs, state.whatsNewSource);
    await yieldSongbookWork();

    // Publish the complete catalog together; renders during preparation must
    // never see partial songs or mismatched indexes.
    Object.assign(state, {
        promotedGenreTags, songs: enrichedSongs, popularThreshold,
        defaultRankedSongs, availableMoods, availableGenres, availableDecades, availableHolidays,
        whatsNewSongs: whatsNew.songs, whatsNewLatest: whatsNew.latest,
    });
    migrateSavedSongs();
    state.cachedDiscoverShelves = null;
    if (els.resultsList.querySelector(".skeleton")) els.resultsList.replaceChildren();
    sanitizeFilterValues();
    renderFilterOptions();
    updateSearchPlaceholder();
    ensureBrowseLetter();
    renderSetlist();
    renderThemeButton();
    render();
    // Styling hook for the "songbook ready" moment; never set by a failed load.
    document.documentElement.classList.add("songbook-ready");
    personalEl("repertoireButton").disabled = false;
    personalEl("chooseSongButton").disabled = false;
    offerSharedSetlistImport();
}

function renderLoadingSkeleton() {
    els.resultsList.classList.add("is-discover");
    els.resultsList.innerHTML = "";

    for (let shelfIndex = 0; shelfIndex < 3; shelfIndex++) {
        const shelf = document.createElement("div");
        shelf.className = "shelf";

        const bar = document.createElement("div");
        bar.className = "skeleton skeleton-bar";

        const row = document.createElement("div");
        row.className = "shelf-row";
        for (let cardIndex = 0; cardIndex < 6; cardIndex++) {
            const card = document.createElement("div");
            card.className = "skeleton skeleton-card";
            row.appendChild(card);
        }

        shelf.append(bar, row);
        els.resultsList.appendChild(shelf);
    }
}

function startLoadStatus() {
    els.status.textContent = "Loading songbook";
    els.resultCount.textContent = "Loading songbook…";
    els.resultsList.setAttribute("aria-busy", "true");
    renderLoadingSkeleton();

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
        tagToLabels: new Map(),
        phraseRules: [],
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

function render() {
    if (!state.snackbarAction) hideSnackbar();
    cancelScheduledSearchRender();
    renderMode();
    renderActiveFilters();

    if (songbookLoadPending && !state.songs.length) {
        // Keep a visible loading state even if Browse is selected mid-load.
        els.resultsList.hidden = false;
        els.browseList.hidden = true;
        return;
    }

    if (state.mode === "browse") {
        lastSungQuery = "";
        renderSearchFilters();
        els.searchNotice.hidden = true;
        els.randomPick.hidden = true;
        els.randomPick.innerHTML = "";
        els.shuffleShelvesButton.hidden = true;
        renderBrowse();
        renderGroupActions();
        renderStatus(state.matchCount);
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

    state.queryScopedSongs = ranked;
    renderSearchFilters();
    const filtered = hasSongFilters() ? applySearchFilters(ranked) : ranked;
    const sorted = sortSongs(filtered);
    const isDiscover = isDiscoverView();
    state.currentSongs = sorted;
    state.matchCount = sorted.length;
    state.visibleSongs = isDiscover ? [] : sorted.slice(0, state.resultLimit);

    renderRandomPick();
    renderSearchNotice();
    els.shuffleShelvesButton.hidden = !isDiscover;
    if (isDiscover) {
        renderDiscover();
    } else {
        renderResults();
    }
    const sungQuery = isDiscover ? "" : normalizeSearchText(state.query);
    if (sungQuery && sungQuery !== lastSungQuery && state.visibleSongs.length) {
        window.StageFx?.sing(els.resultsList);
    }
    lastSungQuery = sungQuery;
    renderStatus(filtered.length);
    renderResultContext();
    renderResultActions(isDiscover ? 0 : filtered.length);
    saveUiState();

    hydrateIcons();
}

function goToDiscover() {
    state.pushHistory = true;
    clearSearchQuery();
    clearSearchFilters();
    state.mode = "search";
    state.sortMode = "relevance";
    state.groupOpenMode = "auto";
    state.randomPick = null;
    closeMultiFilterPopovers();
    closeFiltersSheet({ restoreFocus: false });
    resetResultLimit();
    render();
    window.scrollTo({
        top: 0,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
}

function isDiscoverView() {
    return state.mode === "search" &&
        !normalizeSearchText(state.query) &&
        !hasSongFilters() &&
        state.sortMode === "relevance";
}

function pickRandomSong() {
    if (searchRenderTimer) render();
    const pool = state.mode === "search"
        ? state.currentSongs
        : state.songs;
    if (!pool.length) {
        state.randomPick = null;
        renderRandomPick();
        showSnackbar("No matching songs to pick");
        return;
    }

    state.randomPick = pool[Math.floor(Math.random() * pool.length)];
    state.mode = "search";
    render();
    window.StageFx?.spin(els.randomPick.querySelector(".song-card"),
        Array.from({ length: Math.min(7, pool.length - 1) }, () => pool[Math.floor(Math.random() * pool.length)]));
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

function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) {
        return;
    }

    // The versioned URL guarantees each deploy registers a fresh worker even
    // if an intermediary cached the old sw.js aggressively.
    navigator.serviceWorker.register(`sw.js?v=${APP_VERSION}`).catch(() => {
        // Offline support is progressive enhancement; the app works without it.
    });
}

function bindResultsSentinel() {
    if (typeof IntersectionObserver !== "function") {
        return;
    }

    const observer = new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) {
            return;
        }

        if (state.mode === "browse") {
            if (state.browseBy === "song" && state.visibleSongs.length < state.matchCount) {
                appendSongBrowseBatch(state.browseLimit + RESULT_BATCH_SIZE);
            }
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
    closeSetlistDrawer({ restoreFocus: false });
    document.body.classList.add("filters-open");
    els.filtersToggleButton.setAttribute("aria-expanded", "true");
    els.searchFilters.setAttribute("role", "dialog");
    els.searchFilters.setAttribute("aria-modal", "true");
    updateSheetBackdrop();
    activateSheet(els.searchFilters);
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
    deactivateSheet(els.searchFilters);
    updateSheetBackdrop();
    if (restoreFocus && els.filtersToggleButton.getClientRects().length) {
        els.filtersToggleButton.focus({ preventScroll: true });
    }
}

function openSetlistDrawer() {
    closeFiltersSheet({ restoreFocus: false });
    const panel = els.setlist.closest(".setlist-panel");
    document.body.classList.add("setlist-open");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "Setlist");
    updateSheetBackdrop();
    activateSheet(panel);
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
    deactivateSheet(panel);
    updateSheetBackdrop();
    if (restoreFocus && els.mobileSetlistButton.getClientRects().length) {
        els.mobileSetlistButton.focus({ preventScroll: true });
    }
}

function updateSheetBackdrop() {
    els.sheetBackdrop.hidden = !document.body.classList.contains("filters-open") &&
        !document.body.classList.contains("setlist-open");
}

function activateSheet(sheet) {
    if (activeSheet === sheet) return;
    if (!state.snackbarAction) hideSnackbar();
    activeSheet = sheet;
    // Keep Undo available inside the modal's accessible/focusable subtree.
    sheetSnackbarAnchor = document.createComment("snackbar home");
    els.snackbar.before(sheetSnackbarAnchor);
    sheet.appendChild(els.snackbar);
    // Walk ancestors so a nested setlist can isolate the rest of the page
    // without making its own containing main element inert.
    for (let branch = sheet; branch && branch !== document.body; branch = branch.parentElement) {
        for (const sibling of branch.parentElement.children) {
            if (sibling === branch || sibling === els.sheetBackdrop ||
                !(sibling instanceof HTMLElement) || sibling.tagName === "DIALOG") continue;
            sheetInertElements.set(sibling, sibling.inert);
            sibling.inert = true;
        }
    }
}

function deactivateSheet(sheet) {
    if (activeSheet !== sheet) return;
    activeSheet = null;
    sheetSnackbarAnchor.replaceWith(els.snackbar);
    sheetSnackbarAnchor = null;
    for (const [element, wasInert] of sheetInertElements) {
        element.inert = wasInert;
    }
    sheetInertElements.clear();
}

function getSheetFocusTargets() {
    if (!activeSheet) return [];
    return [...activeSheet.querySelectorAll(
        'button, input, select, textarea, a[href], summary, [tabindex]'
    )].filter((element) => !element.disabled && element.tabIndex >= 0 &&
        !element.closest("[inert]") && element.getClientRects().length &&
        getComputedStyle(element).visibility !== "hidden");
}

function trapSheetFocus(event) {
    const targets = getSheetFocusTargets();
    const first = targets[0];
    const last = targets[targets.length - 1];
    if (!first) {
        event.preventDefault();
        return;
    }
    if (event.shiftKey && (document.activeElement === first || !activeSheet.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !activeSheet.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
    }
}

// countActiveFilters lives in filters-panel.js.

function renderMode() {
    const isBrowse = state.mode === "browse";
    syncSearchInputToMode();
    setToggleState(els.searchModeButton, !isBrowse);
    setToggleState(els.browseModeButton, isBrowse);
    els.browseTools.hidden = !isBrowse;
    els.letterStrip.hidden = !isBrowse;
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

// The search box belongs to Search. Browse ignores the query, so its box starts
// empty; switching back to Search shows the remembered query again. Syncing
// only on mode changes never rewrites text while someone is typing.
function syncSearchInputToMode() {
    if (renderedMode === state.mode) {
        return;
    }

    renderedMode = state.mode;
    const value = state.mode === "browse" ? "" : state.query;
    if (els.searchInput.value.trim() !== value) {
        els.searchInput.value = value;
    }
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
    if (state.exactArtist && state.searchScope === "artist" && query) {
        const key = normalizeArtistKey(query);
        return songs.filter((song) => song.artistKey === key);
    }
    const tokens = normalizeSearchText(query).split(" ").filter(Boolean);
    if (!tokens.length) {
        // New songs mostly lack their own popularity yet, so they keep the
        // What's new ranking instead of falling to the end of the catalog order.
        if (state.filters.recent && state.whatsNewSongs.length) {
            return state.whatsNewSongs;
        }
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

            const songText = matchesSongs ? (song.songSearchText || normalizeSearchText(song.song)) : "";
            const displaySongText = matchesSongs ? (song.displaySongSearchText || songText) : "";
            const artistText = matchesArtists ? (song.displayArtistSearchText || normalizeSearchText(getDisplayArtist(song))) : "";
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

// applySearchFilters and matchesFilterKey live in filters-panel.js.

function sortSongs(songs) {
    const mode = state.sortMode;

    if (mode === "popular") {
        // Among new songs, rank by the What's new signal (see buildWhatsNew).
        const score = state.filters.recent
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
    state.groupOpenStates.clear();
}

// clearSearchFilters lives in filters-panel.js.

function clearSearchQuery({ resetScope = true } = {}) {
    leaveArtistView();
    state.query = "";
    els.searchInput.value = "";

    if (resetScope) {
        state.searchScope = "all";
        syncSearchScopeInput();
        updateSearchPlaceholder();
    }
}

// An artist link shows one artist A-Z by quietly choosing the Artist scope and
// title order. Leaving that view restores the default scope and relevance
// order (an order picked inside the view belongs to it too), so the next search
// covers song titles again and an empty query returns to Discover. This is the
// only place exactArtist is cleared; every exit must come through here.
function leaveArtistView() {
    if (!state.exactArtist) {
        return;
    }

    state.exactArtist = false;
    state.searchScope = "all";
    state.sortMode = "relevance";
    state.groupOpenMode = "auto";
    syncSearchScopeInput();
    updateSearchPlaceholder();
}

// Discover shelves and sampling live in browse-discover.js.

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
    // Point at the filters when the query itself found songs.
    title.textContent = !state.query ? "No songs match these filters"
        : state.queryScopedSongs.length ? `No “${state.query}” songs match these filters`
            : `No matches for “${state.query}”`;
    empty.appendChild(title);

    const { suggestions, nearMatches } = getEmptySearchHelp();
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
                leaveArtistView();
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

    if (nearMatches) {
        actions.appendChild(createEmptyAction(`Include near matches (${nearMatches.toLocaleString()})`, () => {
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

// One scan of the (filtered) catalog finds spelling suggestions and counts the
// near matches that would pass the filters. Near matches already run
// automatically when a query has no exact matches, so they can only help when
// filters hid every exact match.
function getEmptySearchHelp(limit = 5) {
    const queryTokens = normalizeSearchText(state.query).split(" ").filter(Boolean);
    const tokens = queryTokens.filter((token) => token.length > 2);
    if (!tokens.length || state.fuzzySearch) {
        return { suggestions: [], nearMatches: 0 };
    }

    const shortTokens = queryTokens.filter((token) => token.length <= 2);
    const countNearMatches = !state.autoFuzzy && !state.exactArtist &&
        state.queryScopedSongs.length > 0 && hasSongFilters();
    const isArtistSearch = state.searchScope === "artist";
    const sourceSongs = hasSongFilters() ? applySearchFilters(state.songs) : state.songs;
    const seen = new Set();
    const suggestions = [];
    let nearMatches = 0;

    for (const song of sourceSongs) {
        const haystack = getScopedSearchText(song);
        const words = getScopedSearchWords(song);
        let score = 0;
        // Same membership test as rankSongs(..., { fuzzy: true }).
        let matchesEveryToken = shortTokens.every((token) => haystack.includes(token));

        for (const token of tokens) {
            if (haystack.includes(token)) {
                score += 8;
                continue;
            }

            const fuzzyScore = getFuzzyTokenScore(token, words);
            if (fuzzyScore) {
                score += fuzzyScore;
            } else {
                matchesEveryToken = false;
            }
        }

        if (countNearMatches && matchesEveryToken) {
            nearMatches++;
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

    return {
        suggestions: suggestions
            .sort((a, b) => b.score - a.score || compareSongSort(a.song, b.song))
            .slice(0, limit),
        nearMatches,
    };
}

// Grouped search results and Browse A–Z rendering live in browse-discover.js.

function createFavoriteButton(song) {
    const button = document.createElement("button");
    button.className = "icon-button favorite-button";
    button.type = "button";
    FAVORITE_BUTTON_SONGS.set(button, song);
    button.innerHTML = '<i data-lucide="star" aria-hidden="true"></i><span class="save-label">Save</span>';
    updateFavoriteButton(button, song);
    button.addEventListener("click", () => {
        const wasSaved = isFavorite(song);
        toggleFavorite(song);
        if (!wasSaved && isFavorite(song)) window.StageFx?.saved(button);
    });
    return button;
}

function updateFavoriteButton(button, song) {
    const active = isFavorite(song);
    button.classList.toggle("is-active", active);
    const label = button.querySelector(".save-label");
    if (label) label.textContent = active ? "Saved" : "Save";
    button.title = active ? "Edit saved song" : "Save song";
    button.setAttribute("aria-label", `${button.title}: ${getDisplaySongTitle(song)}`);
    button.setAttribute("aria-pressed", String(active));
}

function createMiniAddButton(song) {
    const button = document.createElement("button");
    button.className = "mini-add";
    button.type = "button";
    button.title = "Add to setlist";
    button.textContent = "+";
    ADD_BUTTON_SONGS.set(button, song);
    updateAddButton(button, song);
    button.addEventListener("click", () => addToSetlist(song, button));
    return button;
}

function updateAddButton(button, song, queuedIds = new Set(state.setlist.map(getSongIdentity))) {
    const queued = queuedIds.has(getSongIdentity(song));
    button.textContent = queued ? "Added" : button.classList.contains("mini-add") ? "+" : "Add";
    button.setAttribute("aria-disabled", String(queued));
    button.title = queued ? "Already in your setlist" : "Add to setlist";
    button.setAttribute("aria-label", `${button.title}: ${getDisplaySongTitle(song)}`);
}

function syncAddButtons() {
    const queuedIds = new Set(state.setlist.map(getSongIdentity));
    for (const button of document.querySelectorAll(".add-button, .mini-add")) {
        const song = ADD_BUTTON_SONGS.get(button);
        if (song) updateAddButton(button, song, queuedIds);
    }
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

function createCoverTile(song) {
    const tile = document.createElement("div");
    tile.className = "cover-tile";
    tile.setAttribute("aria-hidden", "true");

    const artist = getDisplayArtist(song) || getDisplaySongTitle(song);
    const hue = hashHue(song.artistKey || artist);
    tile.style.background =
        `linear-gradient(135deg, hsl(${hue} 44% 46%), hsl(${(hue + 42) % 360} 50% 30%))`;
    tile.textContent = getArtistInitials(artist);
    return tile;
}

function hashHue(value) {
    let hash = 7;
    for (const char of String(value || "")) {
        hash = ((hash * 31) + char.codePointAt(0)) >>> 0;
    }

    return hash % 360;
}

function getArtistInitials(name) {
    const words = String(name || "")
        .split(/\s+/)
        .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ""))
        .filter(Boolean);

    if (!words.length) {
        return "♪";
    }

    return words.slice(0, 2).map((word) => word[0].toUpperCase()).join("");
}

function createSongCard(song) {
    const card = document.createElement("article");
    card.className = "song-card";

    const head = document.createElement("div");
    head.className = "card-head";

    const text = document.createElement("div");
    text.className = "card-head-text";
    const title = document.createElement("div");
    title.className = "song-title";
    setHighlightedText(title, getDisplaySongTitle(song), getQueryTokens());

    text.append(title, createArtistSearchControl(song, "song-artist"));
    head.append(createCoverTile(song), text);

    const meta = document.createElement("div");
    meta.className = "meta-row";
    if (state.popularThreshold && (song.popularity || 0) >= state.popularThreshold) {
        const popular = document.createElement("span");
        popular.className = "pill popular";
        popular.textContent = "Popular";
        popular.title = "Among the most-streamed songs in this songbook";
        meta.appendChild(popular);
    }
    if (song.whatsNew) {
        const fresh = document.createElement("span");
        fresh.className = "pill new";
        fresh.textContent = "New";
        fresh.title = `Added to the songbook ${formatAddedDate(song.whatsNew.addedOn)}`;
        meta.appendChild(fresh);
    }
    appendAudioMetadata(meta, song);
    appendPills(meta, getSongMoods(song), "mood", "mood");
    appendPills(meta, getSongGenres(song), "genre", "genre");
    appendPills(meta, song.eras, "era", "decade");
    annotateEraSource(meta, song);
    appendPills(meta, getHolidayValues(song), "flag", "holiday");
    appendPills(meta, getDisplayFlags(song), "flag");

    if (!meta.childElementCount && (song.tags || []).length) {
        appendPills(meta, song.tags.slice(0, 3), "");
    }

    capPills(meta, 2);

    const actions = document.createElement("div");
    actions.className = "card-actions";

    const cardTools = document.createElement("div");
    cardTools.className = "card-tools";
    cardTools.append(createFavoriteButton(song), createSongLinks(song));

    const button = document.createElement("button");
    button.className = "add-button";
    button.type = "button";
    button.textContent = "Add";
    ADD_BUTTON_SONGS.set(button, song);
    updateAddButton(button, song);
    button.addEventListener("click", () => addToSetlist(song, button));

    actions.append(cardTools, button);
    card.append(head, meta, actions);
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

        for (const marker of getVersionMarkers(song)) {
            const badge = document.createElement("span");
            badge.className = "version-badge";
            badge.textContent = marker;
            title.appendChild(badge);
        }

        row.append(title, createRowTools(song));
        list.appendChild(row);
    }

    details.appendChild(list);
    card.appendChild(details);
    return card;
}

function getVersionMarkers(song) {
    const markers = String(song.song || "").match(/\b(multiplex|(?:sf|sbi|sb|mm|hmx)\d{3,6})\b/gi) || [];
    return [...new Set(markers.map((marker) => marker.toUpperCase()))];
}

function createArtistSearchControl(song, className, { highlight = true } = {}) {
    const artistName = getDisplayArtist(song);
    const artist = document.createElement(artistName ? "button" : "div");
    artist.className = className;
    if (artistName) {
        setHighlightedText(artist, artistName, highlight ? getQueryTokens() : []);
    } else {
        artist.textContent = "Unknown artist";
    }

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

    const query = encodeURIComponent(`${getDisplayArtist(song)} ${getDisplaySongTitle(song) || ""}`.trim());
    const button = document.createElement("button");
    button.className = "icon-button link-popout-button";
    button.type = "button";
    button.title = "Music links";
    button.setAttribute("aria-label", `Music links for ${getDisplaySongTitle(song)}`);
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
    const audioSourceUrl = getAudioSourceUrl(song);
    const hasTags = groups.length || audioSourceUrl;
    const button = document.createElement("button");
    button.className = "icon-button link-popout-button tag-popout-button";
    button.type = "button";
    button.title = hasTags ? "Song tags" : "No tags";
    button.disabled = !hasTags;
    button.setAttribute("aria-label", `${hasTags ? "Tags" : "No tags"} for ${getDisplaySongTitle(song)}`);
    button.setAttribute("aria-haspopup", "true");
    button.setAttribute("aria-expanded", "false");
    button.innerHTML = '<i data-lucide="tags" aria-hidden="true"></i>';

    const menu = document.createElement("div");
    menu.className = "song-tags-popout";
    menu.hidden = true;

    if (audioSourceUrl) {
        const section = document.createElement("section");
        section.className = "tag-popout-group";
        const label = document.createElement("div");
        label.className = "tag-popout-label";
        label.textContent = "Reference recording · GetSongBPM";
        const pills = document.createElement("div");
        pills.className = "tag-popout-pills";
        appendAudioMetadata(pills, song);
        const note = document.createElement("p");
        note.textContent = "Karaoke arrangements may use a different tempo or key.";
        section.append(label, pills, note);
        menu.appendChild(section);
    }

    for (const group of groups) {
        const section = document.createElement("section");
        section.className = "tag-popout-group";

        const label = document.createElement("div");
        label.className = "tag-popout-label";
        label.textContent = group.label;

        const pills = document.createElement("div");
        pills.className = "tag-popout-pills";
        appendPills(pills, group.values, group.className, group.filterName, group.limit);
        if (group.filterName === "decade") annotateEraSource(pills, song);

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
        placeSongPopout(container, controls.menu);
    }
}

// Popouts open upward from their button. Inside a scrolling list or dialog
// (the setlist, saved songs) that would cut them off, so there they float in
// the viewport where there is room, and close when anything scrolls.
function placeSongPopout(container, menu) {
    const floating = hasScrollingAncestor(container);
    container.classList.toggle("is-floating", floating);
    // Measure at the corner, where nothing narrows the menu (a narrower menu
    // wraps taller). The corner is the viewport's, except while a sheet slides
    // in: its transform then offsets fixed children, and origin corrects that.
    Object.assign(menu.style, floating ? { top: "0px", left: "0px", maxHeight: "" } : { top: "", left: "", maxHeight: "" });
    if (!floating) return;

    const origin = menu.getBoundingClientRect();
    const button = TAG_MENU_STORAGE.get(container).button.getBoundingClientRect();
    const gap = 7;
    const margin = 8;
    const below = window.innerHeight - button.bottom - gap - margin;
    const above = button.top - gap - margin;
    const openBelow = below >= Math.min(menu.offsetHeight, 240) || below >= above;
    menu.style.maxHeight = `${Math.min(360, Math.max(120, openBelow ? below : above))}px`;
    const top = openBelow ? button.bottom + gap : button.top - gap - menu.offsetHeight;
    const left = Math.max(margin, Math.min(button.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - margin));
    menu.style.top = `${top - origin.top}px`;
    menu.style.left = `${left - origin.left}px`;
}

function hasScrollingAncestor(element) {
    for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
        if (getComputedStyle(node).overflowY !== "visible") return true;
    }
    return false;
}

function closeFloatingSongTagMenus(event) {
    if (event?.target?.closest?.(".song-tags-popout")) return;
    if (document.querySelector(".song-tags.is-open.is-floating")) closeSongTagMenus();
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
    more.textContent = `Details +${hiddenPills.length}`;
    more.title = `Show ${hiddenPills.length} more tags`;
    more.setAttribute("aria-label", `Show ${hiddenPills.length} more tags`);
    more.setAttribute("aria-expanded", "false");
    more.addEventListener("click", () => {
        const expanded = more.getAttribute("aria-expanded") !== "true";
        for (const pill of hiddenPills) pill.hidden = !expanded;
        more.setAttribute("aria-expanded", String(expanded));
        more.textContent = expanded ? "Fewer details" : `Details +${hiddenPills.length}`;
        more.title = expanded ? "Hide extra details" : `Show ${hiddenPills.length} more tags`;
        more.setAttribute("aria-label", more.title);
    });
    container.appendChild(more);
}

function applyPillFilter(filterName, value) {
    leaveArtistView();
    state.pushHistory = true;
    const def = MULTI_FILTER_DEFS.find((item) => item.param === filterName);
    if (def) {
        state.filters[def.key] = [value];
    }
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
    state.exactArtist = true;
    state.favoriteOnly = false;
    state.pushHistory = true;
    for (const def of MULTI_FILTER_DEFS) {
        state.filters[def.key] = [];
    }
    state.filters.duet = false;
    state.filters.popular = false;
    state.filters.recent = false;
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
    const total = state.songs.length.toLocaleString();
    const songCount = `${totalMatches.toLocaleString()} ${totalMatches === 1 ? "song" : "songs"}`;

    els.status.textContent = `${total} songs`;

    if (state.mode === "browse") {
        els.resultsTitle.textContent = state.browseBy === "artist" ? "Artists A–Z" : "Songs A–Z";
        const letter = state.browseLetter === "#" ? "Numbers & symbols" : state.browseLetter;
        els.resultCount.textContent = `${letter} · ${songCount}`;
        return;
    }

    els.applyFiltersButton.textContent = `Show ${songCount}`;
    if (isDiscoverView()) {
        els.resultsTitle.textContent = "Discover";
        els.resultCount.textContent = `Fresh picks from ${total} songs`;
    } else {
        const shown = state.visibleSongs.length;
        els.resultsTitle.textContent = "Songs";
        els.resultCount.textContent = shown < totalMatches
            ? `Showing ${shown.toLocaleString()} of ${totalMatches.toLocaleString()} matches`
            : `${totalMatches.toLocaleString()} ${totalMatches === 1 ? "match" : "matches"}`;
    }
}

function renderResultContext() {
    const focusedSort = document.activeElement?.closest("#resultContext .context-sort button")?.dataset.sort || "";
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

    const sortGroup = document.createElement("div");
    sortGroup.className = "context-sort";
    sortGroup.setAttribute("role", "group");
    sortGroup.setAttribute("aria-label", "Order artist songs");

    const topButton = document.createElement("button");
    topButton.type = "button";
    topButton.dataset.sort = "popular";
    topButton.className = `choice-button${state.sortMode === "popular" ? " is-active" : ""}`;
    topButton.setAttribute("aria-pressed", String(state.sortMode === "popular"));
    topButton.textContent = "Top songs";
    topButton.addEventListener("click", () => {
        if (state.sortMode !== "popular") {
            setSearchOrder("popular");
        }
    });

    const azButton = document.createElement("button");
    azButton.type = "button";
    azButton.dataset.sort = "song";
    azButton.className = `choice-button${state.sortMode === "song" ? " is-active" : ""}`;
    azButton.setAttribute("aria-pressed", String(state.sortMode === "song"));
    azButton.textContent = "A–Z";
    azButton.addEventListener("click", () => {
        if (state.sortMode !== "song") {
            setSearchOrder("song");
        }
    });
    sortGroup.append(topButton, azButton);

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

    els.resultContext.append(label, artist, count, sortGroup);
    if (meta.childElementCount) {
        els.resultContext.appendChild(meta);
    }
    els.resultContext.appendChild(clear);

    if (focusedSort) {
        const replacement = sortGroup.querySelector(`button[data-sort="${focusedSort}"]`);
        replacement?.focus({ preventScroll: true });
    }
}

function renderResultActions(totalMatches) {
    const remaining = totalMatches - state.visibleSongs.length;
    const supportsPagination = state.mode === "search" ||
        (state.mode === "browse" && state.browseBy === "song");
    els.resultActions.hidden = !supportsPagination || remaining <= 0;

    if (els.resultActions.hidden) {
        return;
    }

    const nextCount = Math.min(RESULT_BATCH_SIZE, remaining).toLocaleString();
    els.showMoreResultsButton.textContent = `Show ${nextCount} more`;
    els.showAllResultsButton.textContent = `Show all ${totalMatches.toLocaleString()}`;
    els.showAllResultsButton.hidden = totalMatches > 10000;
}

function applyInitialState() {
    const params = new URLSearchParams(window.location.search);
    // A link that carries state describes a complete view. Merging it with the
    // visitor's stored filters made shared links show something else entirely.
    if (!ROUTE_PARAMS.some((key) => params.has(key))) {
        applyStoredUiState();
    }

    applyInitialRoute();
    els.searchInput.value = state.query;
    syncSearchScopeInput();
    updateSearchPlaceholder();
    bindHistoryNavigation();
}

function resetViewState() {
    clearSearchQuery();
    clearSearchFilters();
    state.mode = "search";
    state.browseBy = "song";
    state.sortMode = "relevance";
    state.groupOpenMode = "auto";
    state.randomPick = null;
}

function bindHistoryNavigation() {
    window.addEventListener("popstate", () => {
        resetViewState();
        applyInitialRoute();
        sanitizeFilterValues();
        els.searchInput.value = state.query;
        syncSearchScopeInput();
        updateSearchPlaceholder();
        ensureBrowseLetter();
        resetResultLimit();
        render();
    });
}

// URL values may be stale, mis-cased, or hand-edited; keep only ones the
// catalog actually has, mapped to their canonical label.
function sanitizeFilterValues() {
    for (const def of MULTI_FILTER_DEFS) {
        const available = def.options();
        state.filters[def.key] = state.filters[def.key]
            .map((value) => available.find((option) => normalize(option) === normalize(value)) || "")
            .filter(Boolean);
    }
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
    state.exactArtist = stored.exactArtist === true && state.searchScope === "artist";

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

    if (["relevance", "popular", "artist", "song"].includes(stored.sortMode)) {
        state.sortMode = stored.sortMode;
    }

    if (stored.filters && typeof stored.filters === "object") {
        for (const def of MULTI_FILTER_DEFS) {
            const arrayValue = stored.filters[def.key];
            const legacyValue = stored.filters[def.param];
            if (Array.isArray(arrayValue)) {
                state.filters[def.key] = arrayValue.filter((value) => typeof value === "string" && value);
            } else if (typeof legacyValue === "string" && legacyValue) {
                state.filters[def.key] = [legacyValue];
            } else {
                state.filters[def.key] = [];
            }
        }
        state.filters.duet = Boolean(stored.filters.duet);
        state.filters.popular = Boolean(stored.filters.popular);
        state.filters.recent = Boolean(stored.filters.recent);
    }

    // Earlier versions kept an artist link's title order after its query was
    // cleared, so every later visit opened on the whole catalog A-Z. Repair
    // only their states; a title order chosen since then is kept.
    if (stored.version !== UI_STATE_VERSION &&
        state.sortMode === "song" && !state.query && !hasSongFilters()) {
        state.sortMode = "relevance";
    }
}

function applyInitialRoute() {
    // Capture a shared-setlist fragment before URL sync strips the hash;
    // it is resolved against the catalog once songs finish loading.
    const hashMatch = window.location.hash.match(/^#sl=(.+)$/);
    if (hashMatch) {
        state.pendingSharedSetlist = hashMatch[1];
    }

    const params = new URLSearchParams(window.location.search);
    const mode = params.get("mode");
    const browseBy = params.get("by");
    const letter = params.get("letter");
    const scope = params.get("scope");
    const query = params.get("q");
    const sort = params.get("sort");

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
    if (params.has("exact")) {
        state.exactArtist = params.get("exact") === "1" && state.searchScope === "artist";
    }

    if (["relevance", "popular", "artist", "song"].includes(sort)) {
        state.sortMode = sort;
    }

    for (const def of MULTI_FILTER_DEFS) {
        const raw = params.get(def.param);
        if (raw) {
            state.filters[def.key] = raw.split(",").map((value) => value.trim()).filter(Boolean);
        }
    }
    if (params.get("duet") === "1") state.filters.duet = true;
    if (params.get("popular") === "1") state.filters.popular = true;
    if (params.get("new") === "1") state.filters.recent = true;
    if (params.get("favorites") === "1") state.favoriteOnly = true;
    if (params.get("fuzzy") === "1") state.fuzzySearch = true;
}

function saveUiState() {
    try {
        localStorage.setItem(UI_STATE_STORAGE_KEY, JSON.stringify({
            version: UI_STATE_VERSION,
            mode: state.mode,
            browseBy: state.browseBy,
            browseLetter: state.browseLetter,
            searchScope: state.searchScope,
            exactArtist: state.exactArtist,
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
        if (state.exactArtist && state.searchScope === "artist") params.set("exact", "1");
        if (state.sortMode !== "relevance") {
            params.set("sort", state.sortMode);
        }
        for (const def of MULTI_FILTER_DEFS) {
            if (state.filters[def.key].length) {
                params.set(def.param, state.filters[def.key].join(","));
            }
        }
        if (state.filters.duet) params.set("duet", "1");
        if (state.filters.popular) params.set("popular", "1");
        if (state.filters.recent) params.set("new", "1");
        if (state.favoriteOnly) params.set("favorites", "1");
        if (state.fuzzySearch) params.set("fuzzy", "1");
    }

    const search = params.toString() ? `?${params.toString()}` : "";
    const push = state.pushHistory;
    state.pushHistory = false;
    if (window.location.search === search) {
        return;
    }

    try {
        const url = `${window.location.pathname}${search}`;
        if (push) {
            history.pushState(null, "", url);
        } else {
            history.replaceState(null, "", url);
        }
    } catch {
        // URL sync is a convenience (e.g. blocked in sandboxed iframes); ignore.
    }
}

// Setlist management, QR sharing, and snackbar helpers live in setlist-panel.js.
// Browse letter/grouping helpers live in browse-discover.js.

function toggleFavorite(song) {
    if (isFavorite(song)) {
        openSongNotes(song, document.activeElement);
        return;
    }
    recordRecentSearch();
    const next = { ...repertoire, [getSongIdentity(song)]: {
        song: toSetlistEntry(song), status: "saved", comfort: null, key: "", notes: "",
    } };
    if (persistRepertoire(next)) showSnackbar("Saved. Find your songs in More → Saved songs.");
}

function isFavorite(song) {
    return Boolean(song && repertoire[song.id || getSongIdentity(song)]);
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

function loadRecentSearches() {
    try {
        const values = JSON.parse(localStorage.getItem(RECENT_SEARCHES_STORAGE_KEY) || "[]");
        return Array.isArray(values)
            ? values.filter((value) => typeof value === "string" && value).slice(0, RECENT_SEARCHES_LIMIT)
            : [];
    } catch {
        return [];
    }
}

function saveRecentSearches() {
    try {
        localStorage.setItem(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify(state.recentSearches));
    } catch {
        // Recents are a convenience; ignore blocked storage.
    }
}

function recordRecentSearch(query = state.query) {
    const value = String(query || "").trim();
    if (!value || state.mode !== "search") {
        return;
    }

    const key = normalize(value);
    state.recentSearches = [
        value,
        ...state.recentSearches.filter((item) => normalize(item) !== key),
    ].slice(0, RECENT_SEARCHES_LIMIT);
    saveRecentSearches();
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

function getElementCenter(element) {
    const rect = element?.getBoundingClientRect();
    return rect?.width ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
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
    els.themeButton.innerHTML = `<i data-lucide="${isDark ? "sun" : "moon"}" aria-hidden="true"></i>${isDark ? "Light mode" : "Dark mode"}`;

    hydrateIcons();
}

function applyStoredCompactView() {
    let compact = false;
    try {
        compact = localStorage.getItem(COMPACT_VIEW_STORAGE_KEY) === "1";
    } catch {
        // Ignore storage errors; default to comfortable density.
    }
    document.body.classList.toggle("is-compact", compact);
    renderCompactViewButton();
}

function setCompactView(compact) {
    const enabled = Boolean(compact);
    document.body.classList.toggle("is-compact", enabled);
    try {
        localStorage.setItem(COMPACT_VIEW_STORAGE_KEY, enabled ? "1" : "0");
    } catch {
        // Density preference is a convenience; keep working if storage is unavailable.
    }
    renderCompactViewButton();
}

function renderCompactViewButton() {
    if (!els.compactViewButton) return;
    const isCompact = document.body.classList.contains("is-compact");
    els.compactViewButton.setAttribute("aria-pressed", String(isCompact));
    els.compactViewButton.title = isCompact ? "Comfortable view" : "Compact view";
    els.compactViewButton.setAttribute("aria-label", isCompact ? "Switch to comfortable view" : "Switch to compact view");
    els.compactViewButton.innerHTML = `<i data-lucide="rows-3" aria-hidden="true"></i>${isCompact ? "Comfortable view" : "Compact view"}`;
    hydrateIcons(els.compactViewButton);
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
        return song.artistSearchText || normalizeSearchText([
            getDisplayArtist(song),
            song.artist,
            song.lookupArtist,
        ].join(" "));
    }

    if (scope === "song") {
        return song.songSearchText || normalizeSearchText(song.song);
    }

    return song.allSearchText || `${song.songSearchText || normalizeSearchText(song.song)} ${song.artistSearchText || normalizeSearchText(getDisplayArtist(song))}`;
}

function getScopedSearchWords(song, scope = state.searchScope) {
    if (scope === "artist") {
        if (!song.artistWords) {
            song.artistWords = getSearchWordsFromNormalized(
                song.artistSearchText || normalizeSearchText([getDisplayArtist(song), song.artist, song.lookupArtist].join(" ")),
                song.artistSortText || normalize(getDisplayArtist(song))
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

// Filter popover UI, faceted counts, and active filter chips live in filters-panel.js.

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

const CLEAN_DISPLAY_CACHE = new Map();

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

const ANY_HOLIDAY_PATTERN = /(^| )(christmas|xmas|santa|noel|jingle|yule|yuletide|hanukkah|chanukah|halloween|spooky|new year|new years|auld lang syne|thanksgiving|valentine|valentines|st patrick|saint patrick|easter)( |$)/;

function getConsolidatedMoodsForSong(song, normalizedTags = null, normalizedGenres = null) {
    const consolidation = state.moodConsolidation;
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

const DUET_COLLAB_PATTERN = /\b(?:feat\.?|ft\.?|featuring|duet)\b/i;
const DUET_PAREN_WITH_PATTERN = /\(\s*with\s+(?!vocals?\b)[^)]+\)/i;
const SOLO_ARTIST_SEP_PATTERN = /[&+]|\b(?:feat\.?|ft\.?|featuring|and|with|vs\.?|versus|duet)\b/i;
const DUET_BACKING_GROUP_PATTERN = /^(?:the\s+|his\s+|her\s+)|^(?:wings|friends|company|band|orchestra|chorus|singers|quartet|trio|ensemble|players|crew|cast|family|gang|boys|girls|brothers|sisters|bandmates)$|\b(?:band|orchestra|chorus|singers|quartet|trio|ensemble|players|all[\s-]*stars?|experience|movement|revolution|heartbreakers|e street band|wailers|supremes|miracles|pips|diamonds|bad seeds|attractions|imposters|news|shondells|vandellas|marvelettes|four seasons|blackhearts|crickets|drifters|comets|blue caps|silver bullet band|rhythm kings|sunshine band|soul syndicate|family stone|crazy horse|stray gators|range|spiders from mars|saints|angels|revelations|jets|breakers|strangers|drifting cowboys|texas playboys|blue moon boys)\b/i;

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

// Built lazily: normalize() depends on caches declared later in this file.
function getDuetNonVocalKeys() {
    duetNonVocalKeys ||= DUET_NON_VOCAL_ARTISTS.map(normalize).sort((a, b) => b.length - a.length);
    return duetNonVocalKeys;
}
const DUET_CREDIT_SPLIT_PATTERN = /\s+(?:and|feat|ft|featuring|with|x|vs|versus)\s+/;
const DUET_TITLE_FEATURE_PATTERN = /\b(?:feat\.?|ft\.?|featuring)\s+([^)\]]+)/i;

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

const NORMALIZE_CACHE = new Map();

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
