# instagram-scraper

Public Instagram profile and recent-media scraper for
[Better Fetch](https://betterfetch.co).

Give it an Instagram username or public profile URL. It uses Instagram's public
web profile endpoint through Better Fetch and returns account metadata, bio
links, public counts, and a bounded set of recent visible media cards.

## Develop

```sh
npm install
export BETTER_FETCH_API_KEY=bf_...
npx bf-tool run --example openai-profile
npx bf-tool test
npx bf-tool validate
```
