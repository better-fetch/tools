# rag-web-browser

Single-page RAG web retrieval tool for [Better Fetch](https://betterfetch.co).

Give it a public URL and it renders the page through the Better Fetch browser
engine, extracts clean text, builds Markdown-like content, returns headings,
links, images, JSON-LD type hints, and optional query snippets.

This v0.1 is intentionally URL-first. Search orchestration is left for a later version so the published tool stays stable and easy to validate.

## Develop

```sh
npm install
export BETTER_FETCH_API_KEY=bf_...
npx bf-tool run --example example-domain-fetch
npx bf-tool test
npx bf-tool validate
```
