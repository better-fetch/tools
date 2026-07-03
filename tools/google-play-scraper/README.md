# google-play-scraper

Google Play keyword app-search scraper for [Better Fetch](https://betterfetch.co).

Version 0.1 searches public Google Play app results and returns normalized app
cards: app ID, title, developer, summary, icon, rating, review label, store URL,
and visible monetization labels. Deep app detail fields and reviews are future
validated slices.

## Develop

```sh
npm install
export BETTER_FETCH_API_KEY=bf_...
npx bf-tool run --example openai-apps
npx bf-tool test
npx bf-tool validate
```
