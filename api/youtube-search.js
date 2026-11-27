// Vercel Serverless Function: GET /api/youtube-search?song=...&artist=...&seconds=...
// Finds and ranks the best embeddable karaoke track on YouTube for a song.
// Requires YOUTUBE_API_KEY in Vercel environment variables; degrades cleanly
// to a smart YouTube search URL when unconfigured or when daily quota is hit.

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

const TRUSTED_KARAOKE_CHANNELS = [
    "sing king",
    "karafun karaoke",
    "karafun",
    "stingray karaoke",
    "zoom karaoke",
    "sunfly karaoke",
    "cc karaoke",
    "karaoke version",
    "party tyme karaoke",
    "lucky voice karaoke",
    "lucky voice",
    "thekaraokechannel",
    "karaokeonvevo",
    "all star karaoke",
    "acoustic karaoke",
    "karaoke hits",
    "prosource karaoke",
    "sing2piano",
    "sing2guitar",
    "karaokekeys",
    "midifine karaoke",
];

const POSITIVE_KARAOKE_PATTERNS = [
    { pattern: /\bkaraoke\b/i, score: 30, tag: "Karaoke" },
    { pattern: /\b(?:with\s+)?lyrics\b/i, score: 10, tag: "Lyrics" },
    { pattern: /\binstrumental\b/i, score: 8, tag: "Instrumental" },
    { pattern: /\b(?:no\s+vocals|without\s+vocals|backing\s+track|off\s+vocal)\b/i, score: 10, tag: "Backing track" },
];

const NEGATIVE_VIDEO_PATTERNS = [
    { pattern: /\b(?:with\s+vocals|guide\s+vocal|lead\s+vocal|full\s+vocal|sing\s+along\s+with\s+vocals)\b/i, score: -55 },
    { pattern: /\b(?:official\s+(?:music\s+)?video|official\s+audio|music\s+video)\b/i, score: -60 },
    { pattern: /\b(?:cover|reaction|tutorial|lesson|how\s+to\s+play|how\s+to\s+sing|review|explained)\b/i, score: -50 },
    { pattern: /\b(?:live\s+at|live\s+in|live\s+performance|concert|tiny\s+desk|mtv\s+unplugged)\b/i, score: -45 },
    { pattern: /\b(?:nightcore|slowed|reverb|8d\s+audio|sped\s+up|1\s*hour|loop|mashup|remix|medley)\b/i, score: -55 },
    { pattern: /#shorts\b/i, score: -70 },
];

const KEY_SHIFT_PATTERN = /\b(?:lower\s+key|higher\s+key|female\s+key|male\s+key|acoustic\s+version|piano\s+version|[-+]\s*[1-6]\s*(?:key|semitone|half\s*step))\b/i;

function normalizeText(value) {
    return String(value || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/['\u2018\u2019\u02bc]/g, "")
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function decodeHtmlEntities(value) {
    return String(value || "")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");
}

function parseIsoDuration(iso) {
    const match = String(iso || "").match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
    if (!match) return 0;
    const hours = Number(match[1] || 0);
    const minutes = Number(match[2] || 0);
    const seconds = Number(match[3] || 0);
    return hours * 3600 + minutes * 60 + seconds;
}

function buildYoutubeSearchUrl(song, artist) {
    const parts = [String(artist || "").trim(), String(song || "").trim(), "karaoke"].filter(Boolean);
    return `https://www.youtube.com/results?search_query=${encodeURIComponent(parts.join(" "))}`;
}

function extractYoutubeVideoId(input) {
    const raw = String(input || "").trim();
    if (!raw) return "";
    if (VIDEO_ID_PATTERN.test(raw)) return raw;
    try {
        const url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
        const host = url.hostname.replace(/^www\./, "").toLowerCase();
        if (host === "youtu.be") {
            const id = url.pathname.split("/").filter(Boolean)[0] || "";
            return VIDEO_ID_PATTERN.test(id) ? id : "";
        }
        if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com" || host === "youtube-nocookie.com") {
            const v = url.searchParams.get("v");
            if (v && VIDEO_ID_PATTERN.test(v)) return v;
            const segments = url.pathname.split("/").filter(Boolean);
            if (["embed", "shorts", "live", "v"].includes(segments[0]) && VIDEO_ID_PATTERN.test(segments[1] || "")) {
                return segments[1];
            }
        }
    } catch {
        return "";
    }
    return "";
}

function tokenOverlapRatio(needle, haystack) {
    const tokens = normalizeText(needle).split(" ").filter((t) => t.length > 1);
    if (!tokens.length) return 0;
    const hay = ` ${normalizeText(haystack)} `;
    let matched = 0;
    for (const token of tokens) {
        if (hay.includes(` ${token} `) || hay.includes(token)) {
            matched++;
        }
    }
    return matched / tokens.length;
}

function isTrustedChannel(channelTitle) {
    const norm = normalizeText(channelTitle);
    if (!norm) return false;
    return TRUSTED_KARAOKE_CHANNELS.some((trusted) => norm === trusted || norm.includes(trusted));
}

function rankKaraokeVideos(items, { song = "", artist = "", seconds = 0 } = {}) {
    const targetSeconds = Number.isFinite(Number(seconds)) && Number(seconds) > 0 ? Number(seconds) : 0;
    const requestedKeyShift = KEY_SHIFT_PATTERN.test(`${song} ${artist}`);
    const scored = [];

    for (const item of items || []) {
        const id = String(item?.id || "");
        if (!VIDEO_ID_PATTERN.test(id)) continue;
        if (item.embeddable === false) continue;

        const title = decodeHtmlEntities(item.title || "");
        const channel = decodeHtmlEntities(item.channel || "");
        const durationSec = Number(item.durationSec || 0);
        const views = Number(item.views || 0);

        let score = 0;
        const tags = [];

        if (isTrustedChannel(channel)) {
            score += 40;
            tags.push("Trusted channel");
        } else if (/\bkaraoke\b/i.test(channel)) {
            score += 18;
            tags.push("Karaoke channel");
        }

        for (const rule of POSITIVE_KARAOKE_PATTERNS) {
            if (rule.pattern.test(title)) {
                score += rule.score;
                if (!tags.includes(rule.tag) && tags.length < 3) {
                    tags.push(rule.tag);
                }
            }
        }

        for (const rule of NEGATIVE_VIDEO_PATTERNS) {
            if (rule.pattern.test(title)) {
                score += rule.score;
            }
        }

        if (!requestedKeyShift && KEY_SHIFT_PATTERN.test(title)) {
            score -= 12;
            if (!tags.includes("Alt key") && tags.length < 3) {
                tags.push("Alt key");
            }
        }

        if (song) {
            const titleOverlap = tokenOverlapRatio(song, title);
            score += Math.round(titleOverlap * 28);
            if (titleOverlap < 0.4) {
                score -= 25;
            }
        }
        if (artist) {
            const artistOverlap = tokenOverlapRatio(artist, `${title} ${channel}`);
            score += Math.round(artistOverlap * 22);
        }

        if (durationSec > 0) {
            if (durationSec < 60) {
                score -= 80;
            } else if (durationSec > 720) {
                score -= 60;
            } else if (durationSec >= 90 && durationSec <= 480) {
                score += 14;
            }
            if (targetSeconds >= 60 && Math.abs(durationSec - targetSeconds) <= 25) {
                score += 12;
            }
        }

        if (views > 0) {
            score += Math.min(12, Math.round(Math.log10(views + 1) * 2));
        }

        scored.push({
            id,
            title,
            channel,
            thumbnail: item.thumbnail || `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
            durationSec,
            views,
            score,
            tags,
            embedUrl: `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1`,
            watchUrl: `https://www.youtube.com/watch?v=${id}`,
        });
    }

    scored.sort((a, b) => b.score - a.score || b.views - a.views || a.id.localeCompare(b.id));
    return scored.slice(0, 5);
}

async function fetchYoutubeCandidates({ song, artist, seconds, apiKey, fetchImpl = fetch }) {
    const query = [artist, song, "karaoke"].filter(Boolean).join(" ").trim();
    const searchParams = new URLSearchParams({
        part: "snippet",
        type: "video",
        videoEmbeddable: "true",
        maxResults: "12",
        q: query,
        key: apiKey,
    });
    const searchRes = await fetchImpl(`https://www.googleapis.com/youtube/v3/search?${searchParams.toString()}`);
    if (searchRes.status === 403 || searchRes.status === 429) {
        return { quotaExceeded: true, candidates: [] };
    }
    if (!searchRes.ok) {
        throw new Error(`YouTube search HTTP ${searchRes.status}`);
    }
    const searchJson = await searchRes.json();
    const rawItems = (searchJson.items || [])
        .map((item) => ({
            id: item?.id?.videoId || "",
            title: item?.snippet?.title || "",
            channel: item?.snippet?.channelTitle || "",
            thumbnail: item?.snippet?.thumbnails?.medium?.url || item?.snippet?.thumbnails?.default?.url || "",
        }))
        .filter((item) => VIDEO_ID_PATTERN.test(item.id));

    if (!rawItems.length) {
        return { quotaExceeded: false, candidates: [] };
    }

    // Fetch duration, embeddable status, and view count (costs only 1 quota unit).
    const detailParams = new URLSearchParams({
        part: "contentDetails,status,statistics",
        id: rawItems.map((item) => item.id).join(","),
        key: apiKey,
    });
    let detailsById = new Map();
    try {
        const detailRes = await fetchImpl(`https://www.googleapis.com/youtube/v3/videos?${detailParams.toString()}`);
        if (detailRes.ok) {
            const detailJson = await detailRes.json();
            detailsById = new Map((detailJson.items || []).map((entry) => [
                entry.id,
                {
                    durationSec: parseIsoDuration(entry?.contentDetails?.duration),
                    embeddable: entry?.status?.embeddable !== false,
                    views: Number(entry?.statistics?.viewCount || 0),
                },
            ]));
        }
    } catch {
        // Proceed with snippet-only ranking if detail lookup fails.
    }

    const enriched = rawItems.map((item) => ({
        ...item,
        ...(detailsById.get(item.id) || { durationSec: 0, embeddable: true, views: 0 }),
    }));
    return {
        quotaExceeded: false,
        candidates: rankKaraokeVideos(enriched, { song, artist, seconds }),
    };
}

async function handler(req, res) {
    if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        return res.status(405).json({ error: "Method not allowed" });
    }

    const song = String(req.query?.song || req.query?.q || "").trim().slice(0, 120);
    const artist = String(req.query?.artist || "").trim().slice(0, 120);
    const seconds = Number(req.query?.seconds || 0);

    if (!song && !artist) {
        return res.status(400).json({ error: "Missing song or artist parameter" });
    }

    const searchUrl = buildYoutubeSearchUrl(song, artist);
    const apiKey = String(process.env.YOUTUBE_API_KEY || "").trim();
    if (!apiKey) {
        res.setHeader("Cache-Control", "public, max-age=300");
        return res.status(200).json({
            configured: false,
            quotaExceeded: false,
            searchUrl,
            candidates: [],
        });
    }

    try {
        const { quotaExceeded, candidates } = await fetchYoutubeCandidates({
            song,
            artist,
            seconds,
            apiKey,
        });
        if (quotaExceeded) {
            res.setHeader("Cache-Control", "public, max-age=300");
            return res.status(200).json({
                configured: true,
                quotaExceeded: true,
                searchUrl,
                candidates: [],
            });
        }

        // Cache ranked results at the Vercel edge for 7 days to conserve API quota.
        res.setHeader("Cache-Control", "public, s-maxage=604800, stale-while-revalidate=86400");
        return res.status(200).json({
            configured: true,
            quotaExceeded: false,
            searchUrl,
            candidates,
        });
    } catch {
        res.setHeader("Cache-Control", "no-store");
        return res.status(502).json({
            configured: true,
            quotaExceeded: false,
            searchUrl,
            candidates: [],
            error: "YouTube search temporarily unavailable",
        });
    }
}

module.exports = handler;
module.exports.rankKaraokeVideos = rankKaraokeVideos;
module.exports.parseIsoDuration = parseIsoDuration;
module.exports.buildYoutubeSearchUrl = buildYoutubeSearchUrl;
module.exports.extractYoutubeVideoId = extractYoutubeVideoId;
module.exports.fetchYoutubeCandidates = fetchYoutubeCandidates;
