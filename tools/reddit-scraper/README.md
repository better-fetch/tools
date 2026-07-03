# reddit-scraper

Public Reddit scraper for [Better Fetch](https://betterfetch.co).

Three modes, all reading Reddit's official public JSON views through the Better
Fetch stealth engine:

- `posts` — a subreddit's `hot` / `new` / `top` / `rising` feed
- `search` — a keyword search across Reddit or restricted to one subreddit
- `comments` — a submission plus a flattened, depth-tagged slice of its thread

Returns normalized submissions (title, author, score, upvote ratio, comment
count, permalink, flair) and comments (author, body, score, depth). Requests
escalate through a residential proxy automatically when Reddit rate-limits the
direct path.

## Develop

```sh
npm install
export BETTER_FETCH_API_KEY=bf_...
npx bf-tool run --example subreddit-hot
npx bf-tool test
npx bf-tool validate
```
