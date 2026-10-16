import { create } from 'zustand';

// src/services/onlineMusic/aggregateHealth.ts
// Browser-local measurements describe the operation actually tested, rather than treating search as proof of playback.
export interface AggregateHealth {
    name: string;
    searchMs?: number;
    audioMs?: number;
    searchState?: 'ok' | 'error';
    audioState?: 'ok' | 'error' | 'preview';
    failedAt?: number;
}
export const useAggregateHealth = create<{
    sources: Record<string, AggregateHealth>;
    selected?: string;
}>(() => ({ sources: {} }));

export function initializeAggregateHealth(sources: { id: string; name: string }[]) {
    useAggregateHealth.setState({ sources: Object.fromEntries(sources.map(source => [source.id, { name: source.name }])), selected: undefined });
}
export function recordAggregateHealth(id: string, patch: Partial<AggregateHealth>) {
    useAggregateHealth.setState(state => ({ sources: { ...state.sources,
        [id]: { ...state.sources[id], ...patch } } }));
}
export function aggregateSourcePriority(id: string): number {
    const source = useAggregateHealth.getState().sources[id];
    const penalty = source?.failedAt && Date.now() - source.failedAt < 30000 ? 20000 : 0;
    return penalty + (source?.audioState === 'ok' ? source.audioMs ?? 1000 : source?.searchMs ?? 2000);
}

export async function aggregateDeadline<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    try {
        return await Promise.race([promise, new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Source timed out')), milliseconds);
        })]);
    } finally { clearTimeout(timer!); }
}
