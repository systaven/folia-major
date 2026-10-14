import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { createPluginHost } from './pluginHost.mjs';

// musicfree-gateway/sources.mjs
// Only server configuration selects executable plugins; browser requests cannot install scripts.

const isRemote = source => /^https?:\/\//i.test(source);
export const pluginId = source => `musicfree.${createHash('sha256').update(source).digest('hex').slice(0, 20)}`;

/** Read per-provider plugin settings without putting credential values in errors. */
export function configuredMusicFreeVariables(value = process.env.MUSICFREE_PLUGIN_VARIABLES ?? '') {
    if (!value.trim()) return {};
    let variables;
    try { variables = JSON.parse(value); } catch { throw new Error('MUSICFREE_PLUGIN_VARIABLES must be a JSON object keyed by provider ID'); }
    if (!variables || typeof variables !== 'object' || Array.isArray(variables)
        || Object.entries(variables).some(([id, settings]) => !/^musicfree\.[a-f0-9]{20}$/.test(id)
            || !settings || typeof settings !== 'object' || Array.isArray(settings)
            || Object.values(settings).some(setting => typeof setting !== 'string'))) {
        throw new Error('MUSICFREE_PLUGIN_VARIABLES must map provider IDs to objects containing string values');
    }
    return variables;
}

export async function readSource(source) {
    if (!isRemote(source)) return readFile(source, 'utf8');
    const response = await fetch(source, { signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`Source returned HTTP ${response.status}`);
    const text = await response.text();
    if (Buffer.byteLength(text) > 4 * 1024 * 1024) throw new Error('MusicFree source exceeds 4 MB');
    return text;
}

// JSON lists can reference other JSON lists or JS files, including relative URLs and local files.
export async function loadPlugins(sources, { read = readSource, createHost = createPluginHost,
    userVariables = configuredMusicFreeVariables() } = {}) {
    const plugins = new Map();
    const errors = [];
    const visited = new Set();
    let initializing = 0;
    const waiting = [];
    // Limit CPU contention during cold starts; queued hosts start their deadline only on admission.
    const initialize = async (content, source) => {
        if (initializing >= 2) await new Promise(resolve => waiting.push(resolve));
        else initializing += 1;
        try { return await createHost(content, source, 20000, userVariables[pluginId(source)] ?? {}); }
        finally {
            if (waiting.length) waiting.shift()();
            else initializing -= 1;
        }
    };
    const load = async (source, depth = 0) => {
        if (visited.has(source)) return;
        if (visited.size >= 64 || depth > 4) { errors.push({ source, message: 'MusicFree source limit exceeded' }); return; }
        visited.add(source);
        try {
            const content = await read(source);
            if (/^\s*\{/.test(content)) {
                const list = JSON.parse(content);
                if (!Array.isArray(list.plugins)) throw new Error('JSON must contain a plugins array');
                await Promise.all(list.plugins.map(entry => {
                    if (typeof entry?.url !== 'string') {
                        errors.push({ source, message: 'Plugin entry has no URL' });
                        return Promise.resolve();
                    }
                    const target = isRemote(source) ? new URL(entry.url, source).href
                        : isRemote(entry.url) ? entry.url : resolve(dirname(source), entry.url);
                    return load(target, depth + 1);
                }));
                return;
            }
            const host = await initialize(content, source);
            plugins.set(pluginId(source), { ...host, source });
        } catch (error) { errors.push({ source, message: error.message }); }
    };
    await Promise.all(sources.map(source => load(source)));
    return { plugins, errors, async close() { await Promise.all([...plugins.values()].map(plugin => plugin.close())); } };
}
