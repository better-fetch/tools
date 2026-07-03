import { defineTool } from "@better-fetch/tools";

type Input = {
  query: string;
  language?: string;
  country?: string;
  max_results?: number;
};

type Article = {
  title: string;
  source?: string;
  source_url?: string;
  link: string;
  guid?: string;
  published_at?: string;
};

type Output = {
  query: string;
  source_url: string;
  count: number;
  articles: Article[];
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

function tagAttrs(xml: string, tag: string): string {
  return xml.match(new RegExp(`<${tag}\\s+([^>]*)>`, "i"))?.[1] ?? "";
}

function attr(attrs: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = attrs.match(new RegExp(`${escaped}=["']([^"']*)["']`, "i"));
  return match?.[1] ? decodeEntities(match[1]).trim() : undefined;
}

function toIsoDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : value;
}

function cleanLocale(value: string | undefined, fallback: string): string {
  const clean = value?.trim();
  return clean && /^[a-z]{2}(?:-[A-Z]{2})?$/.test(clean) ? clean : fallback;
}

function cleanCountry(value: string | undefined): string {
  const clean = value?.trim().toUpperCase();
  return clean && /^[A-Z]{2}$/.test(clean) ? clean : "US";
}

function compactArticle(article: Article): Article {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(article)) {
    if (value !== undefined && value !== "") out[key] = value;
  }
  return out as Article;
}

function parseFeed(xml: string, limit: number): Article[] {
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  const articles: Article[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const title = tagValue(item, "title");
    const link = tagValue(item, "link");
    if (!title || !link || seen.has(link)) continue;
    seen.add(link);
    const sourceAttrs = tagAttrs(item, "source");
    articles.push(
      compactArticle({
        title,
        source: tagValue(item, "source"),
        source_url: attr(sourceAttrs, "url"),
        link,
        guid: tagValue(item, "guid"),
        published_at: toIsoDate(tagValue(item, "pubDate")),
      }),
    );
    if (articles.length >= limit) break;
  }
  return articles;
}

export default defineTool<Input, Output>(async (input, bf) => {
  const query = input.query.trim();
  if (!query) throw new Error("query is required");
  const limit = Math.min(input.max_results ?? 10, 50);
  const language = cleanLocale(input.language, "en-US");
  const country = cleanCountry(input.country);
  const languageCode = language.split("-")[0] ?? "en";
  const params = new URLSearchParams({
    q: query,
    hl: language,
    gl: country,
    ceid: `${country}:${languageCode}`,
  });
  const url = `https://news.google.com/rss/search?${params}`;
  const response = await bf.fetch({
    url,
    strategy: "http",
    return_response_text: true,
    locale: language,
    extra_headers: {
      accept: "application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.5",
      "accept-language": `${language},${languageCode};q=0.9`,
      "user-agent": "Mozilla/5.0 (compatible; BetterFetchGoogleNewsScraper/0.1; +https://betterfetch.co/tools/google_news_scraper)",
    },
  });
  const xml = response.body_text ?? "";
  const articles = parseFeed(xml, limit);
  if (!articles.length) throw new Error("No Google News RSS articles were found for this query");
  return {
    query,
    source_url: response.final_url ?? url,
    count: articles.length,
    articles,
  };
});
