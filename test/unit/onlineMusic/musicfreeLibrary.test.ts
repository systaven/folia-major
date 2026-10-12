import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appDatabase } from '@/services/appDatabase';
import { createMusicFreeProvider } from '@/services/onlineMusic/musicfreeProvider';
import { getMusicFreeLikedSongs, publishMusicFreeLibrary } from '@/services/onlineMusic/musicfreeLibrary';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';
import type { MusicFreeProviderDescriptor } from '@/types/musicfree';

// test/unit/onlineMusic/musicfreeLibrary.test.ts
// Persisted likes must survive adapter recreation and remain isolated by provider identity.

const descriptor: MusicFreeProviderDescriptor = { id: 'musicfree.01234567890123456789', name: 'Fixture', version: '1',
    primaryKey: ['id'], methods: ['getRecommendSheetsByTag', 'getMusicSheetInfo'], supportedSearchType: [] };
afterEach(async () => { vi.unstubAllGlobals(); await appDatabase.musicfree_library.clear(); });
describe('MusicFree public library', () => {
    it('retains concurrent likes across adapter recreation, supports unlike, and isolates providers', async () => {
        const provider = createMusicFreeProvider(descriptor, '/api/musicfree');
        const songs = [1, 2].map(id => provider.normalizeSong({ item: { id, title: `Song ${id}` }, proof: 'signed' }));
        await Promise.all(songs.map(song => provider.mutations!.likeSong!(song, true)));
        const restored = createMusicFreeProvider(descriptor, '/api/musicfree');
        expect((await restored.catalog!.getPlaylistTracks!('browser-liked', 20, 0)).items).toHaveLength(2);
        await publishMusicFreeLibrary(descriptor.id);
        expect(useOnlineProviderAccountStore.getState().accounts[descriptor.id].likedSongIds).toHaveLength(2);
        expect(await getMusicFreeLikedSongs('musicfree.other')).toEqual([]);
        await restored.mutations!.likeSong!(songs[0], false);
        expect((await restored.library!.getLikedSongs!('public')).map(song => song.name)).toEqual(['Song 2']);
    });
    it('preserves signed collection fields through JSON persistence and routes tracks to their provider', async () => {
        const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify([{ item: { id: 'sheet1', title: 'Top', custom: 'keep' }, proof: 'signed', kind: 'top' }])))
            .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ item: { id: 1, title: 'Song' }, proof: 'track-signature' }], hasMore: false, nextOffset: 1 })));
        vi.stubGlobal('fetch', fetcher);
        const provider = createMusicFreeProvider(descriptor, '/api/musicfree');
        expect(provider.capabilities).toMatchObject({ publicLibrary: true, userLibrary: true, playlists: true, likes: true });
        const collections = await provider.recommendations!.getRecommendedCollections!(35);
        const persisted = JSON.parse(JSON.stringify(collections[0]));
        const fresh = createMusicFreeProvider(descriptor, '/api/musicfree');
        const page = await fresh.catalog!.getPlaylistTracks!(persisted.id, 10, 0, persisted);
        expect(page.items[0].sourceRef).toMatchObject({ providerId: descriptor.id });
        expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ item: { custom: 'keep' }, proof: 'signed', kind: 'top' });
    });
});
