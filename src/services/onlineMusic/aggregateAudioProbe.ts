import type { SongResult } from '../../types';
import { OnlineProviderError } from '../../types/onlineMusic';

// src/services/onlineMusic/aggregateAudioProbe.ts
// Inspect the playable media through the gateway; catalog duration alone cannot identify a 30-second trial.
export function verifyAggregateDuration(seconds: number, expectedMs: number): void {
    if (!Number.isFinite(seconds) || seconds <= 0) throw new OnlineProviderError('invalid-response', '无法验证音频时长');
    const expected = expectedMs / 1000;
    if ((seconds >= 25 && seconds <= 45) || (seconds <= 45 && (expected === 0 || expected > 45))
        || (expected > 45 && seconds < expected * 0.85)) {
        throw new OnlineProviderError('preview-only', '此音源返回试听或截断音频，正在尝试其他音源');
    }
}

export function probeAggregateAudio(url: string, song: SongResult, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const audio = new Audio();
        audio.preload = 'metadata';
        let settled = false;
        const finish = (error?: unknown) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal.removeEventListener('abort', abort);
            audio.onloadedmetadata = audio.ondurationchange = audio.onerror = null;
            audio.removeAttribute('src');
            audio.load();
            if (error) reject(error); else resolve();
        };
        const abort = () => finish(new DOMException('Audio check canceled', 'AbortError'));
        const timer = setTimeout(() => finish(new Error('Audio metadata timed out')), 8000);
        const validate = () => {
            if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
            try { verifyAggregateDuration(audio.duration, song.durationMs); finish(); }
            catch (error) { finish(error); }
        };
        audio.onloadedmetadata = audio.ondurationchange = validate;
        audio.onerror = () => finish(new OnlineProviderError('not-playable', '音频无法加载或解码'));
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) { abort(); return; }
        audio.src = url;
        audio.load();
    });
}
