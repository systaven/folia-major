import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedSong } from '@/types';
import { OnlineProviderError } from '@/types/onlineMusic';
import { AGGREGATE_ID, allowedCandidates, mergeAggregateSongs, sameAggregateRecording, wrapAggregateSong } from '@/services/onlineMusic/aggregateIdentity';
import { createAggregatePlayback } from '@/services/onlineMusic/aggregatePlayback';
import { createAggregateSearch } from '@/services/onlineMusic/aggregateSearch';
import { verifyAggregateDuration } from '@/services/onlineMusic/aggregateAudioProbe';
import { initializeAggregateHealth, useAggregateHealth } from '@/services/onlineMusic/aggregateHealth';
import { omni } from '@/services/onlineMusic/omni';

// test/unit/onlineMusic/musicfreeAggregate.test.ts
// Exercise actual orchestration decisions: previews, failed sources, recording identity and source-aware pagination.
vi.mock('@/services/onlineMusic/omni', () => ({ omni: {
    searchProviderSongs: vi.fn(), getAudioSource: vi.fn(), getLyrics: vi.fn(),
} }));
const ids = ['musicfree.fast', 'musicfree.full', 'musicfree.dead'];
const song = (providerId: string, id = '26995594', name = "Holdin' On (Skrillex & Nero Remix)"): UnifiedSong => ({
    id, name, artists: [{ id: 'artist', name: 'Monsta' }], album: { id: 'album', name: 'Holdin On', coverUrl: '/cover' }, durationMs: 237000,
    sourceRef: { kind: 'online', providerId, mediaId: id,
        providerData: { musicfree: { id, platform: '网易云' }, musicfreeProof: `${providerId}-proof` } },
});
const audio = (url: string) => ({ url, quality: 'high' as const, fetchedAt: Date.now(), expiresAt: Date.now() + 60000 });
beforeEach(() => {
    vi.resetAllMocks();
    initializeAggregateHealth(ids.map(id => ({ id, name: id })));
});
afterEach(() => vi.useRealTimers());

describe('aggregate recording identity', () => {
    it('keeps signed child records through persistence and rejects removed/recursive providers', () => {
        const first = song(ids[0]), second = song(ids[1]);
        const rows = mergeAggregateSongs([first, second]);
        expect(rows).toHaveLength(1);
        expect(rows[0].sourceRef).toMatchObject({ providerId: AGGREGATE_ID });
        expect(allowedCandidates(JSON.parse(JSON.stringify(rows[0])), new Set(ids))).toEqual([first, second]);
        expect(allowedCandidates(rows[0], new Set([ids[1]]))).toEqual([second]);
        expect(allowedCandidates(wrapAggregateSong(rows), new Set(ids))).toEqual([]);
    });
    it('never matches different known NetEase IDs, covers or numeric IDs on unrelated platforms', () => {
        const original = song(ids[0]);
        expect(sameAggregateRecording(original, song(ids[1], '123'))).toBe(false);
        const cover = song(ids[1], '123', "Holdin' On (Cover)");
        expect(sameAggregateRecording(original, cover)).toBe(false);
        const unrelated = song(ids[1]);
        unrelated.sourceRef = { kind: 'online', providerId: ids[1], mediaId: '26995594',
            providerData: { musicfree: { id: '26995594', platform: 'QQ' } } };
        unrelated.name = 'Entirely different recording';
        expect(sameAggregateRecording(original, unrelated)).toBe(false);
        const unknown = song(ids[1]);
        unknown.sourceRef = { kind: 'online', providerId: ids[1], mediaId: 'different' };
        expect(sameAggregateRecording(original, unknown)).toBe(true);
        unknown.album.name = 'Live at Wembley';
        expect(sameAggregateRecording(original, unknown)).toBe(false);
    });
    it('recognizes the documented Yuanli WY namespace and keeps aggregate identity stable across provider order', () => {
        const first = song(ids[0]), second = song(ids[1]);
        second.artists[0].name = 'Monsta/Skrillex/NERO';
        second.sourceRef = { kind: 'online', providerId: ids[1], mediaId: '26995594',
            providerData: { musicfree: { id: 26995594, platform: '元力WY' }, musicfreeProof: 'proof' } };
        expect(mergeAggregateSongs([first, second])).toHaveLength(1);
        expect(wrapAggregateSong([first, second]).id).toEqual(wrapAggregateSong([second, first]).id);
        expect(sameAggregateRecording(wrapAggregateSong([first]), second)).toBe(true);
    });
});

describe('aggregate media selection', () => {
    it('rejects actual 30-second audio even if catalog metadata promises the full song', () => {
        expect(() => verifyAggregateDuration(30, 237000)).toThrow(OnlineProviderError);
        expect(() => verifyAggregateDuration(30, 30000)).toThrow(OnlineProviderError);
        expect(() => verifyAggregateDuration(30, 0)).toThrow(OnlineProviderError);
        expect(() => verifyAggregateDuration(110, 237000)).toThrow(OnlineProviderError);
        expect(() => verifyAggregateDuration(Infinity, 237000)).toThrow(OnlineProviderError);
        expect(() => verifyAggregateDuration(237.381, 237000)).not.toThrow();
        expect(() => verifyAggregateDuration(12, 12000)).not.toThrow();
    });
    it('skips the fastest preview and a 502, returning verified full audio with unchanged quality', async () => {
        vi.mocked(omni.getAudioSource).mockImplementation(async input => {
            if (input.sourceRef?.kind === 'online' && input.sourceRef.providerId === ids[2]) throw new Error('HTTP 502');
            return audio(input.sourceRef!.kind === 'online' ? input.sourceRef!.providerId : '');
        });
        const probe = vi.fn(async (url: string) => verifyAggregateDuration(url === ids[0] ? 30 : 237, 237000));
        const player = createAggregatePlayback(ids, ids, probe);
        const source = await player.getAudioSource(wrapAggregateSong(ids.map(id => song(id))), 'high');
        expect(source.url).toBe(ids[1]);
        expect(omni.getAudioSource).toHaveBeenCalledWith(expect.anything(), 'high');
        expect(useAggregateHealth.getState().sources[ids[0]].audioState).toBe('preview');
        expect(useAggregateHealth.getState().selected).toBe(ids[1]);
        vi.mocked(omni.getLyrics).mockResolvedValue({ lyrics: null, isPureMusic: false, mainText: '[00:01]Lyrics' });
        expect((await player.getLyrics(wrapAggregateSong(ids.map(id => song(id))))).mainText).toContain('Lyrics');
        expect(omni.getLyrics).toHaveBeenCalledWith(expect.objectContaining({ sourceRef: expect.objectContaining({ providerId: ids[1] }) }));
    });
    it('discovers the same recording after a recommendation source fails without waiting for a hung search', async () => {
        vi.mocked(omni.getAudioSource).mockImplementation(async input => {
            if (input.sourceRef?.kind === 'online' && input.sourceRef.providerId === ids[0]) throw new Error('502');
            return audio('complete');
        });
        vi.mocked(omni.searchProviderSongs).mockImplementation(async id => id === ids[2] ? new Promise(() => {})
            : { items: [song(id)], hasMore: false, nextOffset: 1 });
        const result = await createAggregatePlayback(ids, ids, async () => {}).getAudioSource(wrapAggregateSong([song(ids[0])]), 'standard');
        expect(result.url).toBe('complete');
        expect(omni.getAudioSource).toHaveBeenCalledTimes(2);
    });
    it('fails clearly when every source only returns previews rather than playing one silently', async () => {
        vi.mocked(omni.getAudioSource).mockResolvedValue(audio('preview'));
        const player = createAggregatePlayback(ids.slice(0, 2), [], async () => verifyAggregateDuration(30, 237000));
        await expect(player.getAudioSource(wrapAggregateSong([song(ids[0]), song(ids[1])]), 'high'))
            .rejects.toMatchObject({ code: 'preview-only' });
    });
    it('shares simultaneous prefetch and play requests without multiplying upstream calls', async () => {
        vi.mocked(omni.getAudioSource).mockResolvedValue(audio('complete'));
        const player = createAggregatePlayback([ids[0]], [], async () => {});
        const input = wrapAggregateSong([song(ids[0])]);
        const [first, second] = await Promise.all([player.getAudioSource(input, 'high'), player.getAudioSource(input, 'high')]);
        expect(first).toEqual(second);
        expect(omni.getAudioSource).toHaveBeenCalledTimes(1);
    });
    it('resolves a persisted queue after its original plugin was removed without calling the removed provider', async () => {
        vi.mocked(omni.searchProviderSongs).mockResolvedValue({ items: [song(ids[1])], hasMore: false, nextOffset: 1 });
        vi.mocked(omni.getAudioSource).mockResolvedValue(audio('new-source'));
        const player = createAggregatePlayback([ids[1]], [ids[1]], async () => {});
        const oldQueueSong = JSON.parse(JSON.stringify(wrapAggregateSong([song(ids[0])])));
        expect((await player.getAudioSource(oldQueueSong, 'high')).url).toBe('new-source');
        expect(omni.getAudioSource).toHaveBeenCalledWith(expect.objectContaining({ sourceRef: expect.objectContaining({ providerId: ids[1] }) }), 'high');
    });
    it('cancels losing media probes and ignores a late response instead of changing the selected source', async () => {
        let late!: (value: ReturnType<typeof audio>) => void;
        vi.mocked(omni.getAudioSource).mockImplementation(async input => input.sourceRef?.kind === 'online' && input.sourceRef.providerId === ids[0]
            ? new Promise(resolve => { late = resolve; }) : audio('winner'));
        const signals: AbortSignal[] = [];
        const player = createAggregatePlayback(ids.slice(0, 2), [], async (_url, _song, signal) => { signals.push(signal); });
        expect((await player.getAudioSource(wrapAggregateSong([song(ids[0]), song(ids[1])]), 'high')).url).toBe('winner');
        late(audio('late'));
        await Promise.resolve();
        expect(useAggregateHealth.getState().selected).toBe(ids[1]);
        expect(signals.every(signal => signal.aborted)).toBe(true);
    });
});

describe('aggregate search', () => {
    it('returns deduplicated partial success and stable buffered pagination despite a failed source', async () => {
        vi.mocked(omni.searchProviderSongs).mockImplementation(async id => {
            if (id === ids[2]) throw new Error('503');
            return { items: [song(id), song(id, id === ids[0] ? '2' : '3', id)], hasMore: false, nextOffset: 2 };
        });
        const search = createAggregateSearch(ids);
        const first = await search.searchSongs('holdin on', 2, 0);
        expect(first.items).toHaveLength(2);
        expect(allowedCandidates(first.items[0], new Set(ids))).toHaveLength(2);
        expect(first.hasMore).toBe(true);
        const second = await search.searchSongs('holdin on', 2, first.nextOffset);
        expect(second.items).toHaveLength(1);
        expect(second.hasMore).toBe(false);
        expect(await search.searchSongs('holdin on', 2, 0)).toEqual(first);
        expect(omni.searchProviderSongs).toHaveBeenCalledTimes(3);
        expect(useAggregateHealth.getState().sources[ids[2]].searchState).toBe('error');
    });
    it('lets a fresh search recover after all sources fail', async () => {
        vi.mocked(omni.searchProviderSongs).mockRejectedValue(new Error('502'));
        const search = createAggregateSearch([ids[0]]);
        await expect(search.searchSongs('holdin on', 10, 0)).rejects.toMatchObject({ code: 'network' });
        vi.mocked(omni.searchProviderSongs).mockResolvedValue({ items: [song(ids[0])], hasMore: false, nextOffset: 1 });
        expect((await search.searchSongs('holdin on', 10, 0)).items).toHaveLength(1);
    });
    it('advances over duplicate-only pages and can retry a failed Load more without expiring earlier results', async () => {
        let failNext = false;
        vi.mocked(omni.searchProviderSongs).mockImplementation(async (_id, _query, page) => {
            if (failNext) { failNext = false; throw new Error('502'); }
            return { items: [song(ids[0], page.offset < 2 ? '1' : '2')], hasMore: page.offset < 2, nextOffset: page.offset + 1 };
        });
        const search = createAggregateSearch([ids[0]]);
        const first = await search.searchSongs('song', 1, 0);
        failNext = true;
        await expect(search.searchSongs('song', 1, first.nextOffset)).rejects.toMatchObject({ code: 'network' });
        const duplicate = await search.searchSongs('song', 1, first.nextOffset);
        expect(duplicate).toMatchObject({ items: [], hasMore: true, nextOffset: 2 });
        const last = await search.searchSongs('song', 1, duplicate.nextOffset);
        expect(last.items).toHaveLength(1);
        expect(last.hasMore).toBe(false);
        expect(last.items[0].id).not.toEqual(first.items[0].id);
    });
});
