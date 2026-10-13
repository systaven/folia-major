import { Worker } from 'node:worker_threads';

// musicfree-gateway/pluginHost.mjs
// Worker lifetime and RPC deadlines keep a broken plugin from blocking the gateway event loop.

export async function createPluginHost(script, source, timeoutMs = 20000) {
    let host = await createWorkerHost(script, source, timeoutMs);
    let restarting = null;
    let closed = false;
    return {
        metadata: host.metadata,
        async call(method, args) {
            if (closed) throw new Error('Gateway closed');
            // A timed-out/crashed worker must not poison this cached provider forever.
            // Retry only a later request; the failed call may already have performed work.
            if (host.failed) {
                restarting ??= (async () => {
                    await host.close();
                    const replacement = await createWorkerHost(script, source, timeoutMs);
                    if (closed) { await replacement.close(); throw new Error('Gateway closed'); }
                    host = replacement;
                })().finally(() => { restarting = null; });
                await restarting;
            }
            if (closed) throw new Error('Gateway closed');
            return host.call(method, args);
        },
        async close() {
            closed = true;
            await host.close();
            if (restarting) await restarting.catch(() => {});
        },
    };
}

/** Start one worker generation and reject its pending calls together on failure. */
async function createWorkerHost(script, source, timeoutMs) {
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
        if (failure) return;
        failure = error;
        clearTimeout(initTimer);
        readyReject(error);
        for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); }
        pending.clear();
    };
    const initTimer = setTimeout(() => {
        fail(Object.assign(new Error('MusicFree plugin initialization timed out'), { code: 'ERR_MUSICFREE_INIT_TIMEOUT' }));
        void worker.terminate();
    }, timeoutMs);
    worker.on('error', fail);
    worker.on('exit', () => fail(Object.assign(new Error('MusicFree plugin worker stopped'), { code: 'ERR_MUSICFREE_WORKER_STOPPED' })));
    worker.on('message', message => {
        if (message.ready) { clearTimeout(initTimer); readyResolve(message.ready); return; }
        const request = pending.get(message.id);
        if (!request) return;
        clearTimeout(request.timer);
        pending.delete(message.id);
        if (message.error) request.reject(Object.assign(new Error(message.error), { code: message.code, upstreamStatus: message.upstreamStatus }));
        else request.resolve(message.value);
    });
    let metadata;
    try { metadata = await ready; }
    catch (error) { clearTimeout(initTimer); await worker.terminate(); throw error; }
    return {
        metadata,
        get failed() { return Boolean(failure); },
        call(method, args) {
            if (failure) return Promise.reject(failure);
            if (pending.size >= 32) return Promise.reject(new Error('MusicFree plugin is busy'));
            return new Promise((resolve, reject) => {
                const id = ++seq;
                const timer = setTimeout(() => {
                    fail(Object.assign(new Error('MusicFree plugin request timed out'), { code: 'ERR_MUSICFREE_TIMEOUT' }));
                    void worker.terminate();
                }, timeoutMs);
                pending.set(id, { resolve, reject, timer });
                worker.postMessage({ id, method, args });
            });
        },
        async close() { clearTimeout(initTimer); fail(new Error('Gateway closed')); await worker.terminate(); },
    };
}
