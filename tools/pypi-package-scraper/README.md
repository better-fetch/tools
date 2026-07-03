# pypi-package-scraper

Public PyPI package metadata scraper for [Better Fetch](https://betterfetch.co).

Three bounded modes, all using public PyPI JSON surfaces:

- `package` - fetch the latest project metadata and recent release summaries
- `release` - fetch one exact release metadata record and its files
- `files` - fetch the PEP 691 simple-project JSON distribution file list

Returns normalized package names, versions, summaries, authors, maintainers,
licenses, Python requirements, classifiers, dependencies, project URLs, release
counts, upload timestamps, file hashes, yanked flags, provenance URLs, and known
vulnerability summaries for Python ecosystem research and supply-chain workflows.

## Develop

```sh
npm install
export BETTER_FETCH_API_KEY=bf_...
export BETTER_FETCH_API_URL=http://127.0.0.1:8090
npx bf-tool run --example requests-package
npx bf-tool test
npx bf-tool validate
```
