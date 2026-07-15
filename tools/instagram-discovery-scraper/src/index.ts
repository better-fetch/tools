import { defineTool } from "@better-fetch/tools";

type Input = {
  mode: "hashtag" | "profiles" | "reels" | "trending_reels";
  hashtag?: string;
  query?: string;
  media_type?: "all" | "reels";
  date_posted?: "last-hour" | "last-day" | "last-week" | "last-month" | "last-year";
  cursor?: string;
  max_results?: number;
  country?: string;
};

type Result = {
  title: string;
  url: string;
  snippet?: string;
  shortcode?: string;
  username?: string;
  matched_from?: "profile" | "caption";
};

type Output = {
  mode: "hashtag" | "profiles" | "reels" | "trending_reels";
  source_url: string;
  query: string;
  count: number;
  hashtag?: string;
  media_type?: "all" | "reels";
  date_posted?: Input["date_posted"];
  results: Result[];
  next_cursor?: string;
  ranking_basis?: "public_search_recency_rank";
};

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)));
}

function stripTags(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function parseSerp(html: string, limit: number): Array<{ title: string; url: string; snippet?: string }> {
  const results: Array<{ title: string; url: string; snippet?: string }> = [];
  const seen = new Set<string>();
  const links = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>(?:(?!<\/a>).)*?<h3[^>]*>((?:(?!<\/h3>).)*)<\/h3>/gs;
  let match: RegExpExecArray | null;
  while ((match = links.exec(html)) && results.length < limit) {
    let url = decodeEntities(match[1]);
    const redirect = url.match(/[?&]q=(https?[^&]+)/);
    if (redirect) url = decodeURIComponent(redirect[1]);
    if (!/^https?:\/\/(?:www\.)?instagram\.com\//i.test(url)) continue;
    const canonical = url.replace(/[?#].*$/, "");
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    const tail = html.slice(match.index + match[0].length, match.index + match[0].length + 3000);
    const snippetMatch = tail.match(/<(?:div|span)[^>]*(?:data-sncf|class="[^"]*(?:VwiC3b|IsZvec)[^"]*")[^>]*>((?:(?!<\/(?:div|span)>).)*)/s);
    const snippet = snippetMatch ? stripTags(snippetMatch[1]).slice(0, 500) : undefined;
    results.push({ title: stripTags(match[2]), url: canonical, snippet });
  }
  return results;
}

function pageNumber(cursor: string | undefined): number {
  if (!cursor) return 1;
  const page = Number(cursor);
  if (!Number.isInteger(page) || page < 1 || page > 10) throw new Error("cursor must be a page number from 1 to 10");
  return page;
}

const dateFilters: Record<NonNullable<Input["date_posted"]>, string> = {
  "last-hour": "qdr:h",
  "last-day": "qdr:d",
  "last-week": "qdr:w",
  "last-month": "qdr:m",
  "last-year": "qdr:y",
};

export default defineTool<Input, Output>(async (input, bf) => {
  const limit = Math.min(Math.max(input.max_results ?? 10, 1), 20);
  const page = pageNumber(input.cursor);
  const mediaType = input.media_type ?? "all";
  let query: string;
  let hashtag: string | undefined;
  if (input.mode === "hashtag") {
    hashtag = input.hashtag?.trim().replace(/^#/, "");
    if (!hashtag || !/^[\p{L}\p{N}_.-]{1,100}$/u.test(hashtag)) throw new Error("hashtag is required for hashtag mode");
    query = mediaType === "reels"
      ? `site:instagram.com/reel/ ${hashtag}`
      : `(site:instagram.com/reel/ OR site:instagram.com/p/) ${hashtag}`;
  } else if (input.mode === "profiles") {
    const phrase = input.query?.trim();
    if (!phrase) throw new Error("query is required for profiles mode");
    query = `site:instagram.com ${phrase} -inurl:reel -inurl:/p/`;
  } else if (input.mode === "reels") {
    const phrase = input.query?.trim();
    if (!phrase) throw new Error("query is required for reels mode");
    query = `site:instagram.com/reel/ ${phrase}`;
  } else {
    query = "site:instagram.com/reel/";
  }
  const requestedFilter = input.date_posted ? dateFilters[input.date_posted] : undefined;
  const filters = input.mode === "trending_reels"
    ? ["qdr:d", "qdr:w", "qdr:m"]
    : [requestedFilter];
  let sourceUrl = "";
  let finalUrl = "";
  let serp: Array<{ title: string; url: string; snippet?: string }> = [];
  let usedFilter = requestedFilter;
  for (const filter of filters) {
    const dateFilter = filter ? `&tbs=${filter}` : "";
    sourceUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${Math.min(limit + 5, 30)}&start=${(page - 1) * 10}&hl=en${dateFilter}`;
    const response = await bf.fetch({
      url: sourceUrl,
      include_html: true,
      strategy: "browser",
      wait_until: "domcontentloaded",
      wait_ms: 1500,
      proxy: "auto",
      ...(input.country ? { country: input.country, geoip: true } : {}),
    });
    finalUrl = response.final_url ?? sourceUrl;
    serp = parseSerp(response.html ?? response.body_text ?? "", limit * 2);
    usedFilter = filter;
    if (serp.length) break;
  }
  const results: Result[] = [];
  for (const item of serp) {
    const path = item.url.match(/^https?:\/\/(?:www\.)?instagram\.com\/([^?#]+)/i)?.[1]?.replace(/\/$/, "");
    if (!path) continue;
    const segments = path.split("/").filter(Boolean);
    const postIndex = segments.findIndex((segment) => segment === "reel" || segment === "p");
    if (input.mode === "hashtag" || input.mode === "reels" || input.mode === "trending_reels") {
      if (postIndex < 0 || !segments[postIndex + 1]) continue;
      if ((input.mode === "reels" || input.mode === "trending_reels" || mediaType === "reels") && segments[postIndex] !== "reel") continue;
      results.push({ ...item, shortcode: segments[postIndex + 1], username: postIndex > 0 ? segments[0] : undefined, matched_from: "caption" });
    } else {
      const titleUsername = item.title.match(/\(@([A-Za-z0-9._]+)\)/)?.[1];
      const isPost = postIndex >= 0;
      const username = isPost ? titleUsername ?? (postIndex > 0 ? segments[0] : undefined) : segments[0];
      if (!username || ["reel", "p", "explore", "accounts"].includes(username.toLowerCase())) continue;
      results.push({ ...item, username, matched_from: isPost ? "caption" : "profile", url: `https://www.instagram.com/${username}/` });
    }
    if (results.length >= limit) break;
  }
  if (!results.length) throw new Error("Google returned no indexed public Instagram matches");
  return {
    mode: input.mode,
    source_url: finalUrl || sourceUrl,
    query: input.mode === "hashtag" ? hashtag as string : input.mode === "trending_reels" ? "public Instagram reels" : input.query!.trim(),
    count: results.length,
    hashtag,
    media_type: input.mode === "hashtag" ? mediaType : input.mode === "reels" || input.mode === "trending_reels" ? "reels" : undefined,
    date_posted: input.mode === "reels" ? input.date_posted : input.mode === "trending_reels" ? ({ "qdr:d": "last-day", "qdr:w": "last-week", "qdr:m": "last-month" } as const)[usedFilter as "qdr:d" | "qdr:w" | "qdr:m"] : undefined,
    results,
    next_cursor: page < 10 ? String(page + 1) : undefined,
    ranking_basis: input.mode === "trending_reels" ? "public_search_recency_rank" : undefined,
  };
});
