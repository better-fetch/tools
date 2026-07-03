# bioRxiv and medRxiv Preprints Scraper

Fetch bioRxiv or medRxiv preprint metadata by date window or DOI through the public bioRxiv API.

## Examples

```bash
npm run validate
BETTER_FETCH_API_KEY=bf_... npm run test
npm run start
```

The tool is intentionally bounded to one public API request per run. It returns public preprint metadata and links only; it does not download PDFs, parse JATS XML, or crawl article pages.
