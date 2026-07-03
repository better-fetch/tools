import { defineTool } from "@better-fetch/tools";

type Input = {
  app_id_or_url: string;
  language?: string;
  country?: string;
  max_reviews?: number;
};

type Review = {
  review_id: string;
  reviewer?: string;
  rating?: number;
  date?: string;
  body?: string;
  helpful_count?: number;
  user_image?: string;
};

type Output = {
  app_id: string;
  app_title?: string;
  developer?: string;
  rating?: number;
  rating_count?: number;
  source_url: string;
  count: number;
  reviews: Review[];
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

function appIdFrom(input: string): string {
  const value = input.trim();
  if (/^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)+$/.test(value)) return value;
  try {
    const url = new URL(value);
    const id = url.searchParams.get("id")?.trim();
    if (id && /^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)+$/.test(id)) return id;
  } catch {
    // Fall through to the user-facing validation error below.
  }
  throw new Error("app_id_or_url must be a Google Play package ID or details URL with an id parameter");
}

function compactReview(review: Review): Review {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(review)) {
    if (value !== undefined && value !== "") out[key] = value;
  }
  return out as Review;
}

function compactOutput(output: Output): Output {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(output)) {
    if (value !== undefined && value !== "") out[key] = value;
  }
  return out as Output;
}

function parseHelpfulCount(value: string | undefined): number | undefined {
  const match = value?.match(/([\d,]+) people found this review helpful/i)?.[1];
  return match ? Number(match.replace(/,/g, "")) : undefined;
}

function parseSchema(html: string): Partial<Output> {
  const rawJson = html.match(/<script\b[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (!rawJson) return {};
  try {
    const schema = JSON.parse(decodeEntities(rawJson)) as Record<string, unknown>;
    const aggregateRating =
      schema.aggregateRating && typeof schema.aggregateRating === "object"
        ? (schema.aggregateRating as Record<string, unknown>)
        : {};
    return {
      app_title: typeof schema.name === "string" ? schema.name : undefined,
      developer:
        schema.author && typeof schema.author === "object" && typeof (schema.author as Record<string, unknown>).name === "string"
          ? ((schema.author as Record<string, unknown>).name as string)
          : undefined,
      rating:
        typeof aggregateRating.ratingValue === "string" || typeof aggregateRating.ratingValue === "number"
          ? Number(aggregateRating.ratingValue)
          : undefined,
      rating_count:
        typeof aggregateRating.ratingCount === "string" || typeof aggregateRating.ratingCount === "number"
          ? Number(aggregateRating.ratingCount)
          : undefined,
    };
  } catch {
    return {};
  }
}

function parseReviews(html: string, limit: number): Review[] {
  const reviews: Review[] = [];
  const seen = new Set<string>();
  const re = /<div class="EGFGHd"[\s\S]*?data-review-id="([^"]+)"[\s\S]*?(?=<div class="EGFGHd"\s|<div class="NHV5Cb"|<div class="RfOaib"|<\/section>)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) && reviews.length < limit) {
    const reviewId = decodeEntities(match[1]);
    if (!reviewId || seen.has(reviewId)) continue;
    seen.add(reviewId);
    const segment = match[0];
    const ratingLabel = segment.match(/aria-label=["']Rated (\d+) stars out of five stars["']/i)?.[1];
    const avatarTag =
      segment.match(/<img\b[^>]+class=["'][^"']*\babYEib\b[^"']*["'][^>]*>/i)?.[0] ?? "";
    reviews.push(
      compactReview({
        review_id: reviewId,
        reviewer: tagText(segment, "X5PpBb"),
        rating: ratingLabel ? Number(ratingLabel) : undefined,
        date: tagText(segment, "bp9Aid"),
        body: tagText(segment, "h3YV2d"),
        helpful_count: parseHelpfulCount(tagText(segment, "AJTPZc")),
        user_image: attr(avatarTag, "src"),
      }),
    );
  }
  return reviews;
}

export default defineTool<Input, Output>(async (input, bf) => {
  const appId = appIdFrom(input.app_id_or_url);
  const language = cleanLocale(input.language, "en-US");
  const country = cleanCountry(input.country);
  const limit = Math.min(input.max_reviews ?? 5, 10);
  const params = new URLSearchParams({ id: appId, hl: language, gl: country });
  const url = `https://play.google.com/store/apps/details?${params}`;
  const response = await bf.fetch({
    url,
    strategy: "http",
    return_response_text: true,
    include_html: true,
    locale: language,
    extra_headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5",
      "accept-language": `${language},en;q=0.9`,
      "user-agent": "Mozilla/5.0 (compatible; BetterFetchGooglePlayReviewsScraper/0.1; +https://betterfetch.co/tools/google_play_reviews_scraper)",
    },
  });
  const html = response.body_text?.length ? response.body_text : (response.html ?? "");
  const reviews = parseReviews(html, limit);
  if (!reviews.length) throw new Error("No visible Google Play review cards were found for this app");
  return compactOutput({
    app_id: appId,
    ...parseSchema(html),
    source_url: response.final_url ?? url,
    count: reviews.length,
    reviews,
  });
});
