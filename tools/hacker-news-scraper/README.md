# Hacker News Scraper

Search Hacker News stories/comments, inspect an item thread, or fetch public user metadata through the public HN Algolia and Firebase APIs.

Version 0.1 uses the HN Algolia API for search and item/thread detail, plus the official Hacker News Firebase API for public user metadata. It returns normalized story, comment, item, and user records without requiring a login or API key. Full recursive archive export, historical page-by-page crawling, saved-item access, and every-comment pagination are intentionally left for later validated slices.
