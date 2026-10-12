import { OnlineProviderError } from '../../types/onlineMusic';

// src/services/onlineMusic/musicfreeTransport.ts
// Browser transport speaks only to the configured gateway; plugins and their dependencies stay on the server.

export const getMusicFreeApiBase = (): string => {
    const configured = import.meta.env.VITE_MUSICFREE_API_BASE?.trim();
    if (configured) return configured.replace(/\/+$/, '');
    return typeof window !== 'undefined' && window.__FOLIA_RUNTIME_CONFIG__?.deployment === 'docker'
        ? '/api/musicfree' : '';
};

export const resolveMusicFreeAssetUrl = (base: string, value: string): string => {
    if (!value.startsWith('/api/musicfree/assets/')) throw new OnlineProviderError('invalid-response', 'Invalid MusicFree asset URL');
    return `${base}/assets/${value.slice('/api/musicfree/assets/'.length)}`;
};

export async function requestMusicFree<T>(base: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
        response = await fetch(`${base}${path}`, {
            method: body === undefined ? 'GET' : 'POST',
            headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(45000),
        });
    } catch { throw new OnlineProviderError('network', 'MusicFree gateway is unreachable'); }
    let data: T & { error?: string };
    try { data = await response.json(); }
    catch { throw new OnlineProviderError('invalid-response', 'MusicFree gateway did not return JSON'); }
    if (!response.ok) throw new OnlineProviderError('network', data?.error || `MusicFree HTTP ${response.status}`);
    return data;
}
