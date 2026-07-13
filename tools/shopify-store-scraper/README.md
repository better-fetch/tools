# Shopify Store Scraper

Fetch a public Shopify collection page and normalize product titles, handles,
URLs, prices, availability, and images. The tool avoids the commonly blocked
`products.json` feed so ordinary runs stay on the low-cost one-credit path.

## Run

```bash
BETTER_FETCH_API_KEY=bf_... npx bf-tool run --example first-run
```

The manifest documents the complete input and output schema. This first-party tool uses one Better Fetch engine call per run.
