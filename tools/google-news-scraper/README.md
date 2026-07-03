# google-news-scraper

Google News RSS metadata scraper for [Better Fetch](https://betterfetch.co).

Version 0.1 searches Google News RSS by keyword and returns normalized article
metadata: title, source, RSS link, GUID, publication time, and source URL when
Google includes it. Article-detail enrichment and image extraction are future
validated slices.

## Develop

```sh
npm install
export BETTER_FETCH_API_KEY=bf_...
npx bf-tool run --example openai-news
npx bf-tool test
npx bf-tool validate
```
