import { configuredMusicFreeSources } from './gateway.mjs';

// musicfree-gateway/vercelSources.mjs
// Repository-managed production sources join optional dashboard sources, allowing deployment through Git.
export const vercelMusicFreeSources = [
    'https://raw.githubusercontent.com/LmLanmei64/MusicFreePlugins/master/dist/Ciallo%28%E4%BB%85%E7%BD%91%E6%98%93%29.js',
    'https://raw.githubusercontent.com/martin65536/z-music-plugins/main/plugins/wy.js',
    'https://raw.githubusercontent.com/martin65536/z-music-plugins/main/yuanli/wy.js',
];

export function configuredVercelMusicFreeSources(value = process.env.MUSICFREE_SOURCES ?? '') {
    return [...new Set([...vercelMusicFreeSources, ...configuredMusicFreeSources(value)])];
}
