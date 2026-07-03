# huggingface-models-scraper

Public Hugging Face model scraper for [Better Fetch](https://betterfetch.co).

Two bounded modes, both using Hugging Face Hub API endpoints:

- `search` - search public Hub models and sort by downloads, likes, or update time
- `details` - fetch one model repo's public metadata and file list

Returns normalized model IDs, authors, task tags, libraries, downloads, likes,
license hints, tags, timestamps, model URLs, and sibling filenames for model
discovery, AI market research, and agent workflows.

## Develop

```sh
npm install
export BETTER_FETCH_API_KEY=bf_...
export BETTER_FETCH_API_URL=http://127.0.0.1:8090
npx bf-tool run --example llama-search
npx bf-tool test
npx bf-tool validate
```
