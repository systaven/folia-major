import type { MusicFreeProviderDescriptor } from '../../types/musicfree';
import { registerOnlineMusicProvider } from './providerRegistry';
import { createMusicFreeProvider } from './musicfreeProvider';
import { publishMusicFreeLibrary } from './musicfreeLibrary';
import { getMusicFreeApiBase, requestMusicFree } from './musicfreeTransport';

// src/services/onlineMusic/musicfreeBootstrap.ts
// Register gateway providers before session restore validates persisted provider and song identities.

export async function initializeMusicFreeProviders(): Promise<void> {
    const base = getMusicFreeApiBase();
    if (!base) return;
    const result = await requestMusicFree<{ providers: MusicFreeProviderDescriptor[]; errors?: unknown[] }>(base, '/providers');
    if (!Array.isArray(result?.providers)) throw new Error('MusicFree gateway returned no provider list');
    for (const provider of result.providers) {
        if (!/^musicfree\.[a-f0-9]{20}$/.test(provider.id) || typeof provider.name !== 'string'
            || !Array.isArray(provider.methods) || !Array.isArray(provider.primaryKey) || !Array.isArray(provider.supportedSearchType)) {
            throw new Error('Invalid MusicFree provider descriptor');
        }
        const adapter = createMusicFreeProvider(provider, base);
        registerOnlineMusicProvider(adapter);
        await publishMusicFreeLibrary(provider.id);
        // Public recommendations must not delay application startup or erase local favorites on failure.
        if (adapter.recommendations?.getRecommendedCollections) {
            void adapter.recommendations.getRecommendedCollections(35)
                .then(collections => publishMusicFreeLibrary(provider.id, collections))
                .catch(error => console.warn('[MusicFree] Catalog could not load:', provider.name, error));
        }
    }
    if (result.errors?.length) console.warn('[MusicFree] Some sources could not load:', result.errors);
}
