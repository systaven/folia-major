// musicfree-gateway/pluginVariables.mjs
// Keep configured NetEase authentication on official HTTPS requests only.

const neteaseHosts = new Set(['music.163.com', 'interface.music.163.com',
    'interface3.music.163.com', 'interfacepc.music.163.com']);

export function applyPluginAuthentication(config, variables) {
    if (!variables?.music_u) return config;
    let url;
    try { url = new URL(config.url, config.baseURL); } catch { return config; }
    if (url.protocol !== 'https:' || !neteaseHosts.has(url.hostname)) return config;
    const supplied = variables.music_u.trim();
    const match = supplied.match(/(?:^|;\s*)(MUSIC_[UA])=([^;]+)/);
    const auth = match ? `${match[1]}=${match[2]}` : !/[;\r\n]/.test(supplied) ? `MUSIC_U=${supplied}` : '';
    if (!auth || /[\r\n]/.test(auth)) return config;
    // The public W音乐 plugin incorrectly takes capture group 1 ("MUSIC_U=")
    // instead of the credential value. Apply explicitly configured auth after
    // the plugin builds its headers, preserving the remaining device cookies.
    const existing = config.headers?.get?.('Cookie') ?? config.headers?.Cookie ?? config.headers?.cookie ?? '';
    const cookies = String(existing).split(';').map(value => value.trim())
        .filter(value => value && !/^MUSIC_[UA]=/i.test(value));
    const cookie = [...cookies, auth].join('; ');
    if (config.headers?.set) config.headers.set('Cookie', cookie);
    else config.headers = { ...config.headers, Cookie: cookie };
    return config;
}
