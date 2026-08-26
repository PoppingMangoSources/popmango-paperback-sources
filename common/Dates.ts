/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

/**
 * Date parsing for chapter listings.
 *
 * Sites express publication dates in whatever their theme happened to ship
 * with — a relative phrase, a localised month name, a numeric date in one of
 * several orders, or a unix timestamp. The app only shows a date when it can
 * order chapters by it, so an unparseable value returns `undefined` rather
 * than a wrong guess.
 */

const RELATIVE = /^\s*(?:about\s+)?(\d+(?:\.\d+)?)\s*([a-z]+)\.?\s*(?:ago)?\s*$/i;

/** Length of each unit in milliseconds. Months and years are averages. */
const UNIT_MS: Record<string, number> = {
    second: 1000,
    minute: 60 * 1000,
    hour: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
    year: 365 * 24 * 60 * 60 * 1000,
};

/** Abbreviations sites use in place of the full unit name. */
const UNIT_ALIASES: Record<string, string> = {
    s: "second",
    sec: "second",
    secs: "second",
    seconds: "second",
    m: "minute",
    min: "minute",
    mins: "minute",
    minutes: "minute",
    h: "hour",
    hr: "hour",
    hrs: "hour",
    hours: "hour",
    d: "day",
    days: "day",
    w: "week",
    wk: "week",
    wks: "week",
    weeks: "week",
    mo: "month",
    mon: "month",
    mons: "month",
    months: "month",
    y: "year",
    yr: "year",
    yrs: "year",
    years: "year",
};

const MONTHS: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Parses a publication date from whatever a site printed.
 *
 * Returns `undefined` when the text carries no date, so callers can leave the
 * chapter undated instead of stamping it with today.
 */
export function parseDate(raw: string | undefined | null): Date | undefined {
    if (raw === undefined || raw === null) {
        return undefined;
    }

    const text = raw.replace(/\s+/g, " ").trim();
    if (text.length === 0) {
        return undefined;
    }

    return (
        parseKeyword(text) ??
        parseRelative(text) ??
        parseTimestamp(text) ??
        parseNamedMonth(text) ??
        parseNumeric(text) ??
        parseNative(text)
    );
}

function parseKeyword(text: string): Date | undefined {
    const lower = text.toLowerCase();

    if (/^(just now|now|moments? ago|a few seconds ago)$/.test(lower)) {
        return new Date();
    }
    if (/^(today)$/.test(lower)) {
        return startOfToday();
    }
    if (/^(yesterday)$/.test(lower)) {
        return new Date(startOfToday().getTime() - UNIT_MS.day!);
    }
    return undefined;
}

/** Handles "3 days ago", "an hour ago", "2h". */
function parseRelative(text: string): Date | undefined {
    // "a minute ago" / "an hour ago" — treat the article as a count of one.
    const normalised = text.replace(/^an?\s+/i, "1 ");

    const match = RELATIVE.exec(normalised);
    if (match === null) {
        return undefined;
    }

    const amount = Number.parseFloat(match[1] ?? "");
    const rawUnit = (match[2] ?? "").toLowerCase();
    const unit = UNIT_MS[rawUnit] !== undefined ? rawUnit : UNIT_ALIASES[rawUnit];
    const unitMs = unit === undefined ? undefined : UNIT_MS[unit];

    if (!Number.isFinite(amount) || unitMs === undefined) {
        return undefined;
    }

    return new Date(Date.now() - amount * unitMs);
}

/** Handles a bare unix timestamp, in seconds or milliseconds. */
function parseTimestamp(text: string): Date | undefined {
    if (!/^\d{10}(\d{3})?$/.test(text)) {
        return undefined;
    }

    const value = Number.parseInt(text, 10);
    return new Date(text.length === 10 ? value * 1000 : value);
}

/** Handles "March 5, 2024", "5 March 2024" and "Mar 5 2024". */
function parseNamedMonth(text: string): Date | undefined {
    const cleaned = text.replace(/(\d+)(st|nd|rd|th)\b/gi, "$1").replace(/,/g, " ");

    const monthFirst = /^([a-z]{3,})\s+(\d{1,2})\s+(\d{4})/i.exec(cleaned);
    const dayFirst = /^(\d{1,2})\s+([a-z]{3,})\s+(\d{4})/i.exec(cleaned);

    const parts =
        monthFirst !== null
            ? { month: monthFirst[1], day: monthFirst[2], year: monthFirst[3] }
            : dayFirst !== null
              ? { month: dayFirst[2], day: dayFirst[1], year: dayFirst[3] }
              : undefined;

    if (parts === undefined) {
        return undefined;
    }

    const month = MONTHS[(parts.month ?? "").slice(0, 3).toLowerCase()];
    if (month === undefined) {
        return undefined;
    }

    return utcDate(
        Number.parseInt(parts.year ?? "", 10),
        month,
        Number.parseInt(parts.day ?? "", 10),
    );
}

/**
 * Handles "2024-03-05", "05/03/2024" and "03/05/2024".
 *
 * Slash-separated dates are genuinely ambiguous. Day-first is assumed unless
 * the first number cannot be a day, which is the safer default given how few
 * of these sites are US-hosted.
 */
function parseNumeric(text: string): Date | undefined {
    const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(text);
    if (iso !== null) {
        return utcDate(
            Number.parseInt(iso[1] ?? "", 10),
            Number.parseInt(iso[2] ?? "", 10) - 1,
            Number.parseInt(iso[3] ?? "", 10),
        );
    }

    const parts = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(text);
    if (parts === null) {
        return undefined;
    }

    const first = Number.parseInt(parts[1] ?? "", 10);
    const second = Number.parseInt(parts[2] ?? "", 10);
    const rawYear = Number.parseInt(parts[3] ?? "", 10);
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;

    const dayFirst = first > 12 || second <= 12;
    return dayFirst ? utcDate(year, second - 1, first) : utcDate(year, first - 1, second);
}

/** Last resort: let the engine try, and reject anything it cannot make sense of. */
function parseNative(text: string): Date | undefined {
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function utcDate(year: number, month: number, day: number): Date | undefined {
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
        return undefined;
    }
    if (month < 0 || month > 11 || day < 1 || day > 31) {
        return undefined;
    }
    return new Date(Date.UTC(year, month, day));
}

function startOfToday(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * Pulls a chapter number out of a chapter title.
 *
 * Falls back to the given index so that a chapter with an unnumbered title
 * ("Prologue", "Extra") still sorts into a stable position.
 */
export function parseChapterNumber(title: string | undefined, fallback: number): number {
    if (title === undefined) {
        return fallback;
    }

    const match = /(?:chapter|chap|ch|episode|ep|#)\s*\.?\s*(\d+(?:\.\d+)?)/i.exec(title)
        ?? /(\d+(?:\.\d+)?)/.exec(title);

    const value = match === null ? Number.NaN : Number.parseFloat(match[1] ?? "");
    return Number.isFinite(value) ? value : fallback;
}
