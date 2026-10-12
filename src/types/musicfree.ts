import type { JsonValue } from './onlineMusic';
import type { UnifiedSong } from '../types';

// src/types/musicfree.ts
// JSON-only contract shared by the MusicFree Web bridge and the Omni adapter.

export type MusicFreeItem = Record<string, JsonValue>;
export interface MusicFreeProviderDescriptor {
    id: string;
    name: string;
    version: string;
    primaryKey: string[];
    methods: string[];
    supportedSearchType: string[];
}
export interface MusicFreeSongPayload {
    item: MusicFreeItem;
    proof: string;
    artworkUrl?: string;
}

export interface MusicFreeCollectionPayload extends MusicFreeSongPayload {
    kind: 'playlist' | 'album' | 'artist' | 'top';
}

export interface MusicFreeLibraryRecord {
    providerId: string;
    likedSongs: UnifiedSong[];
    updatedAt: number;
}
export interface MusicFreeSearchPage {
    items: MusicFreeSongPayload[];
    hasMore: boolean;
    nextOffset: number;
    metadataErrors?: Array<{ id: string | number; message: string }>;
}
