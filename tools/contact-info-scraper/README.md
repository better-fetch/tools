# contact-info-scraper

Public website contact extractor for [Better Fetch](https://betterfetch.co).

Give it one URL, or a short list of URLs, and it renders public pages through
Better Fetch, follows likely same-origin contact/about/support pages, and
returns emails, phone numbers, social profiles, contact-page URLs, and source
pages.

This v0.1 is intentionally bounded: no login, no private enrichment, no email
verification, and no broad whole-site crawl.

## Develop

```sh
npm install
export BETTER_FETCH_API_KEY=bf_...
npx bf-tool run --example iana-contact
npx bf-tool test
npx bf-tool validate
```
