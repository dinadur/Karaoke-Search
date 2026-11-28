#!/usr/bin/env node
// Unit tests for api/account.js (RS256 Google JWKS verification, session cookies,
// CSRF checks, atomic optimistic-concurrency Upstash saves) and account-sync.js
// mergeAccountData() conflict/tombstone logic.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {
    createAccountHandler,
    createJwksVerifier,
    createMemoryAccountStore,
    createUpstashAccountStore,
    resolveEnvAccountConfig,
} = require("../api/account");
const { mergeAccountData } = require("../account-sync");

function b64url(input) {
    return Buffer.from(input)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}

function signJwt(payload, privateKey, { kid = "key-1", alg = "RS256" } = {}) {
    const headerB64 = b64url(JSON.stringify({ alg, typ: "JWT", kid }));
    const payloadB64 = b64url(JSON.stringify(payload));
    const sig = crypto.sign("RSA-SHA256", Buffer.from(`${headerB64}.${payloadB64}`), privateKey);
    return `${headerB64}.${payloadB64}.${b64url(sig)}`;
}

function makeRes() {
    const headers = {};
    let body = "";
    return {
        statusCode: 0,
        setHeader(k, v) { headers[k.toLowerCase()] = v; },
        getHeader(k) { return headers[k.toLowerCase()]; },
        end(chunk = "") { body += chunk; },
        json() { return JSON.parse(body); },
    };
}

async function call(handler, { method = "GET", headers = {}, body } = {}) {
    const req = { method, url: "/api/account", headers, body };
    const res = makeRes();
    await handler(req, res);
    return { status: res.statusCode, headers: res, data: res.json() };
}

(async () => {
    // 1. Env config resolution (single GOOGLE_CLIENT_ID + existing Upstash token derives session secret)
    const derived = resolveEnvAccountConfig({
        GOOGLE_CLIENT_ID: "client-123.apps.googleusercontent.com",
        UPSTASH_REDIS_REST_URL: "https://up.example",
        UPSTASH_REDIS_REST_TOKEN: "redis-secret",
    });
    assert.equal(derived.configured, true);
    assert.ok(derived.sessionSecret.length === 64);
    assert.equal(resolveEnvAccountConfig({ UPSTASH_REDIS_REST_URL: "https://up.example", UPSTASH_REDIS_REST_TOKEN: "tok" }).configured, false);

    // 2. Real RS256 Google ID token verification via JWKS + key rotation
    const kp1 = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const kp2 = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk1 = { ...kp1.publicKey.export({ format: "jwk" }), kid: "kid-1", use: "sig", alg: "RS256" };
    const jwk2 = { ...kp2.publicKey.export({ format: "jwk" }), kid: "kid-2", use: "sig", alg: "RS256" };

    let jwksFetchCount = 0;
    let activeJwks = [jwk1];
    let clock = 1_750_000_000_000;
    const nowSec = () => Math.floor(clock / 1000);
    const clientId = "test-client.apps.googleusercontent.com";

    const verifier = createJwksVerifier({
        now: () => clock,
        fetchImpl: async () => {
            jwksFetchCount += 1;
            return {
                ok: true,
                headers: { get: (k) => (k.toLowerCase() === "cache-control" ? "public, max-age=3600" : null) },
                async json() { return { keys: activeJwks }; },
            };
        },
    });

    const validJwt = signJwt({
        iss: "https://accounts.google.com",
        aud: clientId,
        sub: "100200300",
        name: "Neal Singer",
        email: "neal@example.com",
        email_verified: true,
        picture: "https://lh3.googleusercontent.com/avatar.png",
        iat: nowSec() - 10,
        exp: nowSec() + 3600,
    }, kp1.privateKey, { kid: "kid-1" });

    const verifiedUser = await verifier(validJwt, clientId);
    assert.equal(verifiedUser.uid, "google:100200300");
    assert.equal(verifiedUser.name, "Neal Singer");
    assert.equal(jwksFetchCount, 1);

    // Second verify hits cache (no extra JWKS fetch)
    await verifier(validJwt, clientId);
    assert.equal(jwksFetchCount, 1);

    // Unknown kid triggers JWKS refresh (Google key rotation)
    activeJwks = [jwk1, jwk2];
    const rotatedJwt = signJwt({
        iss: "accounts.google.com",
        aud: clientId,
        sub: "100200300",
        name: "Neal Singer",
        email: "neal@example.com",
        email_verified: true,
        iat: nowSec() - 10,
        exp: nowSec() + 3600,
    }, kp2.privateKey, { kid: "kid-2" });
    const rotatedUser = await verifier(rotatedJwt, clientId);
    assert.equal(rotatedUser.uid, "google:100200300");
    assert.equal(jwksFetchCount, 2);

    // Reject wrong audience, expired token, tampered signature, unverified email
    await assert.rejects(() => verifier(validJwt, "other-client"), /audience/i);
    const expiredJwt = signJwt({
        iss: "https://accounts.google.com",
        aud: clientId,
        sub: "1",
        exp: nowSec() - 5,
    }, kp1.privateKey, { kid: "kid-1" });
    await assert.rejects(() => verifier(expiredJwt, clientId), /expired/i);
    await assert.rejects(() => verifier(`${validJwt.slice(0, -4)}AAAA`, clientId), /signature/i);
    const unverifiedJwt = signJwt({
        iss: "https://accounts.google.com",
        aud: clientId,
        sub: "1",
        email: "x@example.com",
        email_verified: false,
        exp: nowSec() + 300,
    }, kp1.privateKey, { kid: "kid-1" });
    await assert.rejects(() => verifier(unverifiedJwt, clientId), /verified/i);

    // 3. Full /api/account handler lifecycle
    const store = createMemoryAccountStore();
    const handler = createAccountHandler({
        store,
        verifyGoogleToken: verifier,
        now: () => clock,
        env: {
            GOOGLE_CLIENT_ID: clientId,
            ACCOUNT_SESSION_SECRET: "unit-test-secret",
            NODE_ENV: "production",
        },
    });

    // Unconfigured fallback
    const uncfgHandler = createAccountHandler({ env: {} });
    const uncfg = await call(uncfgHandler);
    assert.equal(uncfg.status, 200);
    assert.equal(uncfg.data.configured, false);

    // Signed-out GET
    const signedOut = await call(handler);
    assert.equal(signedOut.status, 200);
    assert.equal(signedOut.data.configured, true);
    assert.equal(signedOut.data.signedIn, false);
    assert.equal(signedOut.data.googleClientId, clientId);

    // Cross-origin POST blocked with 403
    const csrfBlocked = await call(handler, {
        method: "POST",
        headers: { host: "karaokesearch.uk", origin: "https://evil.example" },
        body: { action: "google-login", credential: validJwt },
    });
    assert.equal(csrfBlocked.status, 403);

    // Google login sets HttpOnly Secure SameSite=Lax cookie
    const login = await call(handler, {
        method: "POST",
        headers: { host: "karaokesearch.uk", origin: "https://karaokesearch.uk" },
        body: { action: "google-login", credential: validJwt },
    });
    assert.equal(login.status, 200);
    assert.equal(login.data.signedIn, true);
    assert.equal(login.data.user.uid, "google:100200300");
    const setCookie = login.headers.getHeader("set-cookie");
    assert.match(setCookie, /karaoke_session=/);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
    assert.match(setCookie, /Secure/);
    const cookiePair = setCookie.split(";")[0];

    // Authenticated save (rev 0 -> rev 1) using real \u001f catalog song IDs
    const usSongId = "queen\u001fbohemian rhapsody\u001fbohemian rhapsody";
    const usDeletedId = "abba\u001fdancing queen\u001fdancing queen";
    const save1 = await call(handler, {
        method: "POST",
        headers: { cookie: cookiePair },
        body: {
            action: "save",
            expectedRevision: 0,
            data: {
                repertoire: {
                    [usSongId]: {
                        song: { id: usSongId, song: "Bohemian Rhapsody", artist: "Queen" },
                        status: "want",
                        comfort: 5,
                        key: "Bb",
                        notes: "Nail the operatic section",
                        updatedAt: clock,
                    },
                },
                repertoireTombstones: { [usDeletedId]: clock - 1000 },
                setlist: [{ id: usSongId, song: "Bohemian Rhapsody", artist: "Queen" }],
                setlistUpdatedAt: clock,
                savedSetlists: [],
                preferences: { theme: "dark", compactView: true, singerName: "Neal", updatedAt: clock },
            },
        },
    });
    assert.equal(save1.status, 200);
    assert.equal(save1.data.revision, 1);

    // Stale expectedRevision (0) triggers 409 conflict returning latest server record
    const conflict = await call(handler, {
        method: "POST",
        headers: { cookie: cookiePair },
        body: { action: "save", expectedRevision: 0, data: { repertoire: {} } },
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.data.conflict, true);
    assert.equal(conflict.data.record.revision, 1);

    // GET with cookie restores user & saved profile, preserving \u001f song IDs intact
    const me = await call(handler, { headers: { cookie: cookiePair } });
    assert.equal(me.status, 200);
    assert.equal(me.data.signedIn, true);
    assert.equal(me.data.record.revision, 1);
    assert.equal(me.data.record.data.repertoire[usSongId].key, "Bb");
    assert.equal(me.data.record.data.repertoire[usSongId].song.id, usSongId);
    assert.equal(me.data.record.data.setlist[0].id, usSongId);
    assert.equal(me.data.record.data.repertoireTombstones[usDeletedId], clock - 1000);

    // Delete cloud copy clears Redis profile and cookie
    const del = await call(handler, {
        method: "POST",
        headers: { cookie: cookiePair },
        body: { action: "delete-cloud" },
    });
    assert.equal(del.status, 200);
    assert.equal(del.data.deleted, true);
    assert.equal(await store.getProfile("google:100200300"), null);

    // 4. Upstash store pipeline format check (permanent SET via Lua EVAL, no TTL)
    const sent = [];
    const upStore = createUpstashAccountStore({
        url: "https://fake-upstash.example",
        token: "tok",
        fetchImpl: async (url, init) => {
            const cmds = JSON.parse(init.body);
            sent.push(cmds);
            return {
                ok: true,
                async json() { return [{ result: ["ok", cmds[0][4]] }]; },
            };
        },
    });
    const upSaved = await upStore.saveProfile("google:1", 0, { version: 1, revision: 1, updatedAt: clock, data: {} });
    assert.equal(upSaved.status, "ok");
    assert.equal(sent[0][0][0], "EVAL");
    assert.equal(sent[0][0][3], "karaoke:user:google:1:profile");

    // 5. Client-side mergeAccountData() LWW + tombstone + initial-signin union semantics
    const mergedInitial = mergeAccountData(
        {
            repertoire: {
                s1: { song: { id: "s1", song: "Local Song", artist: "A" }, status: "saved", updatedAt: 1000 },
                s2: { song: { id: "s2", song: "Shared", artist: "B" }, status: "saved", notes: "older", updatedAt: 1000 },
            },
            repertoireTombstones: {},
            setlist: [{ id: "s1", song: "Local Song", artist: "A" }],
            setlistUpdatedAt: 1000,
            savedSetlists: [{ name: "Warmups", savedAt: "2026-11-28", updatedAt: 1000, songs: [{ id: "s1", song: "Local Song", artist: "A" }] }],
            savedSetlistTombstones: {},
            preferences: { theme: "light", compactView: false, singerName: "", updatedAt: 1000 },
        },
        {
            repertoire: {
                s2: { song: { id: "s2", song: "Shared", artist: "B" }, status: "sung", notes: "newer", updatedAt: 2000 },
                s3: { song: { id: "s3", song: "Cloud Song", artist: "C" }, status: "want", updatedAt: 2000 },
            },
            repertoireTombstones: {},
            setlist: [{ id: "s3", song: "Cloud Song", artist: "C" }],
            setlistUpdatedAt: 2000,
            savedSetlists: [],
            savedSetlistTombstones: {},
            preferences: { theme: "dark", compactView: true, singerName: "Neal", updatedAt: 2000 },
        },
        { isInitialSignIn: true, nowMs: 3000 }
    );
    assert.deepEqual(Object.keys(mergedInitial.repertoire).sort(), ["s1", "s2", "s3"]);
    assert.equal(mergedInitial.repertoire.s2.notes, "newer");
    assert.deepEqual(mergedInitial.setlist.map((s) => s.id), ["s3", "s1"]);
    assert.equal(mergedInitial.preferences.theme, "dark");
    assert.equal(mergedInitial.preferences.singerName, "Neal");

    // Tombstone deletes song when deletion timestamp beats live entry, and re-save beats older tombstone
    const mergedDeletion = mergeAccountData(
        {
            repertoire: {
                s1: { song: { id: "s1", song: "Song 1", artist: "A" }, status: "saved", updatedAt: 1000 },
                s2: { song: { id: "s2", song: "Re-saved", artist: "B" }, status: "saved", updatedAt: 5000 },
            },
            repertoireTombstones: {},
        },
        {
            repertoire: {},
            repertoireTombstones: { s1: 4000, s2: 3000 },
        },
        { isInitialSignIn: false, nowMs: 6000 }
    );
    assert.equal("s1" in mergedDeletion.repertoire, false, "Newer tombstone must delete s1");
    assert.equal(mergedDeletion.repertoireTombstones.s1, 4000);
    assert.equal("s2" in mergedDeletion.repertoire, true, "Newer re-save must beat older tombstone");

    // Cleared singerName with newer timestamp must override older non-empty singerName
    const clearedSinger = mergeAccountData(
        { preferences: { theme: "dark", compactView: false, singerName: "", updatedAt: 5000 } },
        { preferences: { theme: "dark", compactView: false, singerName: "Neal", updatedAt: 2000 } },
        { isInitialSignIn: false, nowMs: 6000 }
    );
    assert.equal(clearedSinger.preferences.singerName, "");

    // Saved-setlist name normalization folds accents & punctuation identically to normalize()
    const { normalizeAccountSetlistName } = require("../account-sync");
    assert.equal(normalizeAccountSetlistName("Café & Tea!"), normalizeAccountSetlistName("Cafe and Tea"));

    console.log("ok   api/account.js & account-sync.js unit tests passed");
})();
