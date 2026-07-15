# tiktok-shop-showcase-scraper

Retrieve the products in an arbitrary public creator's US TikTok Shop showcase
through Better Fetch's server-configured managed provider.

The caller supplies only `handle`, optional `region`, and an opaque pagination
`cursor`. Provider credentials, provider account metadata, and raw provider
credit balances never enter the tool request or response. Every result declares
`source_type: managed_upstream`.

This tool is intentionally priced at six Better Fetch credits per run. At the
current upstream entry rate that leaves positive contribution margin across
Starter, Pro, and Scale before infrastructure. Do not publish or enable its
frontend binding until production `/v1/health` reports
`managed_showcase.enabled=true` with `request_credits=6`.

```bash
npx bf-tool validate
npx bf-tool bundle --out dist/bundle.mjs
```
