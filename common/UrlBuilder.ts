/**
 * A small chainable URL builder.
 *
 * The 0.8 runtime has no `URL` of its own and the JavaScriptCore environment
 * it runs in does not provide the browser one either, so sources get this
 * instead. Query items keep insertion order, and a key set to an array is
 * repeated once per value — which is how most sites express multi-select
 * filters.
 */
export class UrlBuilder {
    private base: string;
    private pathComponents: string[] = [];
    private queryItems: Array<[string, string]> = [];
    private fragment?: string;

    constructor(base: string) {
        // Strip a trailing slash so path components join predictably.
        this.base = base.replace(/\/+$/, "");
    }

    addPathComponent(component: string | number): this {
        const value = String(component).replace(/^\/+|\/+$/g, "");
        if (value.length > 0) {
            this.pathComponents.push(value);
        }
        return this;
    }

    /**
     * Sets a query item. An array value is expanded into one item per entry;
     * `undefined` and empty strings are dropped so callers can pass optional
     * values straight through.
     */
    setQueryItem(key: string, value: string | number | boolean | Array<string | number> | undefined): this {
        if (value === undefined) {
            return this;
        }

        const values = Array.isArray(value) ? value : [value];
        for (const entry of values) {
            const asString = String(entry);
            if (asString.length === 0) {
                continue;
            }
            this.queryItems.push([key, asString]);
        }
        return this;
    }

    /**
     * Replaces the whole path at once.
     *
     * Useful when a site hands back a path in an attribute and it just needs
     * hanging off the domain.
     */
    setPath(path: string): this {
        this.pathComponents = path
            .replace(/^\/+|\/+$/g, "")
            .split("/")
            .filter((component) => component.length > 0);
        return this;
    }

    /** Removes every query item previously set under `key`. */
    removeQueryItem(key: string): this {
        this.queryItems = this.queryItems.filter(([existing]) => existing !== key);
        return this;
    }

    setFragment(fragment: string | undefined): this {
        this.fragment = fragment;
        return this;
    }

    build(): string {
        let url = this.base;

        if (this.pathComponents.length > 0) {
            url += "/" + this.pathComponents.join("/");
        }

        if (this.queryItems.length > 0) {
            const query = this.queryItems
                .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
                .join("&");
            url += (url.includes("?") ? "&" : "?") + query;
        }

        if (this.fragment !== undefined && this.fragment.length > 0) {
            url += "#" + this.fragment;
        }

        return url;
    }

    toString(): string {
        return this.build();
    }
}

/** Convenience factory so call sites read as `URL(DOMAIN).addPathComponent(...)`. */
export function URL(base: string): UrlBuilder {
    return new UrlBuilder(base);
}

/**
 * Resolves a possibly-relative `href` against a base URL.
 *
 * Sites mix absolute URLs, protocol-relative URLs and root-relative paths
 * inside the same listing, so parsers run every link through this.
 */
export function resolveUrl(href: string, base: string): string {
    const trimmed = href.trim();

    if (trimmed.length === 0) {
        return "";
    }
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
        return trimmed;
    }
    if (trimmed.startsWith("//")) {
        const scheme = base.match(/^([a-z][a-z0-9+.-]*):/i)?.[1] ?? "https";
        return `${scheme}:${trimmed}`;
    }

    const origin = base.match(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i)?.[0] ?? base.replace(/\/+$/, "");
    if (trimmed.startsWith("/")) {
        return origin + trimmed;
    }
    return `${origin}/${trimmed.replace(/^\.\//, "")}`;
}

/**
 * Returns the host of a URL, without the scheme, port or path.
 *
 * Used when a cookie needs a domain and only the request URL is at hand.
 */
export function hostOf(url: string): string {
    return url.match(/^[a-z][a-z0-9+.-]*:\/\/([^/:?#]+)/i)?.[1] ?? "";
}
