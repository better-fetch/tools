# openrouter-models-pricing-scraper

Public OpenRouter model catalog scraper for [Better Fetch](https://betterfetch.co).

Reads OpenRouter's public model catalog endpoint and returns bounded,
normalized model pricing and capability rows:

- filter by free-text query, provider prefix, modality, minimum context length,
  max prompt price, max completion price, or free-only status
- sort by newest, name, context length, prompt price, or completion price
- return normalized USD-per-million-token prices, context windows, modalities,
  tokenizer, supported parameters, provider limits, and model URLs

## Develop

```sh
npm install
export BETTER_FETCH_API_KEY=bf_...
export BETTER_FETCH_API_URL=http://127.0.0.1:8090
npx bf-tool run --example free-text-models
npx bf-tool test
npx bf-tool validate
```
