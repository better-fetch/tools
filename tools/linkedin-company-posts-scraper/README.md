# linkedin-company-posts-scraper

Public LinkedIn company posts scraper for [Better Fetch](https://betterfetch.co).

Give it a LinkedIn company slug or public company URL. It fetches the public
guest company page and returns recent public company posts from LinkedIn's
structured data, including URL, text, author name, and published timestamp.

Version 0.1 uses the public company page only. Deep pagination, reaction
counts, comments, media attachment expansion, and logged-in activity feeds
should be added as separately validated slices.

## Develop

```sh
npm install
export BETTER_FETCH_API_KEY=bf_...
npx bf-tool run --example openai-posts
npx bf-tool test
npx bf-tool validate
```
