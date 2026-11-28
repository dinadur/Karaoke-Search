// Live Multi-Phone Rooms for Karaoke Night:
// - Host controls: start/end live room, show QR & copy join link, auto-queue
//   into fair rotation by default (with toggle for Approve-first inbox), lock
//   requests, per-singer queue cap, and background polling/sync via /api/night-room.
// - Guest mode: scan QR (?room=CODE) or enter room code from the More menu,
//   set singer name once, search the 37k catalog or request custom YouTube songs,
//   browse the full songbook with 1-tap Request buttons, and watch live wait times.
// Loaded after karaoke-night.js and before karaoke_explorer.js.

const ROOM_HOST_STORAGE_KEY = "karaokeNightHostRoomV1";
const ROOM_GUEST_SINGER_KEY = "karaokeGuestSingerV1";
const ROOM_API_ENDPOINT = "/api/night-room";
const ROOM_HOST_POLL_MS = 3000;
const ROOM_GUEST_POLL_MS = 4000;

const hostRoomState = {
    code: "",
    hostToken: "",
    approvalRequired: false,
    locked: false,
    maxPerSinger: 0,
    declinedIds: [],
    pendingInbox: [],
    unconfigured: false,
    starting: false,
    error: "",
    lastSyncedAt: 0,
};

const hostRoomHandledIds = new Set();
const hostRoomQueuedAckIds = new Set();
let hostRoomPollTimer = 0;
let hostRoomSyncTimer = 0;
let hostRoomSyncInflight = false;
let hostRoomSyncQueued = false;
let hostRoomDirty = false;
let hostRoomSyncSeq = 0;

const guestRoomState = {
    code: "",
    pendingCode: "",
    singer: "",
    room: null,
    panelOpen: false,
    joining: false,
    submitting: false,
    error: "",
    statusMessage: "",
    myRequestIds: [],
    myRequestMeta: new Map(),
};

let guestRoomPollTimer = 0;
let guestRoomSearchTimer = 0;
let guestRoomBound = false;
let guestRoomLastFocused = null;

function roomEl(id) {
    return document.getElementById(id);
}

function normalizeClientRoomCode(raw) {
    const cleaned = String(raw || "")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");
    return cleaned.length >= 4 && cleaned.length <= 10 ? cleaned : "";
}

function buildRoomJoinUrl(code) {
    const cleanCode = normalizeClientRoomCode(code);
    if (!cleanCode) return "";
    const isLocalFileHost = /^(127\.0\.0\.1|localhost)$/i.test(window.location.hostname);
    const basePath = window.location.pathname === "/karaoke_explorer.html" && !isLocalFileHost
        ? "/"
        : window.location.pathname;
    return `${window.location.origin}${basePath}?room=${encodeURIComponent(cleanCode)}`;
}

function getActiveGuestRoomCode() {
    return guestRoomState.code || "";
}

function getGuestRoomUrlCode() {
    return guestRoomState.code || guestRoomState.pendingCode || "";
}

let hostRoomQrCacheUrl = "";
let hostRoomQrCacheMatrix = null;

function buildRoomQrMatrix(url) {
    if (!url || typeof window.qrcode !== "function") return null;
    if (hostRoomQrCacheUrl === url && hostRoomQrCacheMatrix) {
        return hostRoomQrCacheMatrix;
    }
    try {
        const qr = window.qrcode(0, "M");
        qr.addData(url);
        qr.make();
        const size = qr.getModuleCount();
        let bits = "";
        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                bits += qr.isDark(r, c) ? "1" : "0";
            }
        }
        hostRoomQrCacheUrl = url;
        hostRoomQrCacheMatrix = { size, bits };
        return hostRoomQrCacheMatrix;
    } catch {
        return null;
    }
}

function getHostRoomStageInfo() {
    if (!hostRoomState.code) return null;
    const joinUrl = buildRoomJoinUrl(hostRoomState.code);
    return {
        code: hostRoomState.code,
        joinUrl,
        locked: Boolean(hostRoomState.locked),
        qrMatrix: buildRoomQrMatrix(joinUrl),
    };
}

function loadHostRoomSession() {
    try {
        const stored = JSON.parse(localStorage.getItem(ROOM_HOST_STORAGE_KEY) || "null");
        if (!stored || typeof stored !== "object") return;
        const code = normalizeClientRoomCode(stored.code);
        const hostToken = typeof stored.hostToken === "string" ? stored.hostToken.trim() : "";
        if (!code || !hostToken) return;
        hostRoomState.code = code;
        hostRoomState.hostToken = hostToken;
        hostRoomState.approvalRequired = Boolean(stored.approvalRequired);
        hostRoomState.locked = Boolean(stored.locked);
        hostRoomState.maxPerSinger = Number(stored.maxPerSinger) > 0 ? Math.min(10, Math.floor(Number(stored.maxPerSinger))) : 0;
        hostRoomState.declinedIds = Array.isArray(stored.declinedIds) ? stored.declinedIds.slice(-100) : [];
    } catch {
        // Ignore corrupt stored room state.
    }
}

function saveHostRoomSession() {
    try {
        if (!hostRoomState.code || !hostRoomState.hostToken) {
            localStorage.removeItem(ROOM_HOST_STORAGE_KEY);
            return;
        }
        localStorage.setItem(ROOM_HOST_STORAGE_KEY, JSON.stringify({
            code: hostRoomState.code,
            hostToken: hostRoomState.hostToken,
            approvalRequired: hostRoomState.approvalRequired,
            locked: hostRoomState.locked,
            maxPerSinger: hostRoomState.maxPerSinger,
            declinedIds: hostRoomState.declinedIds.slice(-100),
        }));
    } catch {
        // Ignore storage errors.
    }
}

function buildHostRoomSnapshot() {
    const current = getNightCurrent();
    const waits = computeNightWaitMinutes(nightState.queue);
    const upNext = getNightQueued().slice(0, 100).map((item) => ({
        uid: item.uid,
        title: item.title,
        artist: item.artist,
        singer: item.singer || "Open mic",
        seconds: item.seconds || 0,
        waitMin: waits.get(item.uid) || 0,
        requestId: item.requestId || "",
    }));
    const sung = getNightSung();
    const recentSung = sung.slice(-25).map((item) => ({
        uid: item.uid,
        title: item.title,
        artist: item.artist,
        singer: item.singer || "Open mic",
        requestId: item.requestId || "",
    }));
    return {
        locked: Boolean(hostRoomState.locked),
        approvalRequired: Boolean(hostRoomState.approvalRequired),
        maxPerSinger: Number(hostRoomState.maxPerSinger) || 0,
        current: current
            ? {
                uid: current.uid,
                title: current.title,
                artist: current.artist,
                singer: current.singer || "Open mic",
                seconds: current.seconds || 0,
                playing: Boolean(nightState.playing && current.youtubeId),
                requestId: current.requestId || "",
            }
            : null,
        upNext,
        sungCount: sung.length,
        recentSung,
        declinedIds: hostRoomState.declinedIds.slice(-100),
    };
}

function stopHostRoomPolling() {
    if (hostRoomPollTimer) {
        window.clearInterval(hostRoomPollTimer);
        hostRoomPollTimer = 0;
    }
    if (hostRoomSyncTimer) {
        window.clearTimeout(hostRoomSyncTimer);
        hostRoomSyncTimer = 0;
    }
}

function markHostRoomDirty() {
    hostRoomDirty = true;
    hostRoomSyncSeq += 1;
}

function clearHostRoomLocalState() {
    stopHostRoomPolling();
    hostRoomState.code = "";
    hostRoomState.hostToken = "";
    hostRoomState.pendingInbox = [];
    hostRoomState.declinedIds = [];
    hostRoomState.error = "";
    hostRoomState.lastSyncedAt = 0;
    hostRoomDirty = false;
    hostRoomSyncSeq += 1;
    hostRoomHandledIds.clear();
    hostRoomQueuedAckIds.clear();
    saveHostRoomSession();
    broadcastStageState();
    renderHostRoomControls();
}

function startHostRoomPolling() {
    if (!hostRoomState.code || !nightState.active) return;
    if (hostRoomPollTimer) return;
    hostRoomPollTimer = window.setInterval(() => {
        if (!hostRoomState.code || !nightState.active) {
            stopHostRoomPolling();
            return;
        }
        if (document.visibilityState === "hidden") return;
        pollHostRoom();
    }, ROOM_HOST_POLL_MS);
}

function syncHostRoomLifecycle() {
    if (nightState.active && hostRoomState.code) {
        startHostRoomPolling();
        pollHostRoom();
        broadcastStageState();
    } else {
        stopHostRoomPolling();
    }
    renderHostRoomControls();
}

function scheduleHostRoomSync() {
    if (!hostRoomState.code || !hostRoomState.hostToken) return;
    markHostRoomDirty();
    if (hostRoomSyncTimer) window.clearTimeout(hostRoomSyncTimer);
    hostRoomSyncTimer = window.setTimeout(() => {
        hostRoomSyncTimer = 0;
        syncHostRoomNow({ markDirty: false });
    }, 250);
}

function ingestGuestRequestIntoNight(req) {
    if (!req || !req.title) return false;
    const singer = cleanSingerName(req.singer);
    if (singer) {
        const exists = nightState.singers.some((s) => normalizeSingerKey(s) === normalizeSingerKey(singer));
        if (!exists) nightState.singers.push(singer);
    }
    const catalogSong = req.songId && typeof getCatalogSong === "function"
        ? getCatalogSong({ id: req.songId })
        : null;
    const songLike = catalogSong || {
        id: req.songId || "",
        title: req.title,
        artist: req.artist || "",
        seconds: req.seconds || 0,
        bpm: req.bpm || null,
        referenceKey: req.referenceKey || null,
    };
    queueNightSong(songLike, {
        custom: Boolean(req.custom || !catalogSong),
        singer,
        requestId: req.id,
        silent: true,
    });
    return true;
}

function processHostInbox(pendingRequests) {
    const incoming = Array.isArray(pendingRequests) ? pendingRequests : [];
    const queuedRequestIds = new Set(
        nightState.queue.map((item) => item.requestId).filter(Boolean)
    );
    const declinedSet = new Set(hostRoomState.declinedIds);
    const fresh = [];
    let recoveredAcks = 0;

    for (const req of incoming) {
        if (!req || !req.id) continue;
        const alreadyHandled = hostRoomHandledIds.has(req.id) || queuedRequestIds.has(req.id) || declinedSet.has(req.id);
        if (alreadyHandled) {
            hostRoomHandledIds.add(req.id);
            if (!hostRoomQueuedAckIds.has(req.id)) {
                hostRoomQueuedAckIds.add(req.id);
                recoveredAcks += 1;
            }
        } else {
            fresh.push(req);
        }
    }

    if (!hostRoomState.approvalRequired) {
        if (hostRoomState.pendingInbox.length) {
            hostRoomState.pendingInbox = [];
        }
        if (fresh.length) {
            for (const req of fresh) {
                hostRoomHandledIds.add(req.id);
                hostRoomQueuedAckIds.add(req.id);
                ingestGuestRequestIntoNight(req);
            }
            if (fresh.length === 1) {
                showSnackbar(`Guest request queued: ${fresh[0].singer} — “${fresh[0].title}”`);
            } else {
                showSnackbar(`${fresh.length} guest requests added to the queue`);
            }
            syncHostRoomNow();
        } else if (recoveredAcks > 0) {
            syncHostRoomNow({ markDirty: false });
        }
        renderHostRoomControls();
        return;
    }

    hostRoomState.pendingInbox = fresh;
    if (recoveredAcks > 0) {
        syncHostRoomNow({ markDirty: false });
    }
    renderHostRoomControls();
}

async function startHostRoom() {
    if (hostRoomState.starting) return;
    hostRoomState.starting = true;
    hostRoomState.error = "";
    hostRoomState.unconfigured = false;
    renderHostRoomControls();

    try {
        const snapshot = buildHostRoomSnapshot();
        const res = await fetch(ROOM_API_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                action: "create",
                ...snapshot,
            }),
        });
        const data = await res.json();
        if (data.configured === false) {
            hostRoomState.unconfigured = true;
            hostRoomState.error = data.error || "Live rooms require Upstash Redis connected in Vercel Storage.";
            return;
        }
        if (!res.ok || !data.code || !data.hostToken) {
            hostRoomState.error = data.error || "Could not start live room right now.";
            return;
        }
        hostRoomState.code = data.code;
        hostRoomState.hostToken = data.hostToken;
        hostRoomState.pendingInbox = [];
        hostRoomState.declinedIds = [];
        hostRoomState.lastSyncedAt = Date.now();
        hostRoomDirty = false;
        hostRoomSyncSeq += 1;
        hostRoomHandledIds.clear();
        hostRoomQueuedAckIds.clear();
        saveHostRoomSession();
        broadcastStageState();
        startHostRoomPolling();
        showSnackbar(`Live room ${data.code} started — guests can scan the QR code to join`);
    } catch {
        hostRoomState.error = "Couldn’t reach the live room service. Check your connection and try again.";
    } finally {
        hostRoomState.starting = false;
        renderHostRoomControls();
    }
}

async function syncHostRoomNow({ markDirty = true } = {}) {
    if (!hostRoomState.code || !hostRoomState.hostToken) return;
    if (hostRoomSyncTimer) {
        window.clearTimeout(hostRoomSyncTimer);
        hostRoomSyncTimer = 0;
    }
    if (markDirty) {
        markHostRoomDirty();
    }
    if (hostRoomSyncInflight) {
        hostRoomSyncQueued = true;
        return;
    }
    hostRoomSyncInflight = true;
    const attemptSeq = hostRoomSyncSeq;
    const ackBatch = Array.from(hostRoomQueuedAckIds);
    const activeCode = hostRoomState.code;

    try {
        const snapshot = buildHostRoomSnapshot();
        const res = await fetch(ROOM_API_ENDPOINT, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Host-Token": hostRoomState.hostToken,
            },
            body: JSON.stringify({
                action: "sync",
                code: activeCode,
                ackedRequestIds: ackBatch,
                ...snapshot,
            }),
        });
        if (hostRoomState.code !== activeCode) return;
        if (res.status === 404) {
            clearHostRoomLocalState();
            showSnackbar("Live room expired — start a new room when ready");
            return;
        }
        const data = await res.json();
        if (data.configured === false) {
            hostRoomState.unconfigured = true;
            renderHostRoomControls();
            return;
        }
        if (!res.ok) {
            hostRoomDirty = true;
            hostRoomState.error = data.error || "Room sync paused — retrying automatically.";
            renderHostRoomControls();
            return;
        }
        for (const id of ackBatch) hostRoomQueuedAckIds.delete(id);
        if (hostRoomSyncSeq === attemptSeq && hostRoomQueuedAckIds.size === 0) {
            hostRoomDirty = false;
        }
        hostRoomState.error = "";
        hostRoomState.lastSyncedAt = Date.now();
        processHostInbox(data.room?.pendingRequests || []);
    } catch {
        hostRoomDirty = true;
        hostRoomState.error = "Connection hiccup — will retry sync shortly.";
        renderHostRoomControls();
    } finally {
        hostRoomSyncInflight = false;
        if (hostRoomSyncQueued && hostRoomState.code) {
            hostRoomSyncQueued = false;
            syncHostRoomNow({ markDirty: false });
        }
    }
}

async function pollHostRoom() {
    if (!hostRoomState.code || hostRoomSyncInflight) return;
    if (hostRoomDirty || hostRoomQueuedAckIds.size > 0) {
        return syncHostRoomNow({ markDirty: false });
    }
    const activeCode = hostRoomState.code;
    try {
        const res = await fetch(`${ROOM_API_ENDPOINT}?code=${encodeURIComponent(activeCode)}`, {
            cache: "no-store",
        });
        if (hostRoomState.code !== activeCode) return;
        if (res.status === 404) {
            clearHostRoomLocalState();
            showSnackbar("Live room expired — start a new room when ready");
            return;
        }
        const data = await res.json();
        if (data.configured === false) {
            hostRoomState.unconfigured = true;
            renderHostRoomControls();
            return;
        }
        if (!res.ok || !data.room) return;
        if (!hostRoomDirty) {
            hostRoomState.error = "";
        }
        processHostInbox(data.room.pendingRequests || []);
    } catch {
        // Keep silent during transient network drops; next poll retries.
    }
}

function approveGuestRequest(reqId) {
    const req = hostRoomState.pendingInbox.find((item) => item.id === reqId);
    if (!req) return;
    hostRoomHandledIds.add(req.id);
    hostRoomQueuedAckIds.add(req.id);
    hostRoomState.pendingInbox = hostRoomState.pendingInbox.filter((item) => item.id !== reqId);
    ingestGuestRequestIntoNight(req);
    showSnackbar(`Approved ${req.singer}’s request: “${req.title}”`);
    renderHostRoomControls();
    syncHostRoomNow();
}

function declineGuestRequest(reqId) {
    const req = hostRoomState.pendingInbox.find((item) => item.id === reqId);
    if (!req) return;
    hostRoomHandledIds.add(req.id);
    hostRoomQueuedAckIds.add(req.id);
    if (!hostRoomState.declinedIds.includes(req.id)) {
        hostRoomState.declinedIds.push(req.id);
    }
    hostRoomState.pendingInbox = hostRoomState.pendingInbox.filter((item) => item.id !== reqId);
    saveHostRoomSession();
    showSnackbar(`Declined ${req.singer}’s request`);
    renderHostRoomControls();
    syncHostRoomNow();
}

async function endHostRoom() {
    const code = hostRoomState.code;
    const token = hostRoomState.hostToken;
    clearHostRoomLocalState();
    showSnackbar("Live room ended");
    if (!code || !token) return;
    try {
        await fetch(ROOM_API_ENDPOINT, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Host-Token": token,
            },
            body: JSON.stringify({ action: "close", code }),
        });
    } catch {
        // Local room is already closed; Redis key expires automatically.
    }
}

function showHostRoomQr() {
    if (!hostRoomState.code) return;
    const url = buildRoomJoinUrl(hostRoomState.code);
    const dialog = roomEl("qrDialog");
    const title = roomEl("qrDialogTitle");
    const holder = roomEl("qrHolder");
    const caption = roomEl("qrCaption");
    if (!dialog || !holder || !caption) return;
    if (title) title.textContent = `Join room ${hostRoomState.code}`;
    holder.innerHTML = "";
    if (typeof window.qrcode === "function") {
        try {
            const qr = window.qrcode(0, "M");
            qr.addData(url);
            qr.make();
            holder.innerHTML = qr.createSvgTag({ scalable: true, margin: 2 });
        } catch {
            holder.textContent = url;
        }
    } else {
        holder.textContent = url;
    }
    caption.textContent = `Scan with any phone or enter code ${hostRoomState.code} to request songs.`;
    const restoreTitle = () => {
        if (title) title.textContent = "Scan to open";
        dialog.removeEventListener("close", restoreTitle);
    };
    dialog.addEventListener("close", restoreTitle);
    dialog.showModal();
}

async function copyHostRoomLink() {
    if (!hostRoomState.code) return;
    const url = buildRoomJoinUrl(hostRoomState.code);
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(url);
            showSnackbar(`Copied join link for room ${hostRoomState.code}`);
            return;
        }
    } catch {
        // Fallback below.
    }
    showSnackbar(`Join link: ${url}`);
}

function renderHostRoomControls() {
    const idleBox = roomEl("nightRoomIdle");
    const activeBox = roomEl("nightRoomActive");
    const codeEl = roomEl("nightRoomCode");
    const startBtn = roomEl("nightStartRoomButton");
    const approveToggle = roomEl("nightRoomApprovalToggle");
    const lockToggle = roomEl("nightRoomLockToggle");
    const limitSelect = roomEl("nightRoomLimitSelect");
    const statusEl = roomEl("nightRoomStatus");
    const inboxSection = roomEl("nightRoomInbox");
    const inboxCount = roomEl("nightRoomInboxCount");
    const inboxList = roomEl("nightRoomInboxList");

    if (!idleBox || !activeBox) return;

    const hasRoom = Boolean(hostRoomState.code);
    idleBox.hidden = hasRoom;
    activeBox.hidden = !hasRoom;

    if (startBtn) {
        startBtn.disabled = hostRoomState.starting;
        const label = startBtn.querySelector("span");
        if (label) label.textContent = hostRoomState.starting ? "Starting room…" : "Start live room";
    }
    if (codeEl) codeEl.textContent = hostRoomState.code;
    if (approveToggle) approveToggle.checked = hostRoomState.approvalRequired;
    if (lockToggle) lockToggle.checked = hostRoomState.locked;
    if (limitSelect) limitSelect.value = String(hostRoomState.maxPerSinger || 0);

    if (statusEl) {
        if (hostRoomState.unconfigured) {
            statusEl.hidden = false;
            statusEl.textContent = "Connect Upstash Redis in Vercel Dashboard → Storage → Create Database → Upstash Redis, then redeploy to enable multi-phone rooms.";
        } else if (hostRoomState.error) {
            statusEl.hidden = false;
            statusEl.textContent = hostRoomState.error;
        } else if (hasRoom && hostRoomState.locked) {
            statusEl.hidden = false;
            statusEl.textContent = "Guest requests are paused. Toggle off Lock requests when you’re ready for more.";
        } else {
            statusEl.hidden = true;
            statusEl.textContent = "";
        }
    }

    if (inboxSection && inboxList) {
        const pending = hostRoomState.pendingInbox;
        inboxSection.hidden = !hasRoom || !pending.length;
        if (inboxCount) inboxCount.textContent = String(pending.length);
        inboxList.replaceChildren();
        for (const req of pending) {
            const li = document.createElement("li");
            li.className = "night-inbox-item";

            const info = document.createElement("div");
            info.className = "night-inbox-info";
            const singerEl = document.createElement("span");
            singerEl.className = "night-inbox-singer";
            singerEl.textContent = req.singer || "Guest";
            const songEl = document.createElement("span");
            songEl.className = "night-inbox-song";
            songEl.textContent = `${req.title}${req.artist ? ` — ${req.artist}` : ""}`;
            info.append(singerEl, songEl);
            if (req.custom) {
                const badge = document.createElement("span");
                badge.className = "night-inbox-badge";
                badge.textContent = "YouTube";
                info.appendChild(badge);
            }

            const actions = document.createElement("div");
            actions.className = "night-inbox-actions";
            const approveBtn = document.createElement("button");
            approveBtn.type = "button";
            approveBtn.className = "command night-mini-btn";
            approveBtn.textContent = "Approve";
            approveBtn.addEventListener("click", () => approveGuestRequest(req.id));

            const declineBtn = document.createElement("button");
            declineBtn.type = "button";
            declineBtn.className = "command subtle-command night-mini-btn";
            declineBtn.textContent = "Decline";
            declineBtn.addEventListener("click", () => declineGuestRequest(req.id));

            actions.append(approveBtn, declineBtn);
            li.append(info, actions);
            inboxList.appendChild(li);
        }
    }
}

// ---------- Guest Room mode ----------

function loadGuestSingerName() {
    try {
        guestRoomState.singer = cleanSingerName(localStorage.getItem(ROOM_GUEST_SINGER_KEY) || "");
    } catch {
        guestRoomState.singer = "";
    }
}

function saveGuestSingerName(name) {
    const cleaned = cleanSingerName(name);
    guestRoomState.singer = cleaned;
    try {
        if (cleaned) localStorage.setItem(ROOM_GUEST_SINGER_KEY, cleaned);
        else localStorage.removeItem(ROOM_GUEST_SINGER_KEY);
    } catch {
        // Ignore storage errors.
    }
}

function isSongRequestedByGuest(song) {
    if (!guestRoomState.code || !guestRoomState.room || !guestRoomState.singer || !song) return false;
    const singerKey = normalizeSingerKey(guestRoomState.singer);
    const title = (typeof getDisplaySongTitle === "function" ? getDisplaySongTitle(song) : song.title || song.song || "").toLowerCase();
    const artist = (typeof getDisplayArtist === "function" ? getDisplayArtist(song) : song.artist || "").toLowerCase();
    const matchEntry = (entry) => (
        entry &&
        normalizeSingerKey(entry.singer) === singerKey &&
        String(entry.title || "").toLowerCase() === title &&
        String(entry.artist || "").toLowerCase() === artist
    );
    const upNext = guestRoomState.room.upNext || [];
    const pending = guestRoomState.room.pendingRequests || [];
    return upNext.some(matchEntry) || pending.some(matchEntry);
}

function stopGuestRoomPolling() {
    if (guestRoomPollTimer) {
        window.clearInterval(guestRoomPollTimer);
        guestRoomPollTimer = 0;
    }
}

function startGuestRoomPolling() {
    stopGuestRoomPolling();
    if (!guestRoomState.code) return;
    guestRoomPollTimer = window.setInterval(() => {
        if (!guestRoomState.code) {
            stopGuestRoomPolling();
            return;
        }
        if (document.visibilityState === "hidden") return;
        pollGuestRoom();
    }, ROOM_GUEST_POLL_MS);
}

async function pollGuestRoom() {
    if (!guestRoomState.code) return;
    const activeCode = guestRoomState.code;
    try {
        const res = await fetch(`${ROOM_API_ENDPOINT}?code=${encodeURIComponent(activeCode)}`, {
            cache: "no-store",
        });
        if (guestRoomState.code !== activeCode) return;
        if (res.status === 404) {
            guestRoomState.error = "This karaoke room has ended.";
            stopGuestRoomPolling();
            renderGuestRoom();
            return;
        }
        const data = await res.json();
        if (!res.ok || !data.room) return;
        guestRoomState.room = data.room;
        guestRoomState.error = "";
        renderGuestRoom();
        if (typeof syncAddButtons === "function") syncAddButtons();
    } catch {
        // Silent retry on next poll.
    }
}

async function joinGuestRoom(rawCode, { openPanel = true, updateUrl = true } = {}) {
    const code = normalizeClientRoomCode(rawCode);
    if (!code) {
        guestRoomState.error = "Enter a valid 6-character room code.";
        renderJoinDialogError(guestRoomState.error);
        return false;
    }

    guestRoomState.joining = true;
    guestRoomState.pendingCode = code;
    guestRoomState.error = "";
    renderJoinDialogError("");

    try {
        const res = await fetch(`${ROOM_API_ENDPOINT}?code=${encodeURIComponent(code)}`, {
            cache: "no-store",
        });
        const data = await res.json();
        if (data.configured === false) {
            guestRoomState.pendingCode = "";
            guestRoomState.error = data.error || "Live rooms are not configured on this server yet.";
            renderJoinDialogError(guestRoomState.error);
            if (openPanel && !roomEl("joinRoomDialog")?.open) {
                showSnackbar(guestRoomState.error);
            }
            if (typeof syncUrlState === "function") syncUrlState();
            return false;
        }
        if (!res.ok || !data.room) {
            guestRoomState.pendingCode = "";
            guestRoomState.error = data.error || `Room ${code} was not found or has ended.`;
            renderJoinDialogError(guestRoomState.error);
            if (openPanel && !roomEl("joinRoomDialog")?.open) {
                showSnackbar(guestRoomState.error);
            }
            if (typeof syncUrlState === "function") syncUrlState();
            return false;
        }

        guestRoomState.code = data.room.code;
        guestRoomState.pendingCode = "";
        guestRoomState.room = data.room;
        guestRoomState.error = "";
        guestRoomState.statusMessage = "";
        guestRoomState.myRequestIds = [];
        guestRoomState.myRequestMeta.clear();
        document.body.classList.add("guest-room-connected");
        startGuestRoomPolling();

        const joinDialog = roomEl("joinRoomDialog");
        if (joinDialog?.open) joinDialog.close();

        if (openPanel) {
            openGuestRoomPanel();
        } else {
            minimizeGuestRoomToSongbook();
        }

        if (updateUrl && typeof syncUrlState === "function") {
            syncUrlState();
        }
        if (typeof syncAddButtons === "function") syncAddButtons();
        return true;
    } catch {
        guestRoomState.pendingCode = "";
        guestRoomState.error = "Couldn’t connect to the karaoke room. Check your connection and try again.";
        renderJoinDialogError(guestRoomState.error);
        if (typeof syncUrlState === "function") syncUrlState();
        return false;
    } finally {
        guestRoomState.joining = false;
    }
}

function openGuestRoomPanel() {
    if (!guestRoomState.code) return;
    if (typeof closeKaraokeNight === "function" && nightState.active) {
        closeKaraokeNight();
    }
    const more = roomEl("moreTools");
    if (more) more.open = false;
    if (typeof closeSetlistDrawer === "function") closeSetlistDrawer({ restoreFocus: false });
    if (typeof closeFiltersSheet === "function") closeFiltersSheet({ restoreFocus: false });

    guestRoomState.panelOpen = true;
    document.body.classList.add("guest-room-active");
    const panel = roomEl("guestRoomPanel");
    if (panel) panel.hidden = false;
    renderGuestRoom();
    if (!guestRoomState.singer) {
        roomEl("guestSingerInput")?.focus?.({ preventScroll: true });
    } else {
        roomEl("guestRoomTitle")?.focus?.({ preventScroll: true });
    }
    window.scrollTo({ top: 0, behavior: "instant" });
}

function minimizeGuestRoomToSongbook() {
    guestRoomState.panelOpen = false;
    document.body.classList.remove("guest-room-active");
    const panel = roomEl("guestRoomPanel");
    if (panel) panel.hidden = true;
    renderGuestRoom();
    roomEl("searchInput")?.focus?.({ preventScroll: true });
}

function leaveGuestRoom() {
    stopGuestRoomPolling();
    guestRoomState.code = "";
    guestRoomState.pendingCode = "";
    guestRoomState.room = null;
    guestRoomState.panelOpen = false;
    guestRoomState.error = "";
    guestRoomState.statusMessage = "";
    guestRoomState.myRequestIds = [];
    guestRoomState.myRequestMeta.clear();
    document.body.classList.remove("guest-room-active", "guest-room-connected");
    const panel = roomEl("guestRoomPanel");
    const banner = roomEl("guestRoomBanner");
    if (panel) panel.hidden = true;
    if (banner) banner.hidden = true;
    if (typeof syncUrlState === "function") syncUrlState();
    if (typeof syncAddButtons === "function") syncAddButtons();
    showSnackbar("Left the live karaoke room");
    if (guestRoomLastFocused && document.contains(guestRoomLastFocused)) {
        guestRoomLastFocused.focus({ preventScroll: true });
    }
}

async function submitGuestSongRequest(songLike, { custom = false } = {}) {
    if (!guestRoomState.code) return false;
    if (!guestRoomState.singer) {
        openGuestRoomPanel();
        guestRoomState.statusMessage = "Enter your name above before requesting a song.";
        renderGuestRoom();
        roomEl("guestSingerInput")?.focus?.({ preventScroll: true });
        return false;
    }
    if (guestRoomState.submitting) return false;

    const title = custom
        ? String(songLike.title || "").trim()
        : (typeof getDisplaySongTitle === "function" ? getDisplaySongTitle(songLike) : String(songLike.title || songLike.song || "").trim());
    const artist = custom
        ? String(songLike.artist || "").trim()
        : (typeof getDisplayArtist === "function" ? getDisplayArtist(songLike) : String(songLike.artist || "").trim());
    if (!title) return false;

    guestRoomState.submitting = true;
    guestRoomState.statusMessage = "";
    renderGuestRoom();

    try {
        const res = await fetch(ROOM_API_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                action: "request",
                code: guestRoomState.code,
                singer: guestRoomState.singer,
                title,
                artist,
                songId: custom ? "" : (songLike.id || (typeof getSongIdentity === "function" ? getSongIdentity(songLike) : "")),
                seconds: Number(songLike.seconds) > 0 ? Number(songLike.seconds) : 0,
                bpm: Number(songLike.bpm) > 0 ? Number(songLike.bpm) : 0,
                referenceKey: typeof songLike.referenceKey === "string" ? songLike.referenceKey : "",
                custom: Boolean(custom),
            }),
        });
        const data = await res.json();
        if (res.status === 404) {
            guestRoomState.error = "This karaoke room has ended.";
            stopGuestRoomPolling();
            renderGuestRoom();
            showSnackbar(guestRoomState.error);
            return false;
        }
        if (!res.ok) {
            const msg = data.error || "Couldn’t send that request right now.";
            guestRoomState.statusMessage = msg;
            showSnackbar(msg);
            renderGuestRoom();
            return false;
        }
        if (data.request?.id) {
            guestRoomState.myRequestIds.push(data.request.id);
            guestRoomState.myRequestMeta.set(data.request.id, {
                title: data.request.title,
                artist: data.request.artist,
            });
        }
        if (data.room) {
            guestRoomState.room = data.room;
        }
        const approval = Boolean(guestRoomState.room?.approvalRequired);
        const confirmMsg = approval
            ? `Sent “${title}” for host approval`
            : `Requested “${title}” for ${guestRoomState.singer}`;
        guestRoomState.statusMessage = confirmMsg;
        showSnackbar(confirmMsg);
        renderGuestRoom();
        if (typeof syncAddButtons === "function") syncAddButtons();
        return true;
    } catch {
        const msg = "Network error sending request — please try again.";
        guestRoomState.statusMessage = msg;
        showSnackbar(msg);
        renderGuestRoom();
        return false;
    } finally {
        guestRoomState.submitting = false;
    }
}

function renderGuestSearchMatches() {
    const input = roomEl("guestSongSearch");
    const list = roomEl("guestSearchResults");
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

    for (const song of matches.slice(0, 8)) {
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
        sub.textContent = bits.join(" · ");
        info.append(title, sub);

        const requested = isSongRequestedByGuest(song);
        const reqBtn = document.createElement("button");
        reqBtn.type = "button";
        reqBtn.className = "command night-queue-btn";
        reqBtn.textContent = requested ? "Requested" : "Request";
        reqBtn.disabled = requested || Boolean(guestRoomState.room?.locked);
        reqBtn.addEventListener("click", async () => {
            const ok = await submitGuestSongRequest(song, { custom: false });
            if (ok) {
                input.value = "";
                list.replaceChildren();
                list.hidden = true;
            }
        });

        row.append(info, reqBtn);
        list.appendChild(row);
    }

    const customRow = document.createElement("li");
    customRow.className = "night-search-row night-search-custom";
    const customInfo = document.createElement("div");
    customInfo.className = "night-search-info";
    const customTitle = document.createElement("span");
    customTitle.className = "night-search-title";
    customTitle.textContent = `Request “${query}” as a custom YouTube song`;
    const customSub = document.createElement("span");
    customSub.className = "night-search-artist";
    customSub.textContent = state.songs.length
        ? "Not in the songbook? The host’s stage pulls it from YouTube"
        : "Songbook still loading — you can already request any song by title";
    customInfo.append(customTitle, customSub);

    const customBtn = document.createElement("button");
    customBtn.type = "button";
    customBtn.className = "command subtle-command";
    customBtn.textContent = "Request custom";
    customBtn.disabled = Boolean(guestRoomState.room?.locked);
    customBtn.addEventListener("click", async () => {
        const dashParts = query.split(/\s+[-–—]\s+/);
        const parsedArtist = dashParts.length >= 2 ? dashParts[0].trim() : "";
        const parsedTitle = dashParts.length >= 2 ? dashParts.slice(1).join(" - ").trim() : query;
        const ok = await submitGuestSongRequest({ title: parsedTitle, artist: parsedArtist }, { custom: true });
        if (ok) {
            input.value = "";
            list.replaceChildren();
            list.hidden = true;
        }
    });

    customRow.append(customInfo, customBtn);
    list.appendChild(customRow);
}

function renderGuestRoom() {
    const banner = roomEl("guestRoomBanner");
    const bannerText = roomEl("guestBannerText");
    const codeBadge = roomEl("guestRoomCodeBadge");
    const stateBadge = roomEl("guestRoomLiveBadge");
    const singerInput = roomEl("guestSingerInput");
    const statusEl = roomEl("guestRoomStatus");
    const nowBox = roomEl("guestNowPlaying");
    const mySpotsList = roomEl("guestMySpots");
    const queueList = roomEl("guestQueueList");

    const connected = Boolean(guestRoomState.code);
    const room = guestRoomState.room;

    if (banner) {
        banner.hidden = !connected || guestRoomState.panelOpen;
    }
    if (bannerText && connected) {
        const who = guestRoomState.singer ? `Singing as ${guestRoomState.singer}` : "Set your name to request";
        bannerText.textContent = `Live room ${guestRoomState.code} · ${who} · Tap Request on any song`;
    }

    if (!connected) return;

    if (codeBadge) codeBadge.textContent = `Room ${guestRoomState.code}`;
    if (stateBadge) {
        if (guestRoomState.error) {
            stateBadge.textContent = "Disconnected";
            stateBadge.className = "guest-state-pill is-ended";
        } else if (room?.locked) {
            stateBadge.textContent = "Requests paused";
            stateBadge.className = "guest-state-pill is-paused";
        } else {
            stateBadge.textContent = room?.approvalRequired ? "Host approves requests" : "Live · Auto-queue";
            stateBadge.className = "guest-state-pill";
        }
    }

    if (singerInput && document.activeElement !== singerInput) {
        singerInput.value = guestRoomState.singer;
    }

    if (statusEl) {
        const msg = guestRoomState.error || guestRoomState.statusMessage;
        statusEl.textContent = msg;
        statusEl.hidden = !msg;
    }

    if (nowBox) {
        if (room?.current) {
            nowBox.textContent = `Now on stage: ${room.current.singer || "Open mic"} — ${room.current.title}${room.current.artist ? ` (${room.current.artist})` : ""}`;
        } else {
            nowBox.textContent = "Stage is open — be the first to request a song!";
        }
    }

    const singerKey = normalizeSingerKey(guestRoomState.singer);
    const upNext = Array.isArray(room?.upNext) ? room.upNext : [];
    const pending = Array.isArray(room?.pendingRequests) ? room.pendingRequests : [];
    const declinedSet = new Set(Array.isArray(room?.declinedIds) ? room.declinedIds : []);

    if (mySpotsList) {
        mySpotsList.replaceChildren();
        const myItems = [];

        if (room?.current && singerKey && normalizeSingerKey(room.current.singer) === singerKey) {
            myItems.push({
                label: "On stage now!",
                title: room.current.title,
                artist: room.current.artist,
                tone: "is-live",
            });
        }

        upNext.forEach((item, idx) => {
            if ((singerKey && normalizeSingerKey(item.singer) === singerKey) || (item.requestId && guestRoomState.myRequestIds.includes(item.requestId))) {
                const waitText = item.waitMin > 0 ? ` · ~${item.waitMin} min` : "";
                myItems.push({
                    label: `#${idx + 1} in line${waitText}`,
                    title: item.title,
                    artist: item.artist,
                    tone: "is-queued",
                });
            }
        });

        for (const req of pending) {
            if ((singerKey && normalizeSingerKey(req.singer) === singerKey) || guestRoomState.myRequestIds.includes(req.id)) {
                myItems.push({
                    label: room?.approvalRequired ? "Waiting for host approval" : "Joining queue…",
                    title: req.title,
                    artist: req.artist,
                    tone: "is-pending",
                });
            }
        }

        for (const reqId of guestRoomState.myRequestIds) {
            if (declinedSet.has(reqId)) {
                const meta = guestRoomState.myRequestMeta.get(reqId);
                myItems.push({
                    label: "Declined by host",
                    title: meta?.title || "Song request",
                    artist: meta?.artist || "",
                    tone: "is-declined",
                });
            }
        }

        const mySection = roomEl("guestMySpotsSection");
        if (mySection) mySection.hidden = !myItems.length;
        for (const spot of myItems) {
            const li = document.createElement("li");
            li.className = `guest-spot-item ${spot.tone}`;
            const badge = document.createElement("span");
            badge.className = "guest-spot-badge";
            badge.textContent = spot.label;
            const song = document.createElement("span");
            song.className = "guest-spot-song";
            song.textContent = `${spot.title}${spot.artist ? ` — ${spot.artist}` : ""}`;
            li.append(badge, song);
            mySpotsList.appendChild(li);
        }
    }

    if (queueList) {
        queueList.replaceChildren();
        if (!upNext.length) {
            const empty = document.createElement("li");
            empty.className = "night-queue-empty";
            empty.textContent = "No songs waiting yet — request one above!";
            queueList.appendChild(empty);
        } else {
            upNext.forEach((item, idx) => {
                const li = document.createElement("li");
                const isMine = Boolean(
                    (singerKey && normalizeSingerKey(item.singer) === singerKey) ||
                    (item.requestId && guestRoomState.myRequestIds.includes(item.requestId))
                );
                li.className = `guest-queue-item${isMine ? " is-mine" : ""}`;

                const num = document.createElement("span");
                num.className = "night-queue-num";
                num.textContent = String(idx + 1);

                const body = document.createElement("div");
                body.className = "night-queue-body";
                const title = document.createElement("div");
                title.className = "night-queue-title";
                title.textContent = item.title;
                const sub = document.createElement("div");
                sub.className = "night-queue-sub";
                const parts = [item.singer || "Open mic"];
                if (item.artist) parts.push(item.artist);
                if (item.waitMin > 0) parts.push(`~${item.waitMin}m`);
                sub.textContent = parts.join(" · ");
                body.append(title, sub);

                li.append(num, body);
                queueList.appendChild(li);
            });
        }
    }
}

function renderJoinDialogError(msg) {
    const errEl = roomEl("joinRoomError");
    if (!errEl) return;
    errEl.textContent = msg || "";
    errEl.hidden = !msg;
}

function openJoinRoomDialog() {
    const more = roomEl("moreTools");
    if (more) more.open = false;
    guestRoomLastFocused = roomEl("moreToolsButton");
    if (guestRoomState.code) {
        openGuestRoomPanel();
        return;
    }
    const dialog = roomEl("joinRoomDialog");
    const input = roomEl("joinRoomCodeInput");
    renderJoinDialogError("");
    if (input) input.value = "";
    dialog?.showModal?.();
    input?.focus?.();
}

function bindNightRooms() {
    if (guestRoomBound) return;
    guestRoomBound = true;

    loadHostRoomSession();
    loadGuestSingerName();

    // Host room buttons & toggles
    roomEl("nightStartRoomButton")?.addEventListener("click", startHostRoom);
    roomEl("nightRoomQrButton")?.addEventListener("click", showHostRoomQr);
    roomEl("nightRoomCopyButton")?.addEventListener("click", copyHostRoomLink);
    roomEl("nightEndRoomButton")?.addEventListener("click", endHostRoom);

    roomEl("nightRoomApprovalToggle")?.addEventListener("change", (event) => {
        hostRoomState.approvalRequired = Boolean(event.target.checked);
        saveHostRoomSession();
        if (!hostRoomState.approvalRequired && hostRoomState.pendingInbox.length) {
            processHostInbox(hostRoomState.pendingInbox);
        } else {
            syncHostRoomNow();
        }
        renderHostRoomControls();
    });

    roomEl("nightRoomLockToggle")?.addEventListener("change", (event) => {
        hostRoomState.locked = Boolean(event.target.checked);
        saveHostRoomSession();
        broadcastStageState();
        syncHostRoomNow();
        renderHostRoomControls();
    });

    roomEl("nightRoomLimitSelect")?.addEventListener("change", (event) => {
        hostRoomState.maxPerSinger = Math.max(0, Math.min(10, Number(event.target.value) || 0));
        saveHostRoomSession();
        syncHostRoomNow();
        renderHostRoomControls();
    });

    // Guest room buttons & forms
    roomEl("joinRoomMenuButton")?.addEventListener("click", openJoinRoomDialog);
    roomEl("joinRoomForm")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const code = roomEl("joinRoomCodeInput")?.value || "";
        await joinGuestRoom(code, { openPanel: true, updateUrl: true });
    });

    roomEl("guestBrowseCatalogButton")?.addEventListener("click", minimizeGuestRoomToSongbook);
    roomEl("guestLeaveRoomButton")?.addEventListener("click", leaveGuestRoom);
    roomEl("guestBannerOpenButton")?.addEventListener("click", openGuestRoomPanel);
    roomEl("guestBannerLeaveButton")?.addEventListener("click", leaveGuestRoom);

    roomEl("guestSingerForm")?.addEventListener("submit", (event) => {
        event.preventDefault();
        const input = roomEl("guestSingerInput");
        if (!input) return;
        saveGuestSingerName(input.value);
        renderGuestRoom();
        if (typeof syncAddButtons === "function") syncAddButtons();
        if (guestRoomState.singer) {
            showSnackbar(`Singing as ${guestRoomState.singer}`);
            roomEl("guestSongSearch")?.focus?.({ preventScroll: true });
        }
    });

    roomEl("guestSingerInput")?.addEventListener("input", (event) => {
        saveGuestSingerName(event.target.value);
        const bannerText = roomEl("guestBannerText");
        if (bannerText && guestRoomState.code) {
            const who = guestRoomState.singer ? `Singing as ${guestRoomState.singer}` : "Set your name to request";
            bannerText.textContent = `Live room ${guestRoomState.code} · ${who} · Tap Request on any song`;
        }
    });

    roomEl("guestSingerInput")?.addEventListener("change", (event) => {
        saveGuestSingerName(event.target.value);
        renderGuestRoom();
        if (typeof syncAddButtons === "function") syncAddButtons();
    });

    roomEl("guestSongSearch")?.addEventListener("input", () => {
        window.clearTimeout(guestRoomSearchTimer);
        guestRoomSearchTimer = window.setTimeout(renderGuestSearchMatches, 60);
    });

    roomEl("guestCustomSongForm")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const titleInput = roomEl("guestCustomTitle");
        const artistInput = roomEl("guestCustomArtist");
        if (!titleInput?.value.trim()) return;
        const ok = await submitGuestSongRequest(
            { title: titleInput.value, artist: artistInput?.value || "" },
            { custom: true }
        );
        if (ok) {
            titleInput.value = "";
            if (artistInput) artistInput.value = "";
        }
    });

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible") return;
        if (hostRoomState.code && nightState.active) pollHostRoom();
        if (guestRoomState.code) pollGuestRoom();
    });

    renderHostRoomControls();

    // Auto-join if opened via a ?room=CODE QR link
    try {
        const roomParam = new URLSearchParams(window.location.search).get("room");
        if (roomParam) {
            joinGuestRoom(roomParam, { openPanel: true, updateUrl: false });
        }
    } catch {
        // Ignore malformed URL query.
    }
}
