import { randomBytes, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ephemeralSecret } from './itemProof.mjs';

// musicfree-gateway/assets.mjs
// Proxy only plugin-issued assets; opaque tickets keep the public endpoint from accepting arbitrary URLs.

export function createAssetProxy({ fetchAsset = fetch, now = Date.now, ttlMs = 86400000,
    secret = process.env.MUSICFREE_ITEM_SECRET || ephemeralSecret } = {}) {
    const key = createHash('sha256').update(secret).digest();
    const decode = token => {
        const bytes = Buffer.from(token, 'base64url');
        const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
        decipher.setAuthTag(bytes.subarray(12, 28));
        return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'));
    };
    return {
        issue(url, extraHeaders = {}, userAgent) {
            const target = new URL(url);
            if (!['http:', 'https:'].includes(target.protocol)) throw new Error('Asset URL must use HTTP(S)');
            const headers = { ...extraHeaders };
            if (userAgent) headers['User-Agent'] = userAgent;
            for (const name of Object.keys(headers)) {
                if (['host', 'connection', 'content-length', 'transfer-encoding'].includes(name.toLowerCase())) delete headers[name];
            }
            // Stateless encrypted tickets avoid retaining each upstream signed URL in server memory.
            const expiresAt = now() + ttlMs;
            const iv = randomBytes(12);
            const cipher = createCipheriv('aes-256-gcm', key, iv);
            const encrypted = Buffer.concat([cipher.update(JSON.stringify({ url: target.href, headers, expiresAt })), cipher.final()]);
            const token = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
            return { url: `/api/musicfree/assets/${token}`, expiresAt };
        },
        async serve(token, req, res) {
            let entry;
            try { entry = decode(token); } catch { res.writeHead(410); res.end(); return; }
            if (!entry || entry.expiresAt <= now()) { res.writeHead(410); res.end(); return; }
            const controller = new AbortController();
            const headerTimeout = setTimeout(() => controller.abort(), 15000);
            const stop = () => controller.abort();
            res.on('close', stop);
            try {
                const headers = { ...entry.headers };
                if (req.headers.range) headers.Range = req.headers.range;
                if (req.headers['if-range']) headers['If-Range'] = req.headers['if-range'];
                const upstream = await fetchAsset(entry.url, {
                    headers, method: req.method, signal: controller.signal,
                });
                // Only wait for response headers on a deadline; long songs must keep streaming past it.
                clearTimeout(headerTimeout);
                res.statusCode = upstream.status;
                for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
                    // fetch decompresses bodies; an encoded upstream length no longer describes the stream.
                    if (name === 'content-length' && upstream.headers.has('content-encoding')) continue;
                    const value = upstream.headers.get(name);
                    if (value) res.setHeader(name, value);
                }
                res.setHeader('Cache-Control', 'private, max-age=300');
                res.setHeader('X-Content-Type-Options', 'nosniff');
                if (req.method === 'HEAD' || !upstream.body) res.end();
                else await pipeline(Readable.fromWeb(upstream.body), res);
            } catch {
                if (!res.headersSent) res.writeHead(502);
                res.end();
            } finally { clearTimeout(headerTimeout); res.off('close', stop); }
        },
    };
}
