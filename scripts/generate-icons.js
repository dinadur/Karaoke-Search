#!/usr/bin/env node
// Export the existing SVG artwork to the raster sizes referenced by the PWA.
// Run with the same Playwright setup as scripts/smoke.js. No app build step.
const fs = require("node:fs");
const path = require("node:path");
let chromium;
const launchOptions = { headless: true };
try {
    ({ chromium } = require("playwright"));
} catch {
    ({ chromium } = require("playwright-core"));
    launchOptions.executablePath = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
}

(async () => {
    const root = path.join(__dirname, "..");
    const svg = fs.readFileSync(path.join(root, "app-icon.svg"), "utf8");
    const browser = await chromium.launch(launchOptions);
    try {
        const page = await browser.newPage();
        for (const [name, size, maskable] of [
            ["icon-192.png", 192, false],
            ["icon-512.png", 512, false],
            ["icon-maskable-512.png", 512, true],
            ["apple-touch-icon.png", 180, false],
        ]) {
            const data = await page.evaluate(async ({ svg, size, maskable }) => {
                const image = new Image();
                image.src = `data:image/svg+xml;base64,${btoa(svg)}`;
                await image.decode();
                const canvas = document.createElement("canvas");
                canvas.width = canvas.height = size;
                const ctx = canvas.getContext("2d");
                ctx.fillStyle = "#28727a";
                ctx.fillRect(0, 0, size, size);
                // Inset maskable artwork to keep the music mark in the safe area.
                const inset = maskable ? size * 0.15 : 0;
                ctx.drawImage(image, inset, inset, size - inset * 2, size - inset * 2);
                return canvas.toDataURL("image/png").split(",")[1];
            }, { svg, size, maskable });
            fs.writeFileSync(path.join(root, name), Buffer.from(data, "base64"));
            console.log(`Exported ${name} (${size}×${size})`);
        }
    } finally {
        await browser.close();
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
