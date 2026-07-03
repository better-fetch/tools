# instagram-profile-scraper

Public Instagram profile scraper for [Better Fetch](https://betterfetch.co).

Give it an Instagram username or public profile URL. It calls Instagram's
public web profile endpoint with browser-same-origin headers through Better
Fetch and returns normalized profile metadata, bio links, public counts, and a
small set of recent visible media cards.

## Develop

```sh
npm install
export BETTER_FETCH_API_KEY=bf_...
npx bf-tool run --example openai-profile
npx bf-tool test
npx bf-tool validate
```
