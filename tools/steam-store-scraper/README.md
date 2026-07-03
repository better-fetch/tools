# steam-store-scraper

Public Steam Store scraper for [Better Fetch](https://betterfetch.co).

Three bounded modes, all reading public Steam Store JSON surfaces through the
Better Fetch engine:

- `search` - search Steam Store products by keyword
- `details` - fetch one app's public store metadata, pricing, genres, platforms,
  recommendations, screenshots, and review summary
- `reviews` - fetch one page of public Steam user reviews

Returns normalized game, price, platform, review-summary, and review rows for
catalog monitoring, gaming market research, review triage, and agent workflows.

## Develop

```sh
npm install
export BETTER_FETCH_API_KEY=bf_...
export BETTER_FETCH_API_URL=http://127.0.0.1:8090
npx bf-tool run --example portal-details
npx bf-tool test
npx bf-tool validate
```
