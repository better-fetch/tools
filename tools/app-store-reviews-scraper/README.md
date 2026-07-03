# App Store Reviews Scraper

Extract public Apple App Store review rows from Apple's iTunes Store customer-reviews API (the `userReviewsRow` endpoint that backs the App Store's own review pages; the retired iTunes customer-reviews RSS feed no longer returns entries).

Version 0.1 reads one public review page (50 most-recent reviews per page, storefront selected per country) for a numeric App Store ID or App Store URL and returns review IDs, titles, body text, star ratings, authors, author profile URLs, publication dates, vote counts, and the app's reviews URL. Per-review app versions are no longer exposed by Apple's public API. Multi-country fan-out, all-page pagination orchestration, app-name discovery, and authenticated App Store Connect review workflows are intentionally left for later validated slices.
