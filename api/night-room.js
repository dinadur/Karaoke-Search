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
    const artist = cleanText(raw.artist, 120);
    const singer = cleanText(raw.singer, 40);
    const seconds = Number(raw.seconds);
    const waitMin = Number(raw.waitMin);
    return {
        uid: cleanText(raw.uid, 64),
        title,
        artist,
        singer,
        singerKey: normalizeSingerKey(singer),
        songKey: normalizeSongKey(title, artist),
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

function stripInternalKeys(item) {
    if (!item || typeof item !== "object") return item;
    const { singerKey: _sk, songKey: _tk, ...pub } = item;
    return pub;
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
        upNext: Array.isArray(meta.upNext) ? meta.upNext.map(stripInternalKeys) : [],
        sungCount: Number(meta.sungCount) || 0,
        recentSung: Array.isArray(meta.recentSung) ? meta.recentSung.map(stripInternalKeys) : [],
        pendingRequests: Array.isArray(pendingRequests) ? pendingRequests.map(stripInternalKeys) : [],
        declinedIds: Array.isArray(meta.declinedIds) ? meta.declinedIds : [],
    };
}

function roomKeys(code) {
    return {
        metaKey: `karaoke:room:${code}:meta`,
        reqKey: `karaoke:room:${code}:requests`,
    };
}

// Atomic check-and-insert Lua script executed inside Redis so concurrent guest
// requests cannot bypass lock, inbox cap, duplicate, or per-singer limits.
const SUBMIT_REQUEST_LUA = `
local metaRaw = redis.call("GET", KEYS[1])
if not metaRaw then
    return {"not_found"}
end
local okMeta, meta = pcall(cjson.decode, metaRaw)
if not okMeta or type(meta) ~= "table" then
    return {"not_found"}
end
if meta.locked then
    return {"locked"}
end
local reqId = ARGV[1]
local reqJson = ARGV[2]
local singerKey = ARGV[3]
local songKey = ARGV[4]
local maxPending = tonumber(ARGV[5]) or 50
local ttlSec = tonumber(ARGV[6]) or 86400

local function cleanLower(s)
    if type(s) ~= "string" then return "" end
    s = string.gsub(s, "%s+", " ")
    s = string.gsub(s, "^%s+", "")
    s = string.gsub(s, "%s+$", "")
    return string.lower(s)
end

local function itemSingerKey(item)
    if type(item.singerKey) == "string" and item.singerKey ~= "" then
        return item.singerKey
    end
    return cleanLower(item.singer)
end

local function itemSongKey(item)
    if type(item.songKey) == "string" and item.songKey ~= "" then
        return item.songKey
    end
    return cleanLower(item.title) .. "||" .. cleanLower(item.artist)
end

local vals = redis.call("HVALS", KEYS[2])
if #vals >= maxPending then
    return {"inbox_full"}
end

local activeCount = 0
if type(meta.upNext) == "table" then
    for _, item in ipairs(meta.upNext) do
        if type(item) == "table" and itemSingerKey(item) == singerKey then
            activeCount = activeCount + 1
            if itemSongKey(item) == songKey then
                return {"duplicate"}
            end
        end
    end
end

for _, raw in ipairs(vals) do
    local okReq, item = pcall(cjson.decode, raw)
    if okReq and type(item) == "table" and itemSingerKey(item) == singerKey then
        activeCount = activeCount + 1
        if itemSongKey(item) == songKey then
            return {"duplicate"}
        end
    end
end

local maxPerSinger = tonumber(meta.maxPerSinger) or 0
if maxPerSinger > 0 and activeCount >= maxPerSinger then
    return {"capped", tostring(maxPerSinger)}
end

redis.call("HSET", KEYS[2], reqId, reqJson)
redis.call("EXPIRE", KEYS[2], ttlSec)
redis.call("EXPIRE", KEYS[1], ttlSec)
local allReqs = redis.call("HGETALL", KEYS[2])
return {"ok", metaRaw, allReqs}
`;

const SYNC_ROOM_LUA = `
if redis.call("EXISTS", KEYS[1]) == 0 then
    return {"not_found"}
end
local ttlSec = tonumber(ARGV[2]) or 86400
redis.call("SET", KEYS[1], ARGV[1], "EX", ttlSec)
for i = 3, #ARGV do
    redis.call("HDEL", KEYS[2], ARGV[i])
end
redis.call("EXPIRE", KEYS[2], ttlSec)
return {"ok", redis.call("HGETALL", KEYS[2])}
`;

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
            const [res] = await pipeline([[
                "EVAL",
                SYNC_ROOM_LUA,
                "2",
                metaKey,
                reqKey,
                JSON.stringify(meta),
                String(ttlSec),
                ...ackedIds,
            ]]);
            if (!Array.isArray(res) || !res.length) {
                throw new Error("Invalid Upstash sync EVAL response");
            }
            if (res[0] === "not_found") return null;
            return { meta, pendingRequests: parseHgetallResult(res[1]) };
        },

        async submitRequest(code, reqObj, { singerKey, songKey, maxPending = MAX_PENDING_REQUESTS, ttlSec = ROOM_TTL_SECONDS }) {
            const { metaKey, reqKey } = roomKeys(code);
            const [res] = await pipeline([[
                "EVAL",
                SUBMIT_REQUEST_LUA,
                "2",
                metaKey,
                reqKey,
                reqObj.id,
                JSON.stringify(reqObj),
                singerKey,
                songKey,
                String(maxPending),
                String(ttlSec),
            ]]);
            if (!Array.isArray(res) || !res.length) {
                throw new Error("Invalid Upstash EVAL response");
            }
            const status = res[0];
            if (status === "capped") {
                return { status, maxPerSinger: clampMaxPerSinger(res[1]) };
            }
            if (status !== "ok") {
                return { status };
            }
            const meta = JSON.parse(res[1]);
            const pendingRequests = parseHgetallResult(res[2]);
            return { status: "ok", meta, pendingRequests };
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
            if (!entry) return null;
            for (const id of ackedIds) entry.requests.delete(id);
            entry.meta = JSON.stringify(meta);
            entry.expiresAt = now() + ttlSec * 1000;
            return { meta, pendingRequests: listPending(entry) };
        },
        async submitRequest(code, reqObj, { singerKey, songKey, maxPending = MAX_PENDING_REQUESTS, ttlSec = ROOM_TTL_SECONDS }) {
            // Executed synchronously without awaiting so concurrent submissions cannot interleave.
            const entry = getLive(code);
            if (!entry) return { status: "not_found" };
            const meta = JSON.parse(entry.meta);
            if (meta.locked) return { status: "locked" };
            const pending = listPending(entry);
            if (pending.length >= maxPending) return { status: "inbox_full" };

            const upNext = Array.isArray(meta.upNext) ? meta.upNext : [];
            const matchSinger = (item) => (item.singerKey || normalizeSingerKey(item.singer)) === singerKey;
            const matchSong = (item) => (item.songKey || normalizeSongKey(item.title, item.artist)) === songKey;
            const singerEntries = [...upNext.filter(matchSinger), ...pending.filter(matchSinger)];
            if (singerEntries.some(matchSong)) return { status: "duplicate" };

            const maxPerSinger = clampMaxPerSinger(meta.maxPerSinger);
            if (maxPerSinger > 0 && singerEntries.length >= maxPerSinger) {
                return { status: "capped", maxPerSinger };
            }

            entry.requests.set(reqObj.id, JSON.stringify(reqObj));
            entry.expiresAt = now() + ttlSec * 1000;
            return { status: "ok", meta, pendingRequests: listPending(entry) };
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

            if (action === "request") {
                const singer = cleanText(body?.singer, 40);
                const title = cleanText(body?.title, 140);
                const artist = cleanText(body?.artist, 120);
                if (!singer) {
                    return sendJson(res, 400, { configured: true, error: "Please enter your name first." });
                }
                if (!title) {
                    return sendJson(res, 400, { configured: true, error: "Song title is required." });
                }

                const singerKey = normalizeSingerKey(singer);
                const songKey = normalizeSongKey(title, artist);
                const seconds = Number(body?.seconds);
                const bpm = Number(body?.bpm);
                const reqObj = {
                    id: `req_${crypto.randomBytes(6).toString("hex")}`,
                    singer,
                    title,
                    artist,
                    singerKey,
                    songKey,
                    songId: String(body?.songId || "").replace(/[\u0000-\u001e\u007f]/g, "").trim().slice(0, 200),
                    seconds: Number.isFinite(seconds) && seconds > 0 ? Math.min(3600, Math.round(seconds)) : 0,
                    bpm: Number.isFinite(bpm) && bpm > 0 ? Math.min(300, Math.round(bpm)) : 0,
                    referenceKey: cleanText(body?.referenceKey, 24),
                    custom: Boolean(body?.custom),
                    createdAt: now(),
                };

                const outcome = await activeStore.submitRequest(code, reqObj, {
                    singerKey,
                    songKey,
                    maxPending: MAX_PENDING_REQUESTS,
                    ttlSec: ROOM_TTL_SECONDS,
                });
                if (outcome.status === "not_found") {
                    return sendJson(res, 404, { configured: true, error: "Room not found or expired." });
                }
                if (outcome.status === "locked") {
                    return sendJson(res, 403, {
                        configured: true,
                        error: "Requests are currently paused by the host.",
                    });
                }
                if (outcome.status === "inbox_full") {
                    return sendJson(res, 429, {
                        configured: true,
                        error: "The request inbox is full right now — try again in a moment.",
                    });
                }
                if (outcome.status === "duplicate") {
                    return sendJson(res, 409, {
                        configured: true,
                        error: "You already requested that song!",
                    });
                }
                if (outcome.status === "capped") {
                    const max = outcome.maxPerSinger || 1;
                    return sendJson(res, 429, {
                        configured: true,
                        error: `You already have ${max} ${max === 1 ? "song" : "songs"} in line — wait until one plays to request another.`,
                    });
                }
                return sendJson(res, 201, {
                    configured: true,
                    request: stripInternalKeys(reqObj),
                    room: toPublicRoom(outcome.meta, outcome.pendingRequests),
                });
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
                if (!synced) {
                    return sendJson(res, 404, { configured: true, error: "Room not found or expired." });
                }
                return sendJson(res, 200, {
                    configured: true,
                    room: toPublicRoom(synced.meta, synced.pendingRequests),
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
