import type { UnifiedSong } from '../../types';
import type { ProviderPage } from '../../types/onlineMusic';
import { OnlineProviderError } from '../../types/onlineMusic';
import { omni } from './omni';
import { aggregateDeadline, recordAggregateHealth } from './aggregateHealth';
import { mergeAggregateSongs, sameAggregateRecording } from './aggregateIdentity';

// src/services/onlineMusic/aggregateSearch.ts
// Stable buffered pagination keeps fast-source results visible even when another plugin fails.
export function createAggregateSearch(providerIds: string[]) {
    type Session = { offsets: Map<string, number>; done: Set<string>; buffer: UnifiedSong[];
        seen: UnifiedSong[]; pages: Map<string, ProviderPage<UnifiedSong>>; cursor: number; created: number };
    const sessions = new Map<string, Session>();
    const pending = new Map<string, Promise<ProviderPage<UnifiedSong>>>();

    async function page(query: string, limit: number, offset: number): Promise<ProviderPage<UnifiedSong>> {
        let session = sessions.get(query);
        if (!session || Date.now() - session.created > 180000) {
            session = { offsets: new Map(), done: new Set(), buffer: [], seen: [], pages: new Map(), cursor: 0, created: Date.now() };
            if (sessions.size >= 10) sessions.delete(sessions.keys().next().value!);
            sessions.set(query, session);
        }
        const cacheKey = `${offset}:${limit}`;
        const cached = session.pages.get(cacheKey);
        if (cached) return cached;
        if (offset !== session.cursor) throw new OnlineProviderError('invalid-response', '聚合搜索已过期，请重新搜索');
        if (session.buffer.length < limit && session.done.size < providerIds.length) {
            const state = session;
            let successes = 0;
            const failed: string[] = [];
            const pages = await Promise.all(providerIds.map(async id => {
                if (state.done.has(id)) return [];
                const started = Date.now();
                try {
                    const previousOffset = state.offsets.get(id) ?? 0;
                    const result = await aggregateDeadline(omni.searchProviderSongs(id, query, {
                        limit, offset: previousOffset,
                    }), 10000);
                    successes++;
                    recordAggregateHealth(id, { searchMs: Date.now() - started, searchState: 'ok' });
                    state.offsets.set(id, result.nextOffset);
                    if (!result.hasMore || result.nextOffset <= previousOffset) state.done.add(id);
                    return result.items;
                } catch {
                    state.done.add(id);
                    failed.push(id);
                    recordAggregateHealth(id, { searchMs: Date.now() - started, searchState: 'error' });
                    return [];
                }
            }));
            if (!successes && !state.buffer.length) {
                if (!state.seen.length) sessions.delete(query);
                else failed.forEach(id => state.done.delete(id));
                throw new OnlineProviderError('network', '所有聚合音源搜索失败，请稍后重试');
            }
            // Interleave rank, rather than allowing one large catalog to bury every other provider's first result.
            const ranked = Array.from({ length: Math.max(0, ...pages.map(rows => rows.length)) },
                (_, rank) => pages.flatMap(rows => rows[rank] ? [rows[rank]] : [])).flat();
            const merged = mergeAggregateSongs(ranked);
            state.buffer.push(...merged.filter(song => !state.seen.some(old => sameAggregateRecording(old, song))
                && !state.buffer.some(old => sameAggregateRecording(old, song))));
        }
        const items = session.buffer.splice(0, limit);
        session.seen.push(...items);
        const hasMore = session.buffer.length > 0 || session.done.size < providerIds.length;
        // The aggregate cursor is opaque: an all-duplicate child page must still advance so Load more cannot loop forever.
        const result = { items, hasMore, nextOffset: offset + (items.length || (hasMore ? 1 : 0)) };
        session.cursor = result.nextOffset;
        session.pages.set(cacheKey, result);
        return result;
    }
    return {
        searchSongs(query: string, limit: number, offset: number) {
            const key = JSON.stringify([query, limit, offset]);
            let result = pending.get(key);
            if (!result) {
                result = page(query, limit, offset).finally(() => pending.delete(key));
                pending.set(key, result);
            }
            return result;
        },
    };
}
