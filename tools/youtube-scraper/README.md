# youtube-scraper

Public YouTube video metadata scraper for [Better Fetch](https://betterfetch.co).

Search YouTube, inspect channel tabs, videos, playlists, community posts,
sponsor evidence, logged-out public video comments, or a parent comment's
public replies. The
tool renders YouTube through Better Fetch, parses public page and network data,
and returns normalized records for agent research, monitoring, and content
briefs.

`video_comments` scrolls the rendered public watch page to YouTube's comments
section and parses the public request the page makes itself. `comment_replies`
opens a public parent-comment permalink, expands its first visible reply
control, and parses the public continuation response triggered by that click.
Both return normalized author, engagement, permalink, and continuation
evidence without logging in or posting directly to private APIs.

## Develop

```sh
npm install
export BETTER_FETCH_API_KEY=bf_...
npx bf-tool run --example search-openai
npx bf-tool test
npx bf-tool validate
```
