# July 2026 catalog expansion

The selection rule for this release is: add bounded, repeatable web-data jobs
that an AI agent can configure once, rerun, inspect, and export. The release
leans toward retrieval primitives and reliable public sources rather than
duplicating the social scrapers already in the catalog.

Market signals used:

- Apify describes web scrapers, search engines, e-commerce data, social data,
  and general-purpose crawlers as core Actor categories, with structured
  outputs and scheduled automation as the operating model.
- Bright Data's current marketplace prominently features business,
  e-commerce, job, and social datasets; Amazon, LinkedIn, Glassdoor, eBay,
  Walmart, and Shopify-class sources dominate visible demand.
- Firecrawl treats search, scrape, map, crawl, and structured extraction as
  separate agent primitives. Its map workflow specifically turns one URL into
  a site URL inventory for downstream selection and scraping.
- Better Fetch already covers the highest-risk social and lead sources. The
  most valuable adjacent gap is therefore reusable discovery, metadata,
  monitoring, developer, security, market, and storefront data.

Primary references:

- https://docs.apify.com/academy/build-and-publish/actor-ideas/find-actor-ideas
- https://docs.apify.com/academy/actor-marketing-playbook/store-basics/how-store-works
- https://brightdata.com/products/datasets
- https://docs.firecrawl.dev/features/map
- https://docs.firecrawl.dev/features/search

## Release slate

| Tool | Job | Why it belongs |
|---|---|---|
| Sitemap Extractor | Sitemap URL inventory | Crawl planning and content selection |
| Robots.txt Analyzer | Crawl-policy records | Safer agent retrieval |
| RSS and Atom Feed Scraper | Feed normalization | Repeat news and monitoring workflows |
| Open Graph Extractor | Social and canonical metadata | Agent citations, previews, enrichment |
| JSON-LD Extractor | Structured page data | Schema-first extraction without custom selectors |
| Webpage Links Extractor | Internal/external link graph | Discovery and research queues |
| Website Technology Detector | Stack evidence | Technical research and lead enrichment |
| Webpage Change Fingerprint | Stable content fingerprint | Scheduled change monitoring |
| GitHub Releases Scraper | Release records | Dependency and vendor monitoring |
| GitHub Issues Scraper | Issue records | Engineering research without API quota dependence |
| GitHub Trending Scraper | Trending repository records | Developer and AI ecosystem discovery |
| Stack Exchange Search | Question records | Technical research |
| DEV Community Articles Scraper | Current developer content | Topic and ecosystem monitoring |
| crates.io Package Scraper | Rust package metadata | Supply-chain research |
| RubyGems Package Scraper | Ruby package metadata | Supply-chain research |
| CISA KEV Scraper | Exploited vulnerability records | Security triage and monitoring |
| DBLP Publication Search | CS publication records | Reliable academic discovery |
| Kraken Crypto Market Scraper | Public ticker records | Current market workflows |
| Shopify Store Scraper | Public storefront products | E-commerce research and exports |
| WordPress Posts Scraper | Public CMS content | Broad publishing and monitoring coverage |

Every tool is constrained to one Better Fetch engine call, includes a live
example assertion, and publishes only through the repository's
validate → bundle → live example → ingest pipeline.
