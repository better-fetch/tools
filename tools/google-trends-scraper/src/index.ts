import { defineTool } from "@better-fetch/tools";

type Input = {
  country?: string;
  max_results?: number;
};

type NewsItem = {
  query: string;
  title: string;
  url: string;
  source?: string;
  picture?: string;
  snippet?: string;
};

type Trend = {
  query: string;
  approx_traffic?: string;
  published_at?: string;
  link?: string;
  picture?: string;
  picture_source?: string;
  news_count?: number;
};

type Output = {
  country: string;
  source_url: string;
  count: number;
  trends: Trend[];
  news_items?: NewsItem[];
};

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function tagValue(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  const value = match?.[1] ? decodeEntities(match[1]).replace(/\s+/g, " ").trim() : "";
  return value || undefined;
}

function toIsoDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : value;
}

function cleanCountry(value: string | undefined): string {
  const clean = value?.trim().toUpperCase();
  return clean && /^[A-Z]{2}$/.test(clean) ? clean : "US";
}

function compactNews(item: NewsItem): NewsItem {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(item)) {
    if (value !== undefined && value !== "") out[key] = value;
  }
  return out as NewsItem;
}

function compactTrend(trend: Trend): Trend {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(trend)) {
    if (value !== undefined && value !== "" && (!Array.isArray(value) || value.length > 0)) out[key] = value;
  }
  return out as Trend;
}

function parseNewsItems(itemXml: string, query: string): NewsItem[] {
  const blocks = itemXml.match(/<ht:news_item\b[\s\S]*?<\/ht:news_item>/gi) ?? [];
  const items: NewsItem[] = [];
  const seen = new Set<string>();
  for (const block of blocks) {
    const title = tagValue(block, "ht:news_item_title");
    const url = tagValue(block, "ht:news_item_url");
    if (!title || !url || seen.has(url)) continue;
    seen.add(url);
    items.push(
      compactNews({
        query,
        title,
        url,
        source: tagValue(block, "ht:news_item_source"),
        picture: tagValue(block, "ht:news_item_picture"),
        snippet: tagValue(block, "ht:news_item_snippet"),
      }),
    );
  }
  return items;
}

function parseFeed(xml: string, limit: number): { trends: Trend[]; newsItems: NewsItem[] } {
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  const trends: Trend[] = [];
  const newsItems: NewsItem[] = [];
  const seen = new Set<string>();
  for (const block of blocks) {
    const query = tagValue(block, "title");
    if (!query || seen.has(query.toLowerCase())) continue;
    seen.add(query.toLowerCase());
    const relatedNews = parseNewsItems(block, query);
    newsItems.push(...relatedNews);
    trends.push(
      compactTrend({
        query,
        approx_traffic: tagValue(block, "ht:approx_traffic"),
        published_at: toIsoDate(tagValue(block, "pubDate")),
        link: tagValue(block, "link"),
        picture: tagValue(block, "ht:picture"),
        picture_source: tagValue(block, "ht:picture_source"),
        news_count: relatedNews.length || undefined,
      }),
    );
    if (trends.length >= limit) break;
  }
  return { trends, newsItems };
}

export default defineTool<Input, Output>(async (input, bf) => {
  const country = cleanCountry(input.country);
  const limit = Math.min(input.max_results ?? 10, 50);
  const url = `https://trends.google.com/trending/rss?geo=${encodeURIComponent(country)}`;
  const response = await bf.fetch({
    url,
    strategy: "http",
    return_response_text: true,
    locale: "en-US",
    extra_headers: {
      accept: "application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.5",
      "accept-language": "en-US,en;q=0.9",
      "user-agent": "Mozilla/5.0 (compatible; BetterFetchGoogleTrendsScraper/0.1; +https://betterfetch.co/tools/google_trends_scraper)",
    },
  });
  const xml = response.body_text ?? "";
  const { trends, newsItems } = parseFeed(xml, limit);
  if (!trends.length) throw new Error("No Google Trends RSS items were found for this country");
  return {
    country,
    source_url: response.final_url ?? url,
    count: trends.length,
    trends,
    ...(newsItems.length ? { news_items: newsItems.slice(0, limit * 3) } : {}),
  };
});
