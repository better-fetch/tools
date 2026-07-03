# extract_article

Turn any article URL into clean, structured text — title, byline, publish
date, and full body text, sized for LLM context windows. Runs on the
[Better Fetch](https://betterfetch.co) stealth engine, so bot-protected and
JavaScript-rendered pages work too.

## Use it

**On the site** — [betterfetch.co/tools/extract_article](https://betterfetch.co/tools/extract_article)

**Over MCP** — connect `https://betterfetch.co/api/mcp` and call `extract_article`.

**Locally**

```sh
git clone https://github.com/better-fetch/extract-article
cd extract-article && npm install
export BETTER_FETCH_API_KEY=bf_...   # https://betterfetch.co/keys
npx bf-tool run --input '{"url": "https://en.wikipedia.org/wiki/Web_scraping"}'
```

Every engine call costs 1 credit on your key (free accounts get 50/month).

## Output

```json
{
  "title": "…",
  "byline": "…",
  "published": "…",
  "site_name": "…",
  "text": "…",
  "word_count": 1234,
  "final_url": "…"
}
```

Fork it, tweak the extraction, run it with your own key — that's the point.
