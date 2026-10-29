/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

import type { DUIFormRow, DUISection } from "@paperback/types";

import { plainQuotes } from "./Convert";

/**
 * Builders for a source's settings screen.
 *
 * 0.8 describes settings as rows bound to getters and setters rather than as
 * values, and reaches them through a single section holding a button that
 * opens a form. These wrap that shape so a source can list its settings
 * plainly and let the plumbing be handled here.
 *
 * Rows read and write through the source's `SettingsStore`, so a change takes
 * effect immediately and is saved behind.
 */

/** One group of rows, with optional text above and below it. */
export interface MenuSection {
    id: string;
    header?: string;
    footer?: string;
    rows: DUIFormRow[];
}

/** A choice the reader picks from a list. */
export interface SelectOptions {
    label: string;
    options: Array<{ id: string; title: string }>;
    /** Whether more than one option may be chosen at a time. */
    multiple?: boolean;
    get: () => string[];
    set: (value: string[]) => void;
}

/**
 * Settings objects, kept reachable for as long as the app may call into them.
 *
 * The app holds its own handle on every row, binding and section it is given,
 * but not one the JavaScript collector can see. A closure the app has yet to
 * call — a row's getter, a section's row list, a label lookup — can therefore
 * be collected out from under it, and the screen opens empty or a change is
 * silently dropped. Everything built here is held in this list so that cannot
 * happen.
 *
 * The objects are small, but a menu is rebuilt each time it opens, so the list
 * is capped and the oldest are let go first.
 */
const RETAIN_LIMIT = 2000;
let retained: unknown[] = [];

function retain<T>(value: T): T {
    if (retained.length >= RETAIN_LIMIT) {
        retained = retained.slice(RETAIN_LIMIT / 2);
    }
    retained.push(value);
    return value;
}

/** A getter and setter pair the app reads and writes a row's value through. */
function binding(get: () => Promise<unknown>, set: (value: unknown) => Promise<void>) {
    return retain(App.createDUIBinding({ get, set }));
}

export function selectRow(id: string, options: SelectOptions): DUIFormRow {
    const titles = new Map(options.options.map((option) => [option.id, option.title]));

    return retain(
        App.createDUISelect({
            id,
            label: options.label,
            options: options.options.map((option) => option.id),
            allowsMultiselect: options.multiple ?? false,
            // The app stores ids and asks separately for something to display.
            labelResolver: async (optionId: string) => titles.get(optionId) ?? optionId,
            value: binding(
                async () => options.get(),
                async (value: unknown) => {
                    options.set(
                        Array.isArray(value)
                            ? value.filter((entry): entry is string => typeof entry === "string")
                            : [],
                    );
                },
            ),
        }),
    );
}

/** A free-text box. */
export function inputRow(
    id: string,
    options: { label: string; get: () => string; set: (value: string) => void },
): DUIFormRow {
    return retain(
        App.createDUIInputField({
            id,
            label: options.label,
            value: binding(
                async () => options.get(),
                async (value: unknown) => options.set(typeof value === "string" ? plainQuotes(value) : ""),
            ),
        }),
    );
}

/** An on/off row. */
export function switchRow(
    id: string,
    options: { label: string; get: () => boolean; set: (value: boolean) => void },
): DUIFormRow {
    return retain(
        App.createDUISwitch({
            id,
            label: options.label,
            value: binding(
                async () => options.get(),
                async (value: unknown) => options.set(value === true),
            ),
        }),
    );
}

/** A read-only row, for showing what a setting currently resolves to. */
export function labelRow(id: string, label: string, value?: string): DUIFormRow {
    return retain(App.createDUILabel({ id, label, value }));
}

/** Read-only text that wraps instead of truncating. */
export function multilineLabelRow(id: string, label: string, value: string): DUIFormRow {
    return retain(App.createDUIMultilineLabel({ id, label, value }));
}

/** A number picked with − and + buttons. */
export function stepperRow(
    id: string,
    options: { label: string; min?: number; max?: number; step?: number; get: () => number; set: (value: number) => void },
): DUIFormRow {
    return retain(
        App.createDUIStepper({
            id,
            label: options.label,
            min: options.min,
            max: options.max,
            step: options.step,
            value: binding(
                async () => options.get(),
                async (value: unknown) => {
                    if (typeof value === "number" && Number.isFinite(value)) {
                        options.set(value);
                    }
                },
            ),
        }),
    );
}

/** A masked text box, for passwords and tokens. Store its value in the keychain. */
export function secureInputRow(
    id: string,
    options: { label: string; get: () => string; set: (value: string) => void },
): DUIFormRow {
    return retain(
        App.createDUISecureInputField({
            id,
            label: options.label,
            value: binding(
                async () => options.get(),
                async (value: unknown) => options.set(typeof value === "string" ? value : ""),
            ),
        }),
    );
}

/** A tappable action, such as clearing a cache or resetting settings. */
export function buttonRow(id: string, label: string, onTap: () => Promise<void> | void): DUIFormRow {
    return retain(App.createDUIButton({ id, label, onTap: async () => onTap() }));
}

/** A row that opens a web address. */
export function linkRow(id: string, label: string, url: string): DUIFormRow {
    return retain(App.createDUILink({ id, label, value: url }));
}

/** An image banner with a title, shown at the top of a form. */
export function headerRow(id: string, options: { imageUrl: string; title: string; subtitle?: string }): DUIFormRow {
    return retain(App.createDUIHeader({ id, ...options }));
}

/** A sign-in button that runs an OAuth flow and hands back the resulting tokens. */
export function oauthButtonRow(
    id: string,
    options: {
        label: string;
        authorizeEndpoint: string;
        clientId: string;
        responseType: Record<string, unknown>;
        redirectUri?: string;
        scopes?: string[];
        onSuccess: (accessToken: string, refreshToken: string | undefined) => Promise<void> | void;
    },
): DUIFormRow {
    const { onSuccess, ...info } = options;
    return retain(
        App.createDUIOAuthButton({
            id,
            ...info,
            successHandler: async (accessToken: string, refreshToken: string | undefined) =>
                onSuccess(accessToken, refreshToken),
        }),
    );
}

/** A row that opens a nested form of further sections. */
export function formRow(
    id: string,
    label: string,
    sections: () => MenuSection[] | Promise<MenuSection[]>,
): DUIFormRow {
    const form = retain(App.createDUIForm({ sections: async () => retain((await sections()).map(toSection)) }));
    return retain(App.createDUINavigationButton({ id, label, form }));
}

function toSection(section: MenuSection): DUISection {
    return retain(
        App.createDUISection({
            id: section.id,
            header: section.header,
            footer: section.footer,
            isHidden: false,
            rows: async () => retain(section.rows),
        }),
    );
}

/**
 * Wraps a source's settings into the single section the app asks for.
 *
 * The app expects `getSourceMenu` to hand back one section; the convention is
 * that it holds a button which opens the real settings form, which is what
 * this produces.
 */
export function settingsMenu(
    title: string,
    sections: () => MenuSection[] | Promise<MenuSection[]>,
): DUISection {
    // Sections are built when the screen opens, so settings that depend on a fetch can wait for it.
    // With the ids "settings" and "settings_button" the app crashed whenever a
    // source's settings screen was left; a device bisect traced the crash to
    // those two ids alone. These two were tested on the device in their place.
    const button = formRow("content_settings", title, sections);

    return retain(
        App.createDUISection({
            id: "sourceMenu",
            isHidden: false,
            rows: async () => [button],
        }),
    );
}
