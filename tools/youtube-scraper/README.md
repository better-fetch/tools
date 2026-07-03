# youtube-scraper

Public YouTube video metadata scraper for [Better Fetch](https://betterfetch.co).

Run a search query or fetch the public videos tab for a YouTube channel URL. The
tool renders YouTube through Better Fetch, parses public `ytInitialData`, and
returns normalized video cards for agent research, monitoring, and content
briefs.

## Develop

```sh
npm install
export BETTER_FETCH_API_KEY=bf_...
npx bf-tool run --example search-openai
npx bf-tool test
npx bf-tool validate
```
