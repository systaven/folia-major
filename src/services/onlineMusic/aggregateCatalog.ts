import type { UnifiedSong } from '../../types';
import type { ProviderCollection } from '../../types/onlineMusic';
import { OnlineProviderError } from '../../types/onlineMusic';
import { omni } from './omni';
import { AGGREGATE_ID, mergeAggregateSongs, wrapAggregateCollection } from './aggregateIdentity';
import { aggregateDeadline } from './aggregateHealth';
import { getMusicFreeLikedSongs, musicFreeLikedCollection, MUSICFREE_LIKED_COLLECTION_ID } from './musicfreeLibrary';

// src/services/onlineMusic/aggregateCatalog.ts
// Keep original signed collection references while routing every recommendation track back through aggregation.
export function createAggregateCatalog(providerIds: string[]) {
    const allowed = new Set(providerIds);
    async function recommendations(limit: number) {
        const lists = await Promise.all(providerIds.map(async id => {
            try { return await aggregateDeadline(omni.getProviderRecommendedCollections(id, limit), 10000); }
            catch { return []; }
        }));
        return Array.from({ length: Math.max(0, ...lists.map(rows => rows.length)) },
            (_, rank) => lists.flatMap(rows => rows[rank] ? [wrapAggregateCollection(rows[rank])] : [])).flat().slice(0, limit);
    }
    const liked = () => getMusicFreeLikedSongs(AGGREGATE_ID);
    return {
        recommendations: { getRecommendedCollections: recommendations },
        catalog: {
            async getPlaylistDetail(id: string | number, collection?: ProviderCollection) {
                return String(id) === MUSICFREE_LIKED_COLLECTION_ID ? musicFreeLikedCollection(AGGREGATE_ID, await liked()) : collection ?? null;
            },
            async getPlaylistTracks(id: string | number, limit: number, offset: number, collection?: ProviderCollection) {
                if (String(id) === MUSICFREE_LIKED_COLLECTION_ID) {
                    const songs = await liked();
                    const items = songs.slice(offset, offset + limit);
                    return { items, total: songs.length, hasMore: offset + items.length < songs.length, nextOffset: offset + items.length };
                }
                const original = collection?.providerData?.aggregateCollection as unknown as ProviderCollection | undefined;
                if (!original || !allowed.has(original.providerId)) throw new OnlineProviderError('invalid-response', '聚合歌单缺少原始音源');
                const page = await omni.getCollectionTracks(original, { limit, offset });
                // Keep catalog offsets, since deduplication must not change the child's pagination cursor.
                return { ...page, items: page.items.map(song => mergeAggregateSongs([song])[0]) };
            },
        },
        library: {
            async getLikedSongs(): Promise<UnifiedSong[]> { return liked(); },
            async getLikedSongIds() { return (await liked()).map(song => song.id); },
            async getUserPlaylists(_id: string | number, limit: number, offset: number) {
                const rows = [musicFreeLikedCollection(AGGREGATE_ID, await liked()), ...await recommendations(100)];
                const items = rows.slice(offset, offset + limit);
                return { items, total: rows.length, hasMore: offset + items.length < rows.length, nextOffset: offset + items.length };
            },
        },
    };
}
