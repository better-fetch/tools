# Open Library Book Scraper

Search Open Library books or public author records through the public Open Library APIs.

## Examples

```bash
npm run validate
BETTER_FETCH_API_KEY=bf_... npm run test
npm run start
```

The tool is intentionally bounded to one Open Library API request per run. It returns public catalog and author metadata only, and does not scrape Open Library HTML pages or bulk-download records.
