import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderCollection } from '@/types/onlineMusic';
import { appDatabase } from '@/services/appDatabase';
import { createAggregateProvider } from '@/services/onlineMusic/aggregateProvider';
import { AGGREGATE_ID, allowedCandidates, wrapAggregateSong } from '@/services/onlineMusic/aggregateIdentity';
import { normalizeMusicFreeSong } from '@/services/onlineMusic/musicfreeNormalize';
import { omni } from '@/services/onlineMusic/omni';

// test/unit/onlineMusic/musicfreeAggregateLibrary.test.ts
// Recommendation covers, signed collection tracks and browser likes must survive aggregation and restoration.
vi.mock('@/services/onlineMusic/omni', () => ({ omni: {
    getProviderRecommendedCollections: vi.fn(), getCollectionTracks: vi.fn(),
} }));
const descriptor = { id: 'musicfree.11111111111111111111', name: '网易 Fixture', version: '1', primaryKey: ['id'],
    methods: ['search', 'getMediaSource'], supportedSearchType: ['music'] };
const track = normalizeMusicFreeSong(descriptor, '/api/musicfree', {
    item: { id: 123, title: 'Song', artist: 'Artist', platform: '网易', duration: 237 }, proof: 'track-signature',
    artworkUrl: '/api/musicfree/assets/cover',
});
const collection: ProviderCollection = { providerId: descriptor.id, id: 'playlist:123', name: 'Public mix', type: 'playlist',
    coverUrl: '/api/musicfree/assets/cover', providerData: { musicfree: { id: 123 }, musicfreeProof: 'collection-signature', musicfreeKind: 'playlist' } };
afterEach(async () => { vi.resetAllMocks(); await appDatabase.musicfree_library.clear(); });
describe('aggregate home and library', () => {
    it('keeps covers and signed catalog origins while wrapping recommendation tracks for fallback', async () => {
        vi.mocked(omni.getProviderRecommendedCollections).mockImplementation(async id => id === descriptor.id ? [collection] : Promise.reject(new Error('502')));
        vi.mocked(omni.getCollectionTracks).mockResolvedValue({ items: [track], hasMore: true, nextOffset: 40 });
        const provider = createAggregateProvider([descriptor, { ...descriptor, id: 'musicfree.22222222222222222222' }]);
        const rows = await provider.recommendations!.getRecommendedCollections!(35);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ providerId: AGGREGATE_ID, coverUrl: collection.coverUrl });
        const restored = JSON.parse(JSON.stringify(rows[0]));
        const page = await provider.catalog!.getPlaylistTracks!(restored.id, 20, 0, restored);
        expect(omni.getCollectionTracks).toHaveBeenCalledWith(collection, { limit: 20, offset: 0 });
        expect(page).toMatchObject({ hasMore: true, nextOffset: 40 });
        expect(allowedCandidates(page.items[0], new Set([descriptor.id]))).toEqual([track]);
    });
    it('persists aggregate likes with child proofs and restores them without changing the raw providers library', async () => {
        const provider = createAggregateProvider([descriptor]);
        const wrapped = wrapAggregateSong([track]);
        await provider.mutations!.likeSong!(wrapped, true);
        const restored = createAggregateProvider([descriptor]);
        const page = await restored.catalog!.getPlaylistTracks!('browser-liked', 20, 0);
        expect(page.items).toEqual([wrapped]);
        expect(allowedCandidates(page.items[0], new Set([descriptor.id]))).toEqual([track]);
        expect(await appDatabase.musicfree_library.get(descriptor.id)).toBeUndefined();
        await restored.mutations!.likeSong!(wrapped, false);
        expect((await restored.catalog!.getPlaylistTracks!('browser-liked', 20, 0)).items).toEqual([]);
    });
});
