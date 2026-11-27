// Karaoke Night host mode: fair round-robin singer queue, catalog + custom
// song requests, automatic YouTube karaoke lookup (/api/youtube-search) with
// alternate-version switching and manual URL fallback, and dual-screen TV
// stage sync via BroadcastChannel + localStorage.
// Loaded before karaoke_explorer.js; also exports pure helpers for Node tests.

const NIGHT_STORAGE_KEY = "karaokeNightSessionV1";
const NIGHT_STAGE_STORAGE_KEY = "karaokeNightStageV1";
const NIGHT_STAGE_CHANNEL = "karaoke-night-stage";
const NIGHT_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const NIGHT_DEFAULT_SECONDS = 210;

const nightYoutubeCache = new Map();
const nightYoutubeInflight = new Map();
let nightStageChannel = null;
let nightStageWindow = null;
let nightSearchTimer = 0;
let nightLastFocused = null;
let nightBound = false;
let nightLoadedFrameKey = "";

const nightState = {
    active: false,
    singers: [],
    selectedSinger: "",
    queue: [],
    autoBalance: true,
    playing: false,
    tvOnlyAudio: false,
    tvConnected: false,
    lookupStatus: "",
    lookupError: "",
    lookupConfigured: true,
    lookupQuotaExceeded: false,
};

function normalizeSingerKey(name) {
    return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function cleanSingerName(name) {
    return String(name || "").trim().replace(/\s+/g, " ").slice(0, 40);
}

function extractNightYoutubeId(input) {
    const raw = String(input || "").trim();
    if (!raw) return "";
    if (NIGHT_VIDEO_ID_PATTERN.test(raw)) return raw;
    try {
        const url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
        const host = url.hostname.replace(/^www\./, "").toLowerCase();
        if (host === "youtu.be") {
            const id = url.pathname.split("/").filter(Boolean)[0] || "";
            return NIGHT_VIDEO_ID_PATTERN.test(id) ? id : "";
        }
        if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com" || host === "youtube-nocookie.com") {
            const v = url.searchParams.get("v");
            if (v && NIGHT_VIDEO_ID_PATTERN.test(v)) return v;
            const segments = url.pathname.split("/").filter(Boolean);
            if (["embed", "shorts", "live", "v"].includes(segments[0]) && NIGHT_VIDEO_ID_PATTERN.test(segments[1] || "")) {
                return segments[1];
            }
        }
    } catch {
        return "";
    }
    return "";
}

function buildNightYoutubeSearchUrl(title, artist) {
    const parts = [String(artist || "").trim(), String(title || "").trim(), "karaoke"].filter(Boolean);
    return `https://www.youtube.com/results?search_query=${encodeURIComponent(parts.join(" "))}`;
}

function formatNightDuration(seconds) {
    const total = Math.round(Number(seconds));
    if (!Number.isFinite(total) || total <= 0) return "";
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${mins}:${String(secs).padStart(2, "0")}`;
}

// Reorders only "queued" items into fair round-robin order while keeping
// already-sung history and the active performing entry anchored in place.
// A singer's round is (already sung + currently performing + prior queued for
// that singer), so newcomers slot cleanly into the current round instead of
// waiting behind regulars' 3rd and 4th turns.
function rebalanceNightQueue(queue) {
    const sung = [];
    const performing = [];
    const queued = [];
    const priorTurns = new Map();

    for (const item of queue || []) {
        if (!item) continue;
        if (item.status === "sung") {
            sung.push(item);
            const key = normalizeSingerKey(item.singer);
            if (key) priorTurns.set(key, (priorTurns.get(key) || 0) + 1);
        } else if (item.status === "performing") {
            performing.push(item);
            const key = normalizeSingerKey(item.singer);
            if (key) priorTurns.set(key, (priorTurns.get(key) || 0) + 1);
        } else {
            queued.push(item);
        }
    }

    if (queued.length <= 1) {
        return [...sung, ...performing, ...queued];
    }

    const singerFirstSeen = new Map();
    const queuedCounts = new Map();
    const annotated = queued.map((item, index) => {
        const rawKey = normalizeSingerKey(item.singer);
        // Unassigned entries each act as an individual turn so open-mic picks
        // don't push each other to the very end of the night.
        const key = rawKey || `\u001fopen:${item.uid || index}`;
        if (!singerFirstSeen.has(key)) {
            singerFirstSeen.set(key, index);
        }
        const inQueueIndex = queuedCounts.get(key) || 0;
        queuedCounts.set(key, inQueueIndex + 1);
        const baseTurns = rawKey ? (priorTurns.get(rawKey) || 0) : 0;
        return {
            item,
            round: baseTurns + inQueueIndex,
            firstSeen: singerFirstSeen.get(key),
            index,
        };
    });

    annotated.sort((a, b) => a.round - b.round || a.firstSeen - b.firstSeen || a.index - b.index);
    return [...sung, ...performing, ...annotated.map((entry) => entry.item)];
}

function insertIntoNightQueue(queue, entry, { autoBalance = true } = {}) {
    const next = [...(queue || []), { ...entry, status: "queued" }];
    return autoBalance ? rebalanceNightQueue(next) : next;
}

function computeNightWaitMinutes(queue) {
    const waits = new Map();
    let elapsedSeconds = 0;

    for (const item of queue || []) {
        if (item?.status === "performing") {
            elapsedSeconds += Number(item.seconds) > 0 ? Number(item.seconds) : NIGHT_DEFAULT_SECONDS;
        }
    }

    for (const item of queue || []) {
        if (!item || item.status !== "queued") continue;
        const waitMin = elapsedSeconds > 0 ? Math.max(1, Math.round(elapsedSeconds / 60)) : 0;
        waits.set(item.uid, waitMin);
        elapsedSeconds += Number(item.seconds) > 0 ? Number(item.seconds) : NIGHT_DEFAULT_SECONDS;
    }

    return waits;
}

function createNightUid() {
    return `kn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function nightEl(id) {
    return document.getElementById(id);
}

function getNightCurrent() {
    return nightState.queue.find((item) => item.status === "performing") || null;
}

function getNightQueued() {
    return nightState.queue.filter((item) => item.status === "queued");
}

function getNightSung() {
    return nightState.queue.filter((item) => item.status === "sung");
}

function loadNightSession() {
    try {
        const stored = JSON.parse(localStorage.getItem(NIGHT_STORAGE_KEY) || "null");
        if (!stored || typeof stored !== "object") return;
        if (Array.isArray(stored.singers)) {
            nightState.singers = stored.singers
                .map((name) => cleanSingerName(name))
                .filter(Boolean)
                .filter((name, i, arr) => arr.findIndex((other) => normalizeSingerKey(other) === normalizeSingerKey(name)) === i);
        }
        if (Array.isArray(stored.queue)) {
            nightState.queue = stored.queue
                .filter((item) => item && typeof item.title === "string")
                .map((item) => ({
                    uid: String(item.uid || createNightUid()),
                    songId: item.songId || "",
                    title: String(item.title || "").slice(0, 140),
                    artist: String(item.artist || "").slice(0, 120),
                    seconds: Number(item.seconds) > 0 ? Number(item.seconds) : 0,
                    bpm: Number(item.bpm) > 0 ? Number(item.bpm) : null,
                    referenceKey: typeof item.referenceKey === "string" ? item.referenceKey : null,
                    singer: cleanSingerName(item.singer || ""),
                    status: ["queued", "performing", "sung"].includes(item.status) ? item.status : "queued",
                    youtubeId: NIGHT_VIDEO_ID_PATTERN.test(String(item.youtubeId || "")) ? item.youtubeId : "",
                    youtubeTitle: String(item.youtubeTitle || ""),
                    youtubeChannel: String(item.youtubeChannel || ""),
                    candidates: Array.isArray(item.candidates) ? item.candidates.slice(0, 5) : [],
                    custom: Boolean(item.custom),
                }));
        }
        if (typeof stored.autoBalance === "boolean") {
            nightState.autoBalance = stored.autoBalance;
        }
        if (typeof stored.selectedSinger === "string") {
            nightState.selectedSinger = cleanSingerName(stored.selectedSinger);
        }
        ensureSingersFromQueue();
    } catch {
        // Ignore corrupt local session data.
    }
}

function saveNightSession() {
    try {
        localStorage.setItem(NIGHT_STORAGE_KEY, JSON.stringify({
            singers: nightState.singers,
            selectedSinger: nightState.selectedSinger,
            queue: nightState.queue,
            autoBalance: nightState.autoBalance,
            autoSavedAt: Date.now(),
        }));
    } catch {
        // Session stays in memory if storage quota is full.
    }
    broadcastStageState();
}

function ensureSingersFromQueue() {
    const existing = new Set(nightState.singers.map(normalizeSingerKey));
    for (const item of nightState.queue) {
        const cleaned = cleanSingerName(item.singer);
        const key = normalizeSingerKey(cleaned);
        if (key && !existing.has(key)) {
            existing.add(key);
            nightState.singers.push(cleaned);
        }
    }
}

function ensureStageChannel() {
    if (nightStageChannel || typeof BroadcastChannel !== "function") return;
    nightStageChannel = new BroadcastChannel(NIGHT_STAGE_CHANNEL);
    nightStageChannel.addEventListener("message", (event) => {
        if (event.data?.type === "stage-ready") {
            nightState.tvConnected = true;
            broadcastStageState();
            renderNightStageControls();
        }
    });
}

function buildStagePayload() {
    const current = getNightCurrent();
    const waits = computeNightWaitMinutes(nightState.queue);
    const upNext = getNightQueued().slice(0, 5).map((item) => ({
        uid: item.uid,
        singer: item.singer || "Open mic",
        title: item.title,
        artist: item.artist,
        waitMin: waits.get(item.uid) || 0,
    }));
    return {
        current: current
            ? {
                uid: current.uid,
                singer: current.singer || "Open mic",
                title: current.title,
                artist: current.artist,
                youtubeId: current.youtubeId || "",
            }
            : null,
        playing: Boolean(nightState.playing && current && current.youtubeId),
        upNext,
        updatedAt: Date.now(),
    };
}

function broadcastStageState() {
    const payload = buildStagePayload();
    try {
        localStorage.setItem(NIGHT_STAGE_STORAGE_KEY, JSON.stringify(payload));
    } catch {
        // Ignore storage errors.
    }
    if (nightStageChannel) {
        try {
            nightStageChannel.postMessage({ type: "stage-state", payload });
        } catch {
            // Ignore closed channel.
        }
    }
}

function openTvStageWindow() {
    ensureStageChannel();
    broadcastStageState();
    const features = "popup=yes,width=1280,height=720,noopener=no";
    const win = window.open("karaoke_stage.html", "karaokeNightStage", features);
    if (win) {
        nightStageWindow = win;
        nightState.tvConnected = true;
        win.focus?.();
        renderNightStageControls();
        showSnackbar("TV Stage opened — drag it to your TV or cast that tab");
    } else {
        showSnackbar("Popup blocked — allow popups for this site to open the TV Stage");
    }
}

function youtubeCacheKey(title, artist) {
    return `${normalizeSingerKey(artist)}\u001f${normalizeSingerKey(title)}`;
}

async function lookupYoutubeKaraoke(entry, { silent = false } = {}) {
    if (!entry) return null;
    const key = youtubeCacheKey(entry.title, entry.artist);
    if (nightYoutubeCache.has(key)) {
        return nightYoutubeCache.get(key);
    }
    if (nightYoutubeInflight.has(key)) {
        return nightYoutubeInflight.get(key);
    }

    const params = new URLSearchParams({
        song: entry.title,
        artist: entry.artist || "",
    });
    if (entry.seconds > 0) {
        params.set("seconds", String(Math.round(entry.seconds)));
    }

    const promise = (async () => {
        try {
            const response = await fetch(`/api/youtube-search?${params.toString()}`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const contentType = response.headers.get("content-type") || "";
            if (!contentType.includes("application/json")) {
                // Static local server without Vercel API routes returns HTML/404.
                return {
                    configured: false,
                    quotaExceeded: false,
                    searchUrl: buildNightYoutubeSearchUrl(entry.title, entry.artist),
                    candidates: [],
                };
            }
            const data = await response.json();
            nightYoutubeCache.set(key, data);
            return data;
        } catch {
            return {
                configured: false,
                quotaExceeded: false,
                searchUrl: buildNightYoutubeSearchUrl(entry.title, entry.artist),
                candidates: [],
                unavailable: true,
            };
        } finally {
            nightYoutubeInflight.delete(key);
        }
    })();

    nightYoutubeInflight.set(key, promise);
    const result = await promise;
    if (!silent && result) {
        nightState.lookupConfigured = result.configured !== false;
        nightState.lookupQuotaExceeded = Boolean(result.quotaExceeded);
    }
    return result;
}

async function resolveYoutubeForCurrent({ autoplay = false } = {}) {
    const current = getNightCurrent();
    if (!current) {
        nightState.lookupStatus = "";
        nightState.lookupError = "";
        renderNightStage();
        return;
    }

    if (current.youtubeId && current.candidates?.length) {
        if (autoplay) nightState.playing = true;
        nightState.lookupStatus = "";
        saveNightSession();
        renderNightStage();
        prefetchNextYoutube();
        return;
    }

    nightState.lookupStatus = `Finding the best YouTube karaoke track for “${current.title}”…`;
    nightState.lookupError = "";
    renderNightStage();

    const data = await lookupYoutubeKaraoke(current);
    // Guard against the host switching songs while the request was in flight.
    if (getNightCurrent()?.uid !== current.uid) {
        return;
    }

    nightState.lookupStatus = "";
    const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
    current.candidates = candidates;
    if (!current.youtubeId && candidates.length) {
        current.youtubeId = candidates[0].id;
        current.youtubeTitle = candidates[0].title;
        current.youtubeChannel = candidates[0].channel;
    }
    if (autoplay && current.youtubeId) {
        nightState.playing = true;
    }
    if (!candidates.length) {
        if (data?.quotaExceeded) {
            nightState.lookupError = "Daily YouTube search limit reached. Open YouTube below or paste a karaoke link.";
        } else if (data?.configured === false) {
            nightState.lookupError = "Auto YouTube search is off (set YOUTUBE_API_KEY in Vercel env vars). Use the YouTube search button or paste any karaoke link below.";
        } else {
            nightState.lookupError = "No embeddable karaoke track found automatically. Try opening YouTube search or pasting a link below.";
        }
    } else {
        nightState.lookupError = "";
    }

    saveNightSession();
    renderNightStage();
    prefetchNextYoutube();
}

function prefetchNextYoutube() {
    const next = getNightQueued()[0];
    if (!next || next.youtubeId) return;
    lookupYoutubeKaraoke(next, { silent: true }).then((data) => {
        if (!data?.candidates?.length) return;
        const target = nightState.queue.find((item) => item.uid === next.uid);
        if (!target || target.youtubeId) return;
        target.candidates = data.candidates;
        target.youtubeId = data.candidates[0].id;
        target.youtubeTitle = data.candidates[0].title;
        target.youtubeChannel = data.candidates[0].channel;
        saveNightSession();
    }).catch(() => {});
}

function addNightSinger(rawName) {
    const name = cleanSingerName(rawName);
    if (!name) return;
    const key = normalizeSingerKey(name);
    const existing = nightState.singers.find((singer) => normalizeSingerKey(singer) === key);
    if (existing) {
        nightState.selectedSinger = existing;
    } else {
        nightState.singers.push(name);
        nightState.selectedSinger = name;
    }
    saveNightSession();
    renderNightRoster();
}

function queueNightSong(songLike, { custom = false, singer = nightState.selectedSinger } = {}) {
    const title = custom
        ? String(songLike.title || songLike.song || "").trim().slice(0, 140)
        : getDisplaySongTitle(songLike);
    const artist = custom
        ? String(songLike.artist || "").trim().slice(0, 120)
        : (getDisplayArtist(songLike) || "");
    if (!title) return;

    const cleanedSinger = cleanSingerName(singer);
    if (cleanedSinger) {
        const key = normalizeSingerKey(cleanedSinger);
        if (!nightState.singers.some((s) => normalizeSingerKey(s) === key)) {
            nightState.singers.push(cleanedSinger);
        }
    }

    const entry = {
        uid: createNightUid(),
        songId: custom ? "" : (songLike.id || getSongIdentity(songLike)),
        title,
        artist,
        seconds: Number(songLike.seconds) > 0 ? Number(songLike.seconds) : 0,
        bpm: Number(songLike.bpm) > 0 ? Number(songLike.bpm) : null,
        referenceKey: typeof songLike.referenceKey === "string" ? songLike.referenceKey : null,
        singer: cleanedSinger,
        status: "queued",
        youtubeId: "",
        youtubeTitle: "",
        youtubeChannel: "",
        candidates: [],
        custom: Boolean(custom),
    };

    const hadCurrent = Boolean(getNightCurrent());
    nightState.queue = insertIntoNightQueue(nightState.queue, entry, { autoBalance: nightState.autoBalance });

    // If the stage is idle, promote the first queued song right onto the stage.
    if (!hadCurrent) {
        const firstQueued = getNightQueued()[0];
        if (firstQueued) {
            firstQueued.status = "performing";
            nightState.playing = false;
            saveNightSession();
            renderKaraokeNight();
            resolveYoutubeForCurrent({ autoplay: false });
            showSnackbar(`On deck: ${firstQueued.singer || "Open mic"} — “${firstQueued.title}”`);
            return;
        }
    }

    saveNightSession();
    renderKaraokeNight();
    prefetchNextYoutube();
    const who = cleanedSinger ? ` for ${cleanedSinger}` : "";
    showSnackbar(`Queued “${title}”${who}`);
}

function importSetlistToNight() {
    if (!state.setlist.length) {
        showSnackbar("Your setlist is empty");
        return;
    }

    const previousQueue = nightState.queue.map((item) => ({ ...item }));
    const previousSingers = [...nightState.singers];
    const existingActiveIds = new Set(
        nightState.queue
            .filter((item) => item.status !== "sung" && item.songId)
            .map((item) => item.songId)
    );

    let added = 0;
    for (const song of state.setlist) {
        if (song.sung) continue;
        const catalogSong = getCatalogSong(song) || song;
        const id = catalogSong.id || getSongIdentity(catalogSong);
        if (existingActiveIds.has(id)) continue;
        existingActiveIds.add(id);

        const singer = cleanSingerName(song.singer || "");
        const entry = {
            uid: createNightUid(),
            songId: id,
            title: getDisplaySongTitle(catalogSong),
            artist: getDisplayArtist(catalogSong) || "",
            seconds: Number(catalogSong.seconds) > 0 ? Number(catalogSong.seconds) : 0,
            bpm: Number(catalogSong.bpm) > 0 ? Number(catalogSong.bpm) : null,
            referenceKey: typeof catalogSong.referenceKey === "string" ? catalogSong.referenceKey : null,
            singer,
            status: "queued",
            youtubeId: "",
            youtubeTitle: "",
            youtubeChannel: "",
            candidates: [],
            custom: false,
        };
        nightState.queue = insertIntoNightQueue(nightState.queue, entry, { autoBalance: nightState.autoBalance });
        added++;
    }

    if (!added) {
        showSnackbar("All unsung setlist songs are already in the queue");
        return;
    }

    ensureSingersFromQueue();
    if (!getNightCurrent()) {
        const firstQueued = getNightQueued()[0];
        if (firstQueued) {
            firstQueued.status = "performing";
            nightState.playing = false;
        }
    }

    saveNightSession();
    renderKaraokeNight();
    resolveYoutubeForCurrent({ autoplay: false });
    showSnackbar(`Imported ${added} ${added === 1 ? "song" : "songs"} from setlist`, () => {
        nightState.queue = previousQueue;
        nightState.singers = previousSingers;
        saveNightSession();
        renderKaraokeNight();
    });
}

function startNightEntryNow(uid, { autoplay = true } = {}) {
    const target = nightState.queue.find((item) => item.uid === uid);
    if (!target) return;

    const current = getNightCurrent();
    if (current && current.uid !== target.uid) {
        current.status = "queued";
    }
    target.status = "performing";
    nightState.playing = Boolean(autoplay && target.youtubeId);
    nightLoadedFrameKey = "";
    saveNightSession();
    renderKaraokeNight();
    resolveYoutubeForCurrent({ autoplay });
}

function advanceNightNext(event) {
    const current = getNightCurrent();
    const sourceRect = event?.currentTarget?.getBoundingClientRect?.();
    if (current) {
        current.status = "sung";
    }
    const next = getNightQueued()[0];
    if (next) {
        next.status = "performing";
        nightState.playing = Boolean(next.youtubeId);
        nightLoadedFrameKey = "";
        saveNightSession();
        renderKaraokeNight();
        resolveYoutubeForCurrent({ autoplay: true });
        if (sourceRect) window.StageFx?.confetti(sourceRect);
        showSnackbar(`Up now: ${next.singer || "Open mic"} — “${next.title}”`);
    } else {
        nightState.playing = false;
        nightLoadedFrameKey = "";
        saveNightSession();
        renderKaraokeNight();
        showSnackbar("Queue finished — add more songs to keep singing!");
    }
}

function skipAndPushBackCurrent() {
    const current = getNightCurrent();
    if (!current) return;

    const queued = getNightQueued();
    if (!queued.length) {
        showSnackbar("No other singers waiting to swap with");
        return;
    }

    const sung = getNightSung();
    const nextUp = queued[0];
    const remaining = queued.slice(1);
    current.status = "queued";
    nextUp.status = "performing";
    const insertAt = Math.min(1, remaining.length);
    remaining.splice(insertAt, 0, current);

    nightState.queue = [...sung, nextUp, ...remaining];
    nightState.playing = Boolean(nextUp.youtubeId);
    nightLoadedFrameKey = "";
    saveNightSession();
    renderKaraokeNight();
    resolveYoutubeForCurrent({ autoplay: true });
    showSnackbar(`Pushed “${current.title}” back — ${nextUp.singer || "Open mic"} is up now`);
}

function moveNightQueued(uid, direction) {
    const queued = getNightQueued();
    const idx = queued.findIndex((item) => item.uid === uid);
    const targetIdx = idx + direction;
    if (idx < 0 || targetIdx < 0 || targetIdx >= queued.length) return;
    const [moved] = queued.splice(idx, 1);
    queued.splice(targetIdx, 0, moved);
    const current = getNightCurrent();
    nightState.queue = [...getNightSung(), ...(current ? [current] : []), ...queued];
    saveNightSession();
    renderNightQueue();
}

function removeNightEntry(uid) {
    const index = nightState.queue.findIndex((item) => item.uid === uid);
    if (index < 0) return;
    const previous = nightState.queue.map((item) => ({ ...item }));
    const [removed] = nightState.queue.splice(index, 1);
    if (removed.status === "performing") {
        const next = getNightQueued()[0];
        if (next) next.status = "performing";
        nightState.playing = false;
        nightLoadedFrameKey = "";
    }
    saveNightSession();
    renderKaraokeNight();
    if (removed.status === "performing") {
        resolveYoutubeForCurrent({ autoplay: false });
    }
    showSnackbar(`Removed “${removed.title}”`, () => {
        nightState.queue = previous;
        saveNightSession();
        renderKaraokeNight();
    });
}

function resetKaraokeNight() {
    if (!nightState.queue.length && !nightState.singers.length) return;
    const prevQueue = nightState.queue.map((item) => ({ ...item }));
    const prevSingers = [...nightState.singers];
    const prevSelected = nightState.selectedSinger;

    nightState.queue = [];
    nightState.singers = [];
    nightState.selectedSinger = "";
    nightState.playing = false;
    nightState.lookupStatus = "";
    nightState.lookupError = "";
    nightLoadedFrameKey = "";

    saveNightSession();
    renderKaraokeNight();
    showSnackbar("Karaoke night reset", () => {
        nightState.queue = prevQueue;
        nightState.singers = prevSingers;
        nightState.selectedSinger = prevSelected;
        saveNightSession();
        renderKaraokeNight();
    });
}

function selectNightCandidate(candidate) {
    const current = getNightCurrent();
    if (!current || !candidate || !NIGHT_VIDEO_ID_PATTERN.test(candidate.id)) return;
    current.youtubeId = candidate.id;
    current.youtubeTitle = candidate.title || "";
    current.youtubeChannel = candidate.channel || "";
    nightState.playing = true;
    nightState.lookupError = "";
    nightLoadedFrameKey = "";
    saveNightSession();
    renderNightStage();
}

function applyManualYoutubeUrl(rawInput) {
    const current = getNightCurrent();
    if (!current) return;
    const videoId = extractNightYoutubeId(rawInput);
    if (!videoId) {
        showSnackbar("Paste a valid YouTube link or 11-character video ID");
        return;
    }
    current.youtubeId = videoId;
    current.youtubeTitle = `${current.title} (custom YouTube link)`;
    current.youtubeChannel = "Custom link";
    nightState.playing = true;
    nightState.lookupError = "";
    nightLoadedFrameKey = "";
    saveNightSession();
    renderNightStage();
    showSnackbar("Loaded YouTube track on stage");
}

function openKaraokeNight() {
    if (typeof closeMoreTools === "function") closeMoreTools();
    if (typeof closeActiveSheet === "function") closeActiveSheet();
    nightLastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    nightState.active = true;
    document.body.classList.add("karaoke-night-active");
    const panel = nightEl("karaokeNightPanel");
    if (panel) panel.hidden = false;
    ensureStageChannel();
    renderKaraokeNight();
    if (getNightCurrent() && !getNightCurrent().youtubeId) {
        resolveYoutubeForCurrent({ autoplay: false });
    }
    nightEl("karaokeNightTitle")?.focus?.({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
}

function closeKaraokeNight() {
    nightState.active = false;
    nightState.playing = false;
    nightLoadedFrameKey = "";
    const iframe = nightEl("nightVideoFrame");
    if (iframe) iframe.src = "about:blank";
    document.body.classList.remove("karaoke-night-active");
    const panel = nightEl("karaokeNightPanel");
    if (panel) panel.hidden = true;
    broadcastStageState();
    if (nightLastFocused?.isConnected) {
        nightLastFocused.focus({ preventScroll: true });
    } else {
        els.homeButton?.focus?.({ preventScroll: true });
    }
}

function renderKaraokeNight() {
    if (!nightEl("karaokeNightPanel")) return;
    renderNightHeader();
    renderNightRoster();
    renderNightStage();
    renderNightQueue();
    hydrateIcons(nightEl("karaokeNightPanel"));
}

function renderNightHeader() {
    const stats = nightEl("nightStats");
    const importBtn = nightEl("nightImportSetlistButton");
    const queued = getNightQueued();
    const sung = getNightSung();
    const current = getNightCurrent();
    const remainingSongs = queued.length + (current ? 1 : 0);
    const remainingSec = (current ? (current.seconds || NIGHT_DEFAULT_SECONDS) : 0) +
        queued.reduce((sum, item) => sum + (item.seconds || NIGHT_DEFAULT_SECONDS), 0);
    const minutes = remainingSec ? Math.max(1, Math.round(remainingSec / 60)) : 0;

    if (stats) {
        const parts = [
            `${nightState.singers.length} ${nightState.singers.length === 1 ? "singer" : "singers"}`,
            `${remainingSongs} ${remainingSongs === 1 ? "song" : "songs"} up`,
        ];
        if (minutes) parts.push(`~${minutes} min`);
        if (sung.length) parts.push(`${sung.length} sung`);
        stats.textContent = parts.join(" · ");
    }

    if (importBtn) {
        const unsungSetlistCount = state.setlist.filter((song) => !song.sung).length;
        importBtn.hidden = unsungSetlistCount === 0;
        const label = importBtn.querySelector("span");
        if (label) label.textContent = `Import setlist (${unsungSetlistCount})`;
    }
}

function renderNightRoster() {
    const list = nightEl("nightSingerRoster");
    if (!list) return;
    list.replaceChildren();

    const sungCounts = new Map();
    const queuedCounts = new Map();
    for (const item of nightState.queue) {
        const key = normalizeSingerKey(item.singer);
        if (!key) continue;
        if (item.status === "sung") {
            sungCounts.set(key, (sungCounts.get(key) || 0) + 1);
        } else {
            queuedCounts.set(key, (queuedCounts.get(key) || 0) + 1);
        }
    }

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = `night-singer-chip${!nightState.selectedSinger ? " is-selected" : ""}`;
    openBtn.setAttribute("aria-pressed", String(!nightState.selectedSinger));
    openBtn.textContent = "Open mic";
    openBtn.addEventListener("click", () => {
        nightState.selectedSinger = "";
        saveNightSession();
        renderNightRoster();
    });
    list.appendChild(openBtn);

    for (const singer of nightState.singers) {
        const key = normalizeSingerKey(singer);
        const selected = normalizeSingerKey(nightState.selectedSinger) === key;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `night-singer-chip${selected ? " is-selected" : ""}`;
        btn.setAttribute("aria-pressed", String(selected));
        const qCount = queuedCounts.get(key) || 0;
        const sCount = sungCounts.get(key) || 0;
        const countLabel = qCount || sCount ? ` (${qCount} up${sCount ? `, ${sCount} sung` : ""})` : "";
        btn.textContent = `${singer}${countLabel}`;
        btn.addEventListener("click", () => {
            nightState.selectedSinger = singer;
            saveNightSession();
            renderNightRoster();
        });
        list.appendChild(btn);
    }
}

function renderNightStageControls() {
    const current = getNightCurrent();
    const tvOnlyLabel = nightEl("nightTvOnlyLabel");
    const tvOnlyCheck = nightEl("nightTvOnlyAudio");
    const tvStatus = nightEl("nightTvStatus");
    const playToggle = nightEl("nightPlayToggleButton");
    const nextBtn = nightEl("nightNextSingerButton");
    const skipBtn = nightEl("nightSkipSingerButton");

    if (tvOnlyLabel) tvOnlyLabel.hidden = !nightState.tvConnected;
    if (tvOnlyCheck) tvOnlyCheck.checked = nightState.tvOnlyAudio;
    if (tvStatus) {
        tvStatus.hidden = !nightState.tvConnected;
        tvStatus.textContent = "TV Stage synced";
    }
    if (playToggle) {
        playToggle.disabled = !current || !current.youtubeId;
        const label = playToggle.querySelector("span");
        if (label) label.textContent = nightState.playing ? "Pause stage" : "Play on stage";
    }
    if (nextBtn) {
        nextBtn.disabled = !current && !getNightQueued().length;
    }
    if (skipBtn) {
        skipBtn.disabled = !current || !getNightQueued().length;
    }
}

function renderNightStage() {
    const current = getNightCurrent();
    const emptyStage = nightEl("nightStageEmpty");
    const activeStage = nightEl("nightStageActive");
    const singerBadge = nightEl("nightCurrentSinger");
    const titleEl = nightEl("nightCurrentTitle");
    const artistEl = nightEl("nightCurrentArtist");
    const metaEl = nightEl("nightCurrentMeta");
    const frameWrap = nightEl("nightVideoWrap");
    const frame = nightEl("nightVideoFrame");
    const placeholder = nightEl("nightVideoPlaceholder");
    const statusEl = nightEl("nightLookupStatus");
    const candidatesEl = nightEl("nightCandidates");
    const searchLink = nightEl("nightYoutubeSearchLink");
    const urlInput = nightEl("nightYoutubeUrlInput");

    renderNightStageControls();

    if (!current) {
        if (emptyStage) emptyStage.hidden = false;
        if (activeStage) activeStage.hidden = true;
        if (frame) {
            nightLoadedFrameKey = "";
            frame.src = "about:blank";
        }
        return;
    }

    if (emptyStage) emptyStage.hidden = true;
    if (activeStage) activeStage.hidden = false;
    if (singerBadge) singerBadge.textContent = current.singer || "Open mic";
    if (titleEl) titleEl.textContent = current.title;
    if (artistEl) artistEl.textContent = current.artist || "Unknown artist";

    if (metaEl) {
        const metaParts = [];
        const dur = formatNightDuration(current.seconds);
        if (dur) metaParts.push(dur);
        if (current.bpm) metaParts.push(`${current.bpm} BPM`);
        if (current.referenceKey) metaParts.push(`Ref. key ${current.referenceKey}`);
        if (current.youtubeChannel) metaParts.push(`YouTube: ${current.youtubeChannel}`);
        metaEl.textContent = metaParts.join(" · ");
        metaEl.hidden = !metaParts.length;
    }

    if (searchLink) {
        searchLink.href = buildNightYoutubeSearchUrl(current.title, current.artist);
    }

    if (statusEl) {
        const msg = nightState.lookupStatus || nightState.lookupError;
        statusEl.textContent = msg;
        statusEl.hidden = !msg;
    }

    const showLocalIframe = Boolean(current.youtubeId && !(nightState.tvConnected && nightState.tvOnlyAudio));
    if (frameWrap && frame && placeholder) {
        if (showLocalIframe) {
            frame.hidden = false;
            placeholder.hidden = true;
            const frameKey = `${current.uid}:${current.youtubeId}:${nightState.playing ? "1" : "0"}`;
            if (nightLoadedFrameKey !== frameKey) {
                nightLoadedFrameKey = frameKey;
                const autoplayParam = nightState.playing ? "&autoplay=1" : "";
                frame.src = `https://www.youtube-nocookie.com/embed/${current.youtubeId}?rel=0&modestbranding=1${autoplayParam}`;
            }
        } else {
            frame.hidden = true;
            if (nightLoadedFrameKey) {
                nightLoadedFrameKey = "";
                frame.src = "about:blank";
            }
            placeholder.hidden = false;
            if (current.youtubeId && nightState.tvConnected && nightState.tvOnlyAudio) {
                placeholder.textContent = nightState.playing
                    ? `Playing “${current.title}” on the TV Stage window.`
                    : `Ready on TV Stage — press Play on stage to start “${current.title}”.`;
            } else if (nightState.lookupStatus) {
                placeholder.textContent = nightState.lookupStatus;
            } else {
                placeholder.textContent = "Pick a YouTube karaoke track below or paste any YouTube URL to play on stage.";
            }
        }
    }

    if (candidatesEl) {
        candidatesEl.replaceChildren();
        const candidates = current.candidates || [];
        candidatesEl.hidden = !candidates.length;
        for (const candidate of candidates) {
            const btn = document.createElement("button");
            btn.type = "button";
            const isSelected = candidate.id === current.youtubeId;
            btn.className = `night-candidate${isSelected ? " is-selected" : ""}`;
            btn.setAttribute("aria-pressed", String(isSelected));

            const title = document.createElement("span");
            title.className = "night-candidate-title";
            title.textContent = candidate.title;

            const sub = document.createElement("span");
            sub.className = "night-candidate-sub";
            const bits = [candidate.channel];
            const dur = formatNightDuration(candidate.durationSec);
            if (dur) bits.push(dur);
            if (Array.isArray(candidate.tags) && candidate.tags.length) {
                bits.push(candidate.tags.slice(0, 2).join(" · "));
            }
            sub.textContent = bits.filter(Boolean).join(" · ");

            btn.append(title, sub);
            btn.addEventListener("click", () => selectNightCandidate(candidate));
            candidatesEl.appendChild(btn);
        }
    }

    if (urlInput && document.activeElement !== urlInput) {
        urlInput.value = "";
    }
}

function renderNightQueue() {
    const queueList = nightEl("nightQueueList");
    const historyDetails = nightEl("nightHistoryDetails");
    const historySummary = nightEl("nightHistorySummary");
    const historyList = nightEl("nightHistoryList");
    const autoCheck = nightEl("nightAutoBalance");
    const rotateBtn = nightEl("nightRotateNowButton");

    const queued = getNightQueued();
    const sung = getNightSung();
    const waits = computeNightWaitMinutes(nightState.queue);

    if (autoCheck) autoCheck.checked = nightState.autoBalance;
    if (rotateBtn) rotateBtn.disabled = queued.length < 2;

    if (queueList) {
        queueList.replaceChildren();
        if (!queued.length) {
            const empty = document.createElement("li");
            empty.className = "night-queue-empty";
            empty.textContent = getNightCurrent()
                ? "No more songs waiting. Search above to queue the next singer."
                : "Queue is empty. Pick a singer and search the songbook above.";
            queueList.appendChild(empty);
        } else {
            queued.forEach((entry, index) => {
                const li = document.createElement("li");
                li.className = "night-queue-item";

                const num = document.createElement("span");
                num.className = "night-queue-num";
                num.textContent = String(index + 1);

                const body = document.createElement("div");
                body.className = "night-queue-body";

                const topRow = document.createElement("div");
                topRow.className = "night-queue-top";

                const singer = document.createElement("span");
                singer.className = "night-queue-singer";
                singer.textContent = entry.singer || "Open mic";
                topRow.appendChild(singer);

                const waitMin = waits.get(entry.uid) || 0;
                if (waitMin > 0) {
                    const wait = document.createElement("span");
                    wait.className = "night-queue-wait";
                    wait.textContent = `~${waitMin} min`;
                    topRow.appendChild(wait);
                }

                const title = document.createElement("span");
                title.className = "night-queue-title";
                title.textContent = entry.title;

                const artist = document.createElement("span");
                artist.className = "night-queue-artist";
                artist.textContent = entry.artist || (entry.custom ? "Custom YouTube pick" : "Unknown artist");

                body.append(topRow, title, artist);

                const actions = document.createElement("div");
                actions.className = "night-queue-actions";

                const playNow = document.createElement("button");
                playNow.type = "button";
                playNow.className = "setlist-icon-button";
                playNow.title = "Put on stage now";
                playNow.setAttribute("aria-label", `Put ${entry.title} on stage now`);
                playNow.innerHTML = '<i data-lucide="play-circle" aria-hidden="true"></i>';
                playNow.addEventListener("click", () => startNightEntryNow(entry.uid, { autoplay: true }));

                const up = document.createElement("button");
                up.type = "button";
                up.className = "setlist-icon-button";
                up.title = "Move up";
                up.setAttribute("aria-label", `Move ${entry.title} up`);
                up.disabled = index === 0;
                up.innerHTML = '<i data-lucide="chevron-up" aria-hidden="true"></i>';
                up.addEventListener("click", () => moveNightQueued(entry.uid, -1));

                const down = document.createElement("button");
                down.type = "button";
                down.className = "setlist-icon-button";
                down.title = "Move down";
                down.setAttribute("aria-label", `Move ${entry.title} down`);
                down.disabled = index === queued.length - 1;
                down.innerHTML = '<i data-lucide="chevron-down" aria-hidden="true"></i>';
                down.addEventListener("click", () => moveNightQueued(entry.uid, 1));

                const remove = document.createElement("button");
                remove.type = "button";
                remove.className = "setlist-icon-button remove-button";
                remove.title = "Remove";
                remove.setAttribute("aria-label", `Remove ${entry.title} from queue`);
                remove.innerHTML = '<i data-lucide="x" aria-hidden="true"></i>';
                remove.addEventListener("click", () => removeNightEntry(entry.uid));

                actions.append(playNow, up, down, remove);
                li.append(num, body, actions);
                queueList.appendChild(li);
            });
        }
    }

    if (historyDetails && historySummary && historyList) {
        historyDetails.hidden = !sung.length;
        historySummary.textContent = `Sung tonight (${sung.length})`;
        historyList.replaceChildren();
        for (const entry of [...sung].reverse()) {
            const li = document.createElement("li");
            li.className = "night-history-item";
            const info = document.createElement("span");
            info.textContent = `${entry.singer || "Open mic"} — ${entry.title}${entry.artist ? ` · ${entry.artist}` : ""}`;
            const again = document.createElement("button");
            again.type = "button";
            again.className = "command subtle-command night-mini-btn";
            again.textContent = "Sing again";
            again.addEventListener("click", () => {
                queueNightSong({
                    id: entry.songId,
                    song: entry.title,
                    artist: entry.artist,
                    seconds: entry.seconds,
                    bpm: entry.bpm,
                    referenceKey: entry.referenceKey,
                }, { custom: entry.custom, singer: entry.singer });
            });
            li.append(info, again);
            historyList.appendChild(li);
        }
    }
}

function renderNightSearchMatches() {
    const input = nightEl("nightSongSearch");
    const list = nightEl("nightSearchResults");
    if (!input || !list) return;

    const query = String(input.value || "").trim();
    list.replaceChildren();
    if (!query) {
        list.hidden = true;
        return;
    }

    list.hidden = false;
    let matches = state.songs.length
        ? rankSongs(state.songs, query, { scope: "all", fuzzy: false, exactArtist: false })
        : [];
    if (!matches.length && state.songs.length) {
        matches = rankSongs(state.songs, query, { scope: "all", fuzzy: true, exactArtist: false });
    }

    const top = matches.slice(0, 8);
    for (const song of top) {
        const row = document.createElement("li");
        row.className = "night-search-row";

        const info = document.createElement("div");
        info.className = "night-search-info";
        const title = document.createElement("span");
        title.className = "night-search-title";
        title.textContent = getDisplaySongTitle(song);
        const sub = document.createElement("span");
        sub.className = "night-search-artist";
        const bits = [getDisplayArtist(song) || "Unknown artist"];
        const dur = formatNightDuration(song.seconds);
        if (dur) bits.push(dur);
        if (song.referenceKey) bits.push(`Key ${song.referenceKey}`);
        sub.textContent = bits.join(" · ");
        info.append(title, sub);

        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "command night-queue-btn";
        addBtn.textContent = nightState.selectedSinger ? `Queue for ${nightState.selectedSinger}` : "Queue";
        addBtn.addEventListener("click", () => {
            queueNightSong(song, { custom: false, singer: nightState.selectedSinger });
            input.value = "";
            list.replaceChildren();
            list.hidden = true;
            input.focus({ preventScroll: true });
        });

        row.append(info, addBtn);
        list.appendChild(row);
    }

    // Always offer a 1-click custom YouTube request for songs outside the venue catalog.
    const customRow = document.createElement("li");
    customRow.className = "night-search-row night-search-custom";
    const customInfo = document.createElement("div");
    customInfo.className = "night-search-info";
    const customTitle = document.createElement("span");
    customTitle.className = "night-search-title";
    customTitle.textContent = `Queue “${query}” as a custom YouTube song`;
    const customSub = document.createElement("span");
    customSub.className = "night-search-artist";
    customSub.textContent = "Not limited to the venue songbook — pulls straight from YouTube";
    customInfo.append(customTitle, customSub);

    const customBtn = document.createElement("button");
    customBtn.type = "button";
    customBtn.className = "command subtle-command";
    customBtn.textContent = "Add custom";
    customBtn.addEventListener("click", () => {
        const dashParts = query.split(/\s+[-–—]\s+/);
        const parsedArtist = dashParts.length >= 2 ? dashParts[0].trim() : "";
        const parsedTitle = dashParts.length >= 2 ? dashParts.slice(1).join(" - ").trim() : query;
        queueNightSong({ title: parsedTitle, artist: parsedArtist }, { custom: true, singer: nightState.selectedSinger });
        input.value = "";
        list.replaceChildren();
        list.hidden = true;
        input.focus({ preventScroll: true });
    });

    customRow.append(customInfo, customBtn);
    list.appendChild(customRow);
}

function bindKaraokeNight() {
    if (nightBound) return;
    nightBound = true;
    loadNightSession();

    nightEl("karaokeNightButton")?.addEventListener("click", openKaraokeNight);
    nightEl("hostNightFromSetlistButton")?.addEventListener("click", openKaraokeNight);
    nightEl("nightBackButton")?.addEventListener("click", closeKaraokeNight);
    nightEl("nightImportSetlistButton")?.addEventListener("click", importSetlistToNight);
    nightEl("nightPopoutStageButton")?.addEventListener("click", openTvStageWindow);
    nightEl("nightResetButton")?.addEventListener("click", resetKaraokeNight);

    nightEl("nightAddSingerForm")?.addEventListener("submit", (event) => {
        event.preventDefault();
        const input = nightEl("nightSingerInput");
        if (!input) return;
        addNightSinger(input.value);
        input.value = "";
        input.focus({ preventScroll: true });
    });

    nightEl("nightSongSearch")?.addEventListener("input", () => {
        window.clearTimeout(nightSearchTimer);
        nightSearchTimer = window.setTimeout(renderNightSearchMatches, 60);
    });

    nightEl("nightCustomSongForm")?.addEventListener("submit", (event) => {
        event.preventDefault();
        const titleInput = nightEl("nightCustomTitle");
        const artistInput = nightEl("nightCustomArtist");
        if (!titleInput?.value.trim()) return;
        queueNightSong(
            { title: titleInput.value, artist: artistInput?.value || "" },
            { custom: true, singer: nightState.selectedSinger }
        );
        titleInput.value = "";
        if (artistInput) artistInput.value = "";
        titleInput.focus({ preventScroll: true });
    });

    nightEl("nightPlayToggleButton")?.addEventListener("click", () => {
        const current = getNightCurrent();
        if (!current || !current.youtubeId) return;
        nightState.playing = !nightState.playing;
        nightLoadedFrameKey = "";
        saveNightSession();
        renderNightStage();
    });

    nightEl("nightNextSingerButton")?.addEventListener("click", advanceNightNext);
    nightEl("nightSkipSingerButton")?.addEventListener("click", skipAndPushBackCurrent);

    nightEl("nightTvOnlyAudio")?.addEventListener("change", (event) => {
        nightState.tvOnlyAudio = Boolean(event.target.checked);
        nightLoadedFrameKey = "";
        renderNightStage();
    });

    nightEl("nightYoutubeUrlForm")?.addEventListener("submit", (event) => {
        event.preventDefault();
        const input = nightEl("nightYoutubeUrlInput");
        if (!input) return;
        applyManualYoutubeUrl(input.value);
    });

    nightEl("nightAutoBalance")?.addEventListener("change", (event) => {
        nightState.autoBalance = Boolean(event.target.checked);
        if (nightState.autoBalance) {
            nightState.queue = rebalanceNightQueue(nightState.queue);
        }
        saveNightSession();
        renderKaraokeNight();
    });

    nightEl("nightRotateNowButton")?.addEventListener("click", () => {
        const previous = nightState.queue.map((item) => ({ ...item }));
        const next = rebalanceNightQueue(nightState.queue);
        const changed = next.some((item, idx) => item.uid !== previous[idx]?.uid);
        if (!changed) {
            showSnackbar("Queue is already evenly rotated");
            return;
        }
        nightState.queue = next;
        saveNightSession();
        renderNightQueue();
        showSnackbar("Balanced singer rotation", () => {
            nightState.queue = previous;
            saveNightSession();
            renderNightQueue();
        });
    });
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        normalizeSingerKey,
        cleanSingerName,
        extractNightYoutubeId,
        buildNightYoutubeSearchUrl,
        formatNightDuration,
        rebalanceNightQueue,
        insertIntoNightQueue,
        computeNightWaitMinutes,
    };
}
