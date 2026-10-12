import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// musicfree-gateway/itemProof.mjs
// Sign plugin-produced items so callers cannot replace stored lyric/asset URLs with arbitrary targets.

const canonical = value => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    return value;
};

export const ephemeralSecret = randomBytes(32).toString('hex');

export function createItemProof(secret = process.env.MUSICFREE_ITEM_SECRET || ephemeralSecret) {
    const sign = (providerId, item) => createHmac('sha256', secret).update(providerId).update('\0')
        .update(JSON.stringify(canonical(item))).digest('hex');
    return {
        sign,
        verify(providerId, item, proof) {
            if (typeof proof !== 'string' || !/^[a-f0-9]{64}$/.test(proof)) return false;
            return timingSafeEqual(Buffer.from(sign(providerId, item), 'hex'), Buffer.from(proof, 'hex'));
        },
    };
}
