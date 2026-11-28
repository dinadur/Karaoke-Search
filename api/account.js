// Vercel serverless function for Passwordless Google Sign-In & Cross-Device
// Cloud Sync backed by Upstash Redis REST API (zero npm dependencies).
//
// Env vars:
//   - GOOGLE_CLIENT_ID: Google OAuth 2.0 Web Client ID
//   - UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_*)
//   - ACCOUNT_SESSION_SECRET (optional; derived from Redis token + client ID if unset)
//
// Persistent storage key (no TTL):
//   karaoke:user:{uid}:profile -> JSON { version, revision, updatedAt, data }

const crypto = require("node:crypto");

const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const SESSION_COOKIE_NAME = "karaoke_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const MAX_BODY_BYTES = 256 * 1024;
const MAX_REPERTOIRE_ENTRIES = 1500;
const MAX_SETLIST_ITEMS = 200;
const MAX_SAVED_SETLISTS = 50;
const MAX_TOMBSTONES = 1000;

function cleanText(value, maxLen) {
    return String(value || "")
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
        .trim()
        .slice(0, maxLen);
}

function cleanSingleLine(value, maxLen) {
    return cleanText(value, maxLen).replace(/\s+/g, " ");
}

function cleanSongId(value, maxLen = 200) {
    // Catalog song IDs use ASCII Unit Separator (\u001f) between artist/song/title.
    return String(value || "")
        .replace(/[\u0000-\u001e\u007f]/g, "")
        .trim()
        .slice(0, maxLen);
}

function base64UrlDecodeToBuffer(str) {
    const normalized = String(str || "").replace(/-/g, "+").replace(/_/g, "/");
    const pad = normalized.length % 4 ? "=".repeat(4 - (normalized.length % 4)) : "";
    return Buffer.from(normalized + pad, "base64");
}

function base64UrlEncode(buf) {
    return Buffer.from(buf)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}

function resolveEnvAccountConfig(env = process.env) {
    const googleClientId = String(env.GOOGLE_CLIENT_ID || "").trim();
    const upstashUrl = String(env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL || "").trim();
    const upstashToken = String(env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN || "").trim();
    const explicitSecret = String(env.ACCOUNT_SESSION_SECRET || "").trim();
    const sessionSecret = explicitSecret || (
        upstashToken && googleClientId
            ? crypto.createHmac("sha256", "karaoke-account-session-v1").update(`${upstashToken}:${googleClientId}`).digest("hex")
            : ""
    );
    return {
        googleClientId,
        upstashUrl,
        upstashToken,
        sessionSecret,
        googleConfigured: Boolean(googleClientId),
        storageConfigured: Boolean(upstashUrl && upstashToken),
        configured: Boolean(googleClientId && upstashUrl && upstashToken && sessionSecret),
    };
}

function createJwksVerifier({ fetchImpl = fetch, certsUrl = GOOGLE_CERTS_URL, now = () => Date.now() } = {}) {
    let cachedKeys = null;
    let expiresAt = 0;

    async function loadKeys(forceRefresh = false) {
        if (!forceRefresh && cachedKeys && now() < expiresAt) {
            return cachedKeys;
        }
        const res = await fetchImpl(certsUrl, { headers: { Accept: "application/json" } });
        if (!res.ok) {
            throw new Error(`Google JWKS HTTP ${res.status}`);
        }
        const cacheHeader = String(res.headers?.get?.("cache-control") || "");
        const maxAgeMatch = cacheHeader.match(/max-age=(\d+)/i);
        const maxAgeSec = maxAgeMatch ? Math.min(86400, Math.max(60, Number(maxAgeMatch[1]))) : 3600;
        const body = await res.json();
        const keys = new Map();
        for (const jwk of Array.isArray(body?.keys) ? body.keys : []) {
            if (jwk && jwk.kid && jwk.kty === "RSA") {
                try {
                    keys.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: "jwk" }));
                } catch {
                    // Skip invalid JWK entry.
                }
            }
        }
        if (!keys.size) {
            throw new Error("No valid RSA keys in Google JWKS");
        }
        cachedKeys = keys;
        expiresAt = now() + maxAgeSec * 1000;
        return cachedKeys;
    }

    return async function verifyGoogleIdToken(idToken, expectedClientId) {
        const parts = String(idToken || "").split(".");
        if (parts.length !== 3) {
            throw new Error("Invalid Google credential format");
        }
        const [headerB64, payloadB64, sigB64] = parts;
        let header;
        let payload;
        try {
            header = JSON.parse(base64UrlDecodeToBuffer(headerB64).toString("utf8"));
            payload = JSON.parse(base64UrlDecodeToBuffer(payloadB64).toString("utf8"));
        } catch {
            throw new Error("Malformed Google credential");
        }
        if (!header || header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid) {
            throw new Error("Unsupported Google credential algorithm");
        }

        let keys = await loadKeys(false);
        let pubKey = keys.get(header.kid);
        if (!pubKey) {
            keys = await loadKeys(true);
            pubKey = keys.get(header.kid);
        }
        if (!pubKey) {
            throw new Error("Unknown Google signing key");
        }

        const sigBuf = base64UrlDecodeToBuffer(sigB64);
        const verified = crypto.verify(
            "RSA-SHA256",
            Buffer.from(`${headerB64}.${payloadB64}`, "utf8"),
            pubKey,
            sigBuf
        );
        if (!verified) {
            throw new Error("Invalid Google credential signature");
        }

        const validIssuers = new Set(["https://accounts.google.com", "accounts.google.com"]);
        if (!validIssuers.has(String(payload.iss || ""))) {
            throw new Error("Invalid Google credential issuer");
        }
        if (String(payload.aud || "") !== String(expectedClientId || "")) {
            throw new Error("Google credential audience mismatch");
        }
        const nowSec = Math.floor(now() / 1000);
        if (!Number.isFinite(Number(payload.exp)) || Number(payload.exp) <= nowSec) {
            throw new Error("Google credential expired");
        }
        if (Number.isFinite(Number(payload.iat)) && Number(payload.iat) > nowSec + 300) {
            throw new Error("Google credential issued in the future");
        }
        const sub = cleanSingleLine(payload.sub, 128);
        if (!sub) {
            throw new Error("Missing Google subject");
        }
        if (payload.email && payload.email_verified !== true) {
            throw new Error("Google account email is not verified");
        }

        return {
            uid: `google:${sub}`,
            name: cleanSingleLine(payload.name || payload.given_name || "Singer", 80),
            email: cleanSingleLine(payload.email || "", 160),
            picture: typeof payload.picture === "string" && payload.picture.startsWith("https://")
                ? payload.picture.slice(0, 300)
                : "",
        };
    };
}

function signSessionToken(user, secret, nowMs = Date.now()) {
    const exp = Math.floor(nowMs / 1000) + SESSION_TTL_SECONDS;
    const payload = {
        uid: user.uid,
        name: user.name,
        email: user.email || "",
        picture: user.picture || "",
        exp,
    };
    const bodyB64 = base64UrlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
    const sig = crypto.createHmac("sha256", secret).update(bodyB64).digest();
    return `${bodyB64}.${base64UrlEncode(sig)}`;
}

function verifySessionToken(token, secret, nowMs = Date.now()) {
    if (!token || !secret || typeof token !== "string") return null;
    const dot = token.indexOf(".");
    if (dot <= 0 || dot !== token.lastIndexOf(".")) return null;
    const bodyB64 = token.slice(0, dot);
    const sigB64 = token.slice(dot + 1);
    const expectedSig = base64UrlEncode(crypto.createHmac("sha256", secret).update(bodyB64).digest());
    const a = Buffer.from(sigB64, "utf8");
    const b = Buffer.from(expectedSig, "utf8");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    try {
        const parsed = JSON.parse(base64UrlDecodeToBuffer(bodyB64).toString("utf8"));
        if (!parsed || typeof parsed.uid !== "string" || !parsed.uid) return null;
        if (!Number.isFinite(Number(parsed.exp)) || Number(parsed.exp) <= Math.floor(nowMs / 1000)) return null;
        return {
            uid: cleanSingleLine(parsed.uid, 160),
            name: cleanSingleLine(parsed.name || "Singer", 80),
            email: cleanSingleLine(parsed.email || "", 160),
            picture: typeof parsed.picture === "string" && parsed.picture.startsWith("https://")
                ? parsed.picture.slice(0, 300)
                : "",
        };
    } catch {
        return null;
    }
}

function parseCookies(cookieHeader) {
    const out = {};
    for (const part of String(cookieHeader || "").split(";")) {
        const idx = part.indexOf("=");
        if (idx <= 0) continue;
        const key = part.slice(0, idx).trim();
        const val = part.slice(idx + 1).trim();
        if (key) out[key] = decodeURIComponent(val);
    }
    return out;
}

function isSecureRequest(req, env = process.env) {
    const proto = String(req.headers?.["x-forwarded-proto"] || "").toLowerCase();
    return proto === "https" || env.NODE_ENV === "production";
}

function buildSessionCookie(value, { maxAge, secure }) {
    const parts = [
        `${SESSION_COOKIE_NAME}=${encodeURIComponent(value)}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        `Max-Age=${maxAge}`,
    ];
    if (secure) parts.push("Secure");
    return parts.join("; ");
}

function checkSameOriginPost(req) {
    const secFetchSite = String(req.headers?.["sec-fetch-site"] || "").toLowerCase();
    if (secFetchSite === "cross-site") return false;
    const origin = String(req.headers?.origin || "").trim();
    if (!origin) return true;
    const host = String(req.headers?.["x-forwarded-host"] || req.headers?.host || "").trim().toLowerCase();
    if (!host) return true;
    try {
        return new URL(origin).host.toLowerCase() === host;
    } catch {
        return false;
    }
}

function sanitizeSetlistSong(raw) {
    if (!raw || typeof raw !== "object") return null;
    const song = cleanSingleLine(raw.song || raw.title || "", 160);
    const artist = cleanSingleLine(raw.artist || "", 140);
    if (!song && !raw.lookupSong) return null;
    const out = {
        id: cleanSongId(raw.id || "", 200),
        song,
        artist,
    };
    if (raw.legacyId) out.legacyId = cleanSongId(raw.legacyId, 200);
    if (raw.lookupSong) out.lookupSong = cleanSingleLine(raw.lookupSong, 160);
    if (raw.lookupArtist) out.lookupArtist = cleanSingleLine(raw.lookupArtist, 140);
    if (raw.displayArtist) out.displayArtist = cleanSingleLine(raw.displayArtist, 140);
    if (raw.artistKey) out.artistKey = cleanSingleLine(raw.artistKey, 140);
    if (raw.singer) out.singer = cleanSingleLine(raw.singer, 40);
    if (raw.sung) out.sung = true;
    if (Number.isFinite(Number(raw.seconds)) && Number(raw.seconds) > 0) {
        out.seconds = Math.min(3600, Math.round(Number(raw.seconds)));
    }
    return out;
}

function sanitizeRepertoire(raw) {
    const out = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    let count = 0;
    for (const [key, entry] of Object.entries(raw)) {
        if (count >= MAX_REPERTOIRE_ENTRIES) break;
        if (!entry || typeof entry !== "object") continue;
        if (!["saved", "want", "sung"].includes(entry.status)) continue;
        const song = sanitizeSetlistSong(entry.song);
        if (!song) continue;
        const id = cleanSongId(key || song.id, 200);
        if (!id) continue;
        const comfortNum = Number(entry.comfort);
        const updatedAt = Number(entry.updatedAt);
        out[id] = {
            song,
            status: entry.status,
            comfort: [1, 2, 3, 4, 5].includes(comfortNum) ? comfortNum : null,
            key: cleanSingleLine(entry.key || "", 40),
            notes: cleanText(entry.notes || "", 1000),
            updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? Math.floor(updatedAt) : 0,
        };
        count += 1;
    }
    return out;
}

function sanitizeTombstones(raw, limit = MAX_TOMBSTONES) {
    const out = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    const entries = Object.entries(raw)
        .filter(([k, v]) => typeof k === "string" && k.trim() && Number.isFinite(Number(v)) && Number(v) > 0)
        .sort((a, b) => Number(b[1]) - Number(a[1]))
        .slice(0, limit);
    for (const [k, v] of entries) {
        const cleaned = cleanSongId(k, 200);
        if (cleaned) out[cleaned] = Math.floor(Number(v));
    }
    return out;
}

function sanitizeSavedSetlists(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const entry of raw) {
        if (out.length >= MAX_SAVED_SETLISTS) break;
        if (!entry || typeof entry !== "object") continue;
        const name = cleanSingleLine(entry.name || "", 60);
        if (!name || !Array.isArray(entry.songs)) continue;
        const songs = [];
        for (const s of entry.songs) {
            if (songs.length >= MAX_SETLIST_ITEMS) break;
            const clean = sanitizeSetlistSong(s);
            if (clean) songs.push(clean);
        }
        const updatedAt = Number(entry.updatedAt);
        out.push({
            name,
            savedAt: cleanSingleLine(entry.savedAt || "", 20),
            updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? Math.floor(updatedAt) : 0,
            songs,
        });
    }
    return out;
}

function sanitizeAccountData(raw) {
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const setlist = [];
    if (Array.isArray(src.setlist)) {
        for (const s of src.setlist) {
            if (setlist.length >= MAX_SETLIST_ITEMS) break;
            const clean = sanitizeSetlistSong(s);
            if (clean) setlist.push(clean);
        }
    }
    const prefs = src.preferences && typeof src.preferences === "object" ? src.preferences : {};
    const theme = prefs.theme === "dark" || prefs.theme === "light" ? prefs.theme : "";
    return {
        repertoire: sanitizeRepertoire(src.repertoire),
        repertoireTombstones: sanitizeTombstones(src.repertoireTombstones, MAX_TOMBSTONES),
        setlist,
        setlistUpdatedAt: Number.isFinite(Number(src.setlistUpdatedAt)) ? Math.max(0, Math.floor(Number(src.setlistUpdatedAt))) : 0,
        savedSetlists: sanitizeSavedSetlists(src.savedSetlists),
        savedSetlistTombstones: sanitizeTombstones(src.savedSetlistTombstones, 200),
        preferences: {
            theme,
            compactView: typeof prefs.compactView === "boolean" ? prefs.compactView : null,
            singerName: cleanSingleLine(prefs.singerName || "", 40),
            updatedAt: Number.isFinite(Number(prefs.updatedAt)) ? Math.max(0, Math.floor(Number(prefs.updatedAt))) : 0,
        },
    };
}

function profileKey(uid) {
    return `karaoke:user:${uid}:profile`;
}

// Atomic optimistic-concurrency save (permanent key, NO TTL).
const SAVE_PROFILE_LUA = `
local currentRaw = redis.call("GET", KEYS[1])
local currentRev = 0
if currentRaw then
    local ok, parsed = pcall(cjson.decode, currentRaw)
    if ok and type(parsed) == "table" then
        currentRev = tonumber(parsed.revision) or 0
    end
end
local expected = tonumber(ARGV[1]) or 0
if currentRev ~= expected then
    return {"conflict", currentRaw or ""}
end
redis.call("SET", KEYS[1], ARGV[2])
return {"ok", ARGV[2]}
`;

function createUpstashAccountStore({ url, token, fetchImpl = fetch }) {
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
        if (!res.ok) throw new Error(`Upstash Redis HTTP ${res.status}`);
        const results = await res.json();
        if (!Array.isArray(results)) throw new Error("Invalid Upstash pipeline response");
        for (const entry of results) {
            if (entry && entry.error) throw new Error(`Upstash Redis error: ${entry.error}`);
        }
        return results.map((entry) => entry?.result);
    }

    return {
        async getProfile(uid) {
            const [raw] = await pipeline([["GET", profileKey(uid)]]);
            if (!raw || typeof raw !== "string") return null;
            try {
                return JSON.parse(raw);
            } catch {
                return null;
            }
        },
        async saveProfile(uid, expectedRevision, nextRecord) {
            const [res] = await pipeline([[
                "EVAL",
                SAVE_PROFILE_LUA,
                "1",
                profileKey(uid),
                String(expectedRevision),
                JSON.stringify(nextRecord),
            ]]);
            if (!Array.isArray(res) || !res.length) throw new Error("Invalid Upstash save response");
            if (res[0] === "conflict") {
                let current = null;
                try { current = res[1] ? JSON.parse(res[1]) : null; } catch { current = null; }
                return { status: "conflict", record: current };
            }
            return { status: "ok", record: nextRecord };
        },
        async deleteProfile(uid) {
            await pipeline([["DEL", profileKey(uid)]]);
        },
    };
}

function createMemoryAccountStore() {
    const map = new Map();
    return {
        async getProfile(uid) {
            const raw = map.get(uid);
            return raw ? JSON.parse(raw) : null;
        },
        async saveProfile(uid, expectedRevision, nextRecord) {
            const currentRaw = map.get(uid);
            const current = currentRaw ? JSON.parse(currentRaw) : null;
            const currentRev = current ? Number(current.revision) || 0 : 0;
            if (currentRev !== Number(expectedRevision || 0)) {
                return { status: "conflict", record: current };
            }
            map.set(uid, JSON.stringify(nextRecord));
            return { status: "ok", record: nextRecord };
        },
        async deleteProfile(uid) {
            map.delete(uid);
        },
    };
}

async function readJsonBody(req) {
    if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
        const size = Buffer.byteLength(JSON.stringify(req.body), "utf8");
        if (size > MAX_BODY_BYTES) {
            const err = new Error("Profile payload too large");
            err.statusCode = 413;
            throw err;
        }
        return req.body;
    }
    if (typeof req.body === "string") {
        if (Buffer.byteLength(req.body, "utf8") > MAX_BODY_BYTES) {
            const err = new Error("Profile payload too large");
            err.statusCode = 413;
            throw err;
        }
        return req.body.trim() ? JSON.parse(req.body) : {};
    }
    if (Buffer.isBuffer(req.body)) {
        if (req.body.length > MAX_BODY_BYTES) {
            const err = new Error("Profile payload too large");
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
                const err = new Error("Profile payload too large");
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

function createAccountHandler({
    store,
    env = process.env,
    fetchImpl = fetch,
    verifyGoogleToken,
    now = () => Date.now(),
} = {}) {
    const verifier = verifyGoogleToken || createJwksVerifier({ fetchImpl, now });

    return async function handler(req, res) {
        const method = String(req.method || "GET").toUpperCase();
        if (method !== "GET" && method !== "POST") {
            res.setHeader("Allow", "GET, POST");
            return sendJson(res, 405, { error: "Method not allowed" });
        }

        const cfg = resolveEnvAccountConfig(env);
        const activeStore = store || (cfg.storageConfigured
            ? createUpstashAccountStore({ url: cfg.upstashUrl, token: cfg.upstashToken, fetchImpl })
            : null);
        const sessionSecret = cfg.sessionSecret || (store && cfg.googleClientId ? "test-session-secret" : "");
        const configured = Boolean(activeStore && cfg.googleClientId && sessionSecret);

        if (!configured) {
            return sendJson(res, 200, {
                configured: false,
                googleConfigured: cfg.googleConfigured,
                storageConfigured: Boolean(activeStore),
                signedIn: false,
                user: null,
                record: null,
            });
        }

        const cookies = parseCookies(req.headers?.cookie);
        const sessionUser = verifySessionToken(cookies[SESSION_COOKIE_NAME], sessionSecret, now());

        try {
            if (method === "GET") {
                if (!sessionUser) {
                    return sendJson(res, 200, {
                        configured: true,
                        googleClientId: cfg.googleClientId,
                        signedIn: false,
                        user: null,
                        record: null,
                    });
                }
                const record = await activeStore.getProfile(sessionUser.uid);
                return sendJson(res, 200, {
                    configured: true,
                    googleClientId: cfg.googleClientId,
                    signedIn: true,
                    user: sessionUser,
                    record,
                });
            }

            if (!checkSameOriginPost(req)) {
                return sendJson(res, 403, { configured: true, error: "Cross-origin request blocked." });
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

            const action = cleanSingleLine(body?.action, 32).toLowerCase();
            const secureCookie = isSecureRequest(req, env);

            if (action === "google-login") {
                const credential = String(body?.credential || "").trim();
                if (!credential) {
                    return sendJson(res, 400, { configured: true, error: "Missing Google sign-in token." });
                }
                let user;
                try {
                    user = await verifier(credential, cfg.googleClientId);
                } catch (err) {
                    return sendJson(res, 401, {
                        configured: true,
                        error: err.message || "Could not verify Google sign-in.",
                    });
                }
                const token = signSessionToken(user, sessionSecret, now());
                res.setHeader("Set-Cookie", buildSessionCookie(token, { maxAge: SESSION_TTL_SECONDS, secure: secureCookie }));
                const record = await activeStore.getProfile(user.uid);
                return sendJson(res, 200, {
                    configured: true,
                    googleClientId: cfg.googleClientId,
                    signedIn: true,
                    user,
                    record,
                });
            }

            if (action === "logout") {
                res.setHeader("Set-Cookie", buildSessionCookie("", { maxAge: 0, secure: secureCookie }));
                return sendJson(res, 200, {
                    configured: true,
                    googleClientId: cfg.googleClientId,
                    signedIn: false,
                    user: null,
                });
            }

            if (!sessionUser) {
                return sendJson(res, 401, { configured: true, error: "Sign in to sync your account." });
            }

            if (action === "save") {
                const expectedRevision = Math.max(0, Math.floor(Number(body?.expectedRevision) || 0));
                const sanitized = sanitizeAccountData(body?.data);
                const nextRecord = {
                    version: 1,
                    revision: expectedRevision + 1,
                    updatedAt: now(),
                    data: sanitized,
                };
                const outcome = await activeStore.saveProfile(sessionUser.uid, expectedRevision, nextRecord);
                if (outcome.status === "conflict") {
                    return sendJson(res, 409, {
                        configured: true,
                        conflict: true,
                        record: outcome.record,
                    });
                }
                return sendJson(res, 200, {
                    configured: true,
                    ok: true,
                    revision: nextRecord.revision,
                    updatedAt: nextRecord.updatedAt,
                    record: nextRecord,
                });
            }

            if (action === "delete-cloud") {
                await activeStore.deleteProfile(sessionUser.uid);
                res.setHeader("Set-Cookie", buildSessionCookie("", { maxAge: 0, secure: secureCookie }));
                return sendJson(res, 200, {
                    configured: true,
                    deleted: true,
                    signedIn: false,
                });
            }

            return sendJson(res, 400, { configured: true, error: "Unsupported account action." });
        } catch {
            return sendJson(res, 502, {
                configured: true,
                error: "Account sync storage is temporarily unavailable.",
            });
        }
    };
}

const defaultHandler = createAccountHandler();
module.exports = defaultHandler;
module.exports.createAccountHandler = createAccountHandler;
module.exports.createJwksVerifier = createJwksVerifier;
module.exports.createUpstashAccountStore = createUpstashAccountStore;
module.exports.createMemoryAccountStore = createMemoryAccountStore;
module.exports.signSessionToken = signSessionToken;
module.exports.verifySessionToken = verifySessionToken;
module.exports.sanitizeAccountData = sanitizeAccountData;
module.exports.resolveEnvAccountConfig = resolveEnvAccountConfig;
