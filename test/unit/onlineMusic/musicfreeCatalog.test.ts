import { afterEach, describe, expect, it, vi } from 'vitest';
import { recommendedCollections } from '../../../musicfree-gateway/catalog.mjs';

// test/unit/onlineMusic/musicfreeCatalog.test.ts
// A failed recommendation branch must not erase valid charts or hide a completely broken feed.

afterEach(() => vi.restoreAllMocks());
describe('MusicFree home catalogs', () => {
    it('keeps chart cards when the playlist upstream fails', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const plugin = { metadata: { name: 'Fixture', methods: ['getRecommendSheetsByTag', 'getTopLists'] },
            call: vi.fn(async (method: string) => {
                if (method === 'getRecommendSheetsByTag') throw new Error('Playlist HTTP 503');
                return [{ title: 'Charts', data: [{ id: 'top', title: 'Chart', artwork: 'https://cover.test/image.jpg' }] }];
            }) };
        await expect(recommendedCollections(plugin, 35)).resolves.toEqual([
            { kind: 'top', item: { id: 'top', title: 'Chart', artwork: 'https://cover.test/image.jpg' } },
        ]);
    });

    it('preserves a real feed failure when neither branch produces cards', async () => {
        const error = new Error('Playlist HTTP 503');
        const plugin = { metadata: { methods: ['getRecommendSheetsByTag', 'getTopLists'] },
            call: vi.fn(async (method: string) => {
                if (method === 'getRecommendSheetsByTag') throw error;
                return [];
            }) };
        await expect(recommendedCollections(plugin, 35)).rejects.toBe(error);
    });
});
