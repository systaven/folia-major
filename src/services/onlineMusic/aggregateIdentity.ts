import type { SongResult, UnifiedSong } from '../../types';
import type { JsonValue, ProviderCollection } from '../../types/onlineMusic';

// src/services/onlineMusic/aggregateIdentity.ts
// Aggregation preserves signed child records; only explicit recording matches may share playback candidates.
export const AGGREGATE_ID = 'musicfree.aggregate';
const normalized = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
const artist = (song: SongResult) => song.artists.map(a => normalized(a.name)).sort().join('|');
const raw = (song: SongResult): JsonValue | undefined => {
    const ref = song.sourceRef;
    if (ref?.kind !== 'online') return;
    if (ref.providerId !== AGGREGATE_ID) return ref.providerData?.musicfree;
    const candidates = ref.providerData?.aggregateCandidates;
    const first = (Array.isArray(candidates) ? candidates[0] : null) as unknown as UnifiedSong | null;
    return first?.sourceRef?.kind === 'online' && first.sourceRef.providerId !== AGGREGATE_ID ? raw(first) : undefined;
};

function neteaseId(song: SongResult): string | undefined {
    const item = raw(song);
    if (!item || typeof item !== 'object' || Array.isArray(item)) return;
    const platform = String(item.platform ?? item.source ?? '');
    if (!/网易|netease|^wy$|^元力WY$|Ciallo/i.test(platform) && !/^netease_/.test(String(item.id))) return;
    const id = String(item.id).replace(/^netease_/, '');
    return /^\d+$/.test(id) ? id : undefined;
}

export function sameAggregateRecording(a: SongResult, b: SongResult): boolean {
    const aId = neteaseId(a), bId = neteaseId(b);
    if (aId && bId) return aId === bId;
    if (normalized(a.name) !== normalized(b.name) || !artist(a) || artist(a) !== artist(b)) return false;
    if (a.album.name && b.album.name && normalized(a.album.name) !== normalized(b.album.name)) return false;
    return !a.durationMs || !b.durationMs || Math.abs(a.durationMs - b.durationMs) <= 5000;
}

export const childSongKey = (song: SongResult) => song.sourceRef?.kind === 'online'
    ? `${song.sourceRef.providerId}:${song.sourceRef.mediaId}` : '';

// Do not trust persisted queue payloads to add unconfigured providers or recurse into the aggregate adapter.
export function allowedCandidates(song: SongResult, allowed: Set<string>): UnifiedSong[] {
    const candidates = song.sourceRef?.kind === 'online' && song.sourceRef.providerId === AGGREGATE_ID
        ? song.sourceRef.providerData?.aggregateCandidates : [song];
    if (!Array.isArray(candidates)) return [];
    return (candidates as unknown as UnifiedSong[]).filter(item => item?.sourceRef?.kind === 'online'
        && allowed.has(item.sourceRef.providerId) && typeof item.name === 'string'
        && Array.isArray(item.artists) && item.album && typeof item.durationMs === 'number');
}

export function wrapAggregateSong(candidates: UnifiedSong[], existingId?: string): UnifiedSong {
    const completeness = (song: UnifiedSong) => (song.album.coverUrl ? 4 : 0) + (song.durationMs > 0 ? 2 : 0)
        + (song.artists.length ? 1 : 0) + (song.album.name ? 1 : 0);
    const best = candidates.reduce((best, song) => completeness(song) > completeness(best) ? song : best);
    const platformId = neteaseId(candidates[0]);
    const id = existingId ?? (platformId ? `aggregate:netease:${platformId}` : `aggregate:${childSongKey(candidates[0])}`);
    return { ...best, id, sourceRef: { kind: 'online', providerId: AGGREGATE_ID, mediaId: id,
        providerData: { aggregateCandidates: JSON.parse(JSON.stringify(candidates)) as JsonValue } } };
}

export function mergeAggregateSongs(songs: UnifiedSong[]): UnifiedSong[] {
    const groups: UnifiedSong[][] = [];
    for (const song of songs) {
        const group = groups.find(rows => sameAggregateRecording(rows[0], song));
        if (!group) groups.push([song]);
        else if (!group.some(row => childSongKey(row) === childSongKey(song))) group.push(song);
    }
    return groups.map(rows => wrapAggregateSong(rows));
}

export function wrapAggregateCollection(collection: ProviderCollection): ProviderCollection {
    return { ...collection, providerId: AGGREGATE_ID, id: `${collection.providerId}:${collection.id}`,
        providerData: { aggregateCollection: JSON.parse(JSON.stringify(collection)) as JsonValue } };
}
