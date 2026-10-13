import { expect, test } from '@playwright/test';
import { installBaseState, mockNeteaseApi, openApp } from './helpers/appFixtures';

// test/ui/musicfreeHome.spec.ts
// Exercise public MusicFree registration, homepage updates and real browser artwork decoding.

const recommendedId = 'musicfree.11111111111111111111';
const searchOnlyId = 'musicfree.22222222222222222222';
const cover = '/api/musicfree/assets/fixture-cover';

test('shows registered sources and public recommendation cards with decoded covers', async ({ page }) => {
    await installBaseState(page, { neteaseMode: 'guest' });
    await page.addInitScript(id => {
        window.__FOLIA_RUNTIME_CONFIG__ = { deployment: 'docker' };
        localStorage.setItem('active_online_provider_id', id);
        localStorage.setItem('library_suite', 'bravais');
        localStorage.setItem('library_wall_look', 'solid');
    }, recommendedId);
    await mockNeteaseApi(page, 'guest');
    await page.route('**/api/musicfree/**', async route => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/providers')) {
            await route.fulfill({ json: { providers: [
                { id: recommendedId, name: 'Fixture recommendations', version: '1', primaryKey: ['id'],
                    methods: ['search', 'getMediaSource', 'getRecommendSheetsByTag', 'getMusicSheetInfo'], supportedSearchType: ['music'] },
                { id: searchOnlyId, name: 'Fixture search only', version: '1', primaryKey: ['id'],
                    methods: ['search', 'getMediaSource'], supportedSearchType: ['music'] },
            ], errors: [] } });
        } else if (path.endsWith('/recommendations')) {
            await route.fulfill({ json: [{ kind: 'playlist', item: { id: 'mix', title: 'Public MusicFree mix' },
                proof: 'fixture-proof', artworkUrl: cover }] });
        } else if (path.endsWith('/fixture-cover')) {
            await route.fulfill({ contentType: 'image/svg+xml', body:
                '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#168a9a"/></svg>' });
        } else await route.fulfill({ status: 404, json: { error: 'Unexpected fixture endpoint' } });
    });
    const coverLoaded = page.waitForResponse(response => response.url().endsWith(cover) && response.status() === 200);
    await openApp(page);
    await expect(page.locator('[data-library-card]').filter({ has: page.locator('[aria-label^="Public MusicFree mix"]') }).first()).toBeVisible();
    await coverLoaded;
    const decoded = await page.evaluate(async url => {
        const image = new Image();
        image.src = url;
        await image.decode();
        return image.naturalWidth;
    }, cover);
    expect(decoded).toBe(64);
    await page.locator('[data-bravais-account-toggle]').first().click();
    await expect(page.locator('[data-bravais-account-provider]').filter({ hasText: 'Fixture recommendations' })).toBeVisible();
    await expect(page.locator('[data-bravais-account-provider]').filter({ hasText: 'Fixture search only' })).toBeVisible();
    await page.locator(`[data-bravais-account-provider="${searchOnlyId}"] [role="menuitemradio"]`).click();
    await page.getByRole('alertdialog', { name: 'Switch online music provider' }).getByRole('button', { name: 'Switch', exact: true }).click();
    await expect(page.locator('[aria-label^="Public MusicFree mix"]')).toHaveCount(0);
    await expect(page.locator('[data-bravais-account-toggle]').first()).toContainText('Fixture search only');
});
