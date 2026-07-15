# tiktok-shop-scraper

Public TikTok Shop discovery, product details, and product reviews through Better Fetch.

Modes:

- `search` — discover current TikTok Shop product pages through the public web index
- `products` — discover product pages associated with a public shop name/URL
- `product` — parse a rendered public product page
- `product_reviews` — return the public page's review summary and visible verified reviews

Every response reports `source_type`. Search and store discovery use `public_index`; product and review details use `public_product_page`. The tool does not claim access to private seller data or a complete region-gated catalogue.

```bash
npm run validate
npx bf-tool run --example shop-search
```
