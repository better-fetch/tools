# tiktok-scraper

Public TikTok research scraper for [Better Fetch](https://betterfetch.co).

Give it a TikTok username or public profile URL. It renders the profile through
Better Fetch, reads TikTok's public hydration payload, and returns normalized
profile fields such as username, display name, bio, avatar, follower count,
following count, likes, video count, verification, and bio link.

The tool also covers public follower and following lists with min-time
pagination, profile videos, individual videos and caption tracks, comments and
replies, user and video discovery, live status, music pages, and the public
Explore feed. Relationship modes resolve the account's public `secUid` first
and return only the list TikTok exposes for that account; private or restricted
relationships are never inferred.

`audience_demographics` samples up to 200 public followers and reports only
countries those followers explicitly self-declare in a bio via a supported
country name or flag. It reports located and unlocated sample sizes and always
sets `representative: false`. It never maps language, city, IP, or video region
to a country and is not a substitute for TikTok's private audience analytics.

## Develop

```sh
npm install
export BETTER_FETCH_API_KEY=bf_...
npx bf-tool run --example openai-profile
npx bf-tool run --example following
npx bf-tool run --example followers
npx bf-tool test
npx bf-tool validate
```
