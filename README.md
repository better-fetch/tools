# Better Fetch tools — ready-made web data for AI

First-party tools for the [Better Fetch](https://betterfetch.co) marketplace.
Every directory under [`tools/`](tools/) is one tool: a `betterfetch.tool.json`
manifest plus a `src/index.ts` entry that exports a single
`defineTool(async (input, bf) => output)` function. The `bf` host object is the
tool's only capability — it calls the Better Fetch engine (stealth browser
rendering, sessions, geo-emulation, network capture) and bills the caller's
API key per engine call.

Browse them at [betterfetch.co/tools](https://betterfetch.co/tools). In Claude,
ChatGPT, Codex, or another MCP client, call `search_tools` to find a capability,
then pass its exact name and input to `run_tool`. The catalogue can grow without
loading every specialist schema into the default agent tool surface.

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

Third-party publishing into the hosted catalogue is not open yet; tools in this
repository are Better Fetch first-party. The public SDK and template can still
be used for local tools today. Watch
[betterfetch.co/blog](https://betterfetch.co/blog) for the community
marketplace.

## How publishing works (maintainers)

Push to `main` touching `tools/<name>/` and CI runs that tool through
validate → bundle → live example runs → publish to the registry. Green CI is
the production gate; nothing goes live without its examples passing against
the production engine. See [.github/workflows/publish.yml](.github/workflows/publish.yml).

## License

[MIT](LICENSE)
