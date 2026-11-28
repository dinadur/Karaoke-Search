// Vercel serverless function for Karaoke Night Live Multi-Phone Rooms.
// Backed by Upstash Redis REST API (zero npm dependencies; supports both
// UPSTASH_REDIS_REST_* and KV_REST_API_* Vercel Marketplace env vars).
//
// Concurrency model:
//   - Host owns `karaoke:room:{code}:meta` (queue order, current stage, settings).
//   - Guests append atomically via HSET to `karaoke:room:{code}:requests`.
//   - Host acknowledges processed requests atomically via HDEL during sync.
//   This eliminates read-modify-write races between simultaneous host edits
//   and guest submissions.

const crypto = require("node:crypto");

const ROOM_TTL_SECONDS = 86400; // 24 hours
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 6;
const MAX_BODY_BYTES = 128 * 1024;
const MAX_PENDING_REQUESTS = 50;
const MAX_UP_NEXT = 100;
const MAX_RECENT_SUNG = 25;
const MAX_DECLINED_IDS = 100;

function cleanText(value, maxLen) {
    return String(value || "")
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maxLen);
}

function normalizeRoomCode(raw) {
    const cleaned = String(raw || "")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");
    if (cleaned.length < 4 || cleaned.length > 10) return "";
    return cleaned;
}

function normalizeSingerKey(name) {
    return cleanText(name, 40).toLowerCase();
}

function normalizeSongKey(title, artist) {
    return `${cleanText(title, 140).toLowerCase()}||${cleanText(artist, 120).toLowerCase()}`;
}

function generateRoomCode() {
    const bytes = crypto.randomBytes(ROOM_CODE_LENGTH);
    let out = "";
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        out += ROOM_CODE_ALPHABET[bytes[i] % ROOM_CODE_ALPHABET.length];
    }
    return out;
}

function generateHostToken() {
    return crypto.randomBytes(24).toString("base64url");
}

function hashHostToken(token) {
    return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function verifyHostToken(provided, expectedHash) {
    if (!provided || !expectedHash || typeof provided !== "string") return false;
    const providedHash = hashHostToken(provided);
    const a = Buffer.from(providedHash, "utf8");
    const b = Buffer.from(String(expectedHash), "utf8");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

function clampMaxPerSinger(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.min(10, Math.floor(n));
}

function sanitizeCurrent(raw) {
    if (!raw || typeof raw !== "object") return null;
    const title = cleanText(raw.title, 140);
    if (!title) return null;
    const seconds = Number(raw.seconds);
    return {
        uid: cleanText(raw.uid, 64),
        title,
        artist: cleanText(raw.artist, 120),
        singer: cleanText(raw.singer, 40),
        seconds: Number.isFinite(seconds) && seconds > 0 ? Math.min(3600, Math.round(seconds)) : 0,
        playing: Boolean(raw.playing),
        requestId: cleanText(raw.requestId, 64),
    };
}

function sanitizeQueueEntry(raw) {
    if (!raw || typeof raw !== "object") return null;
    const title = cleanText(raw.title, 140);
    if (!title) return null;
    const seconds = Number(raw.seconds);
    const waitMin = Number(raw.waitMin);
    return {
        uid: cleanText(raw.uid, 64),
        title,
        artist: cleanText(raw.artist, 120),
        singer: cleanText(raw.singer, 40),
        seconds: Number.isFinite(seconds) && seconds > 0 ? Math.min(3600, Math.round(seconds)) : 0,
        waitMin: Number.isFinite(waitMin) && waitMin >= 0 ? Math.min(999, Math.round(waitMin)) : 0,
        requestId: cleanText(raw.requestId, 64),
    };
}

function sanitizeQueueList(rawList, limit) {
    if (!Array.isArray(rawList)) return [];
    const out = [];
    for (const item of rawList) {
        const clean = sanitizeQueueEntry(item);
        if (clean) out.push(clean);
        if (out.length >= limit) break;
    }
    return out;
}

function sanitizeIdList(rawList, limit) {
    if (!Array.isArray(rawList)) return [];
    const seen = new Set();
    const out = [];
    for (const item of rawList) {
        const id = cleanText(item, 64);
        if (id && !seen.has(id)) {
            seen.add(id);
            out.push(id);
            if (out.length >= limit) break;
        }
    }
    return out;
}

function parseHgetallResult(raw) {
    const requests = [];
    const pushJson = (val) => {
        if (typeof val !== "string") return;
        try {
            const parsed = JSON.parse(val);
            if (parsed && typeof parsed === "object" && parsed.id && parsed.title) {
                requests.push(parsed);
            }
        } catch {
            // Skip malformed hash entries.
        }
    };
    if (Array.isArray(raw)) {
        for (let i = 1; i < raw.length; i += 2) {
            pushJson(raw[i]);
        }
    } else if (raw && typeof raw === "object") {
        for (const val of Object.values(raw)) {
            pushJson(val);
        }
    }
    requests.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0) || String(a.id).localeCompare(String(b.id)));
    return requests;
}

function toPublicRoom(meta, pendingRequests) {
    return {
        code: meta.code,
        locked: Boolean(meta.locked),
        approvalRequired: Boolean(meta.approvalRequired),
        maxPerSinger: clampMaxPerSinger(meta.maxPerSinger),
        revision: Number(meta.revision) || 1,
        updatedAt: Number(meta.updatedAt) || 0,
        current: meta.current || null,
        upNext: Array.isArray(meta.upNext) ? meta.upNext : [],
        sungCount: Number(meta.sungCount) || 0,
        recentSung: Array.isArray(meta.recentSung) ? meta.recentSung : [],
        pendingRequests: Array.isArray(pendingRequests) ? pendingRequests : [],
        declinedIds: Array.isArray(meta.declinedIds) ? meta.declinedIds : [],
    };
}

function roomKeys(code) {
    return {
        metaKey: `karaoke:room:${code}:meta`,
        reqKey: `karaoke:room:${code}:requests`,
    };
}

function createUpstashStore({ url, token, fetchImpl = fetch }) {
    const baseUrl = String(url || "").replace(/\/+$/, "");

    async function pipeline(commands) {
        const res = await fetchImpl(`${baseUrl}/pipeline`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(commands),
        });
        if (!res.ok) {
            throw new Error(`Upstash Redis HTTP ${res.status}`);
        }
        const results = await res.json();
        if (!Array.isArray(results)) {
            throw new Error("Invalid Upstash Redis pipeline response");
        }
        for (const entry of results) {
            if (entry && entry.error) {
                throw new Error(`Upstash Redis error: ${entry.error}`);
            }
        }
        return results.map((entry) => entry?.result);
    }

    return {
        async exists(code) {
            const { metaKey } = roomKeys(code);
            const [res] = await pipeline([["EXISTS", metaKey]]);
            return Number(res) > 0;
        },

        async getRoom(code) {
            const { metaKey, reqKey } = roomKeys(code);
            const [metaRaw, reqRaw] = await pipeline([
                ["GET", metaKey],
                ["HGETALL", reqKey],
            ]);
            if (!metaRaw || typeof metaRaw !== "string") return null;
            let meta;
            try {
                meta = JSON.parse(metaRaw);
            } catch {
                return null;
            }
            return { meta, pendingRequests: parseHgetallResult(reqRaw) };
        },

        async createRoom(code, meta, ttlSec = ROOM_TTL_SECONDS) {
            const { metaKey, reqKey } = roomKeys(code);
            await pipeline([
                ["SET", metaKey, JSON.stringify(meta), "EX", String(ttlSec)],
                ["DEL", reqKey],
            ]);
        },

        async syncRoom(code, meta, ackedIds, ttlSec = ROOM_TTL_SECONDS) {
            const { metaKey, reqKey } = roomKeys(code);
            const commands = [
                ["SET", metaKey, JSON.stringify(meta), "EX", String(ttlSec)],
            ];
            if (ackedIds.length) {
                commands.push(["HDEL", reqKey, ...ackedIds]);
            }
            commands.push(["EXPIRE", reqKey, String(ttlSec)]);
            commands.push(["HGETALL", reqKey]);
            const results = await pipeline(commands);
            const reqRaw = results[results.length - 1];
            return { meta, pendingRequests: parseHgetallResult(reqRaw) };
        },

        async addRequest(code, reqObj, ttlSec = ROOM_TTL_SECONDS) {
            const { metaKey, reqKey } = roomKeys(code);
            const results = await pipeline([
                ["HSET", reqKey, reqObj.id, JSON.stringify(reqObj)],
                ["EXPIRE", reqKey, String(ttlSec)],
                ["EXPIRE", metaKey, String(ttlSec)],
                ["HGETALL", reqKey],
            ]);
            return parseHgetallResult(results[3]);
        },

        async deleteRoom(code) {
            const { metaKey, reqKey } = roomKeys(code);
            await pipeline([["DEL", metaKey, reqKey]]);
        },
    };
}

function createMemoryStore({ now = () => Date.now() } = {}) {
    const rooms = new Map();

    function getLive(code) {
        const entry = rooms.get(code);
        if (!entry) return null;
        if (entry.expiresAt <= now()) {
            rooms.delete(code);
            return null;
        }
        return entry;
    }

    function listPending(entry) {
        const out = [];
        for (const raw of entry.requests.values()) {
            out.push(JSON.parse(raw));
        }
        out.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0) || String(a.id).localeCompare(String(b.id)));
        return out;
    }

    return {
        async exists(code) {
            return Boolean(getLive(code));
        },
        async getRoom(code) {
            const entry = getLive(code);
            if (!entry) return null;
            return { meta: JSON.parse(entry.meta), pendingRequests: listPending(entry) };
        },
        async createRoom(code, meta, ttlSec = ROOM_TTL_SECONDS) {
            rooms.set(code, {
                meta: JSON.stringify(meta),
                requests: new Map(),
                expiresAt: now() + ttlSec * 1000,
            });
        },
        async syncRoom(code, meta, ackedIds, ttlSec = ROOM_TTL_SECONDS) {
            const entry = getLive(code);
            const requests = entry ? entry.requests : new Map();
            for (const id of ackedIds) requests.delete(id);
            const nextEntry = {
                meta: JSON.stringify(meta),
                requests,
                expiresAt: now() + ttlSec * 1000,
            };
            rooms.set(code, nextEntry);
            return { meta, pendingRequests: listPending(nextEntry) };
        },
        async addRequest(code, reqObj, ttlSec = ROOM_TTL_SECONDS) {
            const entry = getLive(code);
            if (!entry) return [];
            entry.requests.set(reqObj.id, JSON.stringify(reqObj));
            entry.expiresAt = now() + ttlSec * 1000;
            return listPending(entry);
        },
        async deleteRoom(code) {
            rooms.delete(code);
        },
    };
}

function getQueryParam(req, name) {
    if (req.query && typeof req.query === "object" && req.query[name] != null) {
        return String(req.query[name]);
    }
    try {
        const parsed = new URL(req.url || "/", "http://localhost");
        return parsed.searchParams.get(name) || "";
    } catch {
        return "";
    }
}

async function readJsonBody(req) {
    if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
        return req.body;
    }
    if (typeof req.body === "string") {
        if (Buffer.byteLength(req.body, "utf8") > MAX_BODY_BYTES) {
            const err = new Error("Request body too large");
            err.statusCode = 413;
            throw err;
        }
        return req.body.trim() ? JSON.parse(req.body) : {};
    }
    if (Buffer.isBuffer(req.body)) {
        if (req.body.length > MAX_BODY_BYTES) {
            const err = new Error("Request body too large");
            err.statusCode = 413;
            throw err;
        }
        const text = req.body.toString("utf8").trim();
        return text ? JSON.parse(text) : {};
    }
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on("data", (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                const err = new Error("Request body too large");
                err.statusCode = 413;
                reject(err);
                req.destroy?.();
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8").trim();
            if (!text) return resolve({});
            try {
                resolve(JSON.parse(text));
            } catch {
                const err = new Error("Invalid JSON body");
                err.statusCode = 400;
                reject(err);
            }
        });
        req.on("error", reject);
    });
}

function sendJson(res, status, payload) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.statusCode = status;
    res.end(JSON.stringify(payload));
}

function resolveEnvUpstashConfig(env = process.env) {
    const url = (env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL || "").trim();
    const token = (env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN || "").trim();
    if (!url || !token) return null;
    return { url, token };
}

function createRoomHandler({ store, env = process.env, fetchImpl = fetch, now = () => Date.now() } = {}) {
    function getStore() {
        if (store) return store;
        const cfg = resolveEnvUpstashConfig(env);
        if (!cfg) return null;
        return createUpstashStore({ url: cfg.url, token: cfg.token, fetchImpl });
    }

    return async function handler(req, res) {
        const method = String(req.method || "GET").toUpperCase();
        if (method !== "GET" && method !== "POST") {
            res.setHeader("Allow", "GET, POST");
            return sendJson(res, 405, { error: "Method not allowed" });
        }

        const activeStore = getStore();
        if (!activeStore) {
            return sendJson(res, 200, {
                configured: false,
                error: "Live Multi-Phone Rooms require Upstash Redis connected in Vercel Storage.",
            });
        }

        try {
            if (method === "GET") {
                const code = normalizeRoomCode(getQueryParam(req, "code"));
                if (!code) {
                    return sendJson(res, 400, { configured: true, error: "Enter a valid room code." });
                }
                const record = await activeStore.getRoom(code);
                if (!record) {
                    return sendJson(res, 404, { configured: true, error: "Room not found or expired." });
                }
                return sendJson(res, 200, {
                    configured: true,
                    room: toPublicRoom(record.meta, record.pendingRequests),
                });
            }

            let body;
            try {
                body = await readJsonBody(req);
            } catch (err) {
                return sendJson(res, err.statusCode || 400, {
                    configured: true,
                    error: err.message || "Invalid JSON body",
                });
            }

            const action = cleanText(body?.action, 24).toLowerCase();
            const headerToken = req.headers?.["x-host-token"] || req.headers?.["X-Host-Token"] || "";
            const hostToken = String(headerToken || body?.hostToken || "").trim();

            if (action === "create") {
                let code = "";
                for (let attempt = 0; attempt < 5; attempt++) {
                    const candidate = generateRoomCode();
                    if (!(await activeStore.exists(candidate))) {
                        code = candidate;
                        break;
                    }
                }
                if (!code) {
                    return sendJson(res, 503, { configured: true, error: "Could not allocate a room code. Please try again." });
                }

                const newHostToken = generateHostToken();
                const timestamp = now();
                const meta = {
                    code,
                    hostTokenHash: hashHostToken(newHostToken),
                    createdAt: timestamp,
                    updatedAt: timestamp,
                    revision: 1,
                    locked: Boolean(body?.locked),
                    approvalRequired: Boolean(body?.approvalRequired),
                    maxPerSinger: clampMaxPerSinger(body?.maxPerSinger),
                    current: sanitizeCurrent(body?.current),
                    upNext: sanitizeQueueList(body?.upNext, MAX_UP_NEXT),
                    sungCount: Math.max(0, Math.min(9999, Math.floor(Number(body?.sungCount) || 0))),
                    recentSung: sanitizeQueueList(body?.recentSung, MAX_RECENT_SUNG),
                    declinedIds: [],
                };
                await activeStore.createRoom(code, meta, ROOM_TTL_SECONDS);
                return sendJson(res, 201, {
                    configured: true,
                    code,
                    hostToken: newHostToken,
                    room: toPublicRoom(meta, []),
                });
            }

            const code = normalizeRoomCode(body?.code);
            if (!code) {
                return sendJson(res, 400, { configured: true, error: "Valid room code is required." });
            }

            const record = await activeStore.getRoom(code);
            if (!record) {
                return sendJson(res, 404, { configured: true, error: "Room not found or expired." });
            }

            if (action === "sync") {
                if (!verifyHostToken(hostToken, record.meta.hostTokenHash)) {
                    return sendJson(res, 403, { configured: true, error: "Invalid host token for this room." });
                }

                const ackedIds = sanitizeIdList(body?.ackedRequestIds, 100);
                const mergedDeclined = sanitizeIdList(
                    [
                        ...(Array.isArray(record.meta.declinedIds) ? record.meta.declinedIds : []),
                        ...(Array.isArray(body?.declinedIds) ? body.declinedIds : []),
                    ],
                    MAX_DECLINED_IDS
                );

                const nextMeta = {
                    ...record.meta,
                    updatedAt: now(),
                    revision: (Number(record.meta.revision) || 1) + 1,
                    locked: typeof body?.locked === "boolean" ? body.locked : Boolean(record.meta.locked),
                    approvalRequired: typeof body?.approvalRequired === "boolean"
                        ? body.approvalRequired
                        : Boolean(record.meta.approvalRequired),
                    maxPerSinger: body?.maxPerSinger !== undefined
                        ? clampMaxPerSinger(body.maxPerSinger)
                        : clampMaxPerSinger(record.meta.maxPerSinger),
                    current: body?.current !== undefined ? sanitizeCurrent(body.current) : record.meta.current,
                    upNext: body?.upNext !== undefined ? sanitizeQueueList(body.upNext, MAX_UP_NEXT) : record.meta.upNext,
                    sungCount: body?.sungCount !== undefined
                        ? Math.max(0, Math.min(9999, Math.floor(Number(body.sungCount) || 0)))
                        : Number(record.meta.sungCount) || 0,
                    recentSung: body?.recentSung !== undefined
                        ? sanitizeQueueList(body.recentSung, MAX_RECENT_SUNG)
                        : (record.meta.recentSung || []),
                    declinedIds: mergedDeclined,
                };

                const synced = await activeStore.syncRoom(code, nextMeta, ackedIds, ROOM_TTL_SECONDS);
                return sendJson(res, 200, {
                    configured: true,
                    room: toPublicRoom(synced.meta, synced.pendingRequests),
                });
            }

            if (action === "request") {
                if (record.meta.locked) {
                    return sendJson(res, 403, {
                        configured: true,
                        error: "Requests are currently paused by the host.",
                    });
                }

                const singer = cleanText(body?.singer, 40);
                const title = cleanText(body?.title, 140);
                const artist = cleanText(body?.artist, 120);
                if (!singer) {
                    return sendJson(res, 400, { configured: true, error: "Please enter your name first." });
                }
                if (!title) {
                    return sendJson(res, 400, { configured: true, error: "Song title is required." });
                }
                if (record.pendingRequests.length >= MAX_PENDING_REQUESTS) {
                    return sendJson(res, 429, {
                        configured: true,
                        error: "The request inbox is full right now — try again in a moment.",
                    });
                }

                const singerKey = normalizeSingerKey(singer);
                const songKey = normalizeSongKey(title, artist);
                const activeUpNext = Array.isArray(record.meta.upNext) ? record.meta.upNext : [];
                const singerQueueEntries = activeUpNext.filter((item) => normalizeSingerKey(item.singer) === singerKey);
                const singerPendingEntries = record.pendingRequests.filter((item) => normalizeSingerKey(item.singer) === singerKey);

                const duplicate = [...singerQueueEntries, ...singerPendingEntries].some(
                    (item) => normalizeSongKey(item.title, item.artist) === songKey
                );
                if (duplicate) {
                    return sendJson(res, 409, {
                        configured: true,
                        error: "You already requested that song!",
                    });
                }

                const maxPerSinger = clampMaxPerSinger(record.meta.maxPerSinger);
                const activeCount = singerQueueEntries.length + singerPendingEntries.length;
                if (maxPerSinger > 0 && activeCount >= maxPerSinger) {
                    return sendJson(res, 429, {
                        configured: true,
                        error: `You already have ${maxPerSinger} ${maxPerSinger === 1 ? "song" : "songs"} in line — wait until one plays to request another.`,
                    });
                }

                const seconds = Number(body?.seconds);
                const bpm = Number(body?.bpm);
                const reqObj = {
                    id: `req_${crypto.randomBytes(6).toString("hex")}`,
                    singer,
                    title,
                    artist,
                    songId: cleanText(body?.songId, 160),
                    seconds: Number.isFinite(seconds) && seconds > 0 ? Math.min(3600, Math.round(seconds)) : 0,
                    bpm: Number.isFinite(bpm) && bpm > 0 ? Math.min(300, Math.round(bpm)) : 0,
                    referenceKey: cleanText(body?.referenceKey, 24),
                    custom: Boolean(body?.custom),
                    createdAt: now(),
                };

                const nextPending = await activeStore.addRequest(code, reqObj, ROOM_TTL_SECONDS);
                return sendJson(res, 201, {
                    configured: true,
                    request: reqObj,
                    room: toPublicRoom(record.meta, nextPending),
                });
            }

            if (action === "close") {
                if (!verifyHostToken(hostToken, record.meta.hostTokenHash)) {
                    return sendJson(res, 403, { configured: true, error: "Invalid host token for this room." });
                }
                await activeStore.deleteRoom(code);
                return sendJson(res, 200, { configured: true, closed: true });
            }

            return sendJson(res, 400, { configured: true, error: "Unsupported room action." });
        } catch (err) {
            return sendJson(res, 502, {
                configured: true,
                error: "Live room storage is temporarily unavailable.",
            });
        }
    };
}

const defaultHandler = createRoomHandler();
module.exports = defaultHandler;
module.exports.createRoomHandler = createRoomHandler;
module.exports.createUpstashStore = createUpstashStore;
module.exports.createMemoryStore = createMemoryStore;
module.exports.normalizeRoomCode = normalizeRoomCode;
module.exports.parseHgetallResult = parseHgetallResult;
module.exports.resolveEnvUpstashConfig = resolveEnvUpstashConfig;
