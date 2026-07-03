# cheerio-scraper

Fast raw-HTML page scraper for [Better Fetch](https://betterfetch.co).

Give it a public URL. It fetches the document over HTTP and returns normalized
metadata, readable text, links, images, JSON-LD types, response metadata, and
optional simple selector matches.

Version 0.1 is deliberately focused compared with a full production crawler
benchmark: it does not recursively crawl, execute user-supplied page functions,
maintain request queues, or parse JavaScript-rendered content. Use Web Scraper
when a page needs browser rendering.

## Develop

```sh
npm install
export BETTER_FETCH_API_KEY=bf_...
npx bf-tool run --example example-page
npx bf-tool test
npx bf-tool validate
```
