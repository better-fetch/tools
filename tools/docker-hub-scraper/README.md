# docker-hub-scraper

Public Docker Hub scraper for [Better Fetch](https://betterfetch.co).

Three bounded modes, all using Docker Hub JSON endpoints:

- `search` - search public Docker Hub repositories by keyword
- `repository` - fetch one repository's public metadata by name or URL
- `tags` - fetch one page of repository tag metadata

Returns normalized repository names, namespaces, pull counts, stars, official and
automated flags, descriptions, update timestamps, repository URLs, and tag rows
with size, digest, architecture, OS, and last-updated metadata.

## Develop

```sh
npm install
export BETTER_FETCH_API_KEY=bf_...
export BETTER_FETCH_API_URL=http://127.0.0.1:8090
npx bf-tool run --example nginx-search
npx bf-tool test
npx bf-tool validate
```
