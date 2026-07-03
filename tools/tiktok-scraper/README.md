# tiktok-scraper

Public TikTok profile metadata scraper for [Better Fetch](https://betterfetch.co).

Give it a TikTok username or public profile URL. It renders the profile through
Better Fetch, reads TikTok's public hydration payload, and returns normalized
profile fields such as username, display name, bio, avatar, follower count,
following count, likes, video count, verification, and bio link.

## Develop

```sh
npm install
export BETTER_FETCH_API_KEY=bf_...
npx bf-tool run --example openai-profile
npx bf-tool test
npx bf-tool validate
```
