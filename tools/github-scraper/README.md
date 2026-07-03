# GitHub Scraper

Extract public GitHub repository, profile, repository search, and trending repository metadata.

Version 0.1 uses GitHub's public REST API for repository, profile, and search modes, plus the public GitHub Trending page for trending mode. It returns normalized repository/profile records without requiring a GitHub token. Private repositories, authenticated higher-rate-limit workflows, issue/PR/contributor expansion, and deep pagination are intentionally left for later validated slices.
