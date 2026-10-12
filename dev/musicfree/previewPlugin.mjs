import { readFileSync } from 'node:fs';

// dev/musicfree/previewPlugin.mjs
// Opt-in developer demo entry; never injected into production builds or ordinary visits.

export const MUSICFREE_PREVIEW_PROVIDER = 'musicfree.cd0f38bcb685e371a630';

/** @returns {import('vite').Plugin} */
export function musicFreePreviewPlugin() {
    return {
        name: 'folia-musicfree-preview',
        apply: 'serve',
        transformIndexHtml() {
            if (!process.env.MUSICFREE_DEV_GATEWAY) return [];
            const version = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
            return [{
                tag: 'script', injectTo: 'head-prepend',
                children: `if (new URLSearchParams(location.search).get('musicfree-demo') === '1') {
                    localStorage.setItem('active_online_provider_id', ${JSON.stringify(MUSICFREE_PREVIEW_PROVIDER)});
                    localStorage.setItem('last_home_view_tab', 'playlist');
                    localStorage.setItem('library_suite', 'grid');
                    localStorage.setItem('library_suite_prompt_seen', 'true');
                    localStorage.setItem('i18nextLng', 'zh-CN');
                    localStorage.setItem('folia_last_seen_ponder_onboarding_version', ${JSON.stringify(version)});
                    import('/dev/musicfree/preview.ts').catch(error => console.error('[MusicFree preview]', error));
                }`,
            }];
        },
    };
}
