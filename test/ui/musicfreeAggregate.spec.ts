import { expect, test } from '@playwright/test';
import { installBaseState, mockNeteaseApi, openApp } from './helpers/appFixtures';

// test/ui/musicfreeAggregate.spec.ts
// A real browser must reject actual 30s PCM despite 120s catalog metadata, then play and seek the complete recording.
const ids = ['musicfree.11111111111111111111', 'musicfree.22222222222222222222', 'musicfree.33333333333333333333'];
function wav(seconds: number): Buffer {
    const rate = 8000, length = seconds * rate * 2;
    const bytes = Buffer.alloc(44 + length);
    bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + length, 4); bytes.write('WAVEfmt ', 8);
    bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
    bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
    bytes.write('data', 36); bytes.writeUInt32LE(length, 40);
    for (let i = 0; i < length / 2; i++) bytes.writeInt16LE(Math.round(Math.sin(i * 440 * 2 * Math.PI / rate) * 800), 44 + i * 2);
    return bytes;
}

test('automatically skips a preview and a 502, keeps lyrics and plays complete audio', async ({ page }) => {
    const preview = wav(30), full = wav(120);
    await installBaseState(page, { neteaseMode: 'guest' });
    await page.addInitScript(() => {
        window.__FOLIA_RUNTIME_CONFIG__ = { deployment: 'docker' };
        localStorage.removeItem('active_online_provider_id');
        localStorage.setItem('library_suite', 'bravais');
        localStorage.setItem('auto_use_best_lyric', 'false');
    });
    await mockNeteaseApi(page, 'guest');
    const calls: string[] = [];
    await page.route('**/api/musicfree/**', async route => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/providers')) return route.fulfill({ json: { providers: ids.map((id, i) => ({
            id, name: ['Fast preview', 'Complete audio', 'Broken source'][i], version: '1', primaryKey: ['id'],
            methods: ['search', 'getMediaSource', 'getLyric'], supportedSearchType: ['music'],
        })) } });
        if (path.endsWith('/search')) return route.fulfill({ json: { items: [{ item: { id: '26995594', title: 'Aggregate full recording',
            artist: 'Fixture artist', album: 'Fixture album', platform: '网易云', duration: 120 }, proof: 'fixture-proof' }], hasMore: false, nextOffset: 1 } });
        if (path.endsWith('/audio')) {
            const id = path.split('/')[4]; calls.push(id);
            if (id === ids[2]) return route.fulfill({ status: 502, json: { error: 'Upstream failed' } });
            if (id === ids[1]) await new Promise(resolve => setTimeout(resolve, 500));
            return route.fulfill({ json: { url: `/api/musicfree/assets/${id === ids[0] ? 'preview' : 'complete'}`, expiresAt: Date.now() + 60000 } });
        }
        if (path.endsWith('/lyrics')) return route.fulfill({ json: { rawLrc: '[00:01.00]Aggregate lyrics\n[00:05.00]Full recording', translation: '' } });
        if (path.includes('/assets/')) {
            const data = path.endsWith('/preview') ? preview : full;
            const range = route.request().headers()['range']?.match(/bytes=(\d+)-(\d*)/);
            if (range) {
                const start = Number(range[1]), end = Math.min(range[2] ? Number(range[2]) : data.length - 1, data.length - 1);
                return route.fulfill({ status: 206, contentType: 'audio/wav',
                    headers: { 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Accept-Ranges': 'bytes' }, body: data.subarray(start, end + 1) });
            }
            return route.fulfill({ contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body: data });
        }
        return route.fulfill({ status: 404, json: { error: 'Unexpected fixture endpoint' } });
    });
    await openApp(page);
    await expect(page.locator('[data-bravais-account-toggle]').first()).toContainText('Automatic sources');
    await page.locator('[data-bravais-seam-action="search"]').first().click();
    await page.locator('input[name="bravais-search"]').fill('aggregate');
    await page.locator('input[name="bravais-search"]').press('Enter');
    const result = page.getByRole('button', { name: 'Aggregate full recording', exact: true });
    await expect(result).toHaveCount(1);
    await result.click();
    await page.waitForFunction(() => Array.from(document.querySelectorAll('audio')).some(audio => !audio.paused && audio.duration === 120 && audio.currentTime > 0));
    expect(new Set(calls)).toEqual(new Set(ids));
    const time = await page.evaluate(async () => {
        const audio = Array.from(document.querySelectorAll('audio')).find(item => !item.paused && item.duration === 120)!;
        audio.currentTime = 80;
        await new Promise<void>(resolve => audio.addEventListener('seeked', () => resolve(), { once: true }));
        return audio.currentTime;
    });
    expect(time).toBeGreaterThan(79);
    await expect.poll(() => page.evaluate(async () => {
        const storePath = '/src/stores/usePlaybackStore.ts';
        const { usePlaybackStore } = await import(/* @vite-ignore */ storePath);
        return usePlaybackStore.getState().lyrics?.lines.map((line: { fullText: string }) => line.fullText).join('\n');
    })).toContain('Aggregate lyrics');
    await page.screenshot({ path: 'test-results/musicfree-aggregate-playback.png' });
});
