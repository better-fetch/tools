# twitter-search

Public X/Twitter profile metadata scraper for [Better Fetch](https://betterfetch.co).

Give it an X/Twitter handle or profile URL. It renders the public profile page
through Better Fetch, reads the JSON-LD profile payload and meta tags, and
returns normalized profile fields such as handle, display name, bio, user id,
joined date, avatar, banner image, follower count, following count, post count,
and public profile URL.

Version 0.1 intentionally covers profile metadata only. Tweet search, latest
posts, replies, and timeline pagination should be added as separately validated
slices before this tool is marked as full production search coverage.

## Develop

```sh
npm install
export BETTER_FETCH_API_KEY=bf_...
npx bf-tool run --example openai-profile
npx bf-tool test
npx bf-tool validate
```
