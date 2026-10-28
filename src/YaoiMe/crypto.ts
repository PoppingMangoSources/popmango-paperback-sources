/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

// 0.8 has no crypto.subtle, so the page-list cipher (SHA-256 key, AES-256-GCM) is done here.

const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
    0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
    0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
    0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
    0xc67178f2,
];

const rotr = (value: number, bits: number): number => (value >>> bits) | (value << (32 - bits));

export function sha256(data: Uint8Array): Uint8Array {
    const length = data.length;
    const padded = new Uint8Array(((length + 9 + 63) >> 6) << 6);
    padded.set(data);
    padded[length] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(padded.length - 8, Math.floor(length / 0x20000000));
    view.setUint32(padded.length - 4, (length << 3) >>> 0);

    const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const w = new Array<number>(64);
    for (let offset = 0; offset < padded.length; offset += 64) {
        for (let i = 0; i < 16; i++) {
            w[i] = view.getUint32(offset + i * 4);
        }
        for (let i = 16; i < 64; i++) {
            const a = w[i - 15] ?? 0;
            const b = w[i - 2] ?? 0;
            const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
            const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
            w[i] = ((w[i - 16] ?? 0) + s0 + (w[i - 7] ?? 0) + s1) | 0;
        }
        let [a, b, c, d, e, f, g, hh] = h as [number, number, number, number, number, number, number, number];
        for (let i = 0; i < 64; i++) {
            const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + (K[i] ?? 0) + (w[i] ?? 0)) | 0;
            const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
            hh = g;
            g = f;
            f = e;
            e = (d + t1) | 0;
            d = c;
            c = b;
            b = a;
            a = (t1 + t2) | 0;
        }
        h[0] = (h[0]! + a) | 0;
        h[1] = (h[1]! + b) | 0;
        h[2] = (h[2]! + c) | 0;
        h[3] = (h[3]! + d) | 0;
        h[4] = (h[4]! + e) | 0;
        h[5] = (h[5]! + f) | 0;
        h[6] = (h[6]! + g) | 0;
        h[7] = (h[7]! + hh) | 0;
    }

    const digest = new Uint8Array(32);
    const out = new DataView(digest.buffer);
    h.forEach((word, index) => out.setUint32(index * 4, word >>> 0));
    return digest;
}

// AES forward S-box, built from GF(2^8) inverses instead of a 256-entry literal.
const SBOX = (() => {
    const box = new Uint8Array(256);
    let p = 1;
    let q = 1;
    do {
        p = (p ^ ((p << 1) & 0xff) ^ (p & 0x80 ? 0x1b : 0)) & 0xff;
        q ^= q << 1;
        q ^= q << 2;
        q ^= q << 4;
        q &= 0xff;
        if (q & 0x80) q ^= 0x09;
        const x = q ^ ((q << 1) | (q >> 7)) ^ ((q << 2) | (q >> 6)) ^ ((q << 3) | (q >> 5)) ^ ((q << 4) | (q >> 4));
        box[p] = (x ^ 0x63) & 0xff;
    } while (p !== 1);
    box[0] = 0x63;
    return box;
})();

const xtime = (value: number): number => ((value << 1) ^ (value & 0x80 ? 0x1b : 0)) & 0xff;

function expandKey(key: Uint8Array): Uint8Array {
    const words = key.length / 4;
    const rounds = words + 6;
    const expanded = new Uint8Array(16 * (rounds + 1));
    expanded.set(key);
    let rcon = 1;
    for (let i = words; i < 4 * (rounds + 1); i++) {
        let t = expanded.slice((i - 1) * 4, i * 4);
        if (i % words === 0) {
            t = Uint8Array.of(SBOX[t[1]!]! ^ rcon, SBOX[t[2]!]!, SBOX[t[3]!]!, SBOX[t[0]!]!);
            rcon = xtime(rcon);
        } else if (words > 6 && i % words === 4) {
            t = t.map((byte) => SBOX[byte]!);
        }
        for (let j = 0; j < 4; j++) {
            expanded[i * 4 + j] = expanded[(i - words) * 4 + j]! ^ t[j]!;
        }
    }
    return expanded;
}

function encryptBlock(roundKeys: Uint8Array, input: Uint8Array): Uint8Array {
    const rounds = roundKeys.length / 16 - 1;
    const s = input.map((byte, i) => byte ^ roundKeys[i]!);
    for (let round = 1; round <= rounds; round++) {
        // SubBytes + ShiftRows
        const t = new Uint8Array(16);
        for (let c = 0; c < 4; c++) {
            for (let r = 0; r < 4; r++) {
                t[c * 4 + r] = SBOX[s[((c + r) % 4) * 4 + r]!]!;
            }
        }
        if (round < rounds) {
            for (let c = 0; c < 4; c++) {
                const [a0, a1, a2, a3] = [t[c * 4]!, t[c * 4 + 1]!, t[c * 4 + 2]!, t[c * 4 + 3]!];
                const all = a0 ^ a1 ^ a2 ^ a3;
                t[c * 4] = a0 ^ all ^ xtime(a0 ^ a1);
                t[c * 4 + 1] = a1 ^ all ^ xtime(a1 ^ a2);
                t[c * 4 + 2] = a2 ^ all ^ xtime(a2 ^ a3);
                t[c * 4 + 3] = a3 ^ all ^ xtime(a3 ^ a0);
            }
        }
        for (let i = 0; i < 16; i++) {
            s[i] = t[i]! ^ roundKeys[round * 16 + i]!;
        }
    }
    return s;
}

/**
 * AES-GCM decryption without tag verification; a wrong key shows up as
 * unreadable plaintext, which the caller checks by parsing it.
 */
export function aesGcmDecrypt(key: Uint8Array, iv: Uint8Array, ciphertextWithTag: Uint8Array): Uint8Array {
    if (iv.length !== 12) {
        throw new Error("AES-GCM needs a 12-byte IV.");
    }
    const roundKeys = expandKey(key);
    const ciphertext = ciphertextWithTag.subarray(0, Math.max(0, ciphertextWithTag.length - 16));
    const output = new Uint8Array(ciphertext.length);
    const counter = new Uint8Array(16);
    counter.set(iv);
    let block = 2; // GCM's first data block uses counter 2; counter 1 masks the tag
    for (let offset = 0; offset < ciphertext.length; offset += 16, block++) {
        counter[12] = (block >>> 24) & 0xff;
        counter[13] = (block >>> 16) & 0xff;
        counter[14] = (block >>> 8) & 0xff;
        counter[15] = block & 0xff;
        const stream = encryptBlock(roundKeys, counter);
        const end = Math.min(16, ciphertext.length - offset);
        for (let i = 0; i < end; i++) {
            output[offset + i] = ciphertext[offset + i]! ^ stream[i]!;
        }
    }
    return output;
}
