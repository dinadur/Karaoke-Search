#!/usr/bin/env node
const { menu, plan, notes } = require("./ui-helpers");
// Behavioral regressions for the review findings. Uses a deterministic catalog
// and a fresh browser context per case; run against the same server as smoke.js.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
let playwright;
try { playwright = require("playwright"); } catch { playwright = require("playwright-core"); }
const browserName = process.env.BROWSER || "chromium";
assert.ok(["chromium", "firefox", "webkit"].includes(browserName), "Unknown BROWSER");
const launchOptions = { headless: true };
if (browserName === "chromium" && process.env.CHROMIUM_PATH) {
    launchOptions.executablePath = process.env.CHROMIUM_PATH;
}
const BASE = process.env.SMOKE_URL || "http://127.0.0.1:8765/karaoke_explorer.html";
const catalog = [
    { song: "First Tune", artist: "Alpha", eras: ["70s"] },
    { song: "Second Tune", artist: "Beta", eras: ["80s"] },
    { song: "Third Tune", artist: "Gamma", eras: ["90s"] },
    { song: "Fourth Tune", artist: "Delta", eras: ["80s"] },
].map((song) => ({ ...song, status: "ok", tags: [], genres: [], moods: [], flags: [] }));

async function search(page, query) {
    await page.fill("#searchInput", query);
    // Wait for the visible search state, not a guessed debounce duration.
    await page.waitForFunction((query) => state.query === query && !searchRenderTimer, query);
}

async function add(page, query) {
    await plan(page);
    await search(page, query);
    await page.locator(".add-button").first().click();
}

const tests = [
    ["native share passes singer text and handles cancellation and failure", async (page) => {
        await page.addInitScript(() => {
            window.sharedPayload = null;
            window.shareFailure = null;
            Object.defineProperty(navigator, "share", { configurable: true, value: async (payload) => {
                if (window.shareFailure) throw new DOMException("Share unavailable", window.shareFailure);
                window.sharedPayload = payload;
            } });
        });
        await page.reload();
        await page.waitForFunction(() => state.songs.length && !document.querySelector(".skeleton"));
        await add(page, "First Tune");
        await page.locator(".singer-add").click();
        await page.locator(".singer-input").fill("Alex");
        await page.locator(".singer-input").press("Enter");
        await page.click("#shareSetlistButton");
        const payload = await page.evaluate(() => window.sharedPayload);
        assert.equal(payload.title, "Karaoke setlist");
        assert.match(payload.text, /First Tune - Alpha \(Alex\)/);
        // A dismissed OS sheet is ordinary cancellation, not a user error.
        await page.evaluate(() => { window.shareFailure = "AbortError"; hideSnackbar(); });
        await page.click("#shareSetlistButton");
        assert.equal(await page.locator("#snackbar").isVisible(), false);
        await page.evaluate(() => { window.shareFailure = "NotAllowedError"; });
        await page.click("#shareSetlistButton");
        assert.match(await page.locator("#snackbarText").textContent(), /Couldn't share.*QR or Copy/);
    }],
    ["singer editing and reordering preserve keyboard and pointer actions", async (page) => {
        await add(page, "First Tune");
        await add(page, "Second Tune");
        await page.locator(".singer-add").last().click();
        await page.locator(".singer-input").fill("Sam");
        // Clicking Remove while editing first blurs the input; that must not
        // destroy the Remove button before its click is delivered.
        await page.locator(".remove-button").last().click();
        assert.deepEqual(await page.locator(".setlist-title").allTextContents(), ["First Tune"]);
        await page.click("#snackbarAction");
        assert.match(await page.locator(".singer-chip").textContent(), /Sam/);
        await page.locator(".singer-add").first().click();
        await page.locator(".singer-input").fill("Alex");
        await page.locator(".singer-input").press("Enter");
        assert.equal(await page.locator(".singer-chip").first().evaluate((button) => button === document.activeElement), true);
        await page.locator('.setlist-item [title="Move down"]').first().click();
        assert.equal(await page.locator(".setlist-title").last().textContent(), "First Tune");
        assert.equal(await page.locator(".setlist-item").last().evaluate((item) => item.contains(document.activeElement)), true);
    }],
    ["added state stays in sync through remove and Undo", async (page) => {
        await add(page, "First Tune");
        const button = page.locator(".add-button").first();
        assert.equal(await button.textContent(), "Added");
        assert.equal(await button.getAttribute("aria-disabled"), "true");
        await page.locator(".remove-button").click();
        assert.equal(await button.textContent(), "Add");
        await page.click("#snackbarAction");
        assert.equal(await button.textContent(), "Added");
    }],
    ["artist links are exact, reloadable, and retain group/favorite focus", async (page) => {
        await page.route("**/karaoke_songs_enriched.json?*", (route) => route.fulfill({
            json: [...catalog, { ...catalog[1], song: "Another Tune", artist: "Alphaville" }],
        }));
        await page.reload();
        await page.waitForSelector(".shelf");
        await search(page, "First Tune");
        await page.locator(".song-artist").first().click();
        assert.deepEqual(await page.locator("#resultsList .browse-artist").allTextContents(), ["Alpha"]);
        assert.equal(await page.locator("#resultsList details[open]").count(), 1);
        const favorite = page.locator("#resultsList .favorite-button").first();
        await favorite.click();
        assert.equal(await favorite.evaluate((button) => button === document.activeElement), true);
        assert.equal(await favorite.getAttribute("aria-pressed"), "true");
        await page.locator("#resultsList summary").click();
        await page.click("#searchModeButton");
        assert.equal(await page.locator("#resultsList details[open]").count(), 0);
        await page.reload();
        await page.waitForSelector("#resultsList .browse-row");
        assert.deepEqual(await page.locator("#resultsList .browse-artist").allTextContents(), ["Alpha"]);
        // Typing starts a new partial search across songs and artists, releasing
        // the artist link's Artist scope and title order.
        await search(page, "Alpha");
        assert.deepEqual(await page.locator("#resultsList .song-artist").allTextContents(), ["Alpha", "Alphaville"]);
        assert.deepEqual(await page.evaluate(() => [state.searchScope, state.sortMode]), ["all", "relevance"]);
    }],
    ["leaving an artist view searches songs again and returns to Discover", async (page) => {
        await search(page, "First Tune");
        await page.locator(".song-artist").first().click();
        assert.deepEqual(await page.locator(".active-filter-chip").allTextContents(), ["Artist: Alpha"]);
        // A title word typed after an artist link must not search artist names only.
        await search(page, "Tune");
        assert.equal(await page.locator("#resultsList .song-card").count(), 4);
        // A plain query repeats the search box, so it gets no chip.
        assert.equal(await page.locator(".active-filter-chip").count(), 0);
        await search(page, "First Tune");
        await page.locator(".song-artist").first().click();
        await page.click("#clearButton");
        assert.equal(await page.evaluate(() => isDiscoverView()), true);
        assert.ok(await page.locator(".shelf").count());
        // Choosing a scope also leaves the view; its title order must not linger.
        await search(page, "First Tune");
        await page.locator(".song-artist").first().click();
        await page.click("#filtersToggleButton");
        await page.locator("#searchScope label", { hasText: "Song title" }).click();
        assert.equal(await page.locator('#searchScope input[value="song"]').isChecked(), true);
        await page.click("#applyFiltersButton");
        assert.deepEqual(await page.evaluate(() => [state.searchScope, state.sortMode]), ["song", "relevance"]);
        await page.click("#clearButton");
        assert.equal(await page.evaluate(() => isDiscoverView()), true);
        // An order picked inside the artist view belongs to that view too.
        await search(page, "First Tune");
        await page.locator(".song-artist").first().click();
        await page.click("#filtersToggleButton");
        await page.click("#orderPopularButton");
        await page.click("#applyFiltersButton");
        await page.click("#clearButton");
        assert.equal(await page.evaluate(() => isDiscoverView()), true);
        // Earlier versions stored the artist view's title order without its query.
        await page.evaluate(() => localStorage.setItem("karaokeUiState",
            JSON.stringify({ mode: "search", query: "", sortMode: "song", filters: {} })));
        await page.goto(BASE);
        await page.waitForFunction(() => state.songs.length && !document.querySelector(".skeleton"));
        assert.equal(await page.evaluate(() => isDiscoverView()), true);
        // A title order chosen since then is kept.
        await page.evaluate(() => localStorage.setItem("karaokeUiState",
            JSON.stringify({ version: UI_STATE_VERSION, mode: "search", query: "", sortMode: "song", filters: {} })));
        await page.goto(BASE);
        await page.waitForFunction(() => state.songs.length && !document.querySelector(".skeleton"));
        assert.equal(await page.evaluate(() => state.sortMode), "song");
    }],
    ["the chip row returns to Discover once no search remains", async (page) => {
        const filterByDecadesSortedByTitle = async () => {
            await page.click("#filtersToggleButton");
            await page.click('.multi-filter[data-filter="decade"] .multi-filter-button');
            for (const decade of ["70s", "80s"]) {
                await page.locator('.multi-filter[data-filter="decade"] .multi-option').filter({ hasText: decade }).click();
            }
            await page.click("#orderSongButton");
            await page.click("#applyFiltersButton");
        };
        await filterByDecadesSortedByTitle();
        await page.click(".active-filter-clear");
        assert.equal(await page.evaluate(() => isDiscoverView()), true);
        // With a search still in the box, the chosen order stays.
        await search(page, "Tune");
        await filterByDecadesSortedByTitle();
        await page.click(".active-filter-clear");
        assert.deepEqual(await page.evaluate(() => [state.query, state.sortMode]), ["Tune", "song"]);
    }],
    ["near matches are offered only when they can add results", async (page) => {
        await page.route("**/karaoke_songs_enriched.json?*", (route) => route.fulfill({
            json: [...catalog, { ...catalog[1], song: "Fist Fight", artist: "Epsilon" }],
        }));
        await page.reload();
        await page.waitForFunction(() => state.songs.length && !document.querySelector(".skeleton"));
        // Near matches already ran automatically and found nothing.
        await search(page, "zzzzzzzzzzzzzzzzzz");
        assert.deepEqual(await page.locator(".empty-action").allTextContents(), ["Clear search"]);
        assert.match(await page.locator(".search-empty strong").textContent(), /No matches for “zzz/);
        // The 80s filter hides the exact match, but a near match passes it.
        await search(page, "First");
        await page.click("#filtersToggleButton");
        await page.click('.multi-filter[data-filter="decade"] .multi-filter-button');
        await page.locator('.multi-filter[data-filter="decade"] .multi-option').filter({ hasText: "80s" }).click();
        await page.click("#applyFiltersButton");
        // The query found a song; the filter removed it.
        assert.equal(await page.locator(".search-empty strong").textContent(), "No “First” songs match these filters");
        const offer = page.locator(".empty-action", { hasText: "Include near matches" });
        assert.equal(await offer.textContent(), "Include near matches (1)");
        await offer.click();
        assert.deepEqual(await page.locator("#resultsList .song-title").allTextContents(), ["Fist Fight"]);
        assert.ok((await page.locator(".active-filter-chip").allTextContents()).includes("Near matches"));
    }],
    ["Browse hides the search query and Search restores it", async (page) => {
        await search(page, "Beta");
        await page.click("#browseModeButton");
        assert.equal(await page.inputValue("#searchInput"), "");
        assert.ok(await page.locator("#browseList .browse-row").count());
        // On its own row, the letter strip fits on one line at desktop width.
        assert.ok((await page.locator("#letterStrip").boundingBox()).height < 60);
        await page.click("#searchModeButton");
        assert.equal(await page.inputValue("#searchInput"), "Beta");
        assert.deepEqual(await page.locator("#resultsList .song-title").allTextContents(), ["Second Tune"]);
        // Typing while browsing starts a new search.
        await page.click("#browseModeButton");
        await search(page, "Gamma");
        assert.deepEqual(await page.locator("#resultsList .song-title").allTextContents(), ["Third Tune"]);
    }],
    ["setlist rows are numbered, the rail fits the screen, and swaps can be undone", async (page) => {
        const songs = Array.from({ length: 30 }, (_, index) => ({
            ...catalog[0], song: `Song ${index + 1}`, artist: `Singer ${index + 1}`,
        }));
        await page.route("**/karaoke_songs_enriched.json?*", (route) => route.fulfill({ json: songs }));
        await page.evaluate((entries) => localStorage.setItem("karaokeSetlist", JSON.stringify(entries)), songs.slice(0, 24));
        await page.reload();
        await page.waitForFunction(() => state.songs.length && !document.querySelector(".skeleton"));
        await plan(page);
        assert.deepEqual((await page.locator(".setlist-number").allTextContents()).slice(0, 3), ["1", "2", "3"]);
        // Once the sticky rail engages, every entry must be reachable inside it.
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        const rail = await page.evaluate(() => {
            const list = document.getElementById("setlist");
            return {
                bottom: document.querySelector(".setlist-panel").getBoundingClientRect().bottom,
                viewport: innerHeight,
                scrolls: list.scrollHeight > list.clientHeight,
            };
        });
        assert.ok(rail.bottom <= rail.viewport, `rail ends at ${rail.bottom} in a ${rail.viewport}px viewport`);
        assert.equal(rail.scrolls, true);
        const swap = page.locator('.setlist-item [title="Swap for another match"]').first();
        assert.equal(await swap.getAttribute("aria-label"), "Swap Song 1 for another matching song");
        await swap.click();
        assert.notEqual(await page.locator(".setlist-title").first().textContent(), "Song 1");
        assert.match(await page.locator("#snackbarText").textContent(), /^Swapped in/);
        await page.click("#snackbarAction");
        assert.equal(await page.locator(".setlist-title").first().textContent(), "Song 1");
    }],
    ["setlist and saved-song artists and tags lead back to search", async (page) => {
        const view = () => page.evaluate(() => ({
            exact: state.exactArtist, query: state.query, decades: state.filters.decades,
            focus: document.activeElement.id, openTags: document.querySelectorAll(".song-tags.is-open").length,
            drawer: document.body.classList.contains("setlist-open"), dialog: Boolean(document.querySelector("dialog[open]")),
        }));
        await add(page, "First Tune");
        await page.locator("#resultsList .favorite-button").first().click();
        await search(page, "Second");

        // The setlist artist opens that artist's songs, as on song cards.
        await page.locator("#setlist button.setlist-artist").click();
        assert.deepEqual(await view(), { exact: true, query: "Alpha", decades: [], focus: "resultsTitle", openTags: 0, drawer: false, dialog: false });
        assert.deepEqual(await page.locator("#resultsList .browse-artist").allTextContents(), ["Alpha"]);
        // Its tags open from a button beside the title; a tag filters like a card pill.
        await page.locator("#setlist .tag-popout-button").click();
        await page.locator("#setlist .song-tags-popout button.pill", { hasText: "70s" }).click();
        assert.deepEqual(await view(), { exact: false, query: "", decades: ["70s"], focus: "resultsTitle", openTags: 0, drawer: false, dialog: false });

        // Saved songs: the dialog closes on the way back to the results, and
        // Escape inside the tags closes only the tags.
        await menu(page, "#repertoireButton");
        await page.locator("#repertoireList button.personal-artist").click();
        assert.deepEqual(await view(), { exact: true, query: "Alpha", decades: [], focus: "resultsTitle", openTags: 0, drawer: false, dialog: false });
        await menu(page, "#repertoireButton");
        await page.locator("#repertoireList .tag-popout-button").click();
        await page.keyboard.press("Escape");
        assert.equal((await view()).dialog, true);
        assert.equal(await page.evaluate(() => document.activeElement.classList.contains("tag-popout-button")), true);
        // Safari does not focus a clicked button; Escape still closes only the tags.
        await page.locator("#repertoireList .tag-popout-button").click();
        await page.evaluate(() => document.activeElement.blur());
        await page.keyboard.press("Escape");
        const { dialog, openTags } = await view();
        assert.deepEqual({ dialog, openTags }, { dialog: true, openTags: 0 });
        await page.locator("#repertoireList .tag-popout-button").click();
        await page.locator("#repertoireList .song-tags-popout button.pill", { hasText: "70s" }).click();
        assert.deepEqual(await view(), { exact: false, query: "", decades: ["70s"], focus: "resultsTitle", openTags: 0, drawer: false, dialog: false });

        // Phones: the setlist drawer closes too, and the floating tags close when the list scrolls.
        await page.setViewportSize({ width: 390, height: 844 });
        await page.click("#mobileSetlistButton");
        await page.locator("#setlist .tag-popout-button").click();
        assert.equal(await page.locator(".song-tags.is-open.is-floating").count(), 1);
        await page.evaluate(() => document.getElementById("setlist").dispatchEvent(new Event("scroll")));
        assert.equal(await page.locator(".song-tags.is-open").count(), 0);
        await page.locator("#setlist button.setlist-artist").click();
        assert.deepEqual(await view(), { exact: true, query: "Alpha", decades: [], focus: "resultsTitle", openTags: 0, drawer: false, dialog: false });

        // An entry the catalog no longer has keeps its artist link but has no tags to show.
        await page.evaluate(() => { state.setlist.push({ song: "Lost Tune", artist: "Omega" }); renderSetlist(); });
        const lost = page.locator(".setlist-item", { hasText: "Lost Tune" });
        assert.equal(await lost.locator("button.setlist-artist").textContent(), "Omega");
        assert.equal(await lost.locator(".tag-popout-button").count(), 0);

        // Floating tags sit beside their button and inside the screen, even when
        // long tags make them wider than the spot the row gives them.
        await page.evaluate(() => {
            state.songs.find((song) => song.song === "First Tune").tags = ["singalong anthem", "stadium closer", "wedding favourite", "road trip classic"];
            renderSetlist();
        });
        const placement = () => page.evaluate(() => {
            const box = document.querySelector(".song-tags.is-open");
            const button = box.querySelector(".tag-popout-button").getBoundingClientRect();
            const popout = box.querySelector(".song-tags-popout").getBoundingClientRect();
            return {
                gap: Math.round(popout.top >= button.bottom ? popout.top - button.bottom : button.top - popout.bottom),
                inside: Math.round(popout.left) >= 8 && Math.round(popout.right) <= innerWidth - 8,
            };
        });
        await menu(page, "#repertoireButton");
        await page.locator("#repertoireList .tag-popout-button").click();
        assert.deepEqual(await placement(), { gap: 7, inside: true });
        await page.keyboard.press("Escape");
        await page.keyboard.press("Escape");
        await page.click("#mobileSetlistButton");
        await page.locator(".setlist-item", { hasText: "First Tune" }).locator(".tag-popout-button").click();
        assert.deepEqual(await placement(), { gap: 7, inside: true });
    }],
    ["mobile Browse keeps letters docked and starts each letter at its top", async (page) => {
        const songs = Array.from({ length: 120 }, (_, index) => ({
            ...catalog[0], song: `${index % 2 ? "Maybe" : "Always"} ${index}`, artist: `Singer ${index}`,
        }));
        await page.route("**/karaoke_songs_enriched.json?*", (route) => route.fulfill({ json: songs }));
        await page.setViewportSize({ width: 390, height: 844 });
        await page.reload();
        await page.waitForFunction(() => state.songs.length && !document.querySelector(".skeleton"));
        await page.click("#browseModeButton");
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        const [toolbarBottom, stripTop] = await page.evaluate(() => [
            document.querySelector(".toolbar").getBoundingClientRect().bottom,
            document.querySelector(".letter-strip").getBoundingClientRect().top,
        ]);
        assert.ok(Math.abs(toolbarBottom - stripTop) <= 1, `strip top ${stripTop}, search bar bottom ${toolbarBottom}`);
        await page.locator('.letter-button[data-letter="M"]').click();
        await page.waitForFunction(() => Math.abs(document.querySelector("#browseList .browse-row").getBoundingClientRect().top -
            document.querySelector(".letter-strip").getBoundingClientRect().bottom) < 160, null, { timeout: 5000 });
        assert.match(await page.locator("#browseList .browse-title").first().textContent(), /^Maybe/);
    }],
    ["narrow mobile filters scroll vertically and keep actions reachable", async (page) => {
        for (const width of [320, 390]) {
            await page.setViewportSize({ width, height: 740 });
            await page.click("#filtersToggleButton");
            await page.click('.multi-filter[data-filter="decade"] .multi-filter-button');
            assert.equal(await page.locator("#searchFilters").evaluate((sheet) => sheet.scrollWidth <= sheet.clientWidth + 1), true);
            await page.locator('.multi-filter[data-filter="decade"] .multi-option').filter({ hasText: "80s" }).click();
            const sheet = await page.locator("#searchFilters").evaluate((element) => {
                const right = element.getBoundingClientRect().right;
                const chips = element.querySelectorAll(".search-scope span, .filter-checks span, .search-order button");
                element.scrollTop = element.scrollHeight;
                return {
                    clipped: [...chips].filter((chip) => chip.getBoundingClientRect().right > right).map((chip) => chip.textContent),
                    // Content must not scroll into view below the sticky footer.
                    footerGap: element.getBoundingClientRect().bottom - element.querySelector(".sheet-foot").getBoundingClientRect().bottom,
                };
            });
            assert.deepEqual(sheet.clipped, []);
            assert.ok(Math.abs(sheet.footerGap) <= 1, `footer ends ${sheet.footerGap}px above the sheet edge`);
            await page.click("#applyFiltersButton");
            assert.equal(await page.locator("body.filters-open").count(), 0);
            assert.equal(await page.locator("#searchInput").evaluate((input) => input.clientWidth > 130), true);
            assert.equal(await page.locator("#searchModeButton span").evaluate((span) => span.scrollWidth <= span.clientWidth), true);
        }
    }],
    ["catalog failure can retry and invalid backup files show an error", async (page) => {
        await page.route("**/karaoke_songs_enriched.json?*", (route) => route.abort());
        await page.reload();
        await page.waitForSelector("#dataDialog[open]");
        await page.locator("#dataDialog summary").click();
        for (const contents of ['{broken', '[{"artist":"Alpha","song":"Broken","eras":null}]']) {
            await page.locator("#fileInput").setInputFiles({
                name: "invalid.json", mimeType: "application/json", buffer: Buffer.from(contents),
            });
            await page.waitForFunction(() => document.getElementById("dataError").textContent.length > 0);
            assert.match(await page.locator("#dataError").textContent(), /isn't a valid songbook/);
        }
        await page.unroute("**/karaoke_songs_enriched.json?*");
        await page.click("#retryDataButton");
        await page.waitForSelector("#dataDialog", { state: "hidden" });
        await page.waitForSelector(".shelf");
        assert.equal(await page.locator("#dataDialog").isVisible(), false);
        await add(page, "First Tune");
        assert.equal(await page.locator(".setlist-item").count(), 1);
    }],
    ["clear Undo works until a subsequent edit, then preserves the edit", async (page) => {
        await add(page, "First Tune");
        await page.click("#clearSetlistButton");
        await page.click("#snackbarAction");
        assert.equal(await page.locator(".setlist-title").textContent(), "First Tune");
        await page.click("#clearSetlistButton");
        await add(page, "Second Tune");
        assert.equal(await page.locator("#snackbarAction").isVisible(), false);
        await page.reload();
        await page.waitForSelector(".setlist-title", { state: "attached" });
        assert.deepEqual(await page.locator(".setlist-title").allTextContents(), ["Second Tune"]);
    }],
    ["draft Undo expires after editing a singer", async (page) => {
        await page.click("#draftSetlistButton");
        await page.locator(".singer-add").first().click();
        await page.locator(".singer-input").fill("Sam");
        await page.locator(".singer-input").press("Enter");
        assert.equal(await page.locator("#snackbarAction").isVisible(), false);
        assert.equal(await page.locator(".setlist-item").count(), 4);
        assert.match(await page.locator(".singer-chip").textContent(), /Sam/);
    }],
    ["empty search and Favorites never draft, swap, or pick unrelated songs", async (page) => {
        await add(page, "First Tune");
        for (const favorites of [false, true]) {
            await search(page, favorites ? "" : "zzzzzzzzzzzzzzzzzz");
            if (favorites) { await page.click("#filtersToggleButton"); await page.locator("label", { has: page.locator("#favoriteFilter") }).click(); await page.click("#applyFiltersButton"); }
            assert.match(await page.locator("#resultCount").textContent(), /0 matches/);
            await menu(page, "#randomButton");
            assert.equal(await page.locator("#randomPick").isVisible(), false);
            await page.click("#draftSetlistButton");
            await page.locator('.setlist-item [title="Swap for another match"]').click();
            assert.deepEqual(await page.locator(".setlist-title").allTextContents(), ["First Tune"]);
        }
    }],
    ["empty search facets show zero, and open facets follow query edits", async (page) => {
        await search(page, "zzzzzzzzzzzzzzzzzz");
        await page.click("#filtersToggleButton");
        await page.click('.multi-filter[data-filter="decade"] .multi-filter-button');
        const counts = page.locator('.multi-filter[data-filter="decade"] .option-count');
        assert.deepEqual(await counts.allTextContents(), ["0", "0", "0"]);
        await page.click("#applyFiltersButton");
        await search(page, "Alpha");
        await page.click("#filtersToggleButton");
        await page.click('.multi-filter[data-filter="decade"] .multi-filter-button');
        assert.deepEqual(await counts.allTextContents(), ["1", "0", "0"]);
        await page.click("#applyFiltersButton");
        await search(page, "Beta");
        await page.click("#filtersToggleButton");
        await page.click('.multi-filter[data-filter="decade"] .multi-filter-button');
        assert.deepEqual(await counts.allTextContents(), ["0", "1", "0"]);
        assert.equal(await counts.first().isVisible(), true);
    }],
    ["legacy and current saved songs survive a QR round trip", async (page, context) => {
        await page.evaluate((song) => {
            localStorage.setItem("karaokeSetlist", JSON.stringify([
                { ...song, id: "alpha\u001ffirst tune\u001f321", singer: "Sam" },
            ]));
        }, catalog[0]);
        await page.reload();
        await page.waitForSelector(".setlist-title", { state: "attached" });
        await add(page, "Second Tune");
        await page.click("#qrSetlistButton");
        await page.waitForSelector("#qrHolder svg");
        // Capture the exact payload sent to the QR library by the shared builder.
        const url = await page.evaluate(() => buildShareUrl());
        const recipient = await context.newPage();
        await recipient.goto(url);
        await recipient.getByRole("dialog", { name: "Shared setlist" }).waitFor();
        assert.match(await recipient.locator("#importCaption").textContent(), /2 songs/);
        await recipient.click("#importReplaceButton");
        assert.deepEqual(await recipient.locator(".setlist-title").allTextContents(), ["First Tune", "Second Tune"]);
        await add(recipient, "Third Tune");
        assert.equal(await recipient.locator("#snackbarAction").isVisible(), false);
        assert.equal(await recipient.locator(".setlist-item").count(), 3);
        await recipient.close();
    }],
    ["mobile sheets contain focus, restore it, and allow a nested QR dialog", async (page) => {
        await page.setViewportSize({ width: 390, height: 844 });
        for (const [opener, closer, sheet] of [
            ["#filtersToggleButton", "#closeFiltersButton", "#searchFilters"],
            ["#mobileSetlistButton", "#closeSetlistButton", ".setlist-panel"],
        ]) {
            await page.click(opener);
            assert.equal(await page.evaluate(() => document.activeElement.id), closer.slice(1));
            await page.keyboard.press("Shift+Tab");
            assert.equal(await page.evaluate((sheet) => document.querySelector(sheet).contains(document.activeElement), sheet), true);
            // Walk enough times to cross both ends, including disabled buttons.
            for (let i = 0; i < 25; i++) {
                await page.keyboard.press("Tab");
                assert.equal(await page.evaluate((sheet) => document.querySelector(sheet).contains(document.activeElement), sheet), true);
            }
            await page.keyboard.press("/");
            assert.equal(await page.evaluate((sheet) => document.querySelector(sheet).contains(document.activeElement), sheet), true);
            await page.evaluate(() => document.getElementById("searchInput").focus());
            assert.equal(await page.evaluate((sheet) => document.querySelector(sheet).contains(document.activeElement), sheet), true);
            await page.keyboard.press("Escape");
            assert.equal(await page.evaluate(() => document.activeElement.id), opener.slice(1));
            assert.equal(await page.locator("[inert]").count(), 0);
        }
        await page.click("#mobileSetlistButton");
        await page.click("#qrSetlistButton");
        await page.waitForSelector("#qrDialog[open]");
        await page.keyboard.press("Tab");
        // Chromium may hand focus to browser chrome between native dialog
        // cycles; it must never hand it to the underlying custom sheet.
        assert.equal(await page.evaluate(() => document.activeElement === document.body ||
            document.getElementById("qrDialog").contains(document.activeElement)), true);
        await page.keyboard.press("Tab");
        assert.equal(await page.evaluate(() => document.getElementById("qrDialog").contains(document.activeElement)), true);
        await page.keyboard.press("Escape");
        assert.equal(await page.locator("#qrDialog").isVisible(), false);
        assert.equal(await page.locator("body.setlist-open").count(), 1);
        await page.click("#draftSetlistButton");
        await page.locator(".remove-button").first().click();
        await page.click("#snackbarAction");
        assert.equal(await page.locator(".setlist-item").count(), 4);
        await page.keyboard.press("Escape");
        await page.click("#filtersToggleButton");
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.waitForFunction(() => !document.querySelector("[inert]"));
        assert.equal(await page.locator("#sheetBackdrop").isVisible(), false);
    }],
    ["all manifest and touch icons are served at their declared dimensions", async (page) => {
        const manifest = await (await page.request.get(new URL("manifest.json", BASE).href)).json();
        await page.goto(BASE);
        const touchIcon = await page.locator('link[rel="apple-touch-icon"]').getAttribute("href");
        const icons = [...manifest.icons, { src: touchIcon, sizes: "180x180" }];
        for (const icon of icons) {
            const response = await page.request.get(new URL(icon.src, BASE).href);
            assert.equal(response.status(), 200, icon.src);
            if (new URL(icon.src, BASE).pathname.endsWith(".png")) {
                const png = await response.body();
                assert.equal(png.subarray(1, 4).toString(), "PNG");
                assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes);
                assert.ok(fs.existsSync(path.join(__dirname, "..", icon.src.split("?")[0])));
            }
        }
    }],
];

(async () => {
    const browser = await playwright[browserName].launch(launchOptions);
    let failed = 0;
    try {
        for (const [name, run] of tests) {
            const context = await browser.newContext({
                viewport: { width: 1280, height: 900 },
                reducedMotion: "reduce",
                serviceWorkers: "block",
            });
            const errors = [];
            context.on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)));
            await context.route("**/karaoke_songs_enriched.json?*", (route) => route.fulfill({ json: catalog }));
            const page = await context.newPage();
            try {
                await page.goto(BASE);
                await page.waitForFunction(() => state.songs.length && !document.querySelector(".skeleton"));
                await plan(page);
                await run(page, context);
                assert.deepEqual(errors, []);
                console.log(`ok   ${name}`);
            } catch (error) {
                failed++;
                console.error(`FAIL ${name}\n${error.stack}`);
            } finally {
                await context.close();
            }
        }
    } finally {
        await browser.close();
    }
    if (failed) process.exitCode = 1;
    else console.log(`\nAll ${tests.length} regression scenarios passed`);
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
