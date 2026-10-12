import { describe, expect, it, vi } from 'vitest';
import { enrichSearchItems, searchPlugin } from '../../../musicfree-gateway/search.mjs';
import { createItemProof } from '../../../musicfree-gateway/itemProof.mjs';

// test/unit/onlineMusic/musicfreeSearch.test.ts
// Search enrichment and signed item identity survive persistence and distinguish plugin origins.

describe('MusicFree search metadata', () => {
    it('fills missing search covers with getMusicInfo and retains other plugin fields', async () => {
        const plugin = {
            metadata: { name: 'Fixture', methods: ['search', 'getMusicInfo'] },
            call: vi.fn(async (method: string) => method === 'search'
                ? { isEnd: true, data: [{ id: '1', title: 'Song', custom: 'keep' }] }
                : { artwork: 'https://cover.test/1.jpg' }),
        };
        const page = await searchPlugin(plugin, 'Song', 10, 0);
        expect(await enrichSearchItems(plugin, page.items)).toEqual([]);
        expect(page.items[0]).toMatchObject({ platform: 'Fixture', custom: 'keep', artwork: 'https://cover.test/1.jpg' });
        const calls = plugin.call.mock.calls.length;
        await enrichSearchItems(plugin, page.items);
        expect(plugin.call.mock.calls).toHaveLength(calls);
    });
    it('reports failed cover enrichment while keeping searchable songs', async () => {
        const items = [{ id: '1', title: 'Song' }];
        const plugin = { metadata: { methods: ['getMusicInfo'] }, call: vi.fn().mockRejectedValue(new Error('upstream down')) };
        expect(await enrichSearchItems(plugin, items)).toEqual([{ id: '1', message: 'upstream down' }]);
        expect(items[0].title).toBe('Song');
    });
    it('uses a stable secret for restored items and binds signatures to the whole item and provider', () => {
        const first = createItemProof('stable-test-secret');
        const restarted = createItemProof('stable-test-secret');
        const item = { id: '1', extra: { b: 2, a: 1 } };
        const proof = first.sign('musicfree.first', item);
        expect(restarted.verify('musicfree.first', { extra: { a: 1, b: 2 }, id: '1' }, proof)).toBe(true);
        expect(restarted.verify('musicfree.second', item, proof)).toBe(false);
        expect(restarted.verify('musicfree.first', { ...item, url: 'http://other.test' }, proof)).toBe(false);
    });
});
