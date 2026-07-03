# web-scraper

Single-page structured web scraper for [Better Fetch](https://betterfetch.co).

Give it a public URL. It renders the page through Better Fetch and returns
normalized page metadata, readable text, links, images, JSON-LD types, and
optional simple selector matches.

Version 0.1 is deliberately focused:
it does not run user-supplied JavaScript page functions, recursively crawl a
site, or maintain a request queue. Those should be added as separately
validated slices.

## Develop

```sh
npm install
export BETTER_FETCH_API_KEY=bf_...
npx bf-tool run --example example-page
npx bf-tool test
npx bf-tool validate
```
