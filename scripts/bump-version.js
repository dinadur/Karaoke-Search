#!/usr/bin/env node
// Bumps the four cache-busting version references in one go:
//   APP_VERSION (karaoke_explorer.js), CACHE_VERSION (sw.js),
//   and the ?v= query strings in karaoke_explorer.html.
//
// Usage: node scripts/bump-version.js [new-version]
// With no argument, uses today's date and increments the suffix.

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const jsPath = path.join(root, "karaoke_explorer.js");
const htmlPath = path.join(root, "karaoke_explorer.html");
const swPath = path.join(root, "sw.js");

const js = fs.readFileSync(jsPath, "utf8");
const current = js.match(/const APP_VERSION = "([^"]+)";/)?.[1];
if (!current) {
    console.error("Could not find APP_VERSION in karaoke_explorer.js");
    process.exit(1);
}

let next = process.argv[2];
if (!next) {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const [currentDate, suffix] = current.split("-");
    next = currentDate === today ? `${today}-${Number(suffix || 0) + 1}` : `${today}-1`;
}

fs.writeFileSync(jsPath, js.replace(
    /const APP_VERSION = "[^"]+";/,
    `const APP_VERSION = "${next}";`
));

const html = fs.readFileSync(htmlPath, "utf8");
fs.writeFileSync(htmlPath, html.split(`v=${current}`).join(`v=${next}`));

const sw = fs.readFileSync(swPath, "utf8");
fs.writeFileSync(swPath, sw.replace(
    /const CACHE_VERSION = "[^"]+";/,
    `const CACHE_VERSION = "${next}";`
));

console.log(`Bumped ${current} -> ${next}`);
