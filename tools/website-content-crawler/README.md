# website-content-crawler

Small same-origin website crawler for [Better Fetch](https://betterfetch.co).

Give it a starting URL and a small page budget. It fetches rendered pages with
Better Fetch, extracts readable text, discovers same-origin links, and returns a
compact list of pages for RAG ingestion, audits, or AI agent context.

## Develop

```sh
npm install
export BETTER_FETCH_API_KEY=bf_...
npx bf-tool run --example example-domain
npx bf-tool test
npx bf-tool validate
```
