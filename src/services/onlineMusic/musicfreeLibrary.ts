import type { SongResult, UnifiedSong } from '../../types';
import type { ProviderCollection } from '../../types/onlineMusic';
import { OnlineProviderError } from '../../types/onlineMusic';
import { appDatabase } from '../appDatabase';
import { useOnlineProviderAccountStore } from '../../stores/useOnlineProviderAccountStore';
import i18n from '../../i18n/config';

// src/services/onlineMusic/musicfreeLibrary.ts
// Durable browser favorites, namespaced by provider; no remote account or audio file is required.

export const MUSICFREE_LIKED_COLLECTION_ID = 'browser-liked';

export const getMusicFreeLikedSongs = async (providerId: string): Promise<UnifiedSong[]> => (
    (await appDatabase.musicfree_library.get(providerId))?.likedSongs ?? []
);

export function musicFreeLikedCollection(providerId: string, songs: UnifiedSong[]): ProviderCollection {
    return { providerId, id: MUSICFREE_LIKED_COLLECTION_ID, name: i18n.t('musicfree.browserLikedSongs'), type: 'playlist',
        isLiked: true, isOwned: true, trackCount: songs.length, coverUrl: songs[0]?.album.coverUrl,
        description: i18n.t('musicfree.browserLikedSongsDescription') };
}

export async function publishMusicFreeLibrary(providerId: string, collections?: ProviderCollection[]) {
    const songs = await getMusicFreeLikedSongs(providerId);
    const existing = collections ?? useOnlineProviderAccountStore.getState().accounts[providerId]?.collections ?? [];
    useOnlineProviderAccountStore.getState().updateAccount(providerId, {
        status: 'anonymous', user: null, hydration: 'ready', freshness: 'fresh',
        likedSongIds: songs.map(song => song.sourceRef.kind === 'online' ? song.sourceRef.mediaId : String(song.id)),
        collections: [musicFreeLikedCollection(providerId, songs), ...existing.filter(item => item.id !== MUSICFREE_LIKED_COLLECTION_ID)],
    });
}

// One IndexedDB transaction serializes simultaneous likes, avoiding lost updates from rapid clicks.
export async function setMusicFreeSongLiked(providerId: string, song: SongResult, liked: boolean): Promise<void> {
    const ref = song.sourceRef;
    if (ref?.kind !== 'online' || ref.providerId !== providerId) throw new OnlineProviderError('unsupported', 'Song belongs to another provider', providerId);
    await appDatabase.transaction('rw', appDatabase.musicfree_library, async () => {
        const songs = await getMusicFreeLikedSongs(providerId);
        const filtered = songs.filter(item => item.sourceRef.kind !== 'online' || item.sourceRef.mediaId !== ref.mediaId);
        if (liked) filtered.push(JSON.parse(JSON.stringify(song)));
        await appDatabase.musicfree_library.put({ providerId, likedSongs: filtered, updatedAt: Date.now() });
    });
    await publishMusicFreeLibrary(providerId);
}
