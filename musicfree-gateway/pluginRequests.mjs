import { AsyncLocalStorage } from 'node:async_hooks';

// musicfree-gateway/pluginRequests.mjs
// Keep transport diagnostics scoped to one RPC even when a plugin replaces errors.

export const pluginRequestContext = new AsyncLocalStorage();
const validCode = code => typeof code === 'string' && /^(E[A-Z0-9_]+|ERR_[A-Z0-9_]+)$/.test(code);

export function configurePluginRequests(axios) {
    axios.interceptors.request.use(config => {
        const context = pluginRequestContext.getStore();
        let target;
        try { target = new URL(config.url, config.baseURL); } catch {}
        // Ciallo's hard-coded eight-second limit can expire on Vercel.
        // Stay below the worker's 20-second RPC limit.
        if (context?.method === 'getMediaSource' && target?.origin === 'https://api.s0o1.com'
            && target.pathname === '/API/wyy_music' && config.timeout > 0 && config.timeout < 18000) {
            config.timeout = 18000;
        }
        return config;
    });
    axios.interceptors.response.use(response => {
        const context = pluginRequestContext.getStore();
        if (context) context.failure = undefined;
        return response;
    }, error => {
        const context = pluginRequestContext.getStore();
        if (context) {
            let target;
            try { target = new URL(error.config?.url, error.config?.baseURL); } catch {}
            context.failure = {
                code: validCode(error.code) ? error.code : undefined,
                upstreamStatus: Number.isInteger(error.response?.status) ? error.response.status : undefined,
                upstreamHost: target?.hostname,
            };
        }
        throw error;
    });
}
