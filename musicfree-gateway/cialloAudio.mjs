import { pluginRequestContext } from './pluginRequests.mjs';

// musicfree-gateway/cialloAudio.mjs
// Resolve the same NetEase ID when Ciallo's primary audio API is unreachable.

export function isCialloPlugin(plugin) {
    return /Ciallo/i.test(plugin.platform) && plugin.platform.includes('仅网易');
}

export async function resolveCialloAudio(plugin, args, env, axios) {
    const [song, quality] = args;
    // Reserve enough of the 20-second RPC budget for the backup request.
    const primaryContext = { method: 'getMediaSource', cialloBackup: true };
    try {
        const primary = await pluginRequestContext.run(primaryContext, () => plugin.getMediaSource(...args, env));
        if (primary?.url) return primary;
    } catch (error) {
        // Retry transport failures only; never substitute a different track.
        const failure = primaryContext.failure;
        if (!failure || (!failure.code && !failure.upstreamStatus)) throw error;
    }
    if (!/^\d{1,20}$/.test(String(song?.id))) throw new Error('Invalid NetEase song ID');
    const br = { low: 128000, standard: 192000, high: 320000, super: 999000 }[quality];
    if (!br) throw new Error('Invalid NetEase audio quality');
    // Public NetEase proxy used by the tested Z·网易云 plugin. No account
    // cookies or primary-plugin headers are forwarded to this server.
    const response = await axios.get('http://ws.suol.cc/api/wy/wy_php.php/song/url', {
        params: { id: song.id, br }, timeout: 9000,
    });
    const row = response.data?.data?.[0];
    const invalid = message => Object.assign(new Error(message), { code: 'ERR_MUSICFREE_INVALID_AUDIO_URL' });
    if (!row || String(row.id) !== String(song.id) || row.code !== 200) throw invalid('备用音源未返回同一首歌曲');
    // Check the returned audio's duration rather than the search-result label.
    if (row.freeTrialInfo || !(row.time > 45000)
        || (song.duration > 45 && row.time < song.duration * 1000 - 3000)
        || (row.type === 'mp3' && row.size > 0 && row.br > 0 && row.size * 8 / row.br <= 45)) {
        throw invalid('备用音源仅返回试听或不完整音频，未使用该地址');
    }
    if (quality === 'super' ? !['flac', 'alac'].includes(row.type) : !(row.br >= br)) {
        throw invalid('备用音源未提供请求的音质，未自动降级');
    }
    let target;
    try { target = new URL(row.url); } catch {}
    if (!target || !['http:', 'https:'].includes(target.protocol) || !/(^|\.)music\.126\.net$/i.test(target.hostname)) {
        throw invalid('备用音源未返回有效的网易音频地址');
    }
    return { url: target.href, headers: { Referer: 'https://music.163.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } };
}
