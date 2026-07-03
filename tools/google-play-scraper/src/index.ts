import { defineTool } from "@better-fetch/tools";

type Input = {
  query: string;
  language?: string;
  country?: string;
  max_results?: number;
};

type AppCard = {
  app_id: string;
  title: string;
  developer?: string;
  summary?: string;
  url: string;
  icon?: string;
  rating?: number;
  rating_text?: string;
  reviews_text?: string;
  contains_ads?: boolean;
  in_app_purchases?: boolean;
};

type Output = {
  query: string;
  source_url: string;
  count: number;
  apps: AppCard[];
};

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = decodeEntities(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  return clean || undefined;
}

function tagText(html: string, className: string): string | undefined {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text(html.match(new RegExp(`<[^>]+class=["'][^"']*\\b${escaped}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, "i"))?.[1]);
}

function attr(tag: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const value = tag.match(new RegExp(`${escaped}=["']([^"']*)["']`, "i"))?.[1];
  return value ? decodeEntities(value).trim() : undefined;
}

function cleanLocale(value: string | undefined, fallback: string): string {
  const clean = value?.trim();
  return clean && /^[a-z]{2}(?:-[A-Z]{2})?$/.test(clean) ? clean : fallback;
}

function cleanCountry(value: string | undefined): string {
  const clean = value?.trim().toUpperCase();
  return clean && /^[A-Z]{2}$/.test(clean) ? clean : "US";
}

function compact(card: AppCard): AppCard {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(card)) {
    if (value !== undefined && value !== "") out[key] = value;
  }
  return out as AppCard;
}

function parseCards(html: string, limit: number): AppCard[] {
  const cards: AppCard[] = [];
  const seen = new Set<string>();
  const re = /<a href="\/store\/apps\/details\?id=([^"&]+)"[^>]*aria-label="([^"]+)"[^>]*>[\s\S]*?(?=<a href="\/store\/apps\/details\?id=|<\/section>|<\/c-wiz>)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) && cards.length < limit) {
    const appId = decodeEntities(match[1]);
    if (!appId || seen.has(appId)) continue;
    seen.add(appId);
    const segment = match[0];
    const title = tagText(segment, "vWM94c") ?? decodeEntities(match[2]);
    const iconTag = segment.match(/<img\b[^>]+itemprop=["']image["'][^>]*>/i)?.[0] ?? segment.match(/<img\b[^>]*>/i)?.[0] ?? "";
    const ratingLabel = segment.match(/aria-label=["']Rated ([^"']+)["']/i)?.[1];
    const ratingText = text(ratingLabel);
    cards.push(
      compact({
        app_id: appId,
        title,
        developer: tagText(segment, "LbQbAe"),
        summary: tagText(segment, "omXQ6c"),
        url: `https://play.google.com/store/apps/details?id=${encodeURIComponent(appId)}`,
        icon: attr(iconTag, "src"),
        rating: ratingText ? Number(ratingText.match(/\d+(?:\.\d+)?/)?.[0]) : undefined,
        rating_text: ratingText,
        reviews_text: tagText(segment, "g1rdde"),
        contains_ads: /Contains ads/i.test(segment) || undefined,
        in_app_purchases: /In-app purchases/i.test(segment) || undefined,
      }),
    );
  }
  return cards;
}

export default defineTool<Input, Output>(async (input, bf) => {
  const query = input.query.trim();
  if (!query) throw new Error("query is required");
  const limit = Math.min(input.max_results ?? 10, 50);
  const language = cleanLocale(input.language, "en-US");
  const country = cleanCountry(input.country);
  const params = new URLSearchParams({ q: query, c: "apps", hl: language, gl: country });
  const url = `https://play.google.com/store/search?${params}`;
  const response = await bf.fetch({
    url,
    strategy: "http",
    return_response_text: true,
    include_html: true,
    locale: language,
    extra_headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5",
      "accept-language": `${language},en;q=0.9`,
      "user-agent": "Mozilla/5.0 (compatible; BetterFetchGooglePlayScraper/0.1; +https://betterfetch.co/tools/google_play_scraper)",
    },
  });
  const html = response.body_text?.length ? response.body_text : (response.html ?? "");
  const apps = parseCards(html, limit);
  if (!apps.length) throw new Error("No Google Play app cards were found for this query");
  return {
    query,
    source_url: response.final_url ?? url,
    count: apps.length,
    apps,
  };
});
