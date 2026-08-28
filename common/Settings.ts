/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

import type { SourceStateManager } from "@paperback/types";

/**
 * A source's saved settings, readable synchronously.
 *
 * The runtime's own state store is asynchronous, but settings are consulted
 * from places that cannot wait — building a URL, rewriting a request header
 * inside an interceptor. So every declared key is read once up front and kept
 * in memory; reads after that are immediate and writes update memory first and
 * reach the store behind them.
 *
 * Keys have to be declared because the store offers no way to enumerate what
 * it holds.
 */
export class SettingsStore {
    private readonly stateManager: SourceStateManager;
    private readonly keys: readonly string[];
    private readonly cache = new Map<string, unknown>();
    private hydration?: Promise<void>;

    constructor(stateManager: SourceStateManager, keys: readonly string[]) {
        this.stateManager = stateManager;
        this.keys = keys;
    }

    /**
     * Reads every declared key into memory.
     *
     * Safe to call repeatedly — the first call is the one that does the work,
     * and later callers wait on it rather than starting again.
     */
    load(): Promise<void> {
        return (this.hydration ??= this.hydrate());
    }

    private async hydrate(): Promise<void> {
        await Promise.all(
            this.keys.map(async (key) => {
                try {
                    const value = await this.stateManager.retrieve(key);
                    // A value written this session wins over what was on disk.
                    // Without this a setting changed while the load was still
                    // in flight would appear to take and then revert.
                    if (value !== null && value !== undefined && !this.cache.has(key)) {
                        this.cache.set(key, value);
                    }
                } catch {
                    // An unreadable key just falls back to its default.
                }
            }),
        );
    }

    /** The raw stored value, or `undefined` when nothing is set. */
    get(key: string): unknown {
        return this.cache.get(key);
    }

    /** Stores a value, taking effect immediately and persisting behind. */
    set(key: string, value: unknown): void {
        this.cache.set(key, value);
        void this.persist(key, value);
    }

    private async persist(key: string, value: unknown): Promise<void> {
        try {
            await this.stateManager.store(key, value);
        } catch {
            // The setting still applies for this session; it just will not
            // survive a restart, which is better than failing the save.
        }
    }

    /** A stored string, or the fallback when unset or empty. */
    string(key: string, fallback: string): string {
        const value = this.get(key);
        if (typeof value !== "string") {
            return fallback;
        }
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : fallback;
    }

    /** A stored list of strings, keeping only the values still recognised. */
    stringArray(key: string, allowed?: ReadonlySet<string>): string[] {
        const value = this.get(key);
        if (!Array.isArray(value)) {
            return [];
        }

        return value.filter(
            (entry): entry is string => typeof entry === "string" && (allowed === undefined || allowed.has(entry)),
        );
    }

    /** A stored value constrained to a known set of choices. */
    choice<T extends string>(key: string, options: readonly T[], fallback: T): T {
        const value = this.get(key);
        return options.includes(value as T) ? (value as T) : fallback;
    }

    boolean(key: string, fallback: boolean): boolean {
        const value = this.get(key);
        return typeof value === "boolean" ? value : fallback;
    }
}

/**
 * Normalises a URL a reader typed into a settings box.
 *
 * A bare host gets a scheme, a trailing slash is dropped, and anything that
 * is not a plausible address is rejected so a typo cannot leave the source
 * pointing nowhere. An empty value clears the override.
 */
export function normaliseUrlOverride(value: string): string | undefined {
    const trimmed = value.trim().replace(/\/+$/, "");

    if (trimmed.length === 0) {
        return "";
    }

    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return /^https?:\/\/[^\s/?#.]+(?:\.[^\s/?#.]+)+(?:\/\S*)?$/i.test(withScheme) ? withScheme : undefined;
}
