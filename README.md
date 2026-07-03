# Better Fetch Tools

First-party tools for the [Better Fetch](https://betterfetch.co) marketplace.
Every directory under [`tools/`](tools/) is one tool: a `betterfetch.tool.json`
manifest plus a `src/index.ts` entry that exports a single
`defineTool(async (input, bf) => output)` function. The `bf` host object is the
tool's only capability — it calls the Better Fetch engine (stealth browser
rendering, sessions, geo-emulation, network capture) and bills the caller's
API key per engine call.

Browse and run these tools at [betterfetch.co/tools](https://betterfetch.co/tools),
or call them through the [MCP server](https://betterfetch.co/mcp).

## Run a tool yourself

Fork this repo (or copy a tool directory), then:

```bash
npm install
cd tools/github-scraper
BETTER_FETCH_API_KEY=bf_... npx bf-tool run --example react-repo
```

You need a Better Fetch API key — the free tier at
[betterfetch.co](https://betterfetch.co) works. `npx bf-tool test` runs every
example in the manifest and checks outputs.

## Build your own tool

Start from [better-fetch/tool-template](https://github.com/better-fetch/tool-template)
("Use this template"). The manifest schema, the constrained input/output JSON
Schema subset, and the `bf` host API are documented in
[better-fetch/tools-sdk](https://github.com/better-fetch/tools-sdk).

Third-party publishing into the marketplace is not open yet; tools published
from this repository are Better Fetch first-party. Watch
[betterfetch.co/blog](https://betterfetch.co/blog) for the community
marketplace.

## How publishing works (maintainers)

Push to `main` touching `tools/<name>/` and CI runs that tool through
validate → bundle → live example runs → publish to the registry. Green CI is
the production gate; nothing goes live without its examples passing against
the production engine. See [.github/workflows/publish.yml](.github/workflows/publish.yml).

## License

[MIT](LICENSE)
