# Facebook Ad Library Scraper

Search Meta's public Ad Library, group results by advertiser, list a company's
public ads, inspect one public ad, or transcribe the speech in its public video
creative without a Facebook login.

`ad_transcript` first resolves the public creative from Meta, then uses Better
Fetch's locally hosted media transcription capability. Image-only, expired, or
unavailable ads return an explicit error instead of a guessed transcript.
