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
    const init: RequestInit = {
        method: body === undefined ? 'GET' : 'POST',
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(45000),
    };
    // All gateway operations are reads. Retry a proxy's non-JSON 502/503/504
    // once within the original deadline, without replaying plugin JSON errors.
    for (let attempt = 0; ; attempt++) {
        let response: Response;
        try { response = await fetch(`${base}${path}`, init); }
        catch { throw new OnlineProviderError('network', 'MusicFree gateway is unreachable'); }
        let data: T & { error?: string; code?: string };
        try { data = await response.json(); }
        catch {
            if (attempt === 0 && [502, 503, 504].includes(response.status) && !init.signal?.aborted) continue;
            throw new OnlineProviderError(response.ok ? 'invalid-response' : 'network',
                `MusicFree 网关返回 HTTP ${response.status}，响应不是 JSON；请稍后重试`,
                undefined, undefined, response.status);
        }
        if (!response.ok) throw new OnlineProviderError(response.status === 403 || data?.code === 'invalid-response' ? 'invalid-response' : 'network',
            data?.error || `MusicFree HTTP ${response.status}`, undefined, undefined, response.status);
        return data;
    }
}
