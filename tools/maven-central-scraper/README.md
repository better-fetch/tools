# maven-central-scraper

Public Maven Central package scraper for [Better Fetch](https://betterfetch.co).

Two bounded modes, both using the official Maven Central Solr search API:

- `search` - search packages by keyword, group ID, artifact ID, packaging, classifier, or SHA-1
- `versions` - list recent version rows for one exact group ID and artifact ID

Returns normalized Maven coordinates, package URLs, latest versions, packaging
types, version counts, repository IDs, timestamps, file extensions, and version
history rows for JVM dependency research, package discovery, developer tooling,
and supply-chain inventory.

## Develop

```sh
npm install
export BETTER_FETCH_API_KEY=bf_...
export BETTER_FETCH_API_URL=http://127.0.0.1:8090
npx bf-tool run --example spring-search
npx bf-tool test
npx bf-tool validate
```
