# Reconnaissance

Use a real, public title and chapter representative of the change. Remove
authorization headers, cookies, account IDs and private data from shared logs
or fixtures. Record the inspection date and response status. A challenge or
login page is not an empty catalog.

| Surface | Establish before coding |
| --- | --- |
| Home | Actual rows, endpoint/sort for each, item type and pagination |
| Search | Query spelling, cursor/page, included/excluded filters, sort values |
| Details | Stable ID, title, cover, summary, authors, status and genres |
| Chapters | Stable upload IDs, real numbers/volumes, groups, dates, locks and ordering |
| Reader | Full page list, lazy attributes, image headers, encryption or descrambling |

Check at least a normal result and the boundary relevant to the fix: empty
search, last page, a decimal chapter, a volume restart, alternate upload, locked
chapter or missing image. Compare request cost; avoid per-card detail fan-out.

Use reference sources to locate endpoints, not as proof that selectors, cookies
or field names still work. Verify the exact live response shape and access
restrictions. Preserve useful request failures and don't add speculative retry
or fallback loops. Keep any URL-paste fast path limited to supported hosts.

Separate metadata from identity: a chapter number, list position, upload ID and
volume are different fields. Do not use an upload count or a sorting index as
the tracked chapter number. Duplicate visibility and version grouping need
explicit device verification.
