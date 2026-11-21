// Multi-select filter controls, faceted counts, and active filter chips.
// Loaded before karaoke_explorer.js; no side effects on parse.

const MULTI_FILTER_DEFS = [
    {
        key: "moods",
        param: "mood",
        label: "Mood",
        anyLabel: "Any mood",
        pickHint: "Pick any number of moods",
        options: () => state.availableMoods,
        matches: (song, value) => matchesFilterKey(song, "moods", value),
    },
    {
        key: "genres",
        param: "genre",
        label: "Genre",
        anyLabel: "Any genre",
        pickHint: "Pick any number of genres",
        options: () => state.availableGenres,
        matches: (song, value) => matchesFilterKey(song, "genres", value),
    },
    {
        key: "decades",
        param: "decade",
        label: "Decade",
        anyLabel: "Any decade",
        pickHint: "Pick any number of decades",
        options: () => state.availableDecades,
        matches: (song, value) => matchesFilterKey(song, "decades", value),
    },
    {
        key: "holidays",
        param: "holiday",
        label: "Holiday",
        anyLabel: "Any holiday",
        pickHint: "Pick any number of holidays",
        options: () => state.availableHolidays,
        matches: (song, value) => matchesFilterKey(song, "holidays", value),
    },
];
const multiFilterControls = new Map();

function countActiveFilters() {
    return MULTI_FILTER_DEFS.reduce((count, def) => count + state.filters[def.key].length, 0) +
        Number(state.filters.duet) +
        Number(state.filters.popular) +
        Number(state.favoriteOnly) +
        Number(state.fuzzySearch);
}

function applySearchFilters(songs, excludeKey = "") {
    const selections = [];
    for (const def of MULTI_FILTER_DEFS) {
        if (def.key !== excludeKey && state.filters[def.key].length) {
            selections.push({ key: def.key, keys: state.filters[def.key].map(normalize) });
        }
    }

    return songs.filter((song) => {
        for (const selection of selections) {
            const songKeys = song.filterKeys?.[selection.key];
            if (!songKeys || !selection.keys.some((key) => songKeys.has(key))) {
                return false;
            }
        }

        if (state.filters.duet && !song.isDuet) {
            return false;
        }

        if (state.filters.popular &&
            !(state.popularThreshold && (song.popularity || 0) >= state.popularThreshold)) {
            return false;
        }

        if (state.favoriteOnly && !isFavorite(song)) {
            return false;
        }

        return true;
    });
}

function matchesFilterKey(song, key, value) {
    return Boolean(song.filterKeys?.[key]?.has(normalize(value)));
}

function clearSearchFilters({ resetFuzzy = true } = {}) {
    for (const def of MULTI_FILTER_DEFS) {
        state.filters[def.key] = [];
    }
    state.filters.duet = false;
    state.filters.popular = false;
    state.favoriteOnly = false;

    if (resetFuzzy) {
        state.fuzzySearch = false;
    }
}

function renderFilterOptions() {
    for (const control of multiFilterControls.values()) {
        control.options.innerHTML = "";
    }
}

function renderSearchFilters() {
    renderMultiFilters();
    els.popularFilter.checked = state.filters.popular;
    els.duetFilter.checked = state.filters.duet;
    els.favoriteFilter.checked = state.favoriteOnly;
    els.fuzzySearch.checked = state.fuzzySearch;
    els.clearFiltersButton.hidden = !hasActiveSearchFilters();

    const activeCount = countActiveFilters();
    els.filterCountBadge.hidden = !activeCount;
    els.filterCountBadge.textContent = activeCount ? String(activeCount) : "";

    setToggleState(els.orderRelevanceButton, state.sortMode === "relevance");
    setToggleState(els.orderPopularButton, state.sortMode === "popular");
    setToggleState(els.orderSongButton, state.sortMode === "song");
    setToggleState(els.orderArtistButton, state.sortMode === "artist");
}

function buildMultiFilters() {
    for (const root of document.querySelectorAll(".multi-filter")) {
        const def = MULTI_FILTER_DEFS.find((item) => item.param === root.dataset.filter);
        if (!def) {
            continue;
        }

        const label = document.createElement("span");
        label.className = "filter-label";
        label.textContent = def.label;

        const button = document.createElement("button");
        button.className = "multi-filter-button";
        button.type = "button";
        button.setAttribute("aria-haspopup", "true");
        button.setAttribute("aria-expanded", "false");
        button.setAttribute("aria-label", `Filter by ${def.label.toLowerCase()}`);
        const buttonLabel = document.createElement("span");
        buttonLabel.textContent = def.anyLabel;
        button.appendChild(buttonLabel);
        button.innerHTML += '<i data-lucide="chevron-down" aria-hidden="true"></i>';
        button.addEventListener("click", () => toggleMultiFilterPopover(def.param));

        const popover = document.createElement("div");
        popover.className = "multi-popover";
        popover.hidden = true;

        const head = document.createElement("div");
        head.className = "multi-popover-head";
        const hint = document.createElement("span");
        hint.textContent = def.pickHint;
        const clear = document.createElement("button");
        clear.className = "multi-clear";
        clear.type = "button";
        clear.textContent = "Clear";
        clear.hidden = true;
        clear.addEventListener("click", () => {
            state.filters[def.key] = [];
            state.mode = "search";
            resetResultLimit();
            render();
        });
        head.append(hint, clear);

        const options = document.createElement("div");
        options.className = "multi-options";
        options.setAttribute("role", "group");
        options.setAttribute("aria-label", `${def.label} options`);

        popover.append(head, options);
        root.append(label, button, popover);
        multiFilterControls.set(def.param, {
            def,
            button,
            buttonLabel: button.querySelector("span"),
            popover,
            options,
            clear,
        });
    }
}

function renderMultiFilters() {
    for (const control of multiFilterControls.values()) {
        const { def, button, buttonLabel, options, clear } = control;
        const selected = state.filters[def.key];
        const values = def.options();

        buttonLabel.textContent = !selected.length
            ? def.anyLabel
            : selected.length === 1
                ? selected[0]
                : `${selected[0]} +${selected.length - 1}`;
        button.classList.toggle("has-selection", selected.length > 0);
        clear.hidden = !selected.length;

        // Update options in place when possible: rebuilding mid-click detaches
        // the clicked button, which breaks the outside-click check and drops focus.
        const existing = [...options.children];
        if (existing.length !== values.length) {
            options.innerHTML = "";
            for (const value of values) {
                const option = document.createElement("button");
                option.type = "button";
                option.className = "multi-option";
                const text = document.createElement("span");
                text.textContent = value;
                const countLabel = document.createElement("span");
                countLabel.className = "option-count";
                option.append(text, countLabel);
                option.addEventListener("click", () => toggleMultiFilterValue(def, value));
                options.appendChild(option);
            }
        }

        [...options.children].forEach((option, index) => {
            setToggleState(option, includesValue(selected, values[index]));
        });

        if (!control.popover.hidden) {
            updateFacetedCounts(control);
        }
    }
}

function updateFacetedCounts(control) {
    const { def, options } = control;
    const values = def.options();

    // Count against the current query plus every OTHER filter, so the numbers
    // answer "what would picking this add to my current results?".
    const base = applySearchFilters(
        state.queryScopedSongs,
        def.key
    );
    const counts = new Map();
    for (const song of base) {
        for (const key of song.filterKeys[def.key]) {
            counts.set(key, (counts.get(key) || 0) + 1);
        }
    }

    [...options.children].forEach((option, index) => {
        const count = counts.get(normalize(values[index])) || 0;
        const countLabel = option.querySelector(".option-count");
        countLabel.textContent = count.toLocaleString();
        option.classList.toggle("is-empty", count === 0);
    });
}

function toggleMultiFilterValue(def, value) {
    if (includesValue(state.filters[def.key], value)) {
        state.filters[def.key] = state.filters[def.key].filter(
            (item) => normalize(item) !== normalize(value)
        );
    } else {
        state.filters[def.key] = [...state.filters[def.key], value];
    }

    state.mode = "search";
    resetResultLimit();
    render();
}

function toggleMultiFilterPopover(param) {
    const control = multiFilterControls.get(param);
    if (!control) {
        return;
    }

    const open = control.popover.hidden;
    closeMultiFilterPopovers();
    control.popover.hidden = !open;
    control.button.setAttribute("aria-expanded", String(open));
    if (open) {
        updateFacetedCounts(control);
    }
}

function closeMultiFilterPopovers() {
    for (const control of multiFilterControls.values()) {
        control.popover.hidden = true;
        control.button.setAttribute("aria-expanded", "false");
    }
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
        song: "Song",
        artist: "Artist",
    };
    const chips = [];
    // The search box already shows the query; a chip only adds a narrower scope.
    const hasQueryChip = Boolean(state.query && scopeChipLabels[state.searchScope]);
    if (hasQueryChip) {
        chips.push({
            label: `${scopeChipLabels[state.searchScope]}: ${state.query}`,
            onClear: () => clearSearchQuery({ resetScope: false }),
        });
    }

    for (const def of MULTI_FILTER_DEFS) {
        for (const value of state.filters[def.key]) {
            chips.push({
                label: `${def.label}: ${value}`,
                onClear: () => {
                    state.filters[def.key] = state.filters[def.key].filter((item) => item !== value);
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

    if (state.filters.popular) {
        chips.push({
            label: "Popular",
            onClear: () => {
                state.filters.popular = false;
            },
        });
    }

    if (state.favoriteOnly) {
        chips.push({
            label: "Saved songs",
            onClear: () => {
                state.favoriteOnly = false;
            },
        });
    }

    if (state.fuzzySearch) {
        chips.push({
            label: "Near matches",
            onClear: () => {
                state.fuzzySearch = false;
            },
        });
    }

    for (const chip of chips) {
        els.activeFilters.appendChild(createActiveFilterChip(chip.label, chip.onClear));
    }

    if (chips.length > 1) {
        // Clear exactly what the chips show; a chip-less query stays in the box.
        const clearAll = document.createElement("button");
        clearAll.className = "active-filter-clear";
        clearAll.type = "button";
        clearAll.textContent = hasQueryChip ? "Clear all" : "Clear filters";
        clearAll.addEventListener("click", () => {
            if (hasQueryChip) {
                clearSearchQuery();
            }
            clearSearchFilters();
            // With nothing left to search, return to Discover rather than a
            // sorted list of the whole catalog.
            if (!state.query) {
                state.sortMode = "relevance";
                state.groupOpenMode = "auto";
            }
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
    return MULTI_FILTER_DEFS.some((def) => state.filters[def.key].length > 0) ||
        state.filters.duet ||
        state.filters.popular ||
        state.favoriteOnly ||
        state.fuzzySearch;
}

function hasSongFilters() {
    return MULTI_FILTER_DEFS.some((def) => state.filters[def.key].length > 0) ||
        state.filters.duet ||
        state.filters.popular ||
        state.favoriteOnly;
}

function getAvailableDecades(songs = state.songs) {
    const values = new Set();

    for (const song of songs) {
        for (const era of song.eras || []) {
            if (era) {
                values.add(era);
            }
        }
    }

    return [...values].sort(compareDecade);
}

function getAvailableValues(getValues, songs = state.songs) {
    const values = new Set();

    for (const song of songs) {
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
