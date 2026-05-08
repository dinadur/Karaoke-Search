const APP_VERSION = "20260508-5";
const DATA_URL = `karaoke_songs_enriched.json?v=${APP_VERSION}`;
const RESULT_BATCH_SIZE = 160;
const SEARCH_SCOPES = ["song", "artist", "mood", "genre", "holiday"];
const FACET_SCOPES = ["mood", "genre", "holiday"];
const loadStatusTimers = [];
const state = {
    songs: [],
    visibleSongs: [],
    matchCount: 0,
    resultLimit: RESULT_BATCH_SIZE,
    query: "",
    searchScope: "song",
    sortMode: "relevance",
    availableDecades: [],
    filters: {
        decade: "",
        duet: false,
        explicit: false,
    },
    mode: "search",
    browseBy: "song",
    browseLetter: "#",
    groupOpenMode: "auto",
    setlist: loadSetlist(),
};

const els = {
    status: document.getElementById("status"),
    searchInput: document.getElementById("searchInput"),
    randomButton: document.getElementById("randomButton"),
    clearButton: document.getElementById("clearButton"),
    searchModeButton: document.getElementById("searchModeButton"),
    browseModeButton: document.getElementById("browseModeButton"),
    searchScope: document.getElementById("searchScope"),
    searchScopeInputs: [...document.querySelectorAll('input[name="searchScope"]')],
    searchFilters: document.getElementById("searchFilters"),
    decadeFilter: document.getElementById("decadeFilter"),
    duetFilter: document.getElementById("duetFilter"),
    explicitFilter: document.getElementById("explicitFilter"),
    clearFiltersButton: document.getElementById("clearFiltersButton"),
    orderRelevanceButton: document.getElementById("orderRelevanceButton"),
    orderSongButton: document.getElementById("orderSongButton"),
    orderArtistButton: document.getElementById("orderArtistButton"),
    browseTools: document.getElementById("browseTools"),
    browseSongButton: document.getElementById("browseSongButton"),
    browseArtistButton: document.getElementById("browseArtistButton"),
    letterStrip: document.getElementById("letterStrip"),
    resultsList: document.getElementById("resultsList"),
    resultActions: document.getElementById("resultActions"),
    groupActions: document.getElementById("groupActions"),
    expandGroupsButton: document.getElementById("expandGroupsButton"),
    collapseGroupsButton: document.getElementById("collapseGroupsButton"),
    showMoreResultsButton: document.getElementById("showMoreResultsButton"),
    showAllResultsButton: document.getElementById("showAllResultsButton"),
    browseList: document.getElementById("browseList"),
    resultCount: document.getElementById("resultCount"),
    setlist: document.getElementById("setlist"),
    setlistCount: document.getElementById("setlistCount"),
    copySetlistButton: document.getElementById("copySetlistButton"),
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
    applyInitialRoute();
    startLoadStatus();

    try {
        const response = await fetch(DATA_URL, { cache: "no-store" });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const text = await response.text();
        els.status.textContent = "Preparing songbook";
        await nextFrame();

        const songs = JSON.parse(text);
        els.status.textContent = "Building songbook";
        await nextFrame();

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
    els.searchInput.addEventListener("input", () => {
        state.query = els.searchInput.value.trim();
        state.mode = "search";
        resetResultLimit();
        render();
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

    els.decadeFilter.addEventListener("change", () => {
        state.filters.decade = els.decadeFilter.value;
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

    els.explicitFilter.addEventListener("change", () => {
        state.filters.explicit = els.explicitFilter.checked;
        state.mode = "search";
        resetResultLimit();
        render();
    });

    els.clearFiltersButton.addEventListener("click", () => {
        state.filters.decade = "";
        state.filters.duet = false;
        state.filters.explicit = false;
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
        state.query = "";
        els.searchInput.value = "";
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

    els.randomButton.addEventListener("click", () => {
        const pool = state.visibleSongs.length ? state.visibleSongs : state.songs;
        if (!pool.length) {
            return;
        }

        const song = pool[Math.floor(Math.random() * pool.length)];
        addToSetlist(song);
        state.query = `${song.artist} ${song.song}`;
        els.searchInput.value = state.query;
        resetResultLimit();
        render();
    });

    els.showMoreResultsButton.addEventListener("click", () => {
        state.resultLimit = Math.min(state.resultLimit + RESULT_BATCH_SIZE, state.matchCount);
        render();
    });

    els.showAllResultsButton.addEventListener("click", () => {
        state.resultLimit = state.matchCount;
        render();
    });

    els.mobileSetlistButton.addEventListener("click", () => {
        document.body.classList.add("setlist-open");
    });

    els.closeSetlistButton.addEventListener("click", () => {
        document.body.classList.remove("setlist-open");
    });

    els.copySetlistButton.addEventListener("click", async () => {
        const text = state.setlist.map((song, index) => `${index + 1}. ${song.song} - ${song.artist}`).join("\n");
        if (!text) {
            return;
        }

        await navigator.clipboard.writeText(text);
        els.copySetlistButton.classList.add("copied");
        setTimeout(() => els.copySetlistButton.classList.remove("copied"), 800);
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
    state.songs = songs.map((song, index) => ({
        ...song,
        id: `${normalize(song.artist)}\u001f${normalize(song.song)}\u001f${index}`,
        songLetter: getBrowseLetter(song.song),
        artistLetter: getBrowseLetter(song.artist || song.lookupArtist),
        searchText: normalize(song.searchText || buildSearchText(song)),
        songWords: getSearchWords(song.song),
        artistWords: getSearchWords([song.artist, song.lookupArtist].join(" ")),
        moodWords: getSearchWords((song.moods || []).join(" ")),
        genreWords: getSearchWords((song.genres || []).join(" ")),
        holidayWords: getSearchWords(getHolidayValues(song).join(" ")),
    }));

    state.availableDecades = getAvailableDecades();
    renderDecadeFilterOptions();
    updateSearchPlaceholder();
    ensureBrowseLetter();
    renderSetlist();
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

function render() {
    renderMode();
    renderSearchFilters();

    if (state.mode === "browse") {
        renderBrowse();
        renderStatus(getBrowseSongs().length);
        if (window.lucide) {
            window.lucide.createIcons();
        }
        return;
    }

    const ranked = rankSongs(state.songs, state.query);
    const filtered = applySearchFilters(ranked);
    state.matchCount = filtered.length;
    state.visibleSongs = sortSongs(filtered).slice(0, state.resultLimit);

    renderResults();
    renderStatus(filtered.length);
    renderResultActions(filtered.length);

    if (window.lucide) {
        window.lucide.createIcons();
    }
}

function renderMode() {
    const isBrowse = state.mode === "browse";
    els.searchModeButton.classList.toggle("is-active", !isBrowse);
    els.browseModeButton.classList.toggle("is-active", isBrowse);
    els.browseTools.hidden = !isBrowse;
    els.searchScope.hidden = isBrowse;
    els.searchFilters.hidden = isBrowse;
    els.resultsList.hidden = isBrowse;
    els.resultActions.hidden = true;
    els.groupActions.hidden = true;
    els.browseList.hidden = !isBrowse;
}

function rankSongs(songs, query) {
    const tokens = normalize(query).split(" ").filter(Boolean);
    if (!tokens.length) {
        if (isFacetScope(state.searchScope)) {
            return songs
                .filter((song) => getScopedSearchText(song))
                .sort((a, b) => (b.confidence || 0) - (a.confidence || 0) || compareText(a.artist, b.artist));
        }

        return songs
            .map((song) => ({ song, score: song.confidence || 0 }))
            .sort((a, b) => b.score - a.score)
            .map((item) => item.song);
    }

    return songs
        .map((song) => {
            const haystack = getScopedSearchText(song);
            const fuzzyWords = getScopedSearchWords(song);
            const phrase = tokens.join(" ");
            let score = 0;

            for (const token of tokens) {
                if (haystack.includes(token)) {
                    score += 8;
                } else {
                    score += getFuzzyTokenScore(token, fuzzyWords);
                }
            }

            if (haystack.includes(phrase)) {
                score += 12;
            }

            if (state.searchScope === "song" && normalize(song.song).startsWith(phrase)) {
                score += 10;
            }

            if (state.searchScope === "artist" && normalize(song.artist || song.lookupArtist).startsWith(phrase)) {
                score += 10;
            }

            if (state.searchScope === "mood" && (song.moods || []).some((mood) => normalize(mood) === phrase)) {
                score += 14;
            }

            if (state.searchScope === "genre" && (song.genres || []).some((genre) => normalize(genre) === phrase)) {
                score += 14;
            }

            if (state.searchScope === "holiday" && getHolidayValues(song).some((holiday) => normalize(holiday) === phrase)) {
                score += 14;
            }

            return { song, score };
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score || compareText(a.song.artist, b.song.artist))
        .map((item) => item.song);
}

function applySearchFilters(songs) {
    return songs.filter((song) => {
        if (state.filters.decade && !(song.eras || []).includes(state.filters.decade)) {
            return false;
        }

        if (state.filters.duet && !hasFlag(song, "Duet")) {
            return false;
        }

        if (state.filters.explicit && !hasFlag(song, "Explicit")) {
            return false;
        }

        return true;
    });
}

function sortSongs(songs) {
    const mode = state.sortMode;
    const copy = [...songs];

    if (mode === "artist") {
        return copy.sort((a, b) => compareText(a.artist, b.artist) || compareText(a.song, b.song));
    }

    if (mode === "song") {
        return copy.sort((a, b) => compareText(a.song, b.song) || compareText(a.artist, b.artist));
    }

    if (mode === "confidence") {
        return copy.sort((a, b) => (b.confidence || 0) - (a.confidence || 0) || compareText(a.artist, b.artist));
    }

    return copy;
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

function renderResults() {
    els.resultsList.innerHTML = "";
    els.resultsList.classList.toggle("is-grouped", shouldGroupSearchResults());
    renderGroupActions();

    if (!state.visibleSongs.length) {
        els.resultsList.innerHTML = '<p class="empty-state">No matches</p>';
        return;
    }

    if (shouldGroupSearchResults()) {
        renderGroupedSearchResults();
        return;
    }

    const fragment = document.createDocumentFragment();
    for (const song of state.visibleSongs) {
        fragment.appendChild(createSongCard(song));
    }

    els.resultsList.appendChild(fragment);
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
    title.textContent = song.song || "Untitled";

    if (showArtist) {
        const artist = document.createElement("div");
        artist.className = "browse-artist";
        artist.textContent = song.artist || song.lookupArtist || "Unknown artist";
        row.append(title, artist, createSongLinks(song), createMiniAddButton(song));
    } else {
        row.append(title, createSongLinks(song), createMiniAddButton(song));
    }

    return row;
}

function renderBrowse() {
    renderBrowseControls();
    els.browseList.innerHTML = "";

    const songs = getBrowseSongs();
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
    els.browseSongButton.classList.toggle("is-active", state.browseBy === "song");
    els.browseArtistButton.classList.toggle("is-active", state.browseBy === "artist");

    const counts = getLetterCounts();
    const letters = ["#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];

    els.letterStrip.innerHTML = "";
    for (const letter of letters) {
        const count = counts.get(letter) || 0;
        const button = document.createElement("button");
        button.className = "letter-button";
        button.type = "button";
        button.dataset.letter = letter;
        button.classList.toggle("is-active", state.browseLetter === letter);
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
            title.textContent = song.song || "Untitled";

            const add = createMiniAddButton(song);
            row.append(title, add);
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

    const body = document.createElement("div");
    body.className = "browse-items";

    summary.append(title);
    section.append(summary, body);
    return section;
}

function createBrowseRow(song) {
    const row = document.createElement("div");
    row.className = "browse-row";

    const title = document.createElement("div");
    title.className = "browse-title";
    title.textContent = song.song || "Untitled";

    const artist = document.createElement("div");
    artist.className = "browse-artist";
    artist.textContent = song.artist || song.lookupArtist || "Unknown artist";

    const add = createMiniAddButton(song);
    row.append(title, artist, add);
    return row;
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
    title.textContent = song.song || "Untitled";

    const artist = document.createElement("div");
    artist.className = "song-artist";
    artist.textContent = song.artist || song.lookupArtist || "Unknown artist";

    text.append(title, artist);

    const meta = document.createElement("div");
    meta.className = "meta-row";
    appendPills(meta, song.moods, "mood");
    appendPills(meta, song.genres, "genre");
    appendPills(meta, song.eras, "");
    appendPills(meta, getHolidayValues(song), "flag");
    appendPills(meta, getDisplayFlags(song), "flag");

    if (!meta.childElementCount && (song.tags || []).length) {
        appendPills(meta, song.tags.slice(0, 3), "");
    }

    const actions = document.createElement("div");
    actions.className = "card-actions";

    const links = createSongLinks(song);

    const button = document.createElement("button");
    button.className = "add-button";
    button.type = "button";
    button.textContent = "Add";
    button.addEventListener("click", () => addToSetlist(song));

    actions.append(links, button);
    card.append(text, meta, actions);
    return card;
}

function createSongLinks(song) {
    const container = document.createElement("div");
    container.className = "song-links";

    const query = encodeURIComponent(`${song.artist || song.lookupArtist || ""} ${song.song || ""}`.trim());
    const links = [
        ["Spotify", `https://open.spotify.com/search/${query}`],
        ["YouTube Music", `https://music.youtube.com/search?q=${query}`],
    ];

    for (const [label, href] of links) {
        const link = document.createElement("a");
        link.href = href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = label;
        container.appendChild(link);
    }

    return container;
}

function appendPills(container, values = [], className) {
    for (const value of values.slice(0, 4)) {
        if (!value) continue;
        const pill = document.createElement("span");
        pill.className = className ? `pill ${className}` : "pill";
        pill.textContent = value;
        container.appendChild(pill);
    }
}

function renderStatus(totalMatches) {
    const enriched = state.songs.filter((song) => song.status === "ok").length;
    const total = state.songs.length.toLocaleString();
    const tagged = enriched.toLocaleString();

    els.status.textContent = `${tagged} tagged / ${total} songs`;

    if (state.mode === "browse") {
        els.resultCount.textContent = state.browseLetter;
    } else {
        const shown = state.visibleSongs.length.toLocaleString();
        els.resultCount.textContent = `${shown} shown from ${totalMatches.toLocaleString()} matches`;
    }
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

function applyInitialRoute() {
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
        els.searchInput.value = query;
    }

    if (["relevance", "artist", "song"].includes(sort)) {
        state.sortMode = sort;
    }
}

function addToSetlist(song) {
    const exists = state.setlist.some((item) => item.id === song.id);
    if (!exists) {
        state.setlist.push(song);
        saveSetlist();
        renderSetlist();
    }
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
            return compareText(a.artist || a.lookupArtist, b.artist || b.lookupArtist) || compareText(a.song, b.song);
        }

        return compareText(a.song, b.song) || compareText(a.artist, b.artist);
    });
}

function groupByArtist(songs) {
    const groups = new Map();
    const sortedSongs = [...songs].sort((a, b) =>
        compareText(a.artist || a.lookupArtist, b.artist || b.lookupArtist) || compareText(a.song, b.song)
    );

    for (const song of sortedSongs) {
        const artist = song.artist || song.lookupArtist || "Unknown artist";
        if (!groups.has(artist)) {
            groups.set(artist, []);
        }
        groups.get(artist).push(song);
    }

    return [...groups.entries()]
        .map(([artist, artistSongs]) => ({ artist, songs: artistSongs }))
        .sort((a, b) => compareText(a.artist, b.artist));
}

function groupBySongLetter(songs) {
    const groups = new Map();
    for (const song of [...songs].sort((a, b) => compareText(a.song, b.song) || compareText(a.artist, b.artist))) {
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

        const title = document.createElement("span");
        title.className = "setlist-title";
        title.textContent = song.song;

        const artist = document.createElement("span");
        artist.className = "setlist-artist";
        artist.textContent = song.artist || "Unknown artist";

        const remove = document.createElement("button");
        remove.className = "remove-button";
        remove.type = "button";
        remove.textContent = "Remove";
        remove.addEventListener("click", () => {
            state.setlist.splice(index, 1);
            saveSetlist();
            renderSetlist();
        });

        item.append(title, artist, remove);
        fragment.appendChild(item);
    });

    els.setlist.appendChild(fragment);
}

function saveSetlist() {
    localStorage.setItem("karaokeSetlist", JSON.stringify(state.setlist));
}

function loadSetlist() {
    try {
        return JSON.parse(localStorage.getItem("karaokeSetlist") || "[]");
    } catch {
        return [];
    }
}

function updateSearchPlaceholder() {
    const placeholders = {
        song: "Search song titles",
        artist: "Search artists",
        mood: "Search moods",
        genre: "Search genres",
        holiday: "Search Christmas, Halloween, New Year",
    };

    els.searchInput.placeholder = placeholders[state.searchScope] || placeholders.song;
}

function getScopedSearchText(song) {
    if (state.searchScope === "artist") {
        return normalize([song.artist, song.lookupArtist].join(" "));
    }

    if (state.searchScope === "mood") {
        return normalize((song.moods || []).join(" "));
    }

    if (state.searchScope === "genre") {
        return normalize((song.genres || []).join(" "));
    }

    if (state.searchScope === "holiday") {
        return normalize(getHolidayValues(song).join(" "));
    }

    return normalize(song.song);
}

function getScopedSearchWords(song) {
    if (state.searchScope === "artist") {
        return song.artistWords;
    }

    if (state.searchScope === "mood") {
        return song.moodWords;
    }

    if (state.searchScope === "genre") {
        return song.genreWords;
    }

    if (state.searchScope === "holiday") {
        return song.holidayWords;
    }

    return song.songWords;
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

function renderDecadeFilterOptions() {
    els.decadeFilter.innerHTML = '<option value="">Any decade</option>';

    for (const decade of state.availableDecades) {
        const option = document.createElement("option");
        option.value = decade;
        option.textContent = decade;
        els.decadeFilter.appendChild(option);
    }
}

function renderSearchFilters() {
    els.decadeFilter.value = state.filters.decade;
    els.duetFilter.checked = state.filters.duet;
    els.explicitFilter.checked = state.filters.explicit;
    els.clearFiltersButton.hidden = !hasActiveSearchFilters();
    els.orderRelevanceButton.classList.toggle("is-active", state.sortMode === "relevance");
    els.orderSongButton.classList.toggle("is-active", state.sortMode === "song");
    els.orderArtistButton.classList.toggle("is-active", state.sortMode === "artist");
}

function hasActiveSearchFilters() {
    return Boolean(state.filters.decade) ||
        state.filters.duet ||
        state.filters.explicit;
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

function getTagValues(song) {
    return [
        ...(song.genres || []),
        ...(song.eras || []),
        ...(song.flags || []),
        ...getHolidayValues(song),
        ...(song.tags || []),
    ];
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

function isFacetScope(scope) {
    return FACET_SCOPES.includes(scope);
}

function buildSearchText(song) {
    return [
        song.artist,
        song.song,
        ...(song.genres || []),
        ...(song.moods || []),
        ...(song.eras || []),
        ...(song.flags || []),
        ...(song.tags || []),
    ].join(" ").toLowerCase();
}

function normalize(value) {
    return String(value || "")
        .toLowerCase()
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

function compareDecade(a, b) {
    const aYear = Number(String(a).match(/\d+/)?.[0] || 0);
    const bYear = Number(String(b).match(/\d+/)?.[0] || 0);

    return aYear - bYear || compareText(a, b);
}
