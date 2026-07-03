# Stack Overflow Scraper

Search Stack Overflow questions and optionally fetch accepted/top answers through the public Stack Exchange API.

Version 0.1 uses the Stack Exchange `/search/advanced` endpoint for question search and the batched `/questions/{ids}/answers` endpoint when answer rows are requested. It returns normalized public question and answer records without requiring a Stack Apps key. Comments, user profile enrichment, cross-site discovery, full pagination, and authenticated higher-quota workflows are intentionally left for later validated slices.
