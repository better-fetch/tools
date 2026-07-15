# Truth Social Scraper

Retrieve one public Truth Social post as normalized JSON. The tool starts with the platform's public Mastodon-compatible API and lets Better Fetch recover the request when ordinary HTTP cannot reach it. Account lookup and profile timelines remain unbound until their logged-out Cloudflare route is reliable.

```bash
bf-tool run --example truth-social-post
bf-tool test
```
