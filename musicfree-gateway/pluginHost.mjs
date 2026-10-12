import { Worker } from 'node:worker_threads';

// musicfree-gateway/pluginHost.mjs
// Worker lifetime and RPC deadlines keep a broken plugin from blocking the gateway event loop.

export async function createPluginHost(script, source, timeoutMs = 20000) {
    const worker = new Worker(new URL('./pluginWorker.mjs', import.meta.url), {
        workerData: { script, source }, resourceLimits: { maxOldGenerationSizeMb: 128 },
    });
    const pending = new Map();
    let seq = 0;
    let failure = null;
    let readyResolve;
    let readyReject;
    const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    const fail = error => {
        failure = error;
        readyReject(error);
        for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); }
        pending.clear();
    };
    const initTimer = setTimeout(() => {
        fail(new Error('MusicFree plugin initialization timed out'));
        void worker.terminate();
    }, timeoutMs);
    worker.on('error', fail);
    worker.on('exit', () => fail(new Error('MusicFree plugin worker stopped')));
    worker.on('message', message => {
        if (message.ready) { clearTimeout(initTimer); readyResolve(message.ready); return; }
        const request = pending.get(message.id);
        if (!request) return;
        clearTimeout(request.timer);
        pending.delete(message.id);
        if (message.error) request.reject(new Error(message.error));
        else request.resolve(message.value);
    });
    let metadata;
    try { metadata = await ready; }
    catch (error) { clearTimeout(initTimer); await worker.terminate(); throw error; }
    return {
        metadata,
        call(method, args) {
            if (failure) return Promise.reject(failure);
            if (pending.size >= 32) return Promise.reject(new Error('MusicFree plugin is busy'));
            return new Promise((resolve, reject) => {
                const id = ++seq;
                const timer = setTimeout(() => {
                    fail(new Error('MusicFree plugin request timed out'));
                    void worker.terminate();
                }, timeoutMs);
                pending.set(id, { resolve, reject, timer });
                worker.postMessage({ id, method, args });
            });
        },
        async close() { clearTimeout(initTimer); fail(new Error('Gateway closed')); await worker.terminate(); },
    };
}
