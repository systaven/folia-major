import { loadPlugins } from './sources.mjs';
import { searchPlugin, enrichSearchItems } from './search.mjs';
import { createAssetProxy } from './assets.mjs';
import { createItemProof } from './itemProof.mjs';
import { recommendedCollections, collectionTracks } from './catalog.mjs';

// musicfree-gateway/gateway.mjs
// HTTP bridge for MusicFree search, metadata, playback and timed LRC; no browser-side script execution.

const send = (res, status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
};
const readBody = async req => {
    // Vercel's Node helpers can parse JSON before the handler sees the request stream.
    if (req.body !== undefined) {
        const text = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body);
        if (Buffer.byteLength(text) > 1024 * 1024) throw new Error('Request body exceeds 1 MB');
        return JSON.parse(text);
    }
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
        size += chunk.length;
        if (size > 1024 * 1024) throw new Error('Request body exceeds 1 MB');
        chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};

/** @param {{ sources?: string[], origin?: string, loader?: typeof loadPlugins, assets?: ReturnType<typeof createAssetProxy> }} options */
export function createMusicFreeGateway({ sources = [], origin = '', loader = loadPlugins, assets = createAssetProxy() } = {}) {
    let loaded;
    const proofs = createItemProof();
    const getPlugins = () => loaded ??= loader(sources);
    const decorate = (providerId, item) => ({ item, proof: proofs.sign(providerId, item),
        artworkUrl: (item?.artwork || item?.coverImg) ? assets.issue(item.artwork || item.coverImg).url : undefined });
    const handle = async (req, res) => {
        let providerId;
        let operation;
        const pathname = new URL(req.url, 'http://localhost').pathname;
        if (!pathname.startsWith('/api/musicfree/')) return false;
        if (origin && req.headers.origin === origin) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Vary', 'Origin');
            res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,POST,OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Range,If-Range');
            res.setHeader('Access-Control-Expose-Headers', 'Content-Length,Content-Range,Accept-Ranges');
        }
        if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return true; }
        const asset = pathname.match(/^\/api\/musicfree\/assets\/([A-Za-z0-9_-]+)$/);
        if (asset && ['GET', 'HEAD'].includes(req.method)) { await assets.serve(asset[1], req, res); return true; }
        try {
            const { plugins, errors } = await getPlugins();
            if (pathname === '/api/musicfree/providers' && req.method === 'GET') {
                send(res, 200, { providers: [...plugins].map(([id, host]) => ({ id, ...host.metadata })), errors });
                return true;
            }
            const route = pathname.match(/^\/api\/musicfree\/providers\/(musicfree\.[a-f0-9]+)\/(search|detail|audio|lyrics|recommendations|tracks)$/);
            if (!route || req.method !== 'POST') { send(res, 404, { error: 'Unknown MusicFree endpoint' }); return true; }
            providerId = route[1];
            operation = route[2];
            const plugin = plugins.get(route[1]);
            if (!plugin) { send(res, 404, { error: 'MusicFree provider is not configured' }); return true; }
            const body = await readBody(req);
            if (!['search', 'recommendations'].includes(route[2]) && !proofs.verify(route[1], body.item, body.proof)) {
                send(res, 403, { error: 'MusicFree item signature is invalid; search again' });
                return true;
            }
            switch (route[2]) {
                case 'recommendations': {
                    if (!Number.isSafeInteger(body.limit) || body.limit < 1 || body.limit > 100) throw new Error('Invalid recommendation limit');
                    const rows = await recommendedCollections(plugin, body.limit);
                    send(res, 200, rows.map(row => ({ ...decorate(route[1], row.item), kind: row.kind })));
                    break;
                }
                case 'tracks': {
                    if (!Number.isSafeInteger(body.limit) || body.limit < 1 || body.limit > 1000 || !Number.isSafeInteger(body.offset) || body.offset < 0 || body.offset > 10000) throw new Error('Invalid tracks pagination');
                    const page = await collectionTracks(plugin, body.item, body.kind, body.limit, body.offset);
                    await enrichSearchItems(plugin, page.items);
                    send(res, 200, { ...page, items: page.items.map(item => decorate(route[1], item)) });
                    break;
                }
                case 'search': {
                    const { query, limit, offset } = body;
                    if (typeof query !== 'string' || query.length > 500 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000
                        || !Number.isSafeInteger(offset) || offset < 0 || offset > 10000) throw new Error('Invalid search parameters');
                    const page = query.trim() ? await searchPlugin(plugin, query, limit, offset)
                        : { items: [], hasMore: false, nextOffset: offset };
                    const metadataErrors = await enrichSearchItems(plugin, page.items);
                    send(res, 200, { ...page, metadataErrors, items: page.items.map(item => decorate(route[1], item)) });
                    break;
                }
                case 'detail': {
                    const item = body.item;
                    if (!item || typeof item !== 'object' || item.id == null) throw new Error('Invalid MusicFree item');
                    const extra = plugin.metadata.methods.includes('getMusicInfo') ? await plugin.call('getMusicInfo', [item]) : null;
                    send(res, 200, decorate(route[1], { ...item, ...extra }));
                    break;
                }
                case 'audio': {
                    if (!body.item || body.item.id == null || !['low', 'standard', 'high', 'super'].includes(body.quality)) throw new Error('Invalid audio parameters');
                    const result = plugin.metadata.methods.includes('getMediaSource')
                        ? await plugin.call('getMediaSource', [body.item, body.quality]) : body.item.url ? { url: body.item.url } : null;
                    send(res, 200, result?.url ? assets.issue(result.url, result.headers, result.userAgent) : null);
                    break;
                }
                case 'lyrics': {
                    if (!body.item || body.item.id == null) throw new Error('Invalid lyric parameters');
                    const result = plugin.metadata.methods.includes('getLyric') ? await plugin.call('getLyric', [body.item]) : body.item;
                    let rawLrc = result?.rawLrc ?? body.item.rawLrc ?? '';
                    if (!rawLrc && body.item.lrc) {
                        const response = await fetch(body.item.lrc, { signal: AbortSignal.timeout(12000) });
                        if (!response.ok) throw new Error(`Lyric URL returned HTTP ${response.status}`);
                        rawLrc = await response.text();
                    }
                    send(res, 200, { rawLrc, translation: result?.translation ?? '' });
                    break;
                }
            }
        } catch (error) {
            // Log only diagnostic fields: plugin exceptions and request items can contain credentials.
            console.error('[MusicFree] request failed', { providerId, operation,
                code: typeof error.code === 'string' && /^(E[A-Z0-9_]+|ERR_[A-Z0-9_]+)$/.test(error.code) ? error.code : 'ERR_MUSICFREE_PLUGIN',
                upstreamStatus: Number.isInteger(error.upstreamStatus) ? error.upstreamStatus : undefined,
            });
            send(res, 502, { error: error.message || 'MusicFree request failed' });
        }
        return true;
    };
    return { handle, async close() { if (loaded) await (await loaded).close(); } };
}

export function configuredMusicFreeSources(value = process.env.MUSICFREE_SOURCES ?? '') {
    if (!value.trim()) return [];
    const sources = value.trim().startsWith('[') ? JSON.parse(value) : value.split(',').map(source => source.trim());
    if (!Array.isArray(sources) || sources.some(source => typeof source !== 'string' || !source)) throw new Error('MUSICFREE_SOURCES must be URLs/paths or a JSON string array');
    return sources;
}
