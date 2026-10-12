import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMusicFreeProvider, musicFreeQuality } from '@/services/onlineMusic/musicfreeProvider';
import { normalizeMusicFreeSong } from '@/services/onlineMusic/musicfreeNormalize';
import type { MusicFreeProviderDescriptor } from '@/types/musicfree';

// test/unit/onlineMusic/musicfreeProvider.test.ts
// Check source identity, persistent plugin fields, timed lyrics and the Web bridge contract.

const descriptor: MusicFreeProviderDescriptor = {
    id: 'musicfree.01234567890123456789', name: 'Fixture', version: '1', primaryKey: ['id', 'aid'],
    methods: ['search', 'getMediaSource', 'getLyric'], supportedSearchType: ['music'],
};
const payload = { item: { id: 12, aid: 'a', title: 'Song', artist: 'Artist', album: 'Album', duration: 123,
    customToken: 'keep-me' }, proof: 'fixture-proof', artworkUrl: '/api/musicfree/assets/cover' };
afterEach(() => vi.unstubAllGlobals());

describe('MusicFree Omni adapter', () => {
    it('preserves compound identities and raw fields while converting duration and proxy artwork', () => {
        const song = normalizeMusicFreeSong(descriptor, 'https://gateway.test/api/musicfree', payload);
        expect(song.id).toBe('[12,"a"]');
        expect(song.durationMs).toBe(123000);
        expect(song.album.coverUrl).toBe('https://gateway.test/api/musicfree/assets/cover');
        expect(song.artists[0].name).toBe('Artist');
        expect(song.artists[0].catalogRef).toBeUndefined();
        expect(song.sourceRef).toMatchObject({ providerId: descriptor.id, mediaId: '[12,"a"]',
            providerData: { musicfree: { customToken: 'keep-me' } } });
        expect(() => normalizeMusicFreeSong(descriptor, '/api/musicfree', { item: { id: 12, title: 'Missing aid' }, proof: 'fixture-proof' })).toThrow('primary key');
    });
    it('routes persisted songs through the gateway and parses line-timed LRC with translation', async () => {
        const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            rawLrc: '[00:01.00]First line\n[00:04.00]Second line', translation: '[00:01.00]第一句\n[00:04.00]第二句',
        })));
        vi.stubGlobal('fetch', fetcher);
        const provider = createMusicFreeProvider(descriptor, '/api/musicfree');
        const song = JSON.parse(JSON.stringify(provider.normalizeSong(payload)));
        const result = await provider.lyrics!.getLyrics(song);
        expect(result.lyrics?.lines.map(line => line.startTime)).toEqual([1, 4]);
        expect(result.lyrics?.lines[0].translation).toBe('第一句');
        expect(JSON.parse(fetcher.mock.calls[0][1].body).item.customToken).toBe('keep-me');
        expect(provider.capabilities.auth).toBe(false);
    });
    it('keeps gateway URLs and ticket lifetime and rejects songs owned by another provider', async () => {
        const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ url: '/api/musicfree/assets/audio', expiresAt: 9000 })));
        vi.stubGlobal('fetch', fetcher);
        const provider = createMusicFreeProvider(descriptor, '/api/musicfree');
        const song = provider.normalizeSong(payload);
        const audio = await provider.playback!.getAudioSource(song, 'hires');
        expect(audio).toMatchObject({ url: '/api/musicfree/assets/audio', expiresAt: 9000 });
        expect(audio?.quality).toBe('high');
        expect(JSON.parse(fetcher.mock.calls[0][1].body).quality).toBe('super');
        await expect(provider.playback!.getAudioSource({ ...song, sourceRef: { kind: 'online', providerId: 'netease', mediaId: '12' } }, 'high')).rejects.toThrow('original item');
        expect(musicFreeQuality('standard')).toBe('standard');
    });
    it('reports upstream failures rather than empty successful search results', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'upstream failed' }), { status: 502 })));
        const provider = createMusicFreeProvider(descriptor, '/api/musicfree');
        await expect(provider.search!.searchSongs('Song', 10, 0)).rejects.toThrow('upstream failed');
    });
});
