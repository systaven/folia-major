import { createMusicFreeGateway } from '../musicfree-gateway/gateway.mjs';
import { configuredVercelMusicFreeSources } from '../musicfree-gateway/vercelSources.mjs';
// api-ts/musicfree.ts
// Node serverless entry preserves the gateway's worker runtime and stateless signed asset URLs.
const gateway = createMusicFreeGateway({ sources: configuredVercelMusicFreeSources() });
export default async function handler(request, response) {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const path = url.searchParams.get('path') ?? '';
    url.searchParams.delete('path');
    request.url = `/api/musicfree/${path.replace(/^\/+/, '')}${url.search}`;
    if (!await gateway.handle(request, response)) {
        response.writeHead(404);
        response.end();
    }
}
