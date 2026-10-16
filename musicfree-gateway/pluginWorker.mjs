import { parentPort, workerData } from 'node:worker_threads';
import vm from 'node:vm';
import { applyPluginAuthentication } from './pluginVariables.mjs';
import { configurePluginRequests, pluginRequestContext } from './pluginRequests.mjs';
import { isCialloPlugin, resolveCialloAudio } from './cialloAudio.mjs';

// musicfree-gateway/pluginWorker.mjs
// Runs one administrator-configured CommonJS plugin; VM is compatibility, not a security sandbox.

const allowedPackages = new Set(['axios', 'big-integer', 'cheerio', 'crypto-js', 'dayjs', 'he', 'qs', 'webdav']);
const packages = new Map();
// Import only referenced packages, asynchronously and BEFORE the VM's deadline.
// Vercel may disable require(ESM), and module initialization is not plugin execution.
const dependencies = new Set([...workerData.script.matchAll(/\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g)]
    .map(match => match[2]).filter(name => allowedPackages.has(name)));
// Obfuscated public plugins compute package names. Preload the allowlist for
// those scripts so synchronous require remains compatible with ESM packages.
if ([...workerData.script.matchAll(/\brequire\s*\(/g)].some(match =>
    !/^\s*(['"])([^'"]+)\1\s*\)/.test(workerData.script.slice(match.index + match[0].length)))) {
    for (const name of allowedPackages) dependencies.add(name);
}
for (const name of dependencies) {
    const imported = await import(name);
    let value = imported.default ?? imported;
    if (name === 'axios') {
        value = value.create({ timeout: 12000 });
        configurePluginRequests(value);
        value.interceptors.request.use(config => applyPluginAuthentication(config, workerData.userVariables));
        value.default = value;
    }
    packages.set(name, value);
}
const loadPackage = name => {
    if (!allowedPackages.has(name)) throw new Error(`Unsupported MusicFree dependency: ${name}`);
    if (!packages.has(name)) throw new Error(`MusicFree dependency must use a literal require: ${name}`);
    return packages.get(name);
};
// Public plugins also access env as a global, rather than as a method argument.
// Administrator-configured credentials remain inside the provider's worker.
// Return a fresh copy so a plugin cannot overwrite settings for later calls.
const env = Object.freeze({ getUserVariables: () => ({ ...workerData.userVariables }) });
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
parentPort.on('message', ({ id, method, args }) => pluginRequestContext.run({ method }, async () => {
    try {
        if (!methods.includes(method) || typeof plugin[method] !== 'function') throw new Error('Unsupported plugin method');
        const value = method === 'getMediaSource' && isCialloPlugin(plugin)
            ? await resolveCialloAudio(plugin, args, env, packages.get('axios'))
            : await plugin[method](...args, env);
        // Matches MusicFree's JSON persistence; drops non-persistable fields before crossing the bridge.
        parentPort.postMessage({ id, value: value == null ? null : JSON.parse(JSON.stringify(value)) });
    } catch (error) {
        const failure = pluginRequestContext.getStore()?.failure;
        parentPort.postMessage({ id, error: error.message || 'Plugin request failed',
            code: typeof error.code === 'string' && /^(E[A-Z0-9_]+|ERR_[A-Z0-9_]+)$/.test(error.code) ? error.code : failure?.code,
            upstreamStatus: Number.isInteger(error.response?.status) ? error.response.status : failure?.upstreamStatus,
            upstreamHost: failure?.upstreamHost,
        });
    }
}));
