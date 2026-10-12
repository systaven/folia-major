// musicfree-gateway/search.mjs
// Converts variable-size, one-based plugin pages into Omni's limit/offset contract without skipping rows.

export async function searchPlugin(plugin, query, limit, offset) {
    plugin.searches ??= new Map();
    let state = plugin.searches.get(query);
    if (!state || Date.now() - state.createdAt > 60000) {
        if (plugin.searches.size >= 20) plugin.searches.delete(plugin.searches.keys().next().value);
        state = { items: [], nextPage: 1, ended: false, createdAt: Date.now(), tail: Promise.resolve() };
        plugin.searches.set(query, state);
    }
    const run = state.tail.then(async () => {
        while (!state.ended && state.items.length < offset + limit + 1) {
            if (state.nextPage > 100) throw new Error('MusicFree search page limit exceeded');
            const result = await plugin.call('search', [query, state.nextPage, 'music']);
            if (!result || !Array.isArray(result.data)) throw new Error('MusicFree search returned an invalid page');
            state.items.push(...result.data.map(item => ({ ...item, platform: plugin.metadata.name })));
            state.nextPage += 1;
            state.ended = result.isEnd === true || result.data.length === 0;
        }
        const items = state.items.slice(offset, offset + limit);
        return { items, nextOffset: offset + items.length, hasMore: offset + items.length < state.items.length || !state.ended };
    });
    state.tail = run.catch(() => {});
    return run;
}

// Some published plugins omit covers in search and supply them only via getMusicInfo.
export async function enrichSearchItems(plugin, items) {
    const errors = [];
    if (!plugin.metadata.methods.includes('getMusicInfo')) return errors;
    for (let index = 0; index < items.length; index += 6) {
        await Promise.all(items.slice(index, index + 6).map(async item => {
            if (item.artwork) return;
            try {
                const extra = await plugin.call('getMusicInfo', [item]);
                if (extra && typeof extra === 'object') Object.assign(item, extra);
            } catch (error) { errors.push({ id: item.id, message: error.message }); }
        }));
    }
    return errors;
}
