# instagram-scraper

Public Instagram profile and recent-media scraper for
[Better Fetch](https://betterfetch.co).

Give it an Instagram username or public profile URL. It uses Instagram's public
web profile endpoint through Better Fetch and returns account metadata, bio
links, public counts, and a bounded set of recent visible media cards. It also
supports posts, comments, reels, audio pages, story highlights, embed HTML, and
speech transcripts from public video renditions.

`transcript` accepts a public post or Reel URL, resolves Instagram's public
video rendition, and returns text plus timed segments for up to five minutes of
media. Private, removed, image-only, or non-public media is not bypassed.

## Develop

```sh
npm install
export BETTER_FETCH_API_KEY=bf_...
npx bf-tool run --example openai-profile
npx bf-tool test
npx bf-tool validate
```
