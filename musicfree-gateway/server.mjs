import { createServer } from 'node:http';
import { createMusicFreeGateway, configuredMusicFreeSources } from './gateway.mjs';

// musicfree-gateway/server.mjs
// Standalone gateway for local Vite or separately hosted Folia Web deployments.

const gateway = createMusicFreeGateway({ sources: configuredMusicFreeSources(), origin: process.env.MUSICFREE_ALLOW_ORIGIN ?? '' });
const port = Number(process.env.MUSICFREE_PORT || 3300);
const server = createServer(async (req, res) => {
    if (req.url === '/health') { res.writeHead(200); res.end('ok'); return; }
    if (!await gateway.handle(req, res)) { res.writeHead(404); res.end(); }
});
server.listen(port, process.env.MUSICFREE_HOST || '127.0.0.1', () => console.log(`[MusicFree] listening on ${port}`));
const close = async () => { server.close(); await gateway.close(); };
process.on('SIGINT', close);
process.on('SIGTERM', close);
