import { describe, expect, it, vi } from 'vitest';
import { loadPlugins, configuredMusicFreeVariables, pluginId } from '../../../musicfree-gateway/sources.mjs';

// test/unit/onlineMusic/musicfreeSources.test.ts
// Aggregate cold starts must admit only two initializers while preserving independent failures.

describe('MusicFree aggregate initialization', () => {
    it('isolates configured variables by provider and rejects malformed settings without printing values', async () => {
        const first = 'https://plugins.test/a.js';
        const second = 'https://plugins.test/b.js';
        const variables = configuredMusicFreeVariables(JSON.stringify({ [pluginId(first)]: { ikun_key: 'fixture-secret' } }));
        const createHost = vi.fn(async () => ({ metadata: { name: 'Fixture' }, call: vi.fn(), close: vi.fn() }));
        const loaded = await loadPlugins([first, second], { read: async () => 'module.exports={}', createHost, userVariables: variables });
        expect(createHost).toHaveBeenCalledWith('module.exports={}', first, 20000, { ikun_key: 'fixture-secret' });
        expect(createHost).toHaveBeenCalledWith('module.exports={}', second, 20000, {});
        expect(JSON.stringify([...loaded.plugins].map(([, host]) => host.metadata))).not.toContain('fixture-secret');
        expect(() => configuredMusicFreeVariables('fixture-secret')).toThrow('must be a JSON object');
        expect(() => configuredMusicFreeVariables(JSON.stringify({ [pluginId(first)]: { ikun_key: 123 } }))).toThrow('string values');
        await loaded.close();
    });

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
