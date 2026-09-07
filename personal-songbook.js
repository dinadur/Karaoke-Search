// Personal data never enters catalog requests, URLs, or shared setlist payloads.
// One atomic store prevents removed favorites from reappearing after migration.
// Legacy stores are retained for recovery; notes never enter shared payloads.
const REPERTOIRE_STORAGE_KEY = "karaokeSavedSongsV1";
let migratedFavoriteIds = new Set();
const REPERTOIRE_BUTTON_SONGS = new WeakMap();
let repertoire = readRepertoire();
let repertoireLimit = 40;
let editingRepertoireSong = null;
let repertoireOpener = null;
let pickerPool = [];
const personalEl = (id) => document.getElementById(id);

function readRepertoire() {
    try {
        const unified = localStorage.getItem(REPERTOIRE_STORAGE_KEY);
        const envelope = unified === null ? null : JSON.parse(unified);
        if (envelope && Array.isArray(envelope.importedFavorites)) migratedFavoriteIds = new Set(envelope.importedFavorites);
        const stored = unified === null ? JSON.parse(localStorage.getItem("karaokeRepertoireV1") || "{}") : envelope?.songs;
        if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
        return Object.fromEntries(Object.entries(stored).filter(([, entry]) =>
            entry && ["saved", "want", "sung"].includes(entry.status) &&
            entry.song && typeof entry.song.song === "string" && typeof entry.song.artist === "string"
        ).map(([key, entry]) => [key, {
            song: entry.song, status: entry.status,
            comfort: [1, 2, 3, 4, 5].includes(entry.comfort) ? entry.comfort : null,
            key: typeof entry.key === "string" ? entry.key.slice(0, 40) : "",
            notes: typeof entry.notes === "string" ? entry.notes.slice(0, 1000) : "",
        }]));
    } catch { return {}; }
}

function migrateSavedSongs() {
    const next = { ...repertoire };
    for (const song of state.songs) {
        const legacyIds = [song.id, song.legacyId].filter((id) => state.favorites.has(id) && !migratedFavoriteIds.has(id));
        if (!legacyIds.length) continue;
        const id = getSongIdentity(song);
        next[id] ||= { song: toSetlistEntry(song), status: "saved", comfort: null, key: "", notes: "" };
        legacyIds.forEach((key) => migratedFavoriteIds.add(key));
    }
    // Keep the merged collection usable in memory if the browser is full.
    repertoire = next;
    persistRepertoire(next);
}

function setPlanningMode(enabled) {
    document.body.classList.toggle("planning-setlist", enabled);
    personalEl("planningNotice").hidden = !enabled;
    if (!enabled) closeSetlistDrawer({ restoreFocus: false });
}

function bindPersonalFeatures() {
    const more = personalEl("moreTools");
    const closeMore = () => { more.open = false; personalEl("moreToolsButton").focus({ preventScroll: true }); };
    // Close before activating a tool so a dialog restores focus to the visible summary.
    more.querySelectorAll("button").forEach((button) => button.addEventListener("click", closeMore));
    document.addEventListener("click", (event) => { if (!more.contains(event.target)) more.open = false; });
    more.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && more.open) { event.preventDefault(); event.stopPropagation(); closeMore(); }
    });
    document.addEventListener("focusin", (event) => {
        if (!more.contains(event.target)) more.open = false;
    });
    personalEl("planSetlistButton").addEventListener("click", () => {
        setPlanningMode(true);
        if (matchMedia("(max-width: 720px)").matches) openSetlistDrawer();
        else { personalEl("draftSetlistButton").focus({ preventScroll: true }); personalEl("setlistTitle").scrollIntoView({ block: "nearest" }); }
    });
    personalEl("finishPlanningButton").addEventListener("click", () => {
        setPlanningMode(false);
        personalEl("searchInput").focus({ preventScroll: true });
    });
    personalEl("repertoireButton").addEventListener("click", () => {
        repertoireLimit = 40;
        renderRepertoire();
        personalEl("repertoireDialog").showModal();
    });
    personalEl("chooseSongButton").addEventListener("click", () => {
        if (searchRenderTimer) render();
        pickerPool = [...(state.mode === "browse" ? getBrowseSongs() : state.currentSongs)];
        personalEl("pickerResults").replaceChildren();
        personalEl("pickerSummary").textContent = `${pickerPool.length.toLocaleString()} ${pickerPool.length === 1 ? "song" : "songs"} in your current view. Already queued songs are excluded.`;
        personalEl("chooseSongDialog").showModal();
    });
    document.querySelectorAll("[data-close-dialog]").forEach((button) => {
        button.addEventListener("click", () => personalEl(button.dataset.closeDialog).close());
    });
    for (const id of ["repertoireSearch", "repertoireFilter"]) {
        personalEl(id).addEventListener(id === "repertoireSearch" ? "input" : "change", () => {
            repertoireLimit = 40; renderRepertoire();
        });
    }
    personalEl("repertoireMore").addEventListener("click", () => {
        repertoireLimit += 40; renderRepertoire();
    });
    personalEl("songNotesForm").addEventListener("submit", (event) => {
        event.preventDefault();
        if (!editingRepertoireSong) return;
        const song = editingRepertoireSong;
        const next = { ...repertoire, [getSongIdentity(song)]: {
            song: toSetlistEntry(song),
            status: personalEl("repertoireStatus").value,
            comfort: Number(personalEl("repertoireComfort").value) || null,
            key: personalEl("repertoireKey").value.trim(),
            notes: personalEl("repertoireNotes").value.trim(),
        } };
        if (persistRepertoire(next)) personalEl("songNotesDialog").close();
    });
    personalEl("repertoireRemove").addEventListener("click", () => {
        const next = { ...repertoire };
        delete next[getSongIdentity(editingRepertoireSong)];
        if (persistRepertoire(next)) personalEl("songNotesDialog").close();
    });
    personalEl("songNotesDialog").addEventListener("close", () => {
        if (personalEl("repertoireDialog").open) {
            renderRepertoire();
            personalEl("repertoireSearch").focus({ preventScroll: true });
        } else if (repertoireOpener?.isConnected) {
            repertoireOpener.focus({ preventScroll: true });
        }
        editingRepertoireSong = null;
    });
    personalEl("chooseSongForm").addEventListener("submit", (event) => {
        event.preventDefault(); renderPickerResults();
    });
    personalEl("chooseSongForm").addEventListener("change", () => {
        personalEl("pickerResults").replaceChildren();
        personalEl("pickerSummary").textContent = "Preferences changed. Choose Find my five for updated suggestions.";
    });
    updateRepertoireButtons();
}

function persistRepertoire(next) {
    try { localStorage.setItem(REPERTOIRE_STORAGE_KEY, JSON.stringify({ songs: next, importedFavorites: [...migratedFavoriteIds] })); }
    catch {
        showSnackbar("Couldn’t save on this device. Please free some browser storage and try again.");
        personalEl("repertoireError").textContent = "Couldn't save on this device. Your edits are still here; free some browser storage and try again.";
        return false;
    }
    repertoire = next;
    updateRepertoireButtons();
    state.cachedDiscoverShelves = null;
    // Preserve the focused save button and open groups when membership is unchanged.
    if (state.favoriteOnly) render();
    else document.querySelectorAll(".favorite-button").forEach((button) => {
        const song = FAVORITE_BUTTON_SONGS.get(button);
        if (song) updateFavoriteButton(button, song);
    });
    return true;
}

function createRepertoireButton(song) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "icon-button repertoire-song-button";
    button.appendChild(createIcon("book"));
    button.append("Notes");
    REPERTOIRE_BUTTON_SONGS.set(button, song);
    updateRepertoireButton(button, song);
    button.addEventListener("click", () => openSongNotes(song, button));
    return button;
}

function updateRepertoireButton(button, song) {
    const saved = Boolean(repertoire[getSongIdentity(song)]);
    button.classList.toggle("is-saved", saved);
    button.title = saved ? "Edit song notes" : "Add song notes";
    button.setAttribute("aria-label", `${saved ? "Edit song notes" : "Add song notes"}: ${getDisplaySongTitle(song)}`);
}

function updateRepertoireButtons() {
    personalEl("repertoireCount").textContent = Object.keys(repertoire).length;
    document.querySelectorAll(".repertoire-song-button").forEach((button) => {
        const song = REPERTOIRE_BUTTON_SONGS.get(button);
        if (song) updateRepertoireButton(button, song);
    });
}

function openSongNotes(song, opener) {
    editingRepertoireSong = song;
    repertoireOpener = opener;
    const entry = repertoire[getSongIdentity(song)];
    personalEl("songNotesTitle").textContent = getDisplaySongTitle(song);
    personalEl("songNotesArtist").textContent = getDisplayArtist(song);
    personalEl("repertoireStatus").value = entry?.status || "saved";
    personalEl("repertoireComfort").value = entry?.comfort || "";
    personalEl("repertoireKey").value = entry?.key || "";
    personalEl("repertoireNotes").value = entry?.notes || "";
    personalEl("repertoireRemove").hidden = !entry;
    personalEl("repertoireError").textContent = "";
    personalEl("songNotesDialog").showModal();
}

function personalSongRow(song, description, savedLibrary = false) {
    const row = document.createElement("article");
    row.className = "personal-song-row";
    const title = document.createElement("h3");
    title.textContent = getDisplaySongTitle(song);
    const artist = document.createElement("p");
    artist.textContent = getDisplayArtist(song);
    const reason = document.createElement("p");
    reason.className = "personal-reason";
    reason.textContent = description;
    const actions = document.createElement("div");
    actions.className = "personal-row-actions";
    actions.append(savedLibrary ? createRepertoireButton(song) : createFavoriteButton(song), createMiniAddButton(song));
    row.append(title, artist, reason, actions);
    return row;
}

function renderRepertoire() {
    const query = normalize(personalEl("repertoireSearch").value);
    const filter = personalEl("repertoireFilter").value;
    const songsById = new Map(state.songs.map((song) => [getSongIdentity(song), song]));
    const entries = Object.entries(repertoire).filter(([, entry]) =>
        (filter === "all" || entry.status === filter) &&
        normalize(`${entry.song.song} ${entry.song.artist} ${entry.song.displayArtist || ""}`).includes(query)
    ).sort((a, b) => compareText(a[1].song.song, b[1].song.song));
    const list = personalEl("repertoireList");
    list.replaceChildren();
    for (const [id, entry] of entries.slice(0, repertoireLimit)) {
        const song = songsById.get(id) || entry.song;
        const description = [entry.status === "sung" ? "Sung before" : entry.status === "want" ? "Want to try" : "Saved for later",
            entry.comfort ? `Comfort ${entry.comfort}/5` : "", entry.key ? `Key: ${entry.key}` : ""].filter(Boolean).join(" · ");
        const row = personalSongRow(song, description, true);
        if (entry.notes) {
            const note = document.createElement("p");
            note.className = "repertoire-note"; note.textContent = entry.notes; row.appendChild(note);
        }
        list.appendChild(row);
    }
    personalEl("repertoireSummary").textContent = entries.length
        ? `${Math.min(entries.length, repertoireLimit)} of ${entries.length} saved songs`
        : Object.keys(repertoire).length ? "No saved songs match. Try another search or choose All saved songs."
            : "Tap the star on any song to save it here. Notes and practice details are optional.";
    personalEl("repertoireMore").hidden = entries.length <= repertoireLimit;
}

function personalSongGroup(song) {
    return `${song.artistKey || getArtistKey(song)}\u001f${normalize(getDisplaySongTitle(song))}`;
}

function pickPersonalSongs(pool, preferences) {
    const queued = new Set(state.setlist.map(personalSongGroup));
    const familiarGroups = new Set(state.songs.filter(isFavorite).map(personalSongGroup));
    for (const entry of Object.values(repertoire)) {
        if (entry.status === "sung") familiarGroups.add(personalSongGroup(entry.song));
    }
    const seen = new Set();
    const candidates = [];
    for (const song of pool) {
        const id = getSongIdentity(song);
        const group = personalSongGroup(song);
        if (queued.has(group) || seen.has(group)) continue;
        const entry = repertoire[id];
        const familiar = familiarGroups.has(group);
        if (preferences.familiarity === "familiar" && !familiar) continue;
        if (preferences.familiarity === "adventurous" && familiar) continue;
        if (preferences.voices === "duet" && !song.isDuet) continue;
        if (preferences.voices === "solo" && song.isDuet) continue;
        const moods = song.filterKeys.moods;
        const energetic = ["high energy", "party", "danceable"].some((mood) => moods.has(mood));
        const relaxed = ["mellow", "relaxed", "chill", "calm", "romantic"].some((mood) => moods.has(mood));
        if (preferences.energy === "energetic" && !energetic) continue;
        if (preferences.energy === "relaxed" && (!relaxed || energetic)) continue;
        seen.add(group);
        const reasons = [];
        if (entry?.status === "sung") reasons.push("You've sung this before");
        else if (isFavorite(song)) reasons.push("One of your saved songs");
        else if (familiar) reasons.push("Another version of a song you've saved");
        else if (entry?.status === "want") reasons.push("On your want-to-try list");
        else if (preferences.familiarity === "adventurous") reasons.push("Beyond your saved songs");
        if (entry?.comfort) reasons.push(`Your comfort rating: ${entry.comfort}/5`);
        if (preferences.voices === "duet") reasons.push("Tagged as a duet");
        if (preferences.voices === "solo") reasons.push("Not tagged as a duet");
        if (preferences.energy !== "any") reasons.push(preferences.energy === "energetic" ? "Energetic mood tags" : "Relaxed mood tags");
        if (!reasons.length) reasons.push("A fresh pick from your current results");
        // Shuffle within the eligible pool; keep each result's explanation factual.
        const score = Math.random() + (entry?.status === "want" ? .2 : 0);
        candidates.push({ song, reasons, score });
    }
    candidates.sort((a, b) => b.score - a.score);
    const artists = new Set();
    const chosen = [];
    for (const candidate of candidates) {
        if (artists.has(candidate.song.artistKey)) continue;
        chosen.push(candidate); artists.add(candidate.song.artistKey);
        if (chosen.length === 5) break;
    }
    // Small catalogs may have fewer than five artists; fill with other songs.
    for (const candidate of candidates) {
        if (chosen.length === 5) break;
        if (!chosen.includes(candidate)) chosen.push(candidate);
    }
    return chosen;
}

function renderPickerResults() {
    const preferences = Object.fromEntries(new FormData(personalEl("chooseSongForm")));
    const chosen = pickPersonalSongs(pickerPool, preferences);
    const list = personalEl("pickerResults");
    list.replaceChildren();
    personalEl("pickerSummary").textContent = chosen.length
        ? `${chosen.length} ${chosen.length === 1 ? "suggestion" : "suggestions"} for you. Choose Find my five again for another selection.`
        : "No songs match these choices. Try Either, save songs for familiar picks, or close this picker and broaden your search.";
    for (const { song, reasons } of chosen) list.appendChild(personalSongRow(song, reasons.join(" · ")));
    personalEl("pickerSummary").scrollIntoView({ block: "start", behavior: "instant" });
}

async function applyEraEnrichment(songs, enrichment) {
    if (!Array.isArray(songs) || !enrichment || !Array.isArray(enrichment.entries)) return songs;
    const validEras = new Set(["50s", "60s", "70s", "80s", "90s", "2000s", "2010s", "2020s"]);
    const byId = new Map(enrichment.entries.filter((entry) => entry && typeof entry.song === "string" &&
        typeof entry.artist === "string" && Array.isArray(entry.eras) && entry.eras.length &&
        entry.eras.every((era) => validEras.has(era))).map((entry) => [getSongIdentity(entry), entry]));
    return mapSongbookInChunks(songs, (song) => {
        if (!song || typeof song.song !== "string" || typeof song.artist !== "string") return song;
        const match = byId.get(getSongIdentity(song));
        return !song.eras?.length && match ? { ...song, eras: match.eras, eraSource: match.source } : song;
    });
}

function annotateEraSource(container, song) {
    if (!song.eraSource) return;
    const explanation = song.eraSource.type === "musicbrainz"
        ? "Decade from matching MusicBrainz recording dates"
        : "Decade inferred from matching catalog entries";
    for (const pill of container.querySelectorAll(".era")) {
        if (song.eraSource.type === "catalog-consensus") pill.textContent += " · inferred";
        pill.title = explanation;
        pill.setAttribute("aria-label", `${pill.textContent}. ${explanation}`);
    }
}

async function applyAudioEnrichment(songs, enrichment) {
    if (!Array.isArray(songs) || !Array.isArray(enrichment?.entries)) return songs;
    // Overlay only explicit import targets. Favorite/setlist IDs intentionally
    // normalize artist/title variants and are too broad for source attribution.
    const targetKey = (song) => JSON.stringify([song.artist, song.song, song.lookupArtist || '', song.lookupSong || '']);
    const byId = new Map();
    for (const entry of enrichment.entries) {
        if (!entry || typeof entry.song !== 'string' || typeof entry.artist !== 'string' || entry.source?.type !== 'getsongbpm' || !Array.isArray(entry.source.records)) continue;
        const url = entry.source.records?.find((record) => typeof record?.url === 'string' && /^https:\/\/getsongbpm\.com\/song\//.test(record.url))?.url;
        if (!url) continue;
        const bpm = typeof entry.bpm === 'number' && entry.bpm >= 20 && entry.bpm <= 400 ? entry.bpm : null;
        const referenceKey = typeof entry.referenceKey === 'string' && /^[A-G](?:#|b|♯|♭)?m?$/.test(entry.referenceKey) ? entry.referenceKey : null;
        if (bpm === null && referenceKey === null) continue;
        byId.set(targetKey(entry), { bpm, referenceKey, audioSource: { url, type: 'getsongbpm' } });
    }
    return mapSongbookInChunks(songs, (song) => {
        if (!song || typeof song.song !== 'string' || typeof song.artist !== 'string') return song;
        const match = byId.get(targetKey(song));
        return match ? { ...song, ...match } : song;
    });
}

function appendAudioMetadata(container, song) {
    if (!song.audioSource) return;
    const description = 'Reference recording from GetSongBPM. Karaoke arrangements may use a different tempo or key.';
    const values = [song.bpm !== null && song.bpm !== undefined ? `${song.bpm} BPM` : '', song.referenceKey ? `Ref. key ${song.referenceKey}` : ''].filter(Boolean);
    for (const value of values) {
        const link = document.createElement('a');
        link.className = 'pill audio-metadata is-clickable';
        link.textContent = value;
        link.href = song.audioSource.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.title = description;
        link.setAttribute('aria-label', `${value}. ${description} Opens in a new tab.`);
        container.appendChild(link);
    }
}
