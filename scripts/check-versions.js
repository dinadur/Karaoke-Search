#!/usr/bin/env node
// Fails when the four cache-busting version references disagree.
// A mismatch silently breaks the service-worker precache (offline mode).

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const js = fs.readFileSync(path.join(root, "karaoke_explorer.js"), "utf8");
const html = fs.readFileSync(path.join(root, "karaoke_explorer.html"), "utf8");
const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");

const appVersion = js.match(/const APP_VERSION = "([^"]+)";/)?.[1];
const cacheVersion = sw.match(/const CACHE_VERSION = "([^"]+)";/)?.[1];
const htmlVersions = [...html.matchAll(/\?v=([0-9-]+)/g)].map((match) => match[1]);

const problems = [];
if (!appVersion) {
    problems.push("APP_VERSION not found in karaoke_explorer.js");
}
if (cacheVersion !== appVersion) {
    problems.push(`sw.js CACHE_VERSION (${cacheVersion}) != APP_VERSION (${appVersion})`);
}
if (!htmlVersions.length) {
    problems.push("no ?v= query strings found in karaoke_explorer.html");
}
for (const version of htmlVersions) {
    if (version !== appVersion) {
        problems.push(`karaoke_explorer.html references ?v=${version}, expected ${appVersion}`);
    }
}

if (problems.length) {
    console.error("Version check FAILED:");
    for (const problem of problems) {
        console.error(`  - ${problem}`);
    }
    process.exit(1);
}

console.log(`Version check OK: ${appVersion} everywhere (${htmlVersions.length} HTML refs)`);
