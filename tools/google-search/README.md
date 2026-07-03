# google_search

Structured Google search results — titles, URLs, snippets — through the
[Better Fetch](https://betterfetch.co) stealth browser. Optional `country`
for localized SERPs. No SERP API subscription; one credit per search on your
Better Fetch key.

## Use it

**On the site** — [betterfetch.co/tools/google_search](https://betterfetch.co/tools/google_search)

**Over MCP** — connect `https://betterfetch.co/api/mcp` and call `google_search`.

**Locally**

```sh
git clone https://github.com/better-fetch/google-search
cd google-search && npm install
export BETTER_FETCH_API_KEY=bf_...   # https://betterfetch.co/keys
npx bf-tool run --input '{"query": "web scraping api", "num": 5}'
```

## Output

```json
{
  "query": "web scraping api",
  "results": [
    { "title": "…", "url": "https://…", "snippet": "…" }
  ],
  "count": 5
}
```

SERP markup shifts over time — if results come back empty, check the repo
for a newer version, or fork and fix the parser (`src/index.ts`, one regex).
