import type { UnifiedSong } from '../../types';
import type { MusicFreeProviderDescriptor, MusicFreeSongPayload } from '../../types/musicfree';
import { OnlineProviderError } from '../../types/onlineMusic';
import { resolveMusicFreeAssetUrl } from './musicfreeTransport';

// src/services/onlineMusic/musicfreeNormalize.ts
// Keep the entire JSON item for later plugin calls, including plugin-specific compound identifiers.

const text = (value: unknown): string => value == null ? '' : String(value);

export function normalizeMusicFreeSong(descriptor: MusicFreeProviderDescriptor, base: string, payload: MusicFreeSongPayload): UnifiedSong {
    const item = payload?.item;
    if (!item || typeof item !== 'object' || Array.isArray(item) || item.id == null || typeof item.title !== 'string') {
        throw new OnlineProviderError('invalid-response', 'MusicFree song has no id or title', descriptor.id);
    }
    const keys = descriptor.primaryKey.length ? descriptor.primaryKey : ['id'];
    if (keys.some(key => item[key] == null)) throw new OnlineProviderError('invalid-response', 'MusicFree song is missing a primary key', descriptor.id);
    const id = keys.length === 1 ? text(item[keys[0]]) : JSON.stringify(keys.map(key => item[key]));
    const duration = Number(item.duration);
    return {
        id, name: item.title,
        // A display artist string is not enough to invent searchable platform artist IDs.
        artists: item.artist ? [{ id: `${id}#artist`, name: text(item.artist) }] : [],
        album: { id: `${id}#album`, name: text(item.album),
            ...(payload.artworkUrl ? { coverUrl: resolveMusicFreeAssetUrl(base, payload.artworkUrl) } : {}) },
        durationMs: Number.isFinite(duration) ? Math.max(0, duration) * 1000 : 0,
        sourceRef: { kind: 'online', providerId: descriptor.id, mediaId: id,
            providerData: { musicfree: item, musicfreeProof: payload.proof } },
    };
}
