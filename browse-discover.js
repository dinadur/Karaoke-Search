// Discover shelves, Browse A–Z mode (batched Song Browse + lazy Artist Browse),
// and grouped search result rendering. Loaded before karaoke_explorer.js.

const LAZY_SECTION_POPULATORS = new WeakMap();

function renderDiscover() {
    els.resultsList.innerHTML = "";
    els.resultsList.classList.remove("is-grouped");
    els.resultsList.classList.add("is-discover");
    renderGroupActions();

    const fragment = document.createDocumentFragment();
    const recents = createRecentSearchesRow();
    if (recents) {
        fragment.appendChild(recents);
    }

    for (const shelf of buildDiscoverShelves()) {
        fragment.appendChild(createShelf(shelf));
    }

    const foot = document.createElement("div");
    foot.className = "discover-foot";
    foot.appendChild(createEmptyAction("Browse titles A–Z", () => {
        state.mode = "browse";
        state.browseBy = "song";
        resetBrowseLimit();
        ensureBrowseLetter();
        render();
    }));
    foot.appendChild(createEmptyAction("Browse artists A–Z", () => {
        state.mode = "browse";
        state.browseBy = "artist";
        resetBrowseLimit();
        ensureBrowseLetter();
        render();
    }));
    fragment.appendChild(foot);

    els.resultsList.appendChild(fragment);
}

function createRecentSearchesRow() {
    if (!state.recentSearches.length) {
        return null;
    }

    const row = document.createElement("div");
    row.className = "recent-searches";

    const label = document.createElement("span");
    label.className = "filter-label";
    label.textContent = "Recent";
    row.appendChild(label);

    for (const query of state.recentSearches) {
        const chip = document.createElement("button");
        chip.className = "empty-suggestion";
        chip.type = "button";
        chip.textContent = query;
        chip.title = `Search “${query}” again`;
        chip.addEventListener("click", () => {
            leaveArtistView();
            state.query = query;
            els.searchInput.value = query;
            state.mode = "search";
            resetResultLimit();
            render();
        });
        row.appendChild(chip);
    }

    const clear = document.createElement("button");
    clear.className = "multi-clear";
    clear.type = "button";
    clear.textContent = "Clear";
    clear.title = "Clear recent searches";
    clear.addEventListener("click", () => {
        state.recentSearches = [];
        saveRecentSearches();
        render();
    });
    row.appendChild(clear);

    return row;
}

function buildDiscoverShelves() {
    const shelves = [];
    const savedIds = Object.keys(repertoire);

    if (savedIds.length) {
        const byId = getCatalogIndex();
        const favorites = [];
        for (const id of savedIds) {
            const song = byId.get(id);
            if (song) {
                favorites.push(song);
            }
        }
        favorites.sort((a, b) => compareArtistSort(a, b) || compareSongSort(a, b));
        if (favorites.length) {
            shelves.push({
                title: "Your saved songs",
                songs: favorites.slice(0, 8),
                seeAll: () => applyShelfFilter(() => {
                    state.favoriteOnly = true;
                }),
            });
        }
    }

    if (!state.cachedDiscoverShelves) {
        state.cachedDiscoverShelves = buildSampledShelves();
    }

    return [...shelves, ...state.cachedDiscoverShelves];
}

function buildSampledShelves() {
    const shelves = [];
    const seasonalHoliday = getSeasonalHoliday();
    const seasonalKey = seasonalHoliday ? normalize(seasonalHoliday) : "";
    const moodTargets = ["Singalong", "Party"]
        .map((mood) => findAvailableValue(state.availableMoods, mood))
        .filter(Boolean)
        .map((label) => ({ label, key: normalize(label), songs: [] }));
    const decadeTargets = ["70s", "80s", "90s"]
        .map((decade) => findAvailableValue(state.availableDecades, decade))
        .filter(Boolean)
        .map((label) => ({ label, key: normalize(label), songs: [] }));

    // Bucket all Discover pools in a single catalog pass instead of scanning
    // 37k songs separately for every shelf.
    const tagged = [];
    const newlyAdded = [];
    const seasonalSongs = [];
    const duets = [];
    let popularCount = 0;

    for (const song of state.songs) {
        if (song.status === "ok") tagged.push(song);
        else if (song.status === "pending") newlyAdded.push(song);
        if ((song.popularity || 0) > 0) popularCount++;
        if (seasonalKey && song.filterKeys.holidays.has(seasonalKey)) seasonalSongs.push(song);
        for (const target of moodTargets) {
            if (song.filterKeys.moods.has(target.key)) target.songs.push(song);
        }
        if (song.isDuet) duets.push(song);
        for (const target of decadeTargets) {
            if (song.filterKeys.decades.has(target.key)) target.songs.push(song);
        }
    }

    if (popularCount >= 100) {
        // defaultRankedSongs is already ordered by popularity descending.
        const ranked = state.defaultRankedSongs.length ? state.defaultRankedSongs : state.songs;
        const top = [];
        for (const song of ranked) {
            if ((song.popularity || 0) <= 0) break;
            top.push(song);
            if (top.length === 800) break;
        }
        shelves.push({ title: "Crowd pleasers", songs: sampleSongs(top, 8) });
    }

    if (state.whatsNewSongs.length) {
        shelves.unshift(createWhatsNewShelf());
    } else if (newlyAdded.length >= 4) {
        // Without whats_new.json (or for an imported catalog it doesn't
        // describe), fall back to a sample of rows still awaiting enrichment.
        shelves.push({
            title: "Newly added",
            songs: sampleSongs(newlyAdded, 8),
        });
    }

    shelves.push({
        title: "Lucky dip",
        songs: sampleSongs(tagged.length ? tagged : state.songs, 8),
    });

    if (seasonalHoliday) {
        shelves.push({
            title: `${seasonalHoliday} songs`,
            songs: sampleSongs(seasonalSongs, 8),
            seeAll: () => applyPillFilter("holiday", seasonalHoliday),
        });
    }

    for (const target of moodTargets) {
        shelves.push({
            title: target.label,
            songs: sampleSongs(target.songs, 8),
            seeAll: () => applyPillFilter("mood", target.label),
        });
    }

    if (duets.length) {
        shelves.push({
            title: "Duets",
            songs: sampleSongs(duets, 8),
            seeAll: () => applyShelfFilter(() => {
                state.filters.duet = true;
            }),
        });
    }

    for (const target of decadeTargets) {
        shelves.push({
            title: `Big in the ${target.label}`,
            songs: sampleSongs(target.songs, 8),
            seeAll: () => applyPillFilter("decade", target.label),
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

// What's new: songs the venue sync added recently (whats_new.json, built from
// the catalog's Git history by scripts/build-whats-new.js), most popular first.
//
// Fresh rows usually have no enrichment yet, so popularity falls back through
// signals already in the catalog, all on the same Deezer rank scale:
//   1. the song's own Deezer rank, once enrichment has filled it;
//   2. else the best rank of another karaoke version of the same song;
//   3. else the median rank of the artist's other catalog songs, reduced by 10%
//      for each further new song by that artist (one batch can bring a dozen
//      songs by one act, and they can't all be its hits).
// Songs with no signal at all rank last, newest batch first.
const WHATS_NEW_SHELF_SIZE = 12;

function buildWhatsNew(songs, source) {
    const addedOn = new Map();
    for (const batch of Array.isArray(source?.batches) ? source.batches : []) {
        if (!batch || !/^\d{4}-\d{2}-\d{2}$/.test(batch.date) || !Array.isArray(batch.ids)) continue;
        for (const id of batch.ids) {
            if (typeof id === "string" && !addedOn.has(id)) addedOn.set(id, batch.date);
        }
    }
    if (!addedOn.size) return { songs: [], latest: "" };

    const versionBest = new Map();
    const artistRanks = new Map();
    for (const song of songs) {
        const rank = song.popularity || 0;
        if (rank <= 0) continue;
        const versionKey = getSongVersionKey(song);
        versionBest.set(versionKey, Math.max(versionBest.get(versionKey) || 0, rank));
        if (song.artistKey) {
            if (!artistRanks.has(song.artistKey)) artistRanks.set(song.artistKey, []);
            artistRanks.get(song.artistKey).push(rank);
        }
    }

    const artistMedian = new Map();
    const artistUses = new Map();
    const fresh = [];
    let latest = "";
    for (const song of songs) {
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
        fresh.push(song);
    }

    fresh.sort((a, b) => b.whatsNew.score - a.whatsNew.score ||
        b.whatsNew.addedOn.localeCompare(a.whatsNew.addedOn) ||
        compareArtistSort(a, b) ||
        compareSongSort(a, b));
    return { songs: fresh, latest };
}

function createWhatsNewShelf() {
    // One card per song and, while there are enough artists, one per artist.
    const picked = [];
    const seen = new Set();
    const artists = new Set();
    for (const spread of [true, false]) {
        for (const song of state.whatsNewSongs) {
            if (picked.length === WHATS_NEW_SHELF_SIZE) break;
            const key = getSongVersionKey(song);
            if (seen.has(key) || (spread && artists.has(song.artistKey))) continue;
            seen.add(key);
            artists.add(song.artistKey);
            picked.push(song);
        }
    }
    const count = state.whatsNewSongs.length;
    return {
        title: "What's new",
        note: `${count.toLocaleString()} ${count === 1 ? "song" : "songs"} added recently, most popular first. Updated ${formatAddedDate(state.whatsNewLatest)}.`,
        songs: picked,
        seeAll: () => applyShelfFilter(() => {
            state.filters.recent = true;
        }),
    };
}

function formatAddedDate(date) {
    const parsed = new Date(`${date}T12:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return date;
    return parsed.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function findAvailableValue(values, target) {
    const key = normalize(target);
    return (values || []).find((value) => normalize(value) === key) || "";
}

// Partial Fisher-Yates sampling: pick artist-diverse songs without shuffling
// the entire pool when only a small shelf or draft count is needed.
function sampleSongs(pool, count) {
    const total = pool.length;
    if (!total || count <= 0) {
        return [];
    }

    const picked = [];
    const fallback = [];
    const usedArtists = new Set();
    const swaps = new Map();
    const read = (index) => (swaps.has(index) ? swaps.get(index) : pool[index]);

    for (let i = 0; i < total; i++) {
        const j = i + Math.floor(Math.random() * (total - i));
        const song = read(j);
        swaps.set(j, read(i));

        const artistKey = song.artistKey || normalize(getDisplayArtist(song));
        if (!usedArtists.has(artistKey)) {
            usedArtists.add(artistKey);
            picked.push(song);
            if (picked.length === count) {
                return picked;
            }
        } else if (fallback.length < count) {
            fallback.push(song);
        }
    }

    for (const song of fallback) {
        if (picked.length === count) {
            break;
        }
        picked.push(song);
    }

    return picked;
}

function applyShelfFilter(mutate) {
    state.pushHistory = true;
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
    if (shelf.note) {
        const heading = document.createElement("div");
        heading.className = "shelf-heading";
        const note = document.createElement("p");
        note.className = "shelf-note";
        note.textContent = shelf.note;
        heading.append(title, note);
        head.appendChild(heading);
    } else {
        head.appendChild(title);
    }

    const controls = document.createElement("div");
    controls.className = "shelf-controls";

    const row = document.createElement("div");
    row.className = "shelf-row";
    row.setAttribute("tabindex", "0");
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", shelf.title);
    for (const song of shelf.songs) {
        row.appendChild(createSongCard(song));
    }

    const back = document.createElement("button");
    back.className = "shelf-arrow";
    back.type = "button";
    back.title = "Scroll back";
    back.setAttribute("aria-label", `Scroll ${shelf.title} back`);
    back.innerHTML = '<i data-lucide="chevron-left" aria-hidden="true"></i>';
    back.addEventListener("click", () => nudgeShelf(row, -1));

    const forward = document.createElement("button");
    forward.className = "shelf-arrow";
    forward.type = "button";
    forward.title = "Scroll forward";
    forward.setAttribute("aria-label", `Scroll ${shelf.title} forward`);
    forward.innerHTML = '<i data-lucide="chevron-right" aria-hidden="true"></i>';
    forward.addEventListener("click", () => nudgeShelf(row, 1));

    controls.append(back, forward);

    if (shelf.seeAll) {
        const seeAll = document.createElement("button");
        seeAll.className = "see-all";
        seeAll.type = "button";
        seeAll.textContent = "See all";
        seeAll.title = `See all: ${shelf.title}`;
        seeAll.addEventListener("click", shelf.seeAll);
        controls.appendChild(seeAll);
    }

    head.appendChild(controls);

    const wrap = document.createElement("div");
    wrap.className = "shelf-row-wrap";
    wrap.appendChild(row);

    const syncShelfEdges = () => {
        const overflow = row.scrollWidth - row.clientWidth;
        wrap.classList.toggle("at-start", row.scrollLeft <= 4);
        wrap.classList.toggle("at-end", row.scrollLeft >= overflow - 4);
        section.classList.toggle("no-overflow", overflow <= 4);
    };
    row.addEventListener("scroll", syncShelfEdges, { passive: true });
    requestAnimationFrame(syncShelfEdges);

    section.append(head, wrap);
    return section;
}

function nudgeShelf(row, direction) {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    row.scrollBy({
        left: direction * Math.max(row.clientWidth - 80, 200),
        behavior: reduceMotion ? "auto" : "smooth",
    });
}

function resetBrowseLimit() {
    state.browseLimit = RESULT_BATCH_SIZE;
}

function populateLazySection(section, { hydrate = false } = {}) {
    const populate = LAZY_SECTION_POPULATORS.get(section);
    if (!populate) {
        return;
    }

    LAZY_SECTION_POPULATORS.delete(section);
    populate();
    if (hydrate) {
        hydrateIcons(section);
    }
}

function renderGroupedSearchResults() {
    const fragment = document.createDocumentFragment();
    const sortMode = state.sortMode;

    if (sortMode === "artist") {
        for (const group of groupByArtist(state.visibleSongs)) {
            const section = createBrowseSection(group.artist, group.songs.length, shouldOpenGroup(group.songs.length));
            const body = section.querySelector(".browse-items");

            for (const song of group.songs) {
                body.appendChild(createGroupedSongRow(song, false));
            }

            fragment.appendChild(section);
        }
    } else {
        const groups = groupBySongLetter(state.visibleSongs);
        for (const group of groups) {
            const section = createBrowseSection(group.letter, group.songs.length, shouldOpenGroup(group.songs.length));
            const body = section.querySelector(".browse-items");

            for (const song of group.songs) {
                body.appendChild(createGroupedSongRow(song, true));
            }

            fragment.appendChild(section);
        }
    }

    els.resultsList.appendChild(fragment);
}

function renderGroupActions() {
    const browseGrouped = state.mode === "browse" && state.browseBy === "artist";
    const searchGrouped = shouldGroupSearchResults() && state.visibleSongs.length > 0;
    els.groupActions.hidden = !browseGrouped && !searchGrouped;
    els.expandGroupsButton.disabled = state.groupOpenMode === "expanded";
    els.collapseGroupsButton.disabled = state.groupOpenMode === "collapsed";
}

function setGroupedResultsOpen(open) {
    state.groupOpenStates.clear();
    state.groupOpenMode = open ? "expanded" : "collapsed";
    const container = state.mode === "browse" ? els.browseList : els.resultsList;
    let hydratedAny = false;
    for (const section of container.querySelectorAll(".browse-section")) {
        if (open && LAZY_SECTION_POPULATORS.has(section)) {
            populateLazySection(section);
            hydratedAny = true;
        }
        section.open = open;
    }
    if (hydratedAny) {
        hydrateIcons(container);
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

    return Boolean(state.query) || (state.sortMode === "artist" && count <= 8);
}

function createGroupedSongRow(song, showArtist) {
    const row = document.createElement("div");
    row.className = showArtist ? "browse-row" : "artist-song-row";

    const title = document.createElement("div");
    title.className = "browse-title";
    setHighlightedText(title, getDisplaySongTitle(song), getQueryTokens());

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
    const sorted = sortForBrowse(songs);
    state.currentSongs = sorted;
    state.matchCount = sorted.length;
    if (!sorted.length) {
        state.visibleSongs = [];
        els.browseList.innerHTML = '<p class="empty-state">No songs in this letter</p>';
        renderResultActions(0);
        return;
    }

    const fragment = document.createDocumentFragment();
    if (state.browseBy === "artist") {
        state.visibleSongs = sorted;
        renderArtistBrowse(sorted, fragment);
    } else {
        state.visibleSongs = sorted.slice(0, state.browseLimit);
        renderSongBrowse(state.visibleSongs, sorted.length, fragment);
    }

    els.browseList.appendChild(fragment);
    renderResultActions(state.browseBy === "song" ? sorted.length : 0);
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
            resetBrowseLimit();
            render();
            // Start the new letter at its top, not the previous list's depth.
            const panel = els.browseList.closest(".results-panel");
            if (panel.getBoundingClientRect().top < parseFloat(getComputedStyle(panel).scrollMarginTop)) {
                scrollResultsIntoView();
            }
        });
        els.letterStrip.appendChild(button);
    }

    const active = els.letterStrip.querySelector(".letter-button.is-active");
    if (active) {
        active.scrollIntoView({ block: "nearest", inline: "center" });
    }
}

function renderSongBrowse(visibleSongs, totalCount, fragment) {
    const section = createBrowseSection(state.browseLetter, totalCount, true);
    const body = section.querySelector(".browse-items");

    for (const song of visibleSongs) {
        body.appendChild(createBrowseRow(song));
    }

    fragment.appendChild(section);
}

function appendSongBrowseBatch(nextLimit) {
    const target = Math.min(nextLimit, state.matchCount);
    const start = state.visibleSongs.length;
    if (target <= start) {
        return;
    }

    const body = els.browseList.querySelector(".browse-items");
    if (!body) {
        state.browseLimit = target;
        render();
        return;
    }

    const fragment = document.createDocumentFragment();
    for (const song of state.currentSongs.slice(start, target)) {
        fragment.appendChild(createBrowseRow(song));
    }
    body.appendChild(fragment);
    hydrateIcons(body);
    state.browseLimit = target;
    state.visibleSongs = state.currentSongs.slice(0, target);
    renderResultActions(state.matchCount);
}

function renderArtistBrowse(songs, fragment) {
    const groups = groupByArtist(songs);
    for (const group of groups) {
        const open = state.groupOpenMode === "expanded" ? true
            : state.groupOpenMode === "collapsed" ? false
            : groups.length <= 8;
        const section = createBrowseSection(group.artist, group.songs.length, open);
        const body = section.querySelector(".browse-items");

        const populate = () => {
            const rows = document.createDocumentFragment();
            for (const song of group.songs) {
                const row = document.createElement("div");
                row.className = "artist-song-row";

                const title = document.createElement("div");
                title.className = "browse-title";
                title.textContent = getDisplaySongTitle(song);

                row.append(title, createRowTools(song));
                rows.appendChild(row);
            }
            body.appendChild(rows);
        };

        if (section.open) {
            populate();
        } else {
            LAZY_SECTION_POPULATORS.set(section, populate);
            section.addEventListener("toggle", () => {
                if (section.open) {
                    populateLazySection(section, { hydrate: true });
                }
            });
        }

        fragment.appendChild(section);
    }
}

function createBrowseSection(label, count, open) {
    const section = document.createElement("details");
    section.className = "browse-section";
    const key = JSON.stringify([state.mode, state.browseBy, state.sortMode, label]);
    section.dataset.groupKey = key;
    section.open = state.groupOpenStates.get(key) ?? open;

    const summary = document.createElement("summary");
    summary.addEventListener("click", () => {
        if (!section.open) {
            populateLazySection(section, { hydrate: true });
        }
        const container = state.mode === "browse" ? els.browseList : els.resultsList;
        for (const other of container.querySelectorAll(".browse-section")) {
            state.groupOpenStates.set(other.dataset.groupKey, other.open);
        }
        state.groupOpenStates.set(key, !section.open);
        state.groupOpenMode = "auto";
        renderGroupActions();
    });
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
