// Exercise the same progressive-disclosure controls a user follows.
async function menu(page, selector) {
    await page.click('#moreToolsButton');
    await page.click(selector);
}
async function plan(page) {
    if (!await page.locator('body.planning-setlist').count()) {
        await menu(page, '#planSetlistButton');
        if (await page.locator('body.setlist-open').count()) await page.click('#closeSetlistButton');
    }
}
async function notes(page) {
    const save = page.locator('.favorite-button').first();
    if (await save.getAttribute('aria-pressed') !== 'true') await save.click();
    await save.click();
}
module.exports = { menu, plan, notes };
