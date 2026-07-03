# linkedin-jobs-scraper

Public LinkedIn jobs search scraper for [Better Fetch](https://betterfetch.co).

Give it a LinkedIn jobs search URL, or provide keywords and location. It fetches
the public guest jobs search page and returns normalized job cards with title,
company, company URL, location, listed date, job URL, logo, and visible benefits
text.

Version 0.1 focuses on LinkedIn's public guest search cards. Full job
descriptions, recruiter profiles, company enrichment, and logged-in filters
should be added as separately validated slices.

## Develop

```sh
npm install
export BETTER_FETCH_API_KEY=bf_...
npx bf-tool run --example openai-jobs
npx bf-tool test
npx bf-tool validate
```
