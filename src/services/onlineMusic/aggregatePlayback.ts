import type { SongResult, UnifiedSong } from '../../types';
import type { AudioQualityPreference, ProviderAudioSource } from '../../types/onlineMusic';
import { OnlineProviderError } from '../../types/onlineMusic';
import { omni } from './omni';
import { allowedCandidates, childSongKey, sameAggregateRecording } from './aggregateIdentity';
import { aggregateDeadline, aggregateSourcePriority, recordAggregateHealth, useAggregateHealth } from './aggregateHealth';
import { probeAggregateAudio } from './aggregateAudioProbe';

// src/services/onlineMusic/aggregatePlayback.ts
// Explicit cross-provider fallback races verified full recordings, never just the quickest URL response.
export function createAggregatePlayback(providerIds: string[], searchableIds: string[], probe = probeAggregateAudio) {
    const allowed = new Set(providerIds);
    const selected = new Map<string, UnifiedSong>();
    const pending = new Map<string, Promise<ProviderAudioSource>>();
    const candidatesFor = (song: SongResult) => allowedCandidates(song, allowed);

    async function findAlternatives(song: UnifiedSong, existing: UnifiedSong[], onFound: (songs: UnifiedSong[]) => void): Promise<void> {
        const present = new Set(existing.map(item => item.sourceRef.kind === 'online' ? item.sourceRef.providerId : ''));
        const query = `${song.name} ${song.artists[0]?.name ?? ''}`.trim();
        await Promise.all(searchableIds.filter(id => !present.has(id)).map(async id => {
            const started = Date.now();
            try {
                const page = await aggregateDeadline(omni.searchProviderSongs(id, query, { limit: 15, offset: 0 }), 8000);
                recordAggregateHealth(id, { searchState: 'ok', searchMs: Date.now() - started });
                onFound(page.items.filter(item => sameAggregateRecording(song, item)));
            } catch { /* Other providers can still return this recording. */ }
        }));
    }

    async function resolveAudioSource(song: SongResult, quality: AudioQualityPreference): Promise<ProviderAudioSource> {
        const originals = candidatesFor(song);
        // A persisted queue can outlive its original plugin URL: use its recording metadata to find a configured source.
        const reference = originals[0] ?? (song.sourceRef?.kind === 'online' ? song as UnifiedSong : null);
        if (!reference) throw new OnlineProviderError('not-playable', '歌曲缺少音源信息，请重新搜索');
        const controller = new AbortController();
        const queue = [...originals].sort((a, b) => aggregateSourcePriority(a.sourceRef.kind === 'online' ? a.sourceRef.providerId : '')
            - aggregateSourcePriority(b.sourceRef.kind === 'online' ? b.sourceRef.providerId : ''));
        const attempted = new Set<string>();
        let active = 0, discovered = false, finished = false;
        const errors: unknown[] = [];
        // Three in flight prevents a failing plugin from serially blocking a healthy one.
        return new Promise<ProviderAudioSource>((resolve, reject) => {
            const timer = setTimeout(() => finish(undefined, new OnlineProviderError('network', '聚合音源播放超时，请重试')), 40000);
            const finish = (source?: ProviderAudioSource, error?: unknown) => {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                controller.abort();
                if (source) resolve(source); else reject(error);
            };
            const pump = () => {
                while (!finished && active < 3 && queue.length) {
                    const candidate = queue.shift()!;
                    const key = childSongKey(candidate);
                    if (attempted.has(key)) continue;
                    attempted.add(key);
                    active++;
                    const id = candidate.sourceRef.kind === 'online' ? candidate.sourceRef.providerId : '';
                    const started = Date.now();
                    void (async () => {
                        try {
                            const source = await aggregateDeadline(omni.getAudioSource(candidate, quality), 18000);
                            if (finished) return;
                            if (!source?.url) throw new OnlineProviderError('not-playable', '音源没有返回播放地址');
                            await probe(source.url, candidate, controller.signal);
                            if (finished) return;
                            recordAggregateHealth(id, { audioMs: Date.now() - started, audioState: 'ok', failedAt: undefined });
                            useAggregateHealth.setState({ selected: id });
                            if (selected.size >= 256) selected.delete(selected.keys().next().value!);
                            selected.set(String(song.id), candidate);
                            finish(source);
                        } catch (error) {
                            if (finished) return;
                            errors.push(error);
                            recordAggregateHealth(id, { audioMs: Date.now() - started,
                                audioState: error instanceof OnlineProviderError && error.code === 'preview-only' ? 'preview' : 'error', failedAt: Date.now() });
                        } finally { active--; if (!finished) pump(); }
                    })();
                }
                if (!finished && !active && !queue.length && discovered) {
                    const previews = errors.some(error => error instanceof OnlineProviderError && error.code === 'preview-only');
                    finish(undefined, new OnlineProviderError(previews ? 'preview-only' : 'not-playable',
                        previews ? '可达音源均未提供可验证的完整音频，已跳过试听片段' : '各音源均无法播放这首歌，请稍后重试'));
                }
            };
            void findAlternatives(reference, originals, items => {
                if (finished) return;
                queue.push(...items.sort((a, b) => aggregateSourcePriority(a.sourceRef.kind === 'online' ? a.sourceRef.providerId : '')
                    - aggregateSourcePriority(b.sourceRef.kind === 'online' ? b.sourceRef.providerId : '')));
                pump();
            }).then(() => {
                discovered = true;
                pump();
            }).catch(error => { errors.push(error); discovered = true; pump(); });
            pump();
        });
    }

    async function getLyrics(song: SongResult) {
        const candidates = candidatesFor(song);
        const winner = selected.get(String(song.id));
        const ordered = winner ? [winner, ...candidates.filter(item => childSongKey(item) !== childSongKey(winner))] : candidates;
        let complete = false;
        // A hanging lyric provider must not hold playback's lyric-loading gate for every candidate in turn.
        const workers = Array.from({ length: Math.min(3, ordered.length) }, async () => {
            while (!complete && ordered.length) {
                const candidate = ordered.shift()!;
                try {
                    const result = await aggregateDeadline(omni.getLyrics(candidate), 6000);
                    if (result.lyrics || result.mainText || result.isPureMusic) { complete = true; return result; }
                } catch { /* Continue with the same recording's other lyric providers. */ }
            }
            throw new Error('No lyrics');
        });
        try { return await aggregateDeadline(Promise.any(workers), 12000); }
        catch { return { lyrics: null, isPureMusic: false }; }
        finally { complete = true; }
    }
    function getAudioSource(song: SongResult, quality: AudioQualityPreference) {
        const key = JSON.stringify([song.id, quality]);
        let result = pending.get(key);
        if (!result) {
            result = resolveAudioSource(song, quality).finally(() => pending.delete(key));
            pending.set(key, result);
        }
        return result;
    }
    return { getAudioSource, getLyrics, candidatesFor };
}
