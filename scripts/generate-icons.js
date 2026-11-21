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
    launchOptions.executablePath = "/opt/pw-browsers/chromium";
}
if (process.env.CHROMIUM_PATH) {
    launchOptions.executablePath = process.env.CHROMIUM_PATH;
}

(async () => {
    const root = path.join(__dirname, "..");
    const svg = fs.readFileSync(path.join(root, "app-icon.svg"), "utf8");
    const browser = await chromium.launch(launchOptions);
    try {
        const page = await browser.newPage();
        for (const [name, size, fullBleed, maskable] of [
            ["icon-192.png", 192, false, false],
            ["icon-512.png", 512, false, false],
            ["icon-maskable-512.png", 512, true, true],
            ["apple-touch-icon.png", 180, true, false],
        ]) {
            const data = await page.evaluate(async ({ svg, size, fullBleed, maskable }) => {
                const source = fullBleed ? svg.replace(/<rect[^>]*\/>/, "") : svg;
                const image = new Image();
                image.src = `data:image/svg+xml;base64,${btoa(source)}`;
                await image.decode();
                const canvas = document.createElement("canvas");
                canvas.width = canvas.height = size;
                const ctx = canvas.getContext("2d");
                if (fullBleed) {
                    const gradient = ctx.createLinearGradient(0, 0, size, size);
                    gradient.addColorStop(0, "#6247c9");
                    gradient.addColorStop(1, "#c74735");
                    ctx.fillStyle = gradient;
                    ctx.fillRect(0, 0, size, size);
                }
                // Inset maskable artwork to keep the music mark in the safe area.
                const inset = maskable ? size * 0.15 : 0;
                ctx.drawImage(image, inset, inset, size - inset * 2, size - inset * 2);
                return canvas.toDataURL("image/png").split(",")[1];
            }, { svg, size, fullBleed, maskable });
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
