/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

/**
 * The reader's cryptography, in plain JavaScript.
 *
 * 0.9 signs chapter requests and unwraps page keys with `crypto.subtle`, which
 * the 0.8 runtime does not have, so SHA-256 and HMAC are implemented here. The
 * page decryption itself was already plain JavaScript and is carried over
 * unchanged.
 */

import type { ReaderKeyResponse } from "./models";

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export const asciiBytes = (value: string): Uint8Array => Uint8Array.from(value, (c) => c.charCodeAt(0));

export const decodeBase64Url = (value: string): Uint8Array => {
    const clean = value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    if (
        !/^[A-Za-z0-9+/_-]+={0,2}$/.test(value) ||
        clean.length % 4 === 1 ||
        (value.includes("=") && value.length % 4 !== 0)
    ) {
        throw new Error("Invalid base64 reader data.");
    }
    const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
    let buffer = 0;
    let bits = 0;
    let index = 0;
    for (const character of clean) {
        const digit = BASE64.indexOf(character);
        buffer = (buffer << 6) | digit;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            bytes[index++] = (buffer >> bits) & 0xff;
        }
    }
    if (bits && buffer & ((1 << bits) - 1)) {
        throw new Error("Invalid base64 reader data.");
    }
    return bytes.subarray(0, index);
};

export const encodeBase64Url = (bytes: Uint8Array): string => {
    let out = "";
    for (let i = 0; i < bytes.length; i += 3) {
        const chunk = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
        const length = Math.min(3, bytes.length - i) + 1;
        for (let j = 0; j < length; j++) {
            out += BASE64[(chunk >> (18 - j * 6)) & 63];
        }
    }
    return out;
};

const xorCycle = (data: Uint8Array, mask: Uint8Array): Uint8Array =>
    data.map((value, index) => value ^ mask[index % mask.length]!);

// ---------------------------------------------------------------------------
// SHA-256 and HMAC
// ---------------------------------------------------------------------------

const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotate = (value: number, bits: number): number => (value >>> bits) | (value << (32 - bits));

export function sha256(data: Uint8Array): Uint8Array {
    const length = data.length;
    const padded = new Uint8Array(((length + 9 + 63) >> 6) << 6);
    padded.set(data);
    padded[length] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(padded.length - 8, Math.floor((length * 8) / 0x100000000), false);
    view.setUint32(padded.length - 4, (length * 8) >>> 0, false);

    const h = new Uint32Array([
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]);
    const w = new Uint32Array(64);

    for (let offset = 0; offset < padded.length; offset += 64) {
        for (let i = 0; i < 16; i++) {
            w[i] = view.getUint32(offset + i * 4, false);
        }
        for (let i = 16; i < 64; i++) {
            const a = w[i - 15]!;
            const b = w[i - 2]!;
            const s0 = rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3);
            const s1 = rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10);
            w[i] = w[i - 16]! + s0 + w[i - 7]! + s1;
        }

        let a = h[0]!;
        let b = h[1]!;
        let c = h[2]!;
        let d = h[3]!;
        let e = h[4]!;
        let f = h[5]!;
        let g = h[6]!;
        let hh = h[7]!;

        for (let i = 0; i < 64; i++) {
            const t1 = (hh + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) | 0;
            const t2 = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
            hh = g;
            g = f;
            f = e;
            e = (d + t1) | 0;
            d = c;
            c = b;
            b = a;
            a = (t1 + t2) | 0;
        }

        h[0] = h[0]! + a;
        h[1] = h[1]! + b;
        h[2] = h[2]! + c;
        h[3] = h[3]! + d;
        h[4] = h[4]! + e;
        h[5] = h[5]! + f;
        h[6] = h[6]! + g;
        h[7] = h[7]! + hh;
    }

    const out = new Uint8Array(32);
    const outView = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) {
        outView.setUint32(i * 4, h[i]!, false);
    }
    return out;
}

export function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
    const block = new Uint8Array(64);
    block.set(key.length > 64 ? sha256(key) : key);

    const inner = new Uint8Array(64 + message.length);
    const outer = new Uint8Array(64 + 32);
    for (let i = 0; i < 64; i++) {
        inner[i] = block[i]! ^ 0x36;
        outer[i] = block[i]! ^ 0x5c;
    }
    inner.set(message, 64);
    outer.set(sha256(inner), 64);
    return sha256(outer);
}

/**
 * Bytes for a request nonce.
 *
 * The runtime has no `crypto.getRandomValues`. The nonce only keeps two
 * signatures for the same chapter from matching; it guards no secret.
 */
const randomBytes = (count: number): Uint8Array =>
    Uint8Array.from({ length: count }, () => Math.floor(Math.random() * 256));

// ---------------------------------------------------------------------------
// The reader's signing
// ---------------------------------------------------------------------------

export interface ReaderKey {
    /** The HMAC key that signs chapter requests and unwraps page keys. */
    key: Uint8Array;
    /** The site's clock minus ours, so a signature carries the site's time. */
    offset: number;
}

// The served key is masked with a digest of the reader secret; unmasked it is
// the HMAC key that signs chapter requests and unwraps page keys.
export const deriveReaderKey = (response: ReaderKeyResponse, secret: string): ReaderKey => ({
    key: xorCycle(decodeBase64Url(response.key), sha256(asciiBytes(`sign:${secret}`))),
    offset: Number(response.now) - Date.now() || 0,
});

export const signReaderPath = (readerKey: ReaderKey, path: string): string => {
    const time = String(Date.now() + readerKey.offset);
    const nonce = encodeBase64Url(randomBytes(12));
    const signature = encodeBase64Url(hmacSha256(readerKey.key, asciiBytes(`${time}.${nonce}.${path}`)));
    return `v1.${time}.${nonce}.${signature.slice(0, 32)}`;
};

// A "v1" wrapped chapter masks each page key with an HMAC of that page's nonce.
export const unwrapPageKey = (readerKey: ReaderKey, key: string, nonce: string): string =>
    encodeBase64Url(xorCycle(decodeBase64Url(key), hmacSha256(readerKey.key, asciiBytes(`page.${nonce}`))));

// ---------------------------------------------------------------------------
// Page decryption (AES-CTR)
// ---------------------------------------------------------------------------

const SBOX = new Uint8Array(256);
const MIX = [0, 1, 2, 3].map(() => new Int32Array(256));
const FINAL = [0, 1, 2, 3].map(() => new Int32Array(256));

{
    const double = Array.from({ length: 256 }, (_, i) => (i < 128 ? i << 1 : (i << 1) ^ 0x11b));
    const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
    let x = 0;
    let xi = 0;
    for (let i = 0; i < 256; i++) {
        let sx = xi ^ (xi << 1) ^ (xi << 2) ^ (xi << 3) ^ (xi << 4);
        sx = (sx >>> 8) ^ (sx & 0xff) ^ 0x63;
        SBOX[x] = sx;
        for (let n = 0; n < 4; n++) {
            FINAL[n]![x] = sx << (littleEndian ? n * 8 : 24 - n * 8);
        }
        const x2 = double[x]!;
        const x8 = double[double[x2]!]!;
        const t = (double[sx]! * 0x101) ^ (sx * 0x1010100);
        MIX[0]![x] = (t << 24) | (t >>> 8);
        MIX[1]![x] = (t << 16) | (t >>> 16);
        MIX[2]![x] = (t << 8) | (t >>> 24);
        MIX[3]![x] = t;
        if (x === 0) {
            x = xi = 1;
        } else {
            x = x2 ^ double[double[double[x8 ^ x2]!]!]!;
            xi ^= double[double[xi]!]!;
        }
    }
}

const RCON = [0x00, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];

const subWord = (t: number): number =>
    (SBOX[t >>> 24]! << 24) | (SBOX[(t >>> 16) & 0xff]! << 16) | (SBOX[(t >>> 8) & 0xff]! << 8) | SBOX[t & 0xff]!;

const expandKey = (key: Uint8Array): Uint32Array => {
    const words = key.length / 4;
    if (![4, 6, 8].includes(words)) {
        throw new Error(`Unsupported page key length ${key.length}`);
    }
    const schedule = new Uint32Array((words + 7) * 4);
    for (let i = 0; i < schedule.length; i++) {
        if (i < words) {
            schedule[i] = (key[i * 4]! << 24) | (key[i * 4 + 1]! << 16) | (key[i * 4 + 2]! << 8) | key[i * 4 + 3]!;
            continue;
        }
        let t = schedule[i - 1]!;
        if (i % words === 0) {
            t = subWord((t << 8) | (t >>> 24)) ^ (RCON[i / words]! << 24);
        } else if (words > 6 && i % words === 4) {
            t = subWord(t);
        }
        schedule[i] = schedule[i - words]! ^ t;
    }
    return schedule;
};

/**
 * Decrypts a page image, in place.
 *
 * Full blocks are processed as words, reusing the first-round terms that stay
 * fixed between counter changes; the final-round tables use memory byte order
 * so the same loop works on either endianness. The bytes must start on a
 * four-byte boundary, which a fresh array always does.
 */
export const decryptPage = (data: Uint8Array, key: Uint8Array, nonce: Uint8Array): Uint8Array => {
    if (nonce.length < 8) {
        throw new Error("Invalid AES-CTR page nonce: fewer than 8 bytes.");
    }
    const bytes = data.byteOffset % 4 === 0 ? data : data.slice();
    const rk = new Int32Array(expandKey(key));
    const rounds = rk.length / 4 - 1;
    const end = rounds * 4;
    const m0 = MIX[0]!;
    const m1 = MIX[1]!;
    const m2 = MIX[2]!;
    const m3 = MIX[3]!;
    const f0 = FINAL[0]!;
    const f1 = FINAL[1]!;
    const f2 = FINAL[2]!;
    const f3 = FINAL[3]!;
    // The last round key, rearranged into memory order like the FINAL tables.
    const last = new Int32Array(4);
    const lastView = new DataView(last.buffer);
    for (let i = 0; i < 4; i++) {
        lastView.setInt32(i * 4, rk[rounds * 4 + i]!, false);
    }
    const l0 = last[0]!;
    const l1 = last[1]!;
    const l2 = last[2]!;
    const l3 = last[3]!;

    const length = bytes.length;
    const wordCount = length >>> 2;
    const words = new Int32Array(bytes.buffer, bytes.byteOffset, wordCount);

    const c0 = ((nonce[0]! << 24) | (nonce[1]! << 16) | (nonce[2]! << 8) | nonce[3]!) ^ rk[0]!;
    const c1 = ((nonce[4]! << 24) | (nonce[5]! << 16) | (nonce[6]! << 8) | nonce[7]!) ^ rk[1]!;
    const blocks = Math.ceil(length / 16);
    // Round 1 terms that only depend on the fixed nonce words.
    const a0 = m0[c0 >>> 24]! ^ m1[(c1 >>> 16) & 0xff]! ^ rk[4]!;
    const a1 = m0[c1 >>> 24]! ^ m3[c0 & 0xff]! ^ rk[5]!;
    const a2 = m2[(c0 >>> 8) & 0xff]! ^ m3[c1 & 0xff]! ^ rk[6]!;
    const a3 = m1[(c0 >>> 16) & 0xff]! ^ m2[(c1 >>> 8) & 0xff]! ^ rk[7]!;

    let c2 = 0;
    let r0 = 0;
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    for (let block = 0, w = 0; block < blocks; block++, w += 4) {
        const c3 = block ^ rk[3]!;
        if (block === 0 || (block & 0xff) === 0) {
            // Everything except the counter's low byte is fixed for the next 256 blocks.
            c2 = Math.floor(block / 0x100000000) ^ rk[2]!;
            r0 = a0 ^ m2[(c2 >>> 8) & 0xff]!;
            const t1 = a1 ^ m1[(c2 >>> 16) & 0xff]! ^ m2[(c3 >>> 8) & 0xff]!;
            const t2 = a2 ^ m0[c2 >>> 24]! ^ m1[(c3 >>> 16) & 0xff]!;
            const t3 = a3 ^ m0[c3 >>> 24]! ^ m3[c2 & 0xff]!;
            b0 = m1[(t1 >>> 16) & 0xff]! ^ m2[(t2 >>> 8) & 0xff]! ^ m3[t3 & 0xff]! ^ rk[8]!;
            b1 = m0[t1 >>> 24]! ^ m1[(t2 >>> 16) & 0xff]! ^ m2[(t3 >>> 8) & 0xff]! ^ rk[9]!;
            b2 = m0[t2 >>> 24]! ^ m1[(t3 >>> 16) & 0xff]! ^ m3[t1 & 0xff]! ^ rk[10]!;
            b3 = m0[t3 >>> 24]! ^ m2[(t1 >>> 8) & 0xff]! ^ m3[t2 & 0xff]! ^ rk[11]!;
        }
        const t0 = r0 ^ m3[c3 & 0xff]!;
        let s0 = b0 ^ m0[t0 >>> 24]!;
        let s1 = b1 ^ m3[t0 & 0xff]!;
        let s2 = b2 ^ m2[(t0 >>> 8) & 0xff]!;
        let s3 = b3 ^ m1[(t0 >>> 16) & 0xff]!;
        for (let k = 12; k < end; ) {
            const t0 = m0[s0 >>> 24]! ^ m1[(s1 >>> 16) & 0xff]! ^ m2[(s2 >>> 8) & 0xff]! ^ m3[s3 & 0xff]! ^ rk[k++]!;
            const t1 = m0[s1 >>> 24]! ^ m1[(s2 >>> 16) & 0xff]! ^ m2[(s3 >>> 8) & 0xff]! ^ m3[s0 & 0xff]! ^ rk[k++]!;
            const t2 = m0[s2 >>> 24]! ^ m1[(s3 >>> 16) & 0xff]! ^ m2[(s0 >>> 8) & 0xff]! ^ m3[s1 & 0xff]! ^ rk[k++]!;
            s3 = m0[s3 >>> 24]! ^ m1[(s0 >>> 16) & 0xff]! ^ m2[(s1 >>> 8) & 0xff]! ^ m3[s2 & 0xff]! ^ rk[k++]!;
            s0 = t0;
            s1 = t1;
            s2 = t2;
        }
        const o0 = f0[s0 >>> 24]! ^ f1[(s1 >>> 16) & 0xff]! ^ f2[(s2 >>> 8) & 0xff]! ^ f3[s3 & 0xff]! ^ l0;
        const o1 = f0[s1 >>> 24]! ^ f1[(s2 >>> 16) & 0xff]! ^ f2[(s3 >>> 8) & 0xff]! ^ f3[s0 & 0xff]! ^ l1;
        const o2 = f0[s2 >>> 24]! ^ f1[(s3 >>> 16) & 0xff]! ^ f2[(s0 >>> 8) & 0xff]! ^ f3[s1 & 0xff]! ^ l2;
        const o3 = f0[s3 >>> 24]! ^ f1[(s0 >>> 16) & 0xff]! ^ f2[(s1 >>> 8) & 0xff]! ^ f3[s2 & 0xff]! ^ l3;

        if (w + 4 <= wordCount) {
            words[w]! ^= o0;
            words[w + 1]! ^= o1;
            words[w + 2]! ^= o2;
            words[w + 3]! ^= o3;
        } else {
            const stream = new Uint8Array(new Int32Array([o0, o1, o2, o3]).buffer);
            for (let i = block * 16; i < length; i++) {
                bytes[i]! ^= stream[i - block * 16]!;
            }
        }
    }
    return bytes;
};
