# google_maps_search

Search Google Maps and get structured leads — name, address, rating, review
count, category, phone, website, coordinates — through the
[Better Fetch](https://betterfetch.co) stealth engine. The classic
lead-list workflow: one call, no Maps API key.

## Use it

**On the site** — [betterfetch.co/tools/google_maps_search](https://betterfetch.co/tools/google_maps_search)

**Over MCP** — connect `https://betterfetch.co/api/mcp` and call `google_maps_search`.

**Locally**

```sh
git clone https://github.com/better-fetch/google-maps-search
cd google-maps-search && npm install
export BETTER_FETCH_API_KEY=bf_...   # https://betterfetch.co/keys
npx bf-tool run --input '{"query": "coffee roasters in Sydney", "max_results": 5}'
```

## Output

```json
{
  "query": "coffee roasters in Sydney",
  "places": [
    {
      "name": "…", "address": "…", "rating": 4.7, "reviews": 312,
      "category": "Coffee roasters", "phone": "…", "website": "https://…",
      "lat": -33.86, "lng": 151.2
    }
  ],
  "count": 5
}
```

## How it works

Maps embeds its search payload in `window.APP_INITIALIZATION_STATE`; the
parser walks it heuristically (corroborated name + address/rating entries)
rather than trusting one array path, so minor layout shifts don't zero the
results. If Google moves the furniture entirely, fork and fix
`src/index.ts` — that's the point of the repo.
