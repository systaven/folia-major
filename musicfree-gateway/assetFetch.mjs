import axios from 'axios';
import { Readable } from 'node:stream';

// musicfree-gateway/assetFetch.mjs
// Use the same HTTP(S)/proxy transport as plugins without buffering entire media files.

export async function fetchAssetResponse(url, { headers, method = 'GET', signal } = {}) {
    const upstream = await axios.request({ url, headers, method, signal,
        responseType: 'stream', timeout: 0, validateStatus: () => true,
    });
    const responseHeaders = new Headers();
    const rawHeaders = upstream.request?.res?.rawHeaders ?? [];
    const wasEncoded = rawHeaders.some((name, index) => index % 2 === 0 && name.toLowerCase() === 'content-encoding');
    for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
        // Axios decompresses the stream and removes content-encoding. Keep the
        // encoded length out of the response while preserving ordinary audio lengths.
        if (name === 'content-length' && wasEncoded) continue;
        const value = upstream.headers[name];
        if (value != null) responseHeaders.set(name, String(value));
    }
    const hasBody = method !== 'HEAD' && ![204, 205, 304].includes(upstream.status);
    if (!hasBody) upstream.data.destroy();
    return { status: upstream.status, headers: responseHeaders,
        body: hasBody ? Readable.toWeb(upstream.data) : null };
}
