#!/usr/bin/env node
// Unit tests for api/night-room.js (Live Multi-Phone Rooms serverless endpoint).
const assert = require("node:assert/strict");
const {
    createRoomHandler,
    createMemoryStore,
    createUpstashStore,
    normalizeRoomCode,
    parseHgetallResult,
    resolveEnvUpstashConfig,
} = require("../api/night-room");

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

async function call(handler, { method = "GET", url = "/api/night-room", headers = {}, body } = {}) {
    const req = { method, url, headers, body };
    const res = makeRes();
    await handler(req, res);
    return { status: res.statusCode, headers: res, data: res.json() };
}

(async () => {
    // 1. Helpers
    assert.equal(normalizeRoomCode("  k7m-4p2 "), "K7M4P2");
    assert.equal(normalizeRoomCode("ab"), "");
    assert.deepEqual(
        resolveEnvUpstashConfig({ KV_REST_API_URL: "https://kv.example", KV_REST_API_TOKEN: "tok" }),
        { url: "https://kv.example", token: "tok" }
    );
    assert.deepEqual(
        resolveEnvUpstashConfig({ UPSTASH_REDIS_REST_URL: "https://up.example", UPSTASH_REDIS_REST_TOKEN: "tok2" }),
        { url: "https://up.example", token: "tok2" }
    );
    assert.equal(resolveEnvUpstashConfig({}), null);

    // HGETALL array + object parsing
    const parsedArr = parseHgetallResult([
        "req_b", JSON.stringify({ id: "req_b", title: "B", createdAt: 200 }),
        "req_a", JSON.stringify({ id: "req_a", title: "A", createdAt: 100 }),
    ]);
    assert.deepEqual(parsedArr.map((r) => r.id), ["req_a", "req_b"]);

    // 2. Unconfigured fallback
    const unconfiguredHandler = createRoomHandler({ env: {} });
    const uncfg = await call(unconfiguredHandler, { method: "GET", url: "/api/night-room?code=K7M4P2" });
    assert.equal(uncfg.status, 200);
    assert.equal(uncfg.data.configured, false);
    assert.equal(uncfg.headers.getHeader("cache-control"), "no-store");

    // 3. Full room lifecycle with memory store + controllable clock
    let clock = 1_700_000_000_000;
    const store = createMemoryStore({ now: () => clock });
    const handler = createRoomHandler({ store, now: () => clock });

    // Create room (default: auto-queue, unlocked, unlimited)
    const created = await call(handler, {
        method: "POST",
        body: {
            action: "create",
            current: { uid: "u1", title: "Bohemian Rhapsody", artist: "Queen", singer: "Host", seconds: 354, playing: false },
            upNext: [],
            sungCount: 0,
        },
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.configured, true);
    assert.match(created.data.code, /^[A-Z0-9]{6}$/);
    assert.ok(created.data.hostToken.length >= 24);
    assert.equal(created.data.room.approvalRequired, false);
    assert.equal(created.data.room.locked, false);
    assert.equal(created.data.room.hostTokenHash, undefined, "Never expose hostTokenHash");

    const { code, hostToken } = created.data;

    // Public GET must never expose hostTokenHash
    const fetched = await call(handler, { method: "GET", url: `/api/night-room?code=${code}` });
    assert.equal(fetched.status, 200);
    assert.equal(fetched.data.room.code, code);
    assert.equal(fetched.data.room.current.title, "Bohemian Rhapsody");
    assert.equal("hostTokenHash" in fetched.data.room, false);

    // Guest submits a song request
    clock += 1000;
    const req1 = await call(handler, {
        method: "POST",
        body: {
            action: "request",
            code,
            singer: "Sam",
            title: "Mr. Brightside",
            artist: "The Killers",
            seconds: 222,
        },
    });
    assert.equal(req1.status, 201);
    assert.equal(req1.data.request.singer, "Sam");
    assert.equal(req1.data.room.pendingRequests.length, 1);

    // Duplicate song by same singer is rejected with 409
    const dup = await call(handler, {
        method: "POST",
        body: {
            action: "request",
            code,
            singer: "sam",
            title: "Mr. Brightside",
            artist: "The Killers",
        },
    });
    assert.equal(dup.status, 409);

    // Host sync with wrong token is rejected with 403
    const badAuth = await call(handler, {
        method: "POST",
        headers: { "x-host-token": "wrong-token" },
        body: { action: "sync", code, upNext: [] },
    });
    assert.equal(badAuth.status, 403);

    // Concurrent second guest request arrives BEFORE host acks req1
    clock += 1000;
    const req2 = await call(handler, {
        method: "POST",
        body: {
            action: "request",
            code,
            singer: "Maya",
            title: "Dancing Queen",
            artist: "ABBA",
            seconds: 231,
        },
    });
    assert.equal(req2.status, 201);
    assert.equal(req2.data.room.pendingRequests.length, 2);

    // Host sync acknowledges ONLY req1 — req2 MUST remain untouched in pendingRequests!
    clock += 1000;
    const synced = await call(handler, {
        method: "POST",
        headers: { "x-host-token": hostToken },
        body: {
            action: "sync",
            code,
            ackedRequestIds: [req1.data.request.id],
            maxPerSinger: 1,
            approvalRequired: true,
            upNext: [
                { uid: "u2", title: "Mr. Brightside", artist: "The Killers", singer: "Sam", seconds: 222, waitMin: 4, requestId: req1.data.request.id },
            ],
        },
    });
    assert.equal(synced.status, 200);
    assert.equal(synced.data.room.revision, 2);
    assert.equal(synced.data.room.approvalRequired, true);
    assert.equal(synced.data.room.maxPerSinger, 1);
    assert.deepEqual(synced.data.room.pendingRequests.map((r) => r.id), [req2.data.request.id]);

    // Per-singer limit (1) blocks Sam from queuing a second song
    const capped = await call(handler, {
        method: "POST",
        body: {
            action: "request",
            code,
            singer: "Sam",
            title: "Don't Stop Believin'",
            artist: "Journey",
        },
    });
    assert.equal(capped.status, 429);

    // Host declines req2 and locks requests
    const declined = await call(handler, {
        method: "POST",
        headers: { "x-host-token": hostToken },
        body: {
            action: "sync",
            code,
            ackedRequestIds: [req2.data.request.id],
            declinedIds: [req2.data.request.id],
            locked: true,
        },
    });
    assert.equal(declined.status, 200);
    assert.equal(declined.data.room.pendingRequests.length, 0);
    assert.deepEqual(declined.data.room.declinedIds, [req2.data.request.id]);

    // Locked room rejects new requests with 403
    const lockedReq = await call(handler, {
        method: "POST",
        body: { action: "request", code, singer: "Alex", title: "Africa", artist: "Toto" },
    });
    assert.equal(lockedReq.status, 403);

    // Host closes room
    const closed = await call(handler, {
        method: "POST",
        headers: { "x-host-token": hostToken },
        body: { action: "close", code },
    });
    assert.equal(closed.status, 200);
    assert.equal(closed.data.closed, true);

    const missing = await call(handler, { method: "GET", url: `/api/night-room?code=${code}` });
    assert.equal(missing.status, 404);

    // 4. Verify Upstash REST store pipeline command format
    const sentPipelines = [];
    const upstashStore = createUpstashStore({
        url: "https://fake-upstash.example/",
        token: "secret-token",
        fetchImpl: async (url, init) => {
            assert.equal(url, "https://fake-upstash.example/pipeline");
            assert.equal(init.headers.Authorization, "Bearer secret-token");
            const cmds = JSON.parse(init.body);
            sentPipelines.push(cmds);
            return {
                ok: true,
                async json() {
                    return cmds.map((cmd) => {
                        if (cmd[0] === "GET") return { result: JSON.stringify({ code: "TEST99", revision: 1 }) };
                        if (cmd[0] === "HGETALL") return { result: ["r1", JSON.stringify({ id: "r1", title: "Song", createdAt: 1 })] };
                        return { result: "OK" };
                    });
                },
            };
        },
    });
    const upRoom = await upstashStore.getRoom("TEST99");
    assert.equal(upRoom.meta.code, "TEST99");
    assert.equal(upRoom.pendingRequests.length, 1);
    assert.deepEqual(sentPipelines[0], [
        ["GET", "karaoke:room:TEST99:meta"],
        ["HGETALL", "karaoke:room:TEST99:requests"],
    ]);

    console.log("ok   api/night-room.js unit tests passed");
})();
