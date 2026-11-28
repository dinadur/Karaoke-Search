// Passwordless Google Sign-In & Cross-Device Cloud Sync client.
// - Lazily loads Google Identity Services ONLY when the user opens Account & Sync.
// - Merges saved songs (with notes/keys/comfort + tombstones), current setlist,
//   named saved setlists, theme, compact view, and default singer name across devices.
// - Works 100% local-first & offline; syncs automatically when signed in and retries
//   on 409 conflicts or reconnection.
// Loaded after night-room.js and before karaoke_explorer.js; also exports
// mergeAccountData for Node unit tests.

const ACCOUNT_API_ENDPOINT = "/api/account";
const ACCOUNT_META_STORAGE_KEY = "karaokeAccountMetaV1";
const ACCOUNT_SYNC_DEBOUNCE_MS = 1200;
const ACCOUNT_TOMBSTONE_TTL_MS = 1000 * 60 * 60 * 24 * 90; // 90 days

const accountState = {
    configured: false,
    googleConfigured: false,
    storageConfigured: false,
    googleClientId: "",
    signedIn: false,
    user: null,
    revision: 0,
    lastSyncedAt: 0,
    syncing: false,
    dirty: false,
    error: "",
    statusText: "",
};

let accountSyncTimer = 0;
let accountSyncInflight = false;
let accountSyncQueued = false;
let accountSyncPromise = null;
let accountDeleteInflight = false;
let accountApplyingRemote = false;
let accountBound = false;
let accountGsiPromise = null;
let accountGsiRenderedClientId = "";
let accountSessionChecked = false;

function accountEl(id) {
    return document.getElementById(id);
}

function normalizeAccountSetlistName(name) {
    if (typeof normalize === "function") return normalize(name);
    const raw = String(name || "");
    const folded = /[^\x00-\x7f]/.test(raw)
        ? raw.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        : raw.toLowerCase();
    return folded
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function readAccountMeta() {
    try {
        const parsed = JSON.parse(localStorage.getItem(ACCOUNT_META_STORAGE_KEY) || "null");
        if (parsed && typeof parsed === "object") {
            return {
                repertoireTombstones: parsed.repertoireTombstones && typeof parsed.repertoireTombstones === "object"
                    ? parsed.repertoireTombstones
                    : {},
                savedSetlistTombstones: parsed.savedSetlistTombstones && typeof parsed.savedSetlistTombstones === "object"
                    ? parsed.savedSetlistTombstones
                    : {},
                setlistUpdatedAt: Number(parsed.setlistUpdatedAt) || 0,
                prefsUpdatedAt: Number(parsed.prefsUpdatedAt) || 0,
                pendingLogout: Boolean(parsed.pendingLogout),
            };
        }
    } catch {
        // Ignore corrupt local sync metadata.
    }
    return {
        repertoireTombstones: {},
        savedSetlistTombstones: {},
        setlistUpdatedAt: 0,
        prefsUpdatedAt: 0,
        pendingLogout: false,
    };
}

function writeAccountMeta(meta) {
    try {
        localStorage.setItem(ACCOUNT_META_STORAGE_KEY, JSON.stringify(meta));
    } catch {
        // Ignore storage quota errors.
    }
}

function pruneAccountTombstones(map, nowMs = Date.now()) {
    const cutoff = nowMs - ACCOUNT_TOMBSTONE_TTL_MS;
    const out = {};
    for (const [key, ts] of Object.entries(map || {})) {
        const n = Number(ts);
        if (Number.isFinite(n) && n > cutoff) out[key] = Math.floor(n);
    }
    return out;
}

function entryRichnessScore(entry) {
    if (!entry) return 0;
    let score = 0;
    if (entry.notes) score += 4;
    if (entry.key) score += 2;
    if (entry.comfort) score += 2;
    if (entry.status && entry.status !== "saved") score += 1;
    return score;
}

function mergeAccountData(localRaw, remoteRaw, { isInitialSignIn = false, nowMs = Date.now() } = {}) {
    const local = localRaw || {};
    const remote = remoteRaw || {};

    // 1. Saved songs (repertoire) + tombstones (per-song LWW)
    const localRep = local.repertoire && typeof local.repertoire === "object" ? local.repertoire : {};
    const remoteRep = remote.repertoire && typeof remote.repertoire === "object" ? remote.repertoire : {};
    const localRepTombs = local.repertoireTombstones || {};
    const remoteRepTombs = remote.repertoireTombstones || {};

    const mergedRep = {};
    const mergedRepTombs = {};
    const allSongIds = new Set([
        ...Object.keys(localRep),
        ...Object.keys(remoteRep),
        ...Object.keys(localRepTombs),
        ...Object.keys(remoteRepTombs),
    ]);

    for (const id of allSongIds) {
        const lEntry = localRep[id] || null;
        const rEntry = remoteRep[id] || null;
        const lTs = lEntry ? (Number(lEntry.updatedAt) || 0) : 0;
        const rTs = rEntry ? (Number(rEntry.updatedAt) || 0) : 0;
        const lDel = Number(localRepTombs[id]) || 0;
        const rDel = Number(remoteRepTombs[id]) || 0;
        const maxDel = Math.max(lDel, rDel);
        const maxLive = Math.max(lTs, rTs);

        if (maxDel > 0 && maxDel > maxLive) {
            mergedRepTombs[id] = maxDel;
            continue;
        }
        if (lEntry && rEntry) {
            if (lTs > rTs) {
                mergedRep[id] = lEntry;
            } else if (rTs > lTs) {
                mergedRep[id] = rEntry;
            } else {
                mergedRep[id] = entryRichnessScore(lEntry) > entryRichnessScore(rEntry) ? lEntry : rEntry;
            }
        } else if (lEntry) {
            mergedRep[id] = lEntry;
        } else if (rEntry) {
            mergedRep[id] = rEntry;
        }
    }

    // 2. Named saved setlists + tombstones (per-name LWW)
    const localListsByKey = new Map();
    for (const item of Array.isArray(local.savedSetlists) ? local.savedSetlists : []) {
        const key = normalizeAccountSetlistName(item?.name);
        if (key) localListsByKey.set(key, item);
    }
    const remoteListsByKey = new Map();
    for (const item of Array.isArray(remote.savedSetlists) ? remote.savedSetlists : []) {
        const key = normalizeAccountSetlistName(item?.name);
        if (key) remoteListsByKey.set(key, item);
    }
    const localListTombs = local.savedSetlistTombstones || {};
    const remoteListTombs = remote.savedSetlistTombstones || {};

    const mergedSavedSetlists = [];
    const mergedListTombs = {};
    const allListKeys = new Set([
        ...localListsByKey.keys(),
        ...remoteListsByKey.keys(),
        ...Object.keys(localListTombs),
        ...Object.keys(remoteListTombs),
    ]);

    for (const key of allListKeys) {
        const lList = localListsByKey.get(key) || null;
        const rList = remoteListsByKey.get(key) || null;
        const lTs = lList ? (Number(lList.updatedAt) || 0) : 0;
        const rTs = rList ? (Number(rList.updatedAt) || 0) : 0;
        const maxDel = Math.max(Number(localListTombs[key]) || 0, Number(remoteListTombs[key]) || 0);
        const maxLive = Math.max(lTs, rTs);

        if (maxDel > 0 && maxDel > maxLive) {
            mergedListTombs[key] = maxDel;
            continue;
        }
        if (lList && rList) {
            mergedSavedSetlists.push(lTs > rTs ? lList : rList);
        } else if (lList) {
            mergedSavedSetlists.push(lList);
        } else if (rList) {
            mergedSavedSetlists.push(rList);
        }
    }
    mergedSavedSetlists.sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));

    // 3. Current setlist
    const localSetlist = Array.isArray(local.setlist) ? local.setlist : [];
    const remoteSetlist = Array.isArray(remote.setlist) ? remote.setlist : [];
    const localSetTs = Number(local.setlistUpdatedAt) || 0;
    const remoteSetTs = Number(remote.setlistUpdatedAt) || 0;
    let mergedSetlist;
    let mergedSetlistTs = Math.max(localSetTs, remoteSetTs);

    if (isInitialSignIn) {
        if (!remoteSetlist.length) {
            mergedSetlist = localSetlist;
        } else if (!localSetlist.length) {
            mergedSetlist = remoteSetlist;
        } else {
            const seen = new Set(remoteSetlist.map((s) => s.id || `${s.song}||${s.artist}`));
            mergedSetlist = [...remoteSetlist];
            for (const s of localSetlist) {
                const key = s.id || `${s.song}||${s.artist}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    mergedSetlist.push(s);
                }
            }
            mergedSetlistTs = Math.max(mergedSetlistTs, nowMs);
        }
    } else if (localSetTs > remoteSetTs) {
        mergedSetlist = localSetlist;
    } else if (remoteSetTs > localSetTs) {
        mergedSetlist = remoteSetlist;
    } else {
        mergedSetlist = remoteSetlist.length ? remoteSetlist : localSetlist;
    }

    // 4. Preferences (theme, compactView, singerName)
    const lPrefs = local.preferences || {};
    const rPrefs = remote.preferences || {};
    const lPrefTs = Number(lPrefs.updatedAt) || 0;
    const rPrefTs = Number(rPrefs.updatedAt) || 0;
    const preferRemote = isInitialSignIn ? (rPrefTs > 0 || !lPrefTs) : (rPrefTs >= lPrefTs);
    const primary = preferRemote ? rPrefs : lPrefs;
    const fallback = preferRemote ? lPrefs : rPrefs;
    const primaryHasTimestamp = preferRemote ? rPrefTs > 0 : lPrefTs > 0;
    const mergedPrefs = {
        theme: primary.theme || fallback.theme || "",
        compactView: typeof primary.compactView === "boolean"
            ? primary.compactView
            : (typeof fallback.compactView === "boolean" ? fallback.compactView : null),
        singerName: primaryHasTimestamp && typeof primary.singerName === "string"
            ? primary.singerName
            : (primary.singerName || fallback.singerName || ""),
        updatedAt: Math.max(lPrefTs, rPrefTs),
    };

    return {
        repertoire: mergedRep,
        repertoireTombstones: pruneAccountTombstones(mergedRepTombs, nowMs),
        setlist: mergedSetlist,
        setlistUpdatedAt: mergedSetlistTs,
        savedSetlists: mergedSavedSetlists,
        savedSetlistTombstones: pruneAccountTombstones(mergedListTombs, nowMs),
        preferences: mergedPrefs,
    };
}

function collectLocalAccountData() {
    const meta = readAccountMeta();
    let storedTheme = "";
    let storedCompact = null;
    let storedSinger = "";
    try {
        const rawTheme = localStorage.getItem(THEME_STORAGE_KEY);
        if (rawTheme === "dark" || rawTheme === "light") storedTheme = rawTheme;
        const rawCompact = localStorage.getItem(COMPACT_VIEW_STORAGE_KEY);
        if (rawCompact === "1") storedCompact = true;
        else if (rawCompact === "0") storedCompact = false;
        storedSinger = String(localStorage.getItem(ROOM_GUEST_SINGER_KEY) || "").trim().slice(0, 40);
    } catch {
        // Ignore storage read errors.
    }

    const repSnapshot = typeof repertoire === "object" && repertoire ? { ...repertoire } : {};
    const savedLists = typeof readSavedSetlists === "function" ? readSavedSetlists() : [];
    const currentSetlist = typeof state === "object" && Array.isArray(state.setlist)
        ? state.setlist.map((song) => toSetlistEntry(song))
        : [];

    return {
        repertoire: repSnapshot,
        repertoireTombstones: pruneAccountTombstones(meta.repertoireTombstones),
        setlist: currentSetlist,
        setlistUpdatedAt: meta.setlistUpdatedAt,
        savedSetlists: savedLists,
        savedSetlistTombstones: pruneAccountTombstones(meta.savedSetlistTombstones),
        preferences: {
            theme: storedTheme,
            compactView: storedCompact,
            singerName: storedSinger,
            updatedAt: meta.prefsUpdatedAt,
        },
    };
}

function applyMergedAccountDataLocally(merged) {
    accountApplyingRemote = true;
    try {
        writeAccountMeta({
            repertoireTombstones: merged.repertoireTombstones || {},
            savedSetlistTombstones: merged.savedSetlistTombstones || {},
            setlistUpdatedAt: merged.setlistUpdatedAt || 0,
            prefsUpdatedAt: merged.preferences?.updatedAt || 0,
            pendingLogout: false,
        });

        // 1. Saved songs (repertoire)
        if (typeof persistRepertoire === "function" && typeof sanitizeRepertoireMap === "function") {
            const cleanRep = sanitizeRepertoireMap(merged.repertoire) || {};
            persistRepertoire(cleanRep);
            if (accountEl("repertoireDialog")?.open && typeof renderRepertoire === "function") {
                renderRepertoire();
            }
        }

        // 2. Current setlist (skip saveSetlist on no-op refreshes so pending Undo stays intact)
        if (typeof state === "object" && Array.isArray(merged.setlist)) {
            const nextSetlist = merged.setlist.map((song) => toSetlistEntry(song));
            const currentCompact = Array.isArray(state.setlist)
                ? state.setlist.map((song) => toSetlistEntry(song))
                : [];
            if (JSON.stringify(nextSetlist) !== JSON.stringify(currentCompact)) {
                state.setlist = nextSetlist;
                if (typeof saveSetlist === "function") saveSetlist();
                if (typeof renderSetlist === "function") renderSetlist();
                if (typeof syncAddButtons === "function") syncAddButtons();
            }
        }

        // 3. Named saved setlists
        if (typeof writeSavedSetlists === "function" && Array.isArray(merged.savedSetlists)) {
            writeSavedSetlists(merged.savedSetlists);
            if (accountEl("savedSetlistsDialog")?.open && typeof renderSavedSetlists === "function") {
                renderSavedSetlists();
            }
        }

        // 4. Preferences
        const prefs = merged.preferences || {};
        if (prefs.theme === "dark" || prefs.theme === "light") {
            try { localStorage.setItem(THEME_STORAGE_KEY, prefs.theme); } catch { /* ignore */ }
            document.documentElement.dataset.theme = prefs.theme;
            if (typeof renderThemeButton === "function") renderThemeButton();
        }
        if (typeof prefs.compactView === "boolean") {
            try { localStorage.setItem(COMPACT_VIEW_STORAGE_KEY, prefs.compactView ? "1" : "0"); } catch { /* ignore */ }
            if (typeof applyStoredCompactView === "function") applyStoredCompactView();
        }
        if (typeof prefs.singerName === "string" && (prefs.updatedAt > 0 || prefs.singerName) && typeof saveGuestSingerName === "function") {
            saveGuestSingerName(prefs.singerName);
            if (typeof renderGuestRoom === "function") renderGuestRoom();
        }
    } finally {
        accountApplyingRemote = false;
    }
}

function accountNotifyLocalChange(kind, details = {}) {
    if (accountApplyingRemote) return;
    const nowMs = Date.now();
    const meta = readAccountMeta();
    let metaChanged = false;

    if (kind === "repertoire") {
        for (const id of details.addedOrUpdatedIds || []) {
            if (meta.repertoireTombstones[id]) {
                delete meta.repertoireTombstones[id];
                metaChanged = true;
            }
        }
        for (const id of details.removedIds || []) {
            meta.repertoireTombstones[id] = nowMs;
            metaChanged = true;
        }
    } else if (kind === "setlist") {
        meta.setlistUpdatedAt = nowMs;
        metaChanged = true;
    } else if (kind === "savedSetlists") {
        for (const name of details.addedOrUpdatedNames || []) {
            const key = normalizeAccountSetlistName(name);
            if (key && meta.savedSetlistTombstones[key]) {
                delete meta.savedSetlistTombstones[key];
                metaChanged = true;
            }
        }
        for (const name of details.removedNames || []) {
            const key = normalizeAccountSetlistName(name);
            if (key) {
                meta.savedSetlistTombstones[key] = nowMs;
                metaChanged = true;
            }
        }
    } else if (kind === "preferences") {
        meta.prefsUpdatedAt = nowMs;
        metaChanged = true;
    }

    if (metaChanged) writeAccountMeta(meta);
    if (!accountState.signedIn) return;
    accountState.dirty = true;
    scheduleAccountSync();
}

function scheduleAccountSync() {
    if (!accountState.signedIn || accountDeleteInflight) return;
    if (accountSyncTimer) window.clearTimeout(accountSyncTimer);
    accountSyncTimer = window.setTimeout(() => {
        accountSyncTimer = 0;
        syncAccountNow();
    }, ACCOUNT_SYNC_DEBOUNCE_MS);
}

async function syncAccountNow({ allowConflictRetry = true } = {}) {
    if (!accountState.signedIn || accountDeleteInflight) return false;
    if (accountSyncTimer) {
        window.clearTimeout(accountSyncTimer);
        accountSyncTimer = 0;
    }
    if (accountSyncInflight) {
        accountSyncQueued = true;
        return false;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
        accountState.statusText = "Offline — your changes will sync automatically when you’re back online.";
        renderAccountUi();
        return false;
    }

    accountSyncInflight = true;
    accountState.syncing = true;
    accountState.error = "";
    renderAccountUi();

    const run = (async () => {
        try {
            const localData = collectLocalAccountData();
            const res = await fetch(ACCOUNT_API_ENDPOINT, {
                method: "POST",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "save",
                    expectedRevision: accountState.revision,
                    data: localData,
                }),
            });
            const data = await res.json();
            if (accountDeleteInflight) return false;
            if (res.status === 401) {
                accountState.signedIn = false;
                accountState.user = null;
                accountState.error = "Your session expired — sign in again to resume syncing.";
                renderAccountUi();
                return false;
            }
            if (res.status === 409 && data.conflict) {
                const serverRecord = data.record;
                accountState.revision = Number(serverRecord?.revision) || 0;
                if (serverRecord?.data) {
                    const merged = mergeAccountData(collectLocalAccountData(), serverRecord.data, { isInitialSignIn: false });
                    applyMergedAccountDataLocally(merged);
                }
                accountSyncInflight = false;
                accountState.syncing = false;
                if (allowConflictRetry && !accountDeleteInflight) {
                    return syncAccountNow({ allowConflictRetry: false });
                }
                accountState.dirty = true;
                accountState.error = "Another device updated at the same moment — click Sync now to retry.";
                renderAccountUi();
                return false;
            }
            if (!res.ok) {
                accountState.dirty = true;
                accountState.error = data.error || "Sync paused — will retry automatically.";
                renderAccountUi();
                return false;
            }

            accountState.revision = Number(data.revision) || (accountState.revision + 1);
            accountState.lastSyncedAt = Number(data.updatedAt) || Date.now();
            accountState.dirty = false;
            accountState.error = "";
            accountState.statusText = "Synced to your account.";
            renderAccountUi();
            return true;
        } catch {
            if (!accountDeleteInflight) {
                accountState.dirty = true;
                accountState.error = "Couldn’t reach sync service — will retry automatically.";
                renderAccountUi();
            }
            return false;
        } finally {
            accountSyncInflight = false;
            accountState.syncing = false;
            renderAccountUi();
            if (accountSyncQueued && accountState.signedIn && !accountDeleteInflight) {
                accountSyncQueued = false;
                syncAccountNow();
            }
        }
    })();

    accountSyncPromise = run;
    try {
        return await run;
    } finally {
        if (accountSyncPromise === run) accountSyncPromise = null;
    }
}

async function fetchAccountSession({ mergeRemote = true } = {}) {
    try {
        const meta = readAccountMeta();
        if (meta.pendingLogout) {
            const logoutRes = await fetch(ACCOUNT_API_ENDPOINT, {
                method: "POST",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "logout" }),
            });
            if (!logoutRes.ok) {
                accountState.signedIn = false;
                accountState.user = null;
                accountState.revision = 0;
                accountState.statusText = "Signed out locally — server sign-out will finish when back online.";
                renderAccountUi();
                return;
            }
            meta.pendingLogout = false;
            writeAccountMeta(meta);
        }

        const res = await fetch(ACCOUNT_API_ENDPOINT, {
            cache: "no-store",
            credentials: "same-origin",
        });
        if (!res.ok) return;
        const data = await res.json();
        accountSessionChecked = true;
        accountState.configured = Boolean(data.configured);
        accountState.googleConfigured = Boolean(data.googleConfigured ?? data.configured);
        accountState.storageConfigured = Boolean(data.storageConfigured ?? data.configured);
        accountState.googleClientId = String(data.googleClientId || "");
        accountState.signedIn = Boolean(data.signedIn && data.user);
        accountState.user = data.user || null;

        if (accountState.signedIn && mergeRemote) {
            const remoteRecord = data.record || null;
            accountState.revision = Number(remoteRecord?.revision) || 0;
            const localData = collectLocalAccountData();
            if (remoteRecord?.data) {
                const merged = mergeAccountData(localData, remoteRecord.data, { isInitialSignIn: false });
                applyMergedAccountDataLocally(merged);
                accountState.lastSyncedAt = Number(remoteRecord.updatedAt) || Date.now();
                // Push back if local had additions/changes absent from remote.
                if (JSON.stringify(merged) !== JSON.stringify(remoteRecord.data)) {
                    accountState.dirty = true;
                    scheduleAccountSync();
                }
            } else {
                const hasLocal = Object.keys(localData.repertoire).length > 0
                    || localData.setlist.length > 0
                    || localData.savedSetlists.length > 0;
                if (hasLocal) {
                    accountState.dirty = true;
                    scheduleAccountSync();
                }
            }
        }
        renderAccountUi();
    } catch {
        // Stay quiet when offline or running against a static server without /api/account.
    }
}

async function handleGoogleCredentialResponse(response) {
    const credential = response?.credential;
    if (!credential) return;
    accountState.error = "";
    accountState.statusText = "Signing in…";
    renderAccountUi();

    try {
        const res = await fetch(ACCOUNT_API_ENDPOINT, {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "google-login", credential }),
        });
        const data = await res.json();
        if (!res.ok || !data.signedIn) {
            accountState.error = data.error || "Sign-in failed. Please try again.";
            accountState.statusText = "";
            renderAccountUi();
            return;
        }

        const meta = readAccountMeta();
        if (meta.pendingLogout) {
            meta.pendingLogout = false;
            writeAccountMeta(meta);
        }
        accountSessionChecked = true;
        accountState.signedIn = true;
        accountState.user = data.user;
        const remoteRecord = data.record || null;
        accountState.revision = Number(remoteRecord?.revision) || 0;

        const localData = collectLocalAccountData();
        const merged = remoteRecord?.data
            ? mergeAccountData(localData, remoteRecord.data, { isInitialSignIn: true })
            : localData;
        applyMergedAccountDataLocally(merged);
        accountState.dirty = true;
        renderAccountUi();
        await syncAccountNow();
        showSnackbar(`Signed in as ${data.user.name} — synced across devices`);
    } catch {
        accountState.error = "Couldn’t complete sign-in. Check your connection and try again.";
        accountState.statusText = "";
        renderAccountUi();
    }
}

function loadGoogleIdentityScript() {
    if (window.google?.accounts?.id) return Promise.resolve();
    if (accountGsiPromise) return accountGsiPromise;
    accountGsiPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://accounts.google.com/gsi/client";
        script.async = true;
        script.defer = true;
        script.onload = () => resolve();
        script.onerror = () => {
            accountGsiPromise = null;
            reject(new Error("Could not load Google Sign-In"));
        };
        document.head.appendChild(script);
    });
    return accountGsiPromise;
}

async function ensureGoogleSignInButton() {
    const holder = accountEl("googleSignInButton");
    if (!holder || accountState.signedIn || !accountState.configured || !accountState.googleClientId) return;
    if (accountGsiRenderedClientId === accountState.googleClientId && holder.childElementCount > 0) return;

    holder.textContent = "Loading Google Sign-In…";
    try {
        await loadGoogleIdentityScript();
        if (!window.google?.accounts?.id) throw new Error("Google Identity Services unavailable");
        holder.replaceChildren();
        window.google.accounts.id.initialize({
            client_id: accountState.googleClientId,
            callback: handleGoogleCredentialResponse,
        });
        window.google.accounts.id.renderButton(holder, {
            theme: document.documentElement.dataset.theme === "dark" ? "filled_black" : "outline",
            size: "large",
            text: "continue_with",
            shape: "pill",
            width: 280,
        });
        accountGsiRenderedClientId = accountState.googleClientId;
    } catch {
        holder.textContent = "Google Sign-In is unavailable offline.";
    }
}

async function signOutAccount() {
    if (accountSyncTimer) {
        window.clearTimeout(accountSyncTimer);
        accountSyncTimer = 0;
    }
    let serverSignedOut = false;
    try {
        const res = await fetch(ACCOUNT_API_ENDPOINT, {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "logout" }),
        });
        serverSignedOut = Boolean(res.ok);
    } catch {
        serverSignedOut = false;
    }
    const meta = readAccountMeta();
    meta.pendingLogout = !serverSignedOut;
    writeAccountMeta(meta);

    accountState.signedIn = false;
    accountState.user = null;
    accountState.revision = 0;
    accountState.dirty = false;
    accountState.error = "";
    accountState.statusText = serverSignedOut
        ? "Signed out. Your saved songs remain on this device."
        : "Signed out locally — server sign-out will finish when back online.";
    accountGsiRenderedClientId = "";
    renderAccountUi();
    showSnackbar(
        serverSignedOut
            ? "Signed out — local saved songs kept on this device"
            : "Signed out locally — will finish signing out once back online"
    );
}

async function deleteCloudAccountCopy() {
    if (!accountState.signedIn || accountDeleteInflight) return;
    accountDeleteInflight = true;
    accountSyncQueued = false;
    if (accountSyncTimer) {
        window.clearTimeout(accountSyncTimer);
        accountSyncTimer = 0;
    }
    try {
        if (accountSyncPromise) {
            try { await accountSyncPromise; } catch { /* ignore */ }
        }
        const res = await fetch(ACCOUNT_API_ENDPOINT, {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "delete-cloud" }),
        });
        if (!res.ok) {
            accountState.error = "Couldn’t delete cloud data right now. Try again.";
            renderAccountUi();
            return;
        }
        const meta = readAccountMeta();
        if (meta.pendingLogout) {
            meta.pendingLogout = false;
            writeAccountMeta(meta);
        }
        accountState.signedIn = false;
        accountState.user = null;
        accountState.revision = 0;
        accountState.dirty = false;
        accountState.error = "";
        accountState.statusText = "Cloud copy deleted and signed out. Your local copy is still on this device.";
        accountGsiRenderedClientId = "";
        renderAccountUi();
        showSnackbar("Deleted cloud backup and signed out");
    } catch {
        accountState.error = "Couldn’t delete cloud data — check your connection and try again.";
        renderAccountUi();
    } finally {
        accountDeleteInflight = false;
    }
}

function renderAccountUi() {
    const menuLabel = accountEl("accountMenuLabel");
    const signedOutView = accountEl("accountSignedOut");
    const signedInView = accountEl("accountSignedIn");
    const setupNote = accountEl("accountSetupNotice");
    const nameEl = accountEl("accountUserName");
    const emailEl = accountEl("accountUserEmail");
    const countsEl = accountEl("accountSyncCounts");
    const statusEl = accountEl("accountSyncStatus");
    const errorEl = accountEl("accountSyncError");
    const syncNowBtn = accountEl("accountSyncNowButton");
    const repSyncBtn = accountEl("repertoireSyncButton");

    if (menuLabel) {
        if (accountState.signedIn && accountState.user?.name) {
            const firstName = accountState.user.name.split(/\s+/)[0].slice(0, 18);
            menuLabel.textContent = `Account · ${firstName}`;
        } else {
            menuLabel.textContent = "Sign in & sync";
        }
    }

    if (repSyncBtn) {
        repSyncBtn.textContent = accountState.signedIn ? "Synced" : "Sync across devices";
    }

    if (signedOutView) signedOutView.hidden = accountState.signedIn;
    if (signedInView) signedInView.hidden = !accountState.signedIn;

    if (setupNote) {
        if (!accountState.configured && !accountState.signedIn) {
            setupNote.hidden = false;
            setupNote.textContent = !accountState.googleConfigured
                ? "Add GOOGLE_CLIENT_ID in Vercel Environment Variables (using your Google Cloud OAuth Web Client ID) and redeploy to enable Sign in with Google."
                : "Connect Upstash Redis in Vercel Storage and redeploy to enable cloud sync.";
        } else {
            setupNote.hidden = true;
            setupNote.textContent = "";
        }
    }

    if (accountState.signedIn && accountState.user) {
        if (nameEl) nameEl.textContent = accountState.user.name || "Signed in";
        if (emailEl) {
            emailEl.textContent = accountState.user.email || "";
            emailEl.hidden = !accountState.user.email;
        }
        if (countsEl) {
            const repCount = typeof repertoire === "object" && repertoire ? Object.keys(repertoire).length : 0;
            const listsCount = typeof readSavedSetlists === "function" ? readSavedSetlists().length : 0;
            const setlistCount = typeof state === "object" && Array.isArray(state.setlist) ? state.setlist.length : 0;
            countsEl.textContent = `${repCount} saved ${repCount === 1 ? "song" : "songs"} · ${listsCount} saved ${listsCount === 1 ? "setlist" : "setlists"} · ${setlistCount} in current setlist`;
        }
    }

    if (syncNowBtn) {
        syncNowBtn.disabled = accountState.syncing;
        syncNowBtn.textContent = accountState.syncing ? "Syncing…" : "Sync now";
    }

    if (statusEl) {
        let msg = accountState.statusText;
        if (!msg && accountState.signedIn) {
            msg = accountState.syncing
                ? "Syncing with your account…"
                : accountState.dirty
                    ? "Changes waiting to sync…"
                    : accountState.lastSyncedAt
                        ? `Synced ${new Date(accountState.lastSyncedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                        : "Connected — changes sync automatically.";
        }
        statusEl.textContent = msg || "";
        statusEl.hidden = !msg;
    }

    if (errorEl) {
        errorEl.textContent = accountState.error || "";
        errorEl.hidden = !accountState.error;
    }
}

async function openAccountDialog() {
    const more = accountEl("moreTools");
    if (more) more.open = false;
    const dialog = accountEl("accountDialog");
    if (!dialog) return;
    if (!accountSessionChecked || readAccountMeta().pendingLogout || (!accountState.configured && !accountState.signedIn)) {
        await fetchAccountSession({ mergeRemote: true });
    }
    renderAccountUi();
    if (!dialog.open && typeof dialog.showModal === "function") {
        dialog.showModal();
    }
    if (!accountState.signedIn && accountState.configured) {
        ensureGoogleSignInButton();
    }
}

function bindAccountSync() {
    if (accountBound) return;
    accountBound = true;

    accountEl("accountMenuButton")?.addEventListener("click", openAccountDialog);
    accountEl("repertoireSyncButton")?.addEventListener("click", () => {
        const repDialog = accountEl("repertoireDialog");
        if (repDialog?.open) repDialog.close();
        openAccountDialog();
    });
    accountEl("accountSyncNowButton")?.addEventListener("click", () => syncAccountNow());
    accountEl("accountSignOutButton")?.addEventListener("click", signOutAccount);
    accountEl("accountDeleteCloudButton")?.addEventListener("click", deleteCloudAccountCopy);

    window.addEventListener("online", () => {
        if (!accountSessionChecked || readAccountMeta().pendingLogout) {
            fetchAccountSession({ mergeRemote: true });
        } else if (accountState.signedIn && accountState.dirty) {
            syncAccountNow();
        }
    });

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible") return;
        if (!accountSessionChecked || readAccountMeta().pendingLogout) {
            fetchAccountSession({ mergeRemote: true });
        } else if (accountState.signedIn) {
            if (accountState.dirty) {
                syncAccountNow();
            } else {
                fetchAccountSession({ mergeRemote: true });
            }
        }
    });

    renderAccountUi();
    fetchAccountSession({ mergeRemote: true });
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        mergeAccountData,
        normalizeAccountSetlistName,
        pruneAccountTombstones,
    };
}
