// musicfree-gateway/catalog.mjs
// Optional MusicFree catalog methods, adapted to bounded pages and signed collection items.

export async function recommendedCollections(plugin, limit) {
    const results = [];
    const failures = [];
    if (plugin.metadata.methods.includes('getRecommendSheetsByTag')) {
        try {
            let tag = { id: '', title: '全部' };
            if (plugin.metadata.methods.includes('getRecommendSheetTags')) {
                const tags = await plugin.call('getRecommendSheetTags', []);
                tag = tags?.pinned?.[0] ?? tags?.data?.flatMap(group => group.data ?? [])?.[0] ?? tag;
            }
            const page = await plugin.call('getRecommendSheetsByTag', [tag, 1]);
            if (!page || !Array.isArray(page.data)) throw new Error('Invalid recommended playlist response');
            results.push(...page.data.map(item => ({ item, kind: 'playlist' })));
        } catch (error) { failures.push(error); }
    }
    if (results.length < limit && plugin.metadata.methods.includes('getTopLists')) {
        try {
            const groups = await plugin.call('getTopLists', []);
            if (!Array.isArray(groups)) throw new Error('Invalid top list response');
            results.push(...groups.flatMap(group => (Array.isArray(group.data) ? group.data : [group])
                .map(item => ({ item, kind: 'top' }))));
        } catch (error) { failures.push(error); }
    }
    if (!results.length && failures.length) throw failures[0];
    if (failures.length) console.warn('[MusicFree] Partial catalog unavailable', { provider: plugin.metadata.name });
    return results.slice(0, limit);
}

// Page sizes differ by plugin; replay pages from 1 and carry plugin pagination fields forward.
export async function collectionTracks(plugin, item, kind, limit, offset) {
    const method = { playlist: 'getMusicSheetInfo', album: 'getAlbumInfo', top: 'getTopListDetail', artist: 'getArtistWorks' }[kind];
    if (!method || !plugin.metadata.methods.includes(method)) throw new Error('Plugin does not support this collection');
    const items = [];
    let ended = false;
    for (let page = 1; !ended && items.length < offset + limit + 1; page += 1) {
        if (page > 100) throw new Error('Collection page limit exceeded');
        const args = kind === 'artist' ? [item, page, 'music'] : [item, page];
        const result = await plugin.call(method, args);
        const rows = result?.musicList ?? result?.data;
        if (!Array.isArray(rows)) throw new Error('Invalid collection tracks response');
        items.push(...rows.map(song => ({ ...song, platform: plugin.metadata.name })));
        item = { ...item, ...(result.sheetItem ?? result.albumItem), ...result };
        // An absent cursor means a complete list, as in several published top/album plugins.
        ended = result.isEnd !== false || rows.length === 0;
    }
    const slice = items.slice(offset, offset + limit);
    return { items: slice, hasMore: offset + slice.length < items.length || !ended, nextOffset: offset + slice.length };
}
