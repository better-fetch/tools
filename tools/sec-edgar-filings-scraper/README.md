# sec-edgar-filings-scraper

Public SEC EDGAR scraper for [Better Fetch](https://betterfetch.co).

Two bounded modes, both using SEC JSON endpoints through the Better Fetch
engine with an identifying user agent:

- `filings` - resolve a ticker or CIK and return recent EDGAR submissions
- `company_concept` - fetch one XBRL concept such as `us-gaap/Assets`

Returns normalized company metadata, filing URLs, accession numbers, form types,
filing/report dates, inline-XBRL flags, and concept fact rows for finance,
research, and agent workflows.

## Develop

```sh
npm install
export BETTER_FETCH_API_KEY=bf_...
export BETTER_FETCH_API_URL=http://127.0.0.1:8090
npx bf-tool run --example apple-filings
npx bf-tool test
npx bf-tool validate
```
