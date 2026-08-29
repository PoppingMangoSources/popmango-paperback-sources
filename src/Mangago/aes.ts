/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

/**
 * AES-CBC decryption, written out by hand.
 *
 * The site hands its page list over encrypted, and 0.8 has no WebCrypto to
 * undo that with — there is no `crypto.subtle` in the runtime — so the cipher
 * lives here. Only the decrypt direction is implemented, which is all that is
 * ever needed: nothing in a source encrypts.
 *
 * This is textbook AES (FIPS-197) and nothing about it is site-specific.
 */

/** The AES substitution box. */
const SBOX = new Uint8Array(256);

/** Its inverse, which is what decryption substitutes through. */
const INV_SBOX = new Uint8Array(256);

/** Round constants, one per key-expansion round. */
const RCON = new Uint8Array([0x8d, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36, 0x6c, 0xd8, 0xab, 0x4d]);

/** Multiplication in GF(2^8), the field the cipher is defined over. */
function xtime(value: number): number {
    const shifted = value << 1;
    return (shifted & 0x100) !== 0 ? (shifted ^ 0x11b) & 0xff : shifted & 0xff;
}

function mul(a: number, b: number): number {
    let result = 0;
    let x = a;
    let y = b;

    while (y > 0) {
        if ((y & 1) !== 0) {
            result ^= x;
        }
        x = xtime(x);
        y >>= 1;
    }

    return result & 0xff;
}

// Build both boxes from the field rather than listing 512 constants: the
// S-box entry for a byte is its multiplicative inverse, put through a fixed
// affine transform.
(function buildBoxes(): void {
    const inverse = new Uint8Array(256);
    for (let i = 1; i < 256; i += 1) {
        for (let j = 1; j < 256; j += 1) {
            if (mul(i, j) === 1) {
                inverse[i] = j;
                break;
            }
        }
    }

    for (let i = 0; i < 256; i += 1) {
        const c = inverse[i] ?? 0;
        let value = c ^ 0x63;
        for (let shift = 1; shift < 5; shift += 1) {
            value ^= ((c << shift) | (c >>> (8 - shift))) & 0xff;
        }
        SBOX[i] = value & 0xff;
        INV_SBOX[value & 0xff] = i;
    }
})();

/**
 * Expands the key into one round key per round.
 *
 * Returns a flat byte array of `(rounds + 1) * 16` bytes.
 */
function expandKey(key: Uint8Array): { schedule: Uint8Array; rounds: number } {
    const keyWords = key.length / 4;
    if (keyWords !== 4 && keyWords !== 6 && keyWords !== 8) {
        throw new Error(`An AES key must be 16, 24 or 32 bytes, not ${key.length}.`);
    }

    const rounds = keyWords + 6;
    const total = (rounds + 1) * 4;
    const words = new Uint8Array(total * 4);
    words.set(key, 0);

    for (let i = keyWords; i < total; i += 1) {
        let a = words[(i - 1) * 4] ?? 0;
        let b = words[(i - 1) * 4 + 1] ?? 0;
        let c = words[(i - 1) * 4 + 2] ?? 0;
        let d = words[(i - 1) * 4 + 3] ?? 0;

        if (i % keyWords === 0) {
            // Rotate, substitute, then fold in the round constant.
            const rotated = a;
            a = (SBOX[b] ?? 0) ^ (RCON[i / keyWords] ?? 0);
            b = SBOX[c] ?? 0;
            c = SBOX[d] ?? 0;
            d = SBOX[rotated] ?? 0;
        } else if (keyWords > 6 && i % keyWords === 4) {
            a = SBOX[a] ?? 0;
            b = SBOX[b] ?? 0;
            c = SBOX[c] ?? 0;
            d = SBOX[d] ?? 0;
        }

        const prev = (i - keyWords) * 4;
        words[i * 4] = (words[prev] ?? 0) ^ a;
        words[i * 4 + 1] = (words[prev + 1] ?? 0) ^ b;
        words[i * 4 + 2] = (words[prev + 2] ?? 0) ^ c;
        words[i * 4 + 3] = (words[prev + 3] ?? 0) ^ d;
    }

    return { schedule: words, rounds };
}

function addRoundKey(state: Uint8Array, schedule: Uint8Array, round: number): void {
    const offset = round * 16;
    for (let i = 0; i < 16; i += 1) {
        state[i] = (state[i] ?? 0) ^ (schedule[offset + i] ?? 0);
    }
}

function invSubBytes(state: Uint8Array): void {
    for (let i = 0; i < 16; i += 1) {
        state[i] = INV_SBOX[state[i] ?? 0] ?? 0;
    }
}

/** Rows one to three rotate right by their row index. */
function invShiftRows(state: Uint8Array): void {
    const copy = Uint8Array.from(state);
    for (let row = 1; row < 4; row += 1) {
        for (let col = 0; col < 4; col += 1) {
            state[((col + row) % 4) * 4 + row] = copy[col * 4 + row] ?? 0;
        }
    }
}

function invMixColumns(state: Uint8Array): void {
    for (let col = 0; col < 4; col += 1) {
        const offset = col * 4;
        const a = state[offset] ?? 0;
        const b = state[offset + 1] ?? 0;
        const c = state[offset + 2] ?? 0;
        const d = state[offset + 3] ?? 0;

        state[offset] = mul(a, 14) ^ mul(b, 11) ^ mul(c, 13) ^ mul(d, 9);
        state[offset + 1] = mul(a, 9) ^ mul(b, 14) ^ mul(c, 11) ^ mul(d, 13);
        state[offset + 2] = mul(a, 13) ^ mul(b, 9) ^ mul(c, 14) ^ mul(d, 11);
        state[offset + 3] = mul(a, 11) ^ mul(b, 13) ^ mul(c, 9) ^ mul(d, 14);
    }
}

/** Decrypts one 16-byte block in place. */
function decryptBlock(block: Uint8Array, schedule: Uint8Array, rounds: number): void {
    addRoundKey(block, schedule, rounds);

    for (let round = rounds - 1; round > 0; round -= 1) {
        invShiftRows(block);
        invSubBytes(block);
        addRoundKey(block, schedule, round);
        invMixColumns(block);
    }

    invShiftRows(block);
    invSubBytes(block);
    addRoundKey(block, schedule, 0);
}

/**
 * Decrypts a whole message in CBC mode.
 *
 * Each block is decrypted and then XORed with the ciphertext block before it,
 * with the IV standing in for the block before the first. No padding is
 * removed — the caller knows which padding the site used.
 */
export function aesCbcDecrypt(ciphertext: Uint8Array, key: Uint8Array, iv: Uint8Array): Uint8Array {
    if (ciphertext.length === 0 || ciphertext.length % 16 !== 0) {
        throw new Error(`The ciphertext is ${ciphertext.length} bytes, which is not a whole number of blocks.`);
    }
    if (iv.length !== 16) {
        throw new Error(`An AES initialisation vector must be 16 bytes, not ${iv.length}.`);
    }

    const { schedule, rounds } = expandKey(key);
    const plaintext = new Uint8Array(ciphertext.length);
    const block = new Uint8Array(16);
    let previous = iv;

    for (let offset = 0; offset < ciphertext.length; offset += 16) {
        block.set(ciphertext.subarray(offset, offset + 16));
        decryptBlock(block, schedule, rounds);

        for (let i = 0; i < 16; i += 1) {
            plaintext[offset + i] = (block[i] ?? 0) ^ (previous[i] ?? 0);
        }

        previous = ciphertext.subarray(offset, offset + 16);
    }

    return plaintext;
}

/** Drops the trailing zero bytes the site pads its plaintext with. */
export function stripZeroPadding(bytes: Uint8Array): Uint8Array {
    let end = bytes.length;
    while (end > 0 && bytes[end - 1] === 0) {
        end -= 1;
    }
    return bytes.subarray(0, end);
}
