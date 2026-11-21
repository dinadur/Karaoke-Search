// Setlist management, singer editing, Draft/Swap, QR sharing, snackbar, and
// cached catalog lookup index. Loaded before karaoke_explorer.js.

let draggedSetlistIndex = null;
let catalogIndex = { songs: null, byId: new Map() };
const DRAFT_SETLIST_TARGET = 10;

function getCatalogIndex() {
    if (catalogIndex.songs !== state.songs) {
        const byId = new Map();
        for (const song of state.songs) {
            byId.set(song.id, song);
        }
        catalogIndex = { songs: state.songs, byId };
    }
    return catalogIndex.byId;
}

// Setlist entries are trimmed copies (see toSetlistEntry); their tags come from
// the catalog song with the same identity.
function getCatalogSong(entry) {
    const byId = getCatalogIndex();
    return byId.get(entry.id) || byId.get(getSongIdentity(entry)) || null;
}

function addToSetlist(song, source) {
    setPlanningMode(true);
    recordRecentSearch();
    const exists = state.setlist.some((item) => isSameSong(item, song));
    if (!exists) {
        state.setlist.push(toSetlistEntry(song));
        saveSetlist();
        renderSetlist();
        // The desktop rail scrolls internally; show the entry just added.
        els.setlist.scrollTop = els.setlist.scrollHeight;
        showSnackbar(`Added “${getDisplaySongTitle(song)}” to setlist`);
        window.StageFx?.added(source);
    }
}

// Store only what the setlist needs. Copying whole prepared songs dragged
// ~1.1KB of search indexes per entry into localStorage, and their Set fields
// serialized to empty objects that would break any code expecting Sets.
function toSetlistEntry(song, extra = {}) {
    const entry = {
        id: song.id,
        legacyId: song.legacyId,
        song: song.song,
        lookupSong: song.lookupSong,
        artist: song.artist,
        lookupArtist: song.lookupArtist,
        displayArtist: song.displayArtist,
        artistKey: song.artistKey,
        seconds: song.seconds,
        ...extra,
    };

    if (song.singer) {
        entry.singer = song.singer;
    }

    for (const key of Object.keys(entry)) {
        if (entry[key] === undefined) {
            delete entry[key];
        }
    }

    return entry;
}

function renderSetlist() {
    personalEl("planSetlistLabel").textContent = state.setlist.length ? `Setlist (${state.setlist.length})` : "Plan a setlist";
    syncAddButtons();
    const focusedItem = document.activeElement?.closest(".setlist-item");
    const focusedSongId = focusedItem?.dataset.songId;
    const focusedIndex = Number(focusedItem?.dataset.index || 0);
    const focusedTitle = document.activeElement?.title;
    els.setlist.innerHTML = "";
    els.setlistCount.textContent = getSetlistSummary();
    els.copySetlistButton.disabled = !state.setlist.length;
    els.clearSetlistButton.disabled = !state.setlist.length;
    els.mobileSetlistButton.querySelector("span").textContent =
        state.setlist.length ? `Setlist (${state.setlist.length})` : "Setlist";
    els.mobileSetlistButton.setAttribute(
        "aria-label",
        state.setlist.length ? `Open setlist, ${state.setlist.length} songs` : "Open setlist"
    );

    if (!state.setlist.length) {
        const empty = document.createElement("li");
        empty.className = "empty-state";

        const message = document.createElement("p");
        message.textContent = "Nothing queued";

        const draft = document.createElement("button");
        draft.className = "command subtle-command draft-cta";
        draft.type = "button";
        draft.innerHTML = '<i data-lucide="dices" aria-hidden="true"></i><span>Draft 10 songs for me</span>';
        draft.title = "Fill the setlist from your current results";
        draft.addEventListener("click", draftSetlist);

        empty.append(message, draft);
        els.setlist.appendChild(empty);
        hydrateIcons();
        if (focusedItem) draft.focus({ preventScroll: true });
        return;
    }

    const fragment = document.createDocumentFragment();
    state.setlist.forEach((song, index) => {
        const item = document.createElement("li");
        item.className = "setlist-item";
        item.draggable = true;
        item.dataset.index = String(index);
        item.dataset.songId = getSongIdentity(song);

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

        const displayTitle = getDisplaySongTitle(song);
        const number = document.createElement("span");
        number.className = "setlist-number";
        number.textContent = String(index + 1);

        const title = document.createElement("span");
        title.className = "setlist-title";
        title.textContent = displayTitle;

        const artist = createArtistSearchControl(song, "setlist-artist", { highlight: false });

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
        up.setAttribute("aria-label", `Move ${displayTitle} up`);
        up.disabled = index === 0;
        up.innerHTML = '<i data-lucide="chevron-up" aria-hidden="true"></i>';
        up.addEventListener("click", () => moveSetlistItem(index, -1));

        const down = document.createElement("button");
        down.className = "setlist-icon-button";
        down.type = "button";
        down.title = "Move down";
        down.setAttribute("aria-label", `Move ${displayTitle} down`);
        down.disabled = index === state.setlist.length - 1;
        down.innerHTML = '<i data-lucide="chevron-down" aria-hidden="true"></i>';
        down.addEventListener("click", () => moveSetlistItem(index, 1));

        const reroll = document.createElement("button");
        reroll.className = "setlist-icon-button";
        reroll.type = "button";
        reroll.title = "Swap for another match";
        reroll.setAttribute("aria-label", `Swap ${displayTitle} for another matching song`);
        reroll.innerHTML = '<i data-lucide="shuffle" aria-hidden="true"></i>';
        reroll.addEventListener("click", () => rerollSetlistSong(index));

        const remove = document.createElement("button");
        remove.className = "setlist-icon-button remove-button";
        remove.type = "button";
        remove.title = "Remove";
        remove.setAttribute("aria-label", `Remove ${displayTitle}`);
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

        controls.append(handle, up, down, reroll, remove);

        // Controls share the singer row so the title and artist get the full width.
        const footer = document.createElement("div");
        footer.className = "setlist-row";
        footer.append(createSingerControl(song, item), controls);

        const heading = document.createElement("div");
        heading.className = "setlist-heading";
        heading.append(title, artist);
        const head = document.createElement("div");
        head.className = "setlist-head";
        head.appendChild(heading);
        const catalogSong = getCatalogSong(song);
        if (catalogSong) head.appendChild(createSongTags(catalogSong));

        const body = document.createElement("div");
        body.className = "setlist-body";
        body.append(head, footer);
        item.append(number, body);
        fragment.appendChild(item);
    });

    els.setlist.appendChild(fragment);
    hydrateIcons();
    if (focusedItem) {
        const items = [...els.setlist.querySelectorAll(".setlist-item")];
        const item = items.find((entry) => entry.dataset.songId === focusedSongId) ||
            items[Math.min(focusedIndex, items.length - 1)];
        const buttons = [...(item?.querySelectorAll("button") || [])]
            .filter((button) => !button.disabled && !button.closest("[hidden]"));
        (buttons.find((button) => button.title === focusedTitle) ||
            item?.querySelector(".setlist-row button:not(:disabled)"))?.focus({ preventScroll: true });
    }
}

// Artist and tag links in the setlist or a songs dialog lead to search results,
// as they do on song cards: close whatever covers the results and move there.
function returnToResults(event) {
    // Filter tags are buttons; the GetSongBPM pills are links to another site.
    if (!event.target.closest("button.setlist-artist, button.personal-artist, button.pill.is-clickable")) {
        return;
    }
    closeSongTagMenus();
    event.target.closest("dialog[open]")?.close();
    closeSetlistDrawer({ restoreFocus: false });
    els.resultsTitle.focus({ preventScroll: true });
}

function createSingerControl(song, item) {
    const wrap = document.createElement("div");
    wrap.className = "setlist-singer";

    const startEdit = () => {
        wrap.innerHTML = "";
        item.draggable = false;

        const input = document.createElement("input");
        input.type = "text";
        input.className = "singer-input";
        input.maxLength = 40;
        input.placeholder = "Who's singing this?";
        input.value = song.singer || "";
        input.setAttribute("aria-label", "Singer name");

        let settled = false;
        const finish = (save) => {
            if (settled) {
                return;
            }

            settled = true;
            if (save) {
                const value = input.value.trim();
                if (value) {
                    song.singer = value;
                } else {
                    delete song.singer;
                }
                saveSetlist();
            }
            const restoreFocus = document.activeElement === input;
            const replacement = createSingerControl(song, item);
            item.draggable = true;
            wrap.replaceWith(replacement);
            if (restoreFocus) replacement.querySelector("button").focus({ preventScroll: true });
        };

        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                finish(true);
            } else if (event.key === "Escape") {
                event.stopPropagation();
                finish(false);
            }
        });
        input.addEventListener("blur", () => finish(true));

        wrap.appendChild(input);
        input.focus();
        input.select();
    };

    const button = document.createElement("button");
    button.type = "button";
    if (song.singer) {
        button.className = "singer-chip";
        button.textContent = `🎤 ${song.singer}`;
        button.title = "Edit singer";
        button.setAttribute("aria-label", `Singer: ${song.singer}. Edit`);
    } else {
        button.className = "singer-add";
        button.textContent = "+ Singer";
        button.title = "Assign a singer";
    }
    button.addEventListener("click", startEdit);
    wrap.appendChild(button);
    return wrap;
}

async function openQrDialog() {
    const url = await buildShareUrl();
    els.qrHolder.innerHTML = "";

    if (typeof qrcode === "function") {
        try {
            const qr = qrcode(0, "M");
            qr.addData(url);
            qr.make();
            els.qrHolder.innerHTML = qr.createSvgTag({ scalable: true, margin: 2 });
        } catch {
            els.qrHolder.textContent = url;
        }
    } else {
        els.qrHolder.textContent = url;
    }

    els.qrCaption.textContent = state.setlist.length
        ? `Opens this view with your ${state.setlist.length}-song setlist ready to import.`
        : "Opens this songbook view, filters and all.";
    els.qrDialog.showModal();
}

async function buildShareUrl() {
    const base = `${window.location.origin}${window.location.pathname}${window.location.search}`;
    if (!state.setlist.length) {
        return base;
    }

    const payload = await encodeSetlistPayload();
    return payload ? `${base}#sl=${payload}` : base;
}

async function encodeSetlistPayload() {
    try {
        const raw = state.setlist
            // Stored IDs may predate content-derived identity and contain a row
            // index. Recompute from the retained song fields for shared links.
            .map((song) => getSongIdentity(song))
            .join("\n");
        const bytes = new TextEncoder().encode(raw);

        if (typeof CompressionStream === "function") {
            const stream = new Blob([bytes]).stream()
                .pipeThrough(new CompressionStream("deflate-raw"));
            const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
            return `z.${base64UrlEncode(compressed)}`;
        }

        return `r.${base64UrlEncode(bytes)}`;
    } catch {
        return "";
    }
}

async function decodeSetlistPayload(payload) {
    try {
        const [kind, data] = payload.split(".", 2);
        const bytes = base64UrlDecode(data);
        let raw;
        if (kind === "z") {
            const stream = new Blob([bytes]).stream()
                .pipeThrough(new DecompressionStream("deflate-raw"));
            raw = await new Response(stream).text();
        } else {
            raw = new TextDecoder().decode(bytes);
        }

        return raw.split("\n").filter(Boolean);
    } catch {
        return [];
    }
}

function base64UrlEncode(bytes) {
    let binary = "";
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }

    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(data) {
    const padded = data.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
}

async function offerSharedSetlistImport() {
    const payload = state.pendingSharedSetlist;
    state.pendingSharedSetlist = "";
    if (!payload) {
        return;
    }

    const ids = await decodeSetlistPayload(payload);
    if (!ids.length) {
        return;
    }

    const songsById = getCatalogIndex();
    const shared = ids.map((id) => songsById.get(id)).filter(Boolean);
    if (!shared.length) {
        return;
    }

    els.importCaption.textContent =
        `Someone shared a setlist with ${shared.length} ${shared.length === 1 ? "song" : "songs"}` +
        (shared.length < ids.length ? ` (${ids.length - shared.length} not in this songbook)` : "") + ".";

    const applyImport = (replace) => {
        const previous = [...state.setlist];
        if (replace) {
            state.setlist = shared.map((song) => toSetlistEntry(song));
        } else {
            for (const song of shared) {
                if (!state.setlist.some((item) => isSameSong(item, song))) {
                    state.setlist.push(toSetlistEntry(song));
                }
            }
        }
        saveSetlist();
        renderSetlist();
        els.importDialog.close();
        setPlanningMode(true);
        if (matchMedia("(max-width: 720px)").matches) openSetlistDrawer();
        showSnackbar(`Setlist ${replace ? "replaced" : "updated"} (${state.setlist.length} songs)`, () => {
            state.setlist = previous;
            saveSetlist();
            renderSetlist();
        });
    };

    els.importAddButton.onclick = () => applyImport(false);
    els.importReplaceButton.onclick = () => applyImport(true);
    if (typeof els.importDialog.showModal === "function") {
        els.importDialog.showModal();
    }
}

function getDraftPool() {
    if (searchRenderTimer) render();
    const hasScope = state.mode === "search" &&
        (Boolean(normalizeSearchText(state.query)) || hasSongFilters());
    if (hasScope) {
        return state.currentSongs;
    }

    const tagged = state.songs.filter((song) => song.status === "ok");
    return tagged.length ? tagged : state.songs;
}

function draftSetlist(event) {
    const source = event?.currentTarget;
    // The empty-list button disappears on render, so measure it first.
    const startRect = source?.getBoundingClientRect?.();
    const missing = DRAFT_SETLIST_TARGET - state.setlist.length;
    if (missing <= 0) {
        showSnackbar(`Setlist already has ${state.setlist.length} songs`);
        return;
    }

    let pool = getDraftPool().filter(
        (song) => !state.setlist.some((item) => isSameSong(item, song))
    );
    // Bias to the recognizable end: a draft should be songs a room knows.
    if (pool.length > 200 && pool.some((song) => (song.popularity || 0) > 0)) {
        pool = [...pool]
            .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
            .slice(0, Math.max(200, Math.floor(pool.length * 0.05)));
    }
    const additions = sampleSongs(pool, missing);
    if (!additions.length) {
        showSnackbar("No matching songs left to draft");
        return;
    }

    const previous = [...state.setlist];
    for (const song of additions) {
        state.setlist.push(toSetlistEntry(song));
    }
    saveSetlist();
    renderSetlist();
    // The phone drawer grows as it fills, moving its Draft button.
    window.StageFx?.confetti(source?.isConnected ? source.getBoundingClientRect() : startRect);
    window.StageFx?.cascade([...els.setlist.children].slice(previous.length));
    showSnackbar(
        `Drafted ${additions.length} ${additions.length === 1 ? "song" : "songs"}`,
        () => {
            state.setlist = previous;
            saveSetlist();
            renderSetlist();
        }
    );
}

function rerollSetlistSong(index) {
    const current = state.setlist[index];
    if (!current) {
        return;
    }

    const pool = getDraftPool().filter(
        (song) => !state.setlist.some((item) => isSameSong(item, song))
    );
    const [replacement] = sampleSongs(pool, 1);
    if (!replacement) {
        showSnackbar("No matching songs left to swap in");
        return;
    }

    const previous = [...state.setlist];
    const next = toSetlistEntry(replacement, current.singer ? { singer: current.singer } : {});
    state.setlist.splice(index, 1, next);
    saveSetlist();
    renderSetlist();
    showSnackbar(`Swapped in “${getDisplaySongTitle(replacement)}”`, () => {
        state.setlist = previous;
        saveSetlist();
        renderSetlist();
    });
}

function buildSetlistText() {
    return state.setlist
        .map((song, index) => {
            const singer = song.singer ? ` (${song.singer})` : "";
            return `${index + 1}. ${getDisplaySongTitle(song)} - ${getDisplayArtist(song) || "Unknown artist"}${singer}`;
        })
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

function getSetlistSummary() {
    const count = state.setlist.length;
    const label = `${count} ${count === 1 ? "song" : "songs"}`;
    if (!count) {
        return label;
    }

    // Average karaoke track is ~3.5 min; use real durations where known.
    const totalSeconds = state.setlist.reduce(
        (sum, song) => sum + (song.seconds || 210), 0
    );
    return `${label} · ~${Math.max(1, Math.round(totalSeconds / 60))} min`;
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
    // Any subsequent edit makes a prior snapshot-based Undo unsafe. Callers
    // offering a new Undo install it after saving their own change.
    if (state.snackbarAction) hideSnackbar();
    try {
        localStorage.setItem("karaokeSetlist", JSON.stringify(state.setlist));
    } catch {
        // Setlist remains available in memory for the current page.
    }
}

function loadSetlist() {
    try {
        const stored = JSON.parse(localStorage.getItem("karaokeSetlist") || "[]");
        if (!Array.isArray(stored)) {
            return [];
        }

        // Entries saved by older versions carry the full prepared song; slim
        // them so the next save writes the compact shape.
        return stored.map((song) => toSetlistEntry(song));
    } catch {
        return [];
    }
}
