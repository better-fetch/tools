# youtube-transcript

Public YouTube transcript extractor for [Better Fetch](https://betterfetch.co).

Give it a YouTube video URL or ID and it returns the full transcript — both
timestamped caption segments and a single joined text block — by reading the
video's public caption tracks through the Better Fetch stealth engine. Prefers a
manual track in your requested language and falls back to auto-generated (ASR)
captions.

Ideal as an input to summarization, RAG indexing, and content-repurposing
workflows. No media download.

## Develop

```sh
npm install
export BETTER_FETCH_API_KEY=bf_...
npx bf-tool run --example transcript-by-url
npx bf-tool test
npx bf-tool validate
```
