import type { UnifiedSong } from '../../types';
import type { MusicFreeProviderDescriptor } from '../../types/musicfree';
import type { OnlineMusicProvider } from '../../types/onlineMusic';
import { OnlineProviderError } from '../../types/onlineMusic';
import i18n from '../../i18n/config';
import { AGGREGATE_ID } from './aggregateIdentity';
import { initializeAggregateHealth } from './aggregateHealth';
import { createAggregateSearch } from './aggregateSearch';
import { createAggregatePlayback } from './aggregatePlayback';
import { createAggregateCatalog } from './aggregateCatalog';
import { getMusicFreeLikedSongs, setMusicFreeSongLiked } from './musicfreeLibrary';

// src/services/onlineMusic/aggregateProvider.ts
// Synthetic Omni adapter orchestrates configured MusicFree providers without bypassing their signed transports.
export function createAggregateProvider(descriptors: MusicFreeProviderDescriptor[]): OnlineMusicProvider {
    const ids = descriptors.filter(item => item.methods.includes('getMediaSource')).map(item => item.id);
    const searchable = descriptors.filter(item => ids.includes(item.id) && item.methods.includes('search')
        && item.supportedSearchType.includes('music')).map(item => item.id);
    initializeAggregateHealth(descriptors.filter(item => ids.includes(item.id)));
    const playback = createAggregatePlayback(ids, searchable);
    const catalog = createAggregateCatalog(ids);
    return {
        id: AGGREGATE_ID,
        get displayName() { return i18n.t('musicfree.aggregateName'); },
        getAvailability: () => ({ configured: ids.length > 0 }),
        capabilities: { search: searchable.length > 0, playback: true, lyrics: true, wordByWordLyrics: false,
            auth: false, publicLibrary: true, userLibrary: true, playlists: true, albums: false, artists: false,
            recommendations: true, mutations: true, likes: true },
        normalizeSong(raw) {
            const song = raw as UnifiedSong;
            if (song?.sourceRef?.kind !== 'online' || song.sourceRef.providerId !== AGGREGATE_ID) {
                throw new OnlineProviderError('invalid-response', 'Invalid aggregate song');
            }
            return song;
        },
        search: createAggregateSearch(searchable),
        playback: { getAudioSource: playback.getAudioSource,
            async getSongDetail(id) { return (await getMusicFreeLikedSongs(AGGREGATE_ID)).find(song => String(song.id) === String(id)) ?? null; } },
        lyrics: { getLyrics: playback.getLyrics },
        ...catalog,
        mutations: {
            async likeSong(song, liked) {
                const record = typeof song === 'object' ? song : (await getMusicFreeLikedSongs(AGGREGATE_ID)).find(item => String(item.id) === String(song));
                if (!record) throw new OnlineProviderError('unsupported', 'Like requires the original aggregate song');
                await setMusicFreeSongLiked(AGGREGATE_ID, record, liked);
            },
        },
    };
}
