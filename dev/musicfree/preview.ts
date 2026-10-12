import { omni } from '../../src/services/onlineMusic/omni';
import { useSearchNavigationStore } from '../../src/stores/useSearchNavigationStore';

// dev/musicfree/preview.ts
// Opens the existing search UI after bootstrap and session restoration, so a demo needs no account or local import.

const waitForMount = (): Promise<void> => new Promise((resolve, reject) => {
    if (!document.getElementById('app-splash') && document.getElementById('root')?.childElementCount) {
        resolve();
        return;
    }
    let sawSplash = Boolean(document.getElementById('app-splash'));
    const observer = new MutationObserver(() => {
        sawSplash ||= Boolean(document.getElementById('app-splash'));
        if (sawSplash && !document.getElementById('app-splash')) {
            observer.disconnect();
            clearTimeout(timeout);
            resolve();
        }
    });
    const timeout = setTimeout(() => { observer.disconnect(); reject(new Error('Folia did not mount')); }, 90000);
    observer.observe(document.documentElement, { childList: true, subtree: true });
});

async function openDemo() {
    await waitForMount();
    // Let the mount effects that restore navigation settle before selecting the demo surface.
    await new Promise<void>(resolve => setTimeout(resolve, 250));
    const provider = omni.getProviderSummaries().find(item => item.displayName === '小秋音乐');
    if (!provider) throw new Error('小秋音乐 did not load in the configured gateway');
    useSearchNavigationStore.getState().setHomeViewTab('playlist');
    if (new URLSearchParams(location.search).get('musicfree-search') !== '1') return;
    await useSearchNavigationStore.getState().submitSearch({
        query: '晴天', sourceTab: provider.providerId,
        deps: { localSongs: [], t: key => key },
    });
}

void openDemo().catch(error => console.error('[MusicFree preview]', error));
