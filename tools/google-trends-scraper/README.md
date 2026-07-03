# google-trends-scraper

Google Trends Daily Search Trends RSS scraper for
[Better Fetch](https://betterfetch.co).

Version 0.1 reads the public Google Trends RSS feed for a country and returns
normalized trending query records with approximate traffic, images, source
labels, timestamps, and related news items. Historical interest-over-time,
regional breakdowns, and related queries/topics are future validated slices.

## Develop

```sh
npm install
export BETTER_FETCH_API_KEY=bf_...
npx bf-tool run --example us-trends
npx bf-tool test
npx bf-tool validate
```
