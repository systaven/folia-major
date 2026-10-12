import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMusicFreeGateway } from '../../../musicfree-gateway/gateway.mjs';
import { pluginId } from '../../../musicfree-gateway/sources.mjs';
import { createPluginHost } from '../../../musicfree-gateway/pluginHost.mjs';
import { createMusicFreeProvider } from '@/services/onlineMusic/musicfreeProvider';
import type { MusicFreeProviderDescriptor } from '@/types/musicfree';

// test/unit/onlineMusic/musicfreeGateway.test.ts
// Real HTTP and worker round trips validate headers, seeking, metadata, paging and failed-plugin isolation.

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const listen = async (server: Server): Promise<string> => {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    cleanup.push(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server address');
    return `http://127.0.0.1:${address.port}`;
};

describe('MusicFree Web gateway', () => {
    it('loads a JSON list and executes CommonJS search, detail, lyrics and header-protected ranged audio', async () => {
        const upstream = await listen(createServer((req, res) => {
            if (req.headers['x-plugin'] !== 'fixture') { res.writeHead(403); res.end(); return; }
            res.writeHead(req.headers.range ? 206 : 200, { 'Content-Type': 'audio/mpeg', 'Accept-Ranges': 'bytes',
                ...(req.headers.range ? { 'Content-Range': 'bytes 2-4/6' } : {}) });
            res.end(req.headers.range ? 'cde' : 'abcdef');
        }));
        const dir = await mkdtemp(join(tmpdir(), 'folia-mf-test-'));
        cleanup.push(() => rm(dir, { recursive: true, force: true }));
        const script = join(dir, 'fixture.js');
        await writeFile(script, `const axios = require('axios'); const crypto = require('crypto-js');
            module.exports = { platform: 'Fixture', primaryKey: ['id', 'aid'], supportedSearchType: ['music'],
            async search(query, page) { return { isEnd: page === 3, data: [1,2].map(n => ({
                id: (page-1)*2+n, aid: crypto.MD5(query).toString(), title: 'Song', artist: 'Artist',
                album: 'Album', duration: 10, artwork: '${upstream}/cover', custom: 'persist' })) }; },
            async getRecommendSheetsByTag(tag, page) { return { isEnd: true, data: [{ id: 'sheet', title: 'Public sheet', artwork: '${upstream}/cover' }] }; },
            async getMusicSheetInfo(item, page) { return { isEnd: page === 2, musicList: [{ id: page, aid: 'sheet', title: 'Track '+page }] }; },
            async getMusicInfo(item) { return { album: 'Detailed album' }; },
            async getLyric(item) { return { rawLrc: '[00:01.00]First\\n[00:03.00]Second' }; },
            async getMediaSource(item, quality) { return { url: '${upstream}/audio', headers: { 'X-Plugin': 'fixture' } }; }
            };`);
        await writeFile(join(dir, 'bad.js'), 'throw new Error("broken plugin")');
        const manifest = join(dir, 'plugins.json');
        await writeFile(manifest, JSON.stringify({ plugins: [{ url: './fixture.js' }, { url: './bad.js' }] }));
        const gateway = createMusicFreeGateway({ sources: [manifest], origin: 'https://folia.test' });
        cleanup.push(() => gateway.close());
        const base = await listen(createServer(async (req, res) => { if (!await gateway.handle(req, res)) { res.writeHead(404); res.end(); } }));
        const descriptors = await (await fetch(`${base}/api/musicfree/providers`)).json();
        expect(descriptors.providers).toHaveLength(1);
        expect(descriptors.errors[0].message).toContain('broken plugin');
        const id = pluginId(script);
        const call = async (operation: string, body: unknown) => {
            const response = await fetch(`${base}/api/musicfree/providers/${id}/${operation}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
            });
            expect(response.status).toBe(200);
            return response.json();
        };
        const page = await call('search', { query: 'test', limit: 3, offset: 1 });
        expect(page.items.map((row: { item: { id: number } }) => row.item.id)).toEqual([2, 3, 4]);
        expect(page.nextOffset).toBe(4);
        expect(page.hasMore).toBe(true);
        const last = await call('search', { query: 'test', limit: 3, offset: 4 });
        expect(last.items.map((row: { item: { id: number } }) => row.item.id)).toEqual([5, 6]);
        expect(last.hasMore).toBe(false);
        const recommendations = await fetch(`${base}/api/musicfree/providers/${id}/recommendations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limit: 10 }) }).then(r => r.json());
        const tracks = await fetch(`${base}/api/musicfree/providers/${id}/tracks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...recommendations[0], limit: 1, offset: 1 }) }).then(r => r.json());
        expect(tracks.items[0].item.title).toBe('Track 2');
        expect(tracks.hasMore).toBe(false);
        const item = page.items[0].item;
        expect(item.platform).toBe('Fixture');
        const proof = page.items[0].proof;
        const detail = await call('detail', { item, proof });
        expect(detail.item).toMatchObject({ album: 'Detailed album', custom: 'persist' });
        expect(detail.artworkUrl).toMatch(/^\/api\/musicfree\/assets\//);
        expect((await call('lyrics', { item, proof })).rawLrc).toContain('[00:03.00]Second');
        const audio = await call('audio', { item, proof, quality: 'high' });
        const response = await fetch(`${base}${audio.url}`, { headers: { Range: 'bytes=2-4', Origin: 'https://folia.test' } });
        expect(response.status).toBe(206);
        expect(response.headers.get('content-range')).toBe('bytes 2-4/6');
        expect(response.headers.get('access-control-allow-origin')).toBe('https://folia.test');
        expect(await response.text()).toBe('cde');
        expect((await fetch(`${base}/api/musicfree/assets/${'0'.repeat(48)}`)).status).toBe(410);
        const tampered = await fetch(`${base}/api/musicfree/providers/${id}/audio`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ item: { ...item, url: 'http://arbitrary.test/' }, proof, quality: 'high' }),
        });
        expect(tampered.status).toBe(403);
        // Exercise the browser-facing adapter against the real bridge, not a mocked transport.
        const descriptor: MusicFreeProviderDescriptor = descriptors.providers[0];
        const provider = createMusicFreeProvider(descriptor, `${base}/api/musicfree`);
        const songs = await provider.search!.searchSongs('test', 3, 1);
        expect(songs.items[0].durationMs).toBe(10000);
        expect(songs.items[0].album.coverUrl).toContain('/api/musicfree/assets/');
        const persisted = JSON.parse(JSON.stringify(songs.items[0]));
        const lyric = await provider.lyrics!.getLyrics(persisted);
        expect(lyric.lyrics?.lines.map(line => line.startTime)).toEqual([1, 3]);
        const source = await provider.playback!.getAudioSource(persisted, 'high');
        expect(source?.url).toContain('/api/musicfree/assets/');
    }, 20000);

    it('terminates a stuck plugin without hanging the gateway', async () => {
        const host = await createPluginHost("module.exports = { platform: 'Stuck', search() { while (true) {} } };", 'stuck.js', 2000);
        cleanup.push(() => host.close());
        await expect(host.call('search', ['test', 1, 'music'])).rejects.toThrow('timed out');
    }, 10000);
});
