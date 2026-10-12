import type { UnifiedSong } from '../../types';
import type { MusicFreeCollectionPayload, MusicFreeProviderDescriptor, MusicFreeSearchPage, MusicFreeSongPayload } from '../../types/musicfree';
import type { OnlineCatalogProvider, OnlineLibraryProvider, OnlineRecommendationProvider, ProviderCollection } from '../../types/onlineMusic';
import { OnlineProviderError } from '../../types/onlineMusic';
import { requestMusicFree, resolveMusicFreeAssetUrl } from './musicfreeTransport';
import { getMusicFreeLikedSongs, musicFreeLikedCollection, MUSICFREE_LIKED_COLLECTION_ID } from './musicfreeLibrary';

// src/services/onlineMusic/musicfreeCatalog.ts
// Public plugin catalogs and browser-owned favorites share the existing Omni collection contract.

export function createMusicFreeCatalog(descriptor: MusicFreeProviderDescriptor, base: string, normalize: (payload: MusicFreeSongPayload) => UnifiedSong) {
    const collections = new Map<string, ProviderCollection>();
    const supportsRecommendations = descriptor.methods.includes('getRecommendSheetsByTag') || descriptor.methods.includes('getTopLists');
    let pending: Promise<ProviderCollection[]> | undefined;
    let cached: ProviderCollection[] | undefined;
    const recommendations: OnlineRecommendationProvider = supportsRecommendations ? {
        async getRecommendedCollections(limit) {
            if (cached) return cached.slice(0, limit);
            pending ??= requestMusicFree<MusicFreeCollectionPayload[]>(base, `/providers/${descriptor.id}/recommendations`, { limit: 100 })
                .then(rows => {
                    if (!Array.isArray(rows)) throw new OnlineProviderError('invalid-response', 'Invalid MusicFree catalog', descriptor.id);
                    cached = rows.map(row => {
                        const collection: ProviderCollection = {
                            providerId: descriptor.id, id: `${row.kind}:${String(row.item.id)}`, type: 'playlist',
                            name: String(row.item.title ?? row.item.name ?? ''),
                            coverUrl: row.artworkUrl ? resolveMusicFreeAssetUrl(base, row.artworkUrl) : undefined,
                            description: typeof row.item.description === 'string' ? row.item.description : undefined,
                            providerData: { musicfree: row.item, musicfreeProof: row.proof, musicfreeKind: row.kind },
                        };
                        collections.set(String(collection.id), collection);
                        return collection;
                    });
                    return cached;
                }).finally(() => { pending = undefined; });
            return (cached ?? await pending).slice(0, limit);
        },
    } : {};
    const catalog: OnlineCatalogProvider = {
        async getPlaylistDetail(id, collection) {
            if (String(id) === MUSICFREE_LIKED_COLLECTION_ID) return musicFreeLikedCollection(descriptor.id, await getMusicFreeLikedSongs(descriptor.id));
            return collection ?? collections.get(String(id)) ?? null;
        },
        async getPlaylistTracks(id, limit, offset, collection) {
            if (String(id) === MUSICFREE_LIKED_COLLECTION_ID) {
                const songs = await getMusicFreeLikedSongs(descriptor.id);
                const items = songs.slice(offset, offset + limit);
                return { items, total: songs.length, hasMore: offset + items.length < songs.length, nextOffset: offset + items.length };
            }
            const ref = collection ?? collections.get(String(id));
            if (ref?.providerId !== descriptor.id || !ref.providerData?.musicfree) throw new OnlineProviderError('unsupported', 'MusicFree collection has no source item', descriptor.id);
            const page = await requestMusicFree<MusicFreeSearchPage>(base, `/providers/${descriptor.id}/tracks`, {
                item: ref.providerData.musicfree, proof: ref.providerData.musicfreeProof, kind: ref.providerData.musicfreeKind, limit, offset,
            });
            if (!Array.isArray(page?.items) || typeof page.hasMore !== 'boolean' || !Number.isSafeInteger(page.nextOffset)) {
                throw new OnlineProviderError('invalid-response', 'Invalid MusicFree collection page', descriptor.id);
            }
            return { ...page, items: page.items.map(normalize) };
        },
    };
    const library: OnlineLibraryProvider = {
        async getUserPlaylists(_userId, limit, offset) {
            const all = [musicFreeLikedCollection(descriptor.id, await getMusicFreeLikedSongs(descriptor.id)),
                ...await recommendations.getRecommendedCollections?.(100) ?? []];
            const items = all.slice(offset, offset + limit);
            return { items, total: all.length, hasMore: offset + items.length < all.length, nextOffset: offset + items.length };
        },
        async getLikedSongs() { return getMusicFreeLikedSongs(descriptor.id); },
        async getLikedSongIds() { return (await getMusicFreeLikedSongs(descriptor.id)).map(song => String(song.id)); },
    };
    return { catalog, library, recommendations, supportsRecommendations };
}
