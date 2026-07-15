# twitter-search

Public X/Twitter profile metadata scraper for [Better Fetch](https://betterfetch.co).

Give it an X/Twitter handle or profile URL. It renders the public profile page
through Better Fetch, reads the JSON-LD profile payload and meta tags, and
returns normalized profile fields such as handle, display name, bio, user id,
joined date, avatar, banner image, follower count, following count, post count,
and public profile URL.

The tool also reads visible profile posts, individual posts, public Community
metadata and Community posts. `transcript` resolves X's public syndication
payload, selects the best MP4 rendition expected to fit Better Fetch's media
ceiling, and returns locally generated speech text plus timed segments. Posts
without a public MP4 fail explicitly.

## Develop

```sh
npm install
export BETTER_FETCH_API_KEY=bf_...
npx bf-tool run --example openai-profile
npx bf-tool test
npx bf-tool validate
```
