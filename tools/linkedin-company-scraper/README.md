# linkedin-company-scraper

Public LinkedIn company profile scraper for [Better Fetch](https://betterfetch.co).

Give it a LinkedIn company slug or public company URL. It fetches the public
guest company page and returns normalized company profile fields such as name,
description, website, industry, company size, headquarters, type, follower
count, logo, and recent public company posts when LinkedIn exposes them.

Version 0.1 focuses on the public company profile page. Employee lists,
deep company enrichment, affiliated pages, and full post engagement metrics
should be added as separately validated slices.

## Develop

```sh
npm install
export BETTER_FETCH_API_KEY=bf_...
npx bf-tool run --example openai-company
npx bf-tool test
npx bf-tool validate
```
