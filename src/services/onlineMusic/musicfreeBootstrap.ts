import type { MusicFreeProviderDescriptor } from '../../types/musicfree';
import { registerOnlineMusicProvider } from './providerRegistry';
import { createMusicFreeProvider } from './musicfreeProvider';
import { publishMusicFreeLibrary } from './musicfreeLibrary';
import { getMusicFreeApiBase, requestMusicFree } from './musicfreeTransport';
import { createAggregateProvider } from './aggregateProvider';
import { AGGREGATE_ID } from './aggregateIdentity';
import { useOnlineProviderAccountStore } from '../../stores/useOnlineProviderAccountStore';

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
    if (result.providers.some(provider => provider.methods.includes('getMediaSource'))) {
        const aggregate = createAggregateProvider(result.providers);
        registerOnlineMusicProvider(aggregate);
        await publishMusicFreeLibrary(AGGREGATE_ID);
        void aggregate.recommendations!.getRecommendedCollections!(35)
            .then(collections => publishMusicFreeLibrary(AGGREGATE_ID, collections))
            .catch(error => console.warn('[MusicFree] Aggregate catalog could not load:', error));
        // Migrate old MusicFree selections once; later manual selections remain respected.
        try {
            if (!localStorage.getItem('musicfree_aggregate_migrated_v1')) {
                const saved = localStorage.getItem('active_online_provider_id');
                if (!saved || saved.startsWith('musicfree.')) useOnlineProviderAccountStore.getState().setActiveProviderId(AGGREGATE_ID);
                localStorage.setItem('musicfree_aggregate_migrated_v1', 'true');
            }
        } catch { /* Storage may be unavailable in private browser contexts. */ }
    }
    if (result.errors?.length) console.warn('[MusicFree] Some sources could not load:', result.errors);
}
