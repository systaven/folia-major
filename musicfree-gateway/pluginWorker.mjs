import { parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
import vm from 'node:vm';

// musicfree-gateway/pluginWorker.mjs
// Runs one administrator-configured CommonJS plugin; VM is compatibility, not a security sandbox.

const requirePackage = createRequire(import.meta.url);
const allowedPackages = new Set(['axios', 'big-integer', 'cheerio', 'crypto-js', 'dayjs', 'he', 'qs', 'webdav']);
const packages = new Map();
// Aggregate subscriptions contain dozens of plugins. Loading every dependency in
// every worker wastes memory even for plugins that only use axios.
const loadPackage = name => {
    if (!allowedPackages.has(name)) throw new Error(`Unsupported MusicFree dependency: ${name}`);
    if (!packages.has(name)) {
        const imported = requirePackage(name);
        let value = imported.default ?? imported;
        if (name === 'axios') {
            value = value.create({ timeout: 12000 });
            // Both require('axios') and require('axios').default occur in published plugins.
            value.default = value;
        }
        packages.set(name, value);
    }
    return packages.get(name);
};
// Public plugins also access env as a global, rather than as a method argument.
// No credentials are invented or exposed to the browser; optional settings default empty.
const env = Object.freeze({ getUserVariables: () => ({}) });
const module = { exports: {} };
const context = vm.createContext({
    module, exports: module.exports,
    require: loadPackage,
    env,
    Buffer, URL, URLSearchParams, TextEncoder, TextDecoder,
    setTimeout, clearTimeout, setInterval, clearInterval,
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    fetch, AbortController, AbortSignal, atob, btoa,
});
new vm.Script(workerData.script, { filename: workerData.source }).runInContext(context, { timeout: 3000 });
const plugin = module.exports.default ?? module.exports;
if (!plugin || typeof plugin.platform !== 'string' || !plugin.platform.trim()) throw new Error('Plugin has no platform name');
const methods = ['search', 'getMusicInfo', 'getMediaSource', 'getLyric', 'getAlbumInfo', 'getMusicSheetInfo',
    'getArtistWorks', 'getTopLists', 'getTopListDetail', 'getRecommendSheetTags', 'getRecommendSheetsByTag'];
parentPort.postMessage({ ready: {
    name: plugin.platform, version: String(plugin.version ?? '0.0.0'),
    primaryKey: Array.isArray(plugin.primaryKey) ? plugin.primaryKey : ['id'],
    methods: methods.filter(name => typeof plugin[name] === 'function'),
    supportedSearchType: plugin.supportedSearchType ?? ['music', 'album', 'artist', 'sheet', 'lyric'],
} });
parentPort.on('message', async ({ id, method, args }) => {
    try {
        if (!methods.includes(method) || typeof plugin[method] !== 'function') throw new Error('Unsupported plugin method');
        const value = await plugin[method](...args, env);
        // Matches MusicFree's JSON persistence; drops non-persistable fields before crossing the bridge.
        parentPort.postMessage({ id, value: value == null ? null : JSON.parse(JSON.stringify(value)) });
    } catch (error) {
        parentPort.postMessage({ id, error: error.message || 'Plugin request failed',
            code: typeof error.code === 'string' && /^(E[A-Z0-9_]+|ERR_[A-Z0-9_]+)$/.test(error.code) ? error.code : undefined,
            upstreamStatus: Number.isInteger(error.response?.status) ? error.response.status : undefined,
        });
    }
});
