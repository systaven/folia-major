import type { SongResult, UnifiedSong } from '../../types';
import type { MusicFreeItem, MusicFreeProviderDescriptor, MusicFreeSearchPage, MusicFreeSongPayload } from '../../types/musicfree';
import type { AudioQualityPreference, OnlineMusicProvider } from '../../types/onlineMusic';
import { OnlineProviderError } from '../../types/onlineMusic';
import { parseLyricsByFormat } from '../../utils/lyrics/parserCore';
import { isPureMusicLyricText } from '../../utils/lyrics/pureMusic';
import { normalizeMusicFreeSong } from './musicfreeNormalize';
import { requestMusicFree, resolveMusicFreeAssetUrl } from './musicfreeTransport';
import { createMusicFreeCatalog } from './musicfreeCatalog';
import { getMusicFreeLikedSongs, setMusicFreeSongLiked } from './musicfreeLibrary';

// src/services/onlineMusic/musicfreeProvider.ts
// Adapts each MusicFree plugin to Omni without adding account flows or changing the UI.

export const musicFreeQuality = (quality: AudioQualityPreference): 'standard' | 'high' | 'super' => (
    quality === 'lossless' || quality === 'hires' ? 'super' : quality
);

export function createMusicFreeProvider(descriptor: MusicFreeProviderDescriptor, base: string): OnlineMusicProvider {
    const songs = new Map<string, UnifiedSong>();
    const normalize = (payload: MusicFreeSongPayload): UnifiedSong => {
        const song = normalizeMusicFreeSong(descriptor, base, payload);
        if (songs.size >= 2048) songs.delete(songs.keys().next().value!);
        songs.set(String(song.id), song);
        return song;
    };
    const rawItem = (song: SongResult): { item: MusicFreeItem; proof: string } => {
        const ref = song.sourceRef;
        const item = ref?.kind === 'online' && ref.providerId === descriptor.id ? ref.providerData?.musicfree : null;
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            throw new OnlineProviderError('invalid-response', 'MusicFree song is missing its original item', descriptor.id);
        }
        const proof = ref?.kind === 'online' ? ref.providerData?.musicfreeProof : null;
        if (typeof proof !== 'string') throw new OnlineProviderError('invalid-response', 'MusicFree song has no item signature', descriptor.id);
        return { item, proof };
    };
    const call = <T>(operation: string, body: unknown) => requestMusicFree<T>(base, `/providers/${descriptor.id}/${operation}`, body);
    const catalog = createMusicFreeCatalog(descriptor, base, normalize);
    const searchable = descriptor.methods.includes('search') && descriptor.supportedSearchType.includes('music');
    return {
        id: descriptor.id, displayName: descriptor.name,
        getAvailability: () => ({ configured: true }),
        capabilities: {
            search: searchable, playback: true, lyrics: true, wordByWordLyrics: false,
            auth: false, publicLibrary: true, userLibrary: true, playlists: true, albums: false, artists: false,
            recommendations: catalog.supportsRecommendations, mutations: true, likes: true,
        },
        catalog: catalog.catalog,
        library: catalog.library,
        recommendations: catalog.recommendations,
        mutations: {
            async likeSong(song, liked) {
                const record = typeof song === 'object' ? song : songs.get(String(song))
                    ?? (await getMusicFreeLikedSongs(descriptor.id)).find(item => String(item.id) === String(song));
                if (!record) throw new OnlineProviderError('unsupported', 'MusicFree likes require the original song', descriptor.id);
                await setMusicFreeSongLiked(descriptor.id, record, liked);
            },
        },
        normalizeSong(raw) {
            const song = raw as UnifiedSong;
            if (song?.sourceRef?.kind === 'online' && song.sourceRef.providerId === descriptor.id) return song;
            return normalize(raw as MusicFreeSongPayload);
        },
        ...(searchable ? { search: {
            async searchSongs(query: string, limit: number, offset: number) {
                const page = await call<MusicFreeSearchPage>('search', { query, limit, offset });
                if (!Array.isArray(page?.items) || typeof page.hasMore !== 'boolean' || !Number.isSafeInteger(page.nextOffset)) {
                    throw new OnlineProviderError('invalid-response', 'Invalid MusicFree search page', descriptor.id);
                }
                if (page.metadataErrors?.length) console.warn('[MusicFree] Some song metadata could not load:', page.metadataErrors);
                return { items: page.items.map(normalize), hasMore: page.hasMore, nextOffset: page.nextOffset };
            },
        } } : {}),
        playback: {
            async getSongDetail(id) {
                const song = songs.get(String(id));
                return song ? normalize(await call<MusicFreeSongPayload>('detail', rawItem(song))) : null;
            },
            async getAudioSource(song, quality) {
                const result = await call<{ url: string; expiresAt: number } | null>('audio', { ...rawItem(song), quality: musicFreeQuality(quality) });
                if (!result) return null;
                return { url: resolveMusicFreeAssetUrl(base, result.url), fetchedAt: Date.now(), expiresAt: result.expiresAt,
                    // Plugin tiers do not guarantee a codec; the supplied fixture even maps super to 320k.
                    quality: quality === 'standard' ? 'standard' : 'high' };
            },
        },
        lyrics: {
            async getLyrics(song) {
                const result = await call<{ rawLrc: string; translation: string }>('lyrics', rawItem(song));
                const mainText = typeof result.rawLrc === 'string' ? result.rawLrc : '';
                const translationText = typeof result.translation === 'string' ? result.translation : '';
                const lyrics = mainText ? parseLyricsByFormat('lrc', mainText, translationText) : null;
                return { lyrics: lyrics?.lines.length ? lyrics : null, mainText, translationText,
                    isPureMusic: isPureMusicLyricText(mainText) };
            },
        },
    };
}
