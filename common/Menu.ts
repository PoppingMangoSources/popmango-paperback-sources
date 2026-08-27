/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

import type { DUIFormRow, DUISection } from "@paperback/types";

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

export function selectRow(id: string, options: SelectOptions): DUIFormRow {
    const titles = new Map(options.options.map((option) => [option.id, option.title]));

    return App.createDUISelect({
        id,
        label: options.label,
        options: options.options.map((option) => option.id),
        allowsMultiselect: options.multiple ?? false,
        // The app stores ids and asks separately for something to display.
        labelResolver: async (optionId: string) => titles.get(optionId) ?? optionId,
        value: App.createDUIBinding({
            get: async () => options.get(),
            set: async (value: unknown) => {
                options.set(Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []);
            },
        }),
    });
}

/** A free-text box. */
export function inputRow(
    id: string,
    options: { label: string; get: () => string; set: (value: string) => void },
): DUIFormRow {
    return App.createDUIInputField({
        id,
        label: options.label,
        value: App.createDUIBinding({
            get: async () => options.get(),
            set: async (value: unknown) => options.set(typeof value === "string" ? value : ""),
        }),
    });
}

/** An on/off row. */
export function switchRow(
    id: string,
    options: { label: string; get: () => boolean; set: (value: boolean) => void },
): DUIFormRow {
    return App.createDUISwitch({
        id,
        label: options.label,
        value: App.createDUIBinding({
            get: async () => options.get(),
            set: async (value: unknown) => options.set(value === true),
        }),
    });
}

/** A read-only row, for showing what a setting currently resolves to. */
export function labelRow(id: string, label: string, value?: string): DUIFormRow {
    return App.createDUILabel({ id, label, value });
}

function toSection(section: MenuSection): DUISection {
    return App.createDUISection({
        id: section.id,
        header: section.header,
        footer: section.footer,
        isHidden: false,
        rows: async () => section.rows,
    });
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
    const form = App.createDUIForm({
        // Built when the screen opens rather than up front, so a source whose
        // settings depend on something fetched can wait for it here.
        sections: async () => (await sections()).map(toSection),
    });

    return App.createDUISection({
        id: "settings",
        isHidden: false,
        rows: async () => [App.createDUINavigationButton({ id: "settings_button", label: title, form })],
    });
}
