# ecommerce-product-scraper

Public product-page scraper for [Better Fetch](https://betterfetch.co).

Give it a product URL and it returns normalized product metadata from JSON-LD,
Open Graph, microdata-ish attributes, and common storefront HTML fallbacks:
title, price, currency, availability, image, brand, SKU, rating, review count,
description, and final URL.

## Develop

```sh
npm install
export BETTER_FETCH_API_KEY=bf_...
npx bf-tool run --example books-to-scrape
npx bf-tool test
npx bf-tool validate
```
