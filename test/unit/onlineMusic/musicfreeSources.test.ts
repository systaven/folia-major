import { describe, expect, it, vi } from 'vitest';
import { loadPlugins } from '../../../musicfree-gateway/sources.mjs';

// test/unit/onlineMusic/musicfreeSources.test.ts
// Aggregate cold starts must admit only two initializers while preserving independent failures.

describe('MusicFree aggregate initialization', () => {
    it('bounds concurrent initialization and loads the remaining plugins after one failure', async () => {
        let active = 0;
        let peak = 0;
        const closes: Array<ReturnType<typeof vi.fn>> = [];
        const createHost = vi.fn(async (_script: string, source: string) => {
            active += 1;
            peak = Math.max(peak, active);
            await new Promise(resolve => setTimeout(resolve, 10));
            active -= 1;
            if (source.endsWith('/3.js')) throw new Error('Broken plugin');
            const close = vi.fn(async () => {});
            closes.push(close);
            return { metadata: { name: source }, call: vi.fn(), close };
        });
        const list = 'https://aggregate.test/plugins.json';
        const read = async (source: string) => source === list
            ? JSON.stringify({ plugins: Array.from({ length: 18 }, (_, id) => ({ url: `./${id}.js` })) })
            : 'module.exports = {}';
        const loaded = await loadPlugins([list], { read, createHost });
        expect(peak).toBe(2);
        expect(active).toBe(0);
        expect(loaded.plugins.size).toBe(17);
        expect(loaded.errors).toEqual([{ source: 'https://aggregate.test/3.js', message: 'Broken plugin' }]);
        await loaded.close();
        expect(closes.every(close => close.mock.calls.length === 1)).toBe(true);
    });
});
