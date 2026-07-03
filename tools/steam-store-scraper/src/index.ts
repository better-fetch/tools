import { defineTool, type Bf } from "@better-fetch/tools";

type Mode = "search" | "details" | "reviews";
type JsonObject = Record<string, unknown>;

type Input = {
  mode?: Mode;
  query?: string;
  app_id?: string | number;
  country?: string;
  language?: string;
  limit?: number;
  include_reviews?: boolean;
  review_filter?: string;
  review_language?: string;
  review_type?: string;
  purchase_type?: string;
  cursor?: string;
};

type Price = string;

type GameSearchResult = {
  rank: number;
  app_id: number;
  name: string;
  type?: string;
  store_url: string;
  price?: Price;
  metascore?: number;
  platforms?: string;
  image_url?: string;
};

type GameDetails = {
  app_id: number;
  name?: string;
  type?: string;
  store_url: string;
  short_description?: string;
  is_free?: boolean;
  required_age?: number;
  release_date?: string;
  coming_soon?: boolean;
  developers?: string;
  publishers?: string;
  genres?: string;
  categories?: string;
  platforms?: string;
  recommendations_total?: number;
  metacritic_score?: number;
  metacritic_url?: string;
  website?: string;
  header_image?: string;
  capsule_image?: string;
  screenshots?: string;
  price?: Price;
};

type ReviewSummary = {
  num_reviews?: number;
  review_score?: number;
  review_score_desc?: string;
  total_positive?: number;
  total_negative?: number;
  total_reviews?: number;
};

type Review = {
  recommendation_id?: string;
  steam_id?: string;
  language?: string;
  review?: string;
  voted_up?: boolean;
  votes_up?: number;
  votes_funny?: number;
  weighted_vote_score?: string;
  timestamp_created?: number;
  timestamp_updated?: number;
  playtime_forever_minutes?: number;
  playtime_at_review_minutes?: number;
  steam_purchase?: boolean;
  received_for_free?: boolean;
  written_during_early_access?: boolean;
};

type Output = {
  mode: Mode;
  source_url: string;
  count: number;
  query?: string;
  app_id?: number;
  country: string;
  language: string;
  games?: GameSearchResult[];
  app?: GameDetails;
  review_summary?: ReviewSummary;
  reviews?: Review[];
  next_cursor?: string;
  reviews_url?: string;
};

const STORE_BASE = "https://store.steampowered.com";
const USER_AGENT =
  "BetterFetchSteamStoreScraper/0.1 (https://betterfetch.co/tools/steam_store_scraper; support@betterfetch.co)";

function objectValue(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : undefined;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function compact<T extends Record<string, unknown>>(record: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined && value !== "" && value !== null) out[key] = value;
  }
  return out as T;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'");
}

function truncate(value: string | undefined, max: number): string | undefined {
  const clean = decodeEntities(value ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return undefined;
  return clean.length > max ? `${clean.slice(0, max - 3)}...` : clean;
}

function cleanMode(input: Input): Mode {
  if (input.mode === "reviews" || input.mode === "details" || input.mode === "search") return input.mode;
  return input.app_id ? "details" : "search";
}

function cleanCountry(value: string | undefined): string {
  const clean = (value ?? "US").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(clean)) throw new Error("country must be a two-letter country code such as US, GB, or AU");
  return clean;
}

function cleanLanguage(value: string | undefined): string {
  const clean = (value ?? "en").trim().toLowerCase();
  if (!/^[a-z]{2,8}(-[a-z0-9]{2,8})?$/.test(clean)) throw new Error("language must be a short Steam language code such as en");
  return clean;
}

function cleanReviewLanguage(value: string | undefined): string {
  const clean = (value ?? "english").trim().toLowerCase().replace(/\s+/g, "_");
  if (!/^[a-z_]{2,32}$/.test(clean)) throw new Error("review_language must be a Steam review language such as english or all");
  return clean;
}

function cleanBoundedChoice(value: string | undefined, allowed: Set<string>, fallback: string, field: string): string {
  const clean = (value ?? fallback).trim().toLowerCase();
  if (!allowed.has(clean)) throw new Error(`${field} must be one of: ${[...allowed].join(", ")}`);
  return clean;
}

function limit(value: number | undefined, max: number): number {
  return Math.min(Math.max(value ?? 10, 1), max);
}

function cleanQuery(value: string | undefined): string {
  const clean = (value ?? "").trim();
  if (!clean) throw new Error("query is required for search mode");
  return clean.slice(0, 120);
}

function appIdFrom(value: string | number | undefined): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  const raw = String(value ?? "").trim();
  const fromUrl = raw.match(/store\.steampowered\.com\/app\/(\d+)/i);
  const clean = fromUrl?.[1] ?? raw;
  if (!/^\d+$/.test(clean)) throw new Error("app_id must be a Steam app id or Steam app URL");
  const parsed = Number(clean);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error("app_id must be a positive integer");
  return parsed;
}

function queryString(params: Record<string, string | number | undefined>): string {
  return Object.entries(params)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined && entry[1] !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
}

function storeUrl(appId: number): string {
  return `${STORE_BASE}/app/${appId}`;
}

function searchUrl(query: string, country: string, language: string): string {
  return `${STORE_BASE}/api/storesearch/?${queryString({ term: query, cc: country, l: language })}`;
}

function detailsUrl(appId: number, country: string, language: string): string {
  return `${STORE_BASE}/api/appdetails?${queryString({ appids: appId, cc: country, l: language })}`;
}

function reviewsUrl(input: Input, appId: number, max: number): string {
  const filter = cleanBoundedChoice(
    input.review_filter,
    new Set(["recent", "updated", "all"]),
    "recent",
    "review_filter",
  );
  const reviewType = cleanBoundedChoice(
    input.review_type,
    new Set(["all", "positive", "negative"]),
    "all",
    "review_type",
  );
  const purchaseType = cleanBoundedChoice(
    input.purchase_type,
    new Set(["all", "steam", "non_steam_purchase"]),
    "all",
    "purchase_type",
  );
  return `${STORE_BASE}/appreviews/${appId}?${queryString({
    json: 1,
    filter,
    language: cleanReviewLanguage(input.review_language),
    review_type: reviewType,
    purchase_type: purchaseType,
    num_per_page: max,
    cursor: input.cursor ?? "*",
  })}`;
}

async function fetchJson(bf: Bf, url: string): Promise<JsonObject> {
  const response = await bf.fetch({
    url,
    strategy: "http",
    return_response_text: true,
    extra_headers: {
      accept: "application/json,*/*;q=0.5",
      "user-agent": USER_AGENT,
    },
  });
  const status = response.status ?? 0;
  if (!response.ok || status >= 400 || !response.body_text) {
    throw new Error(`Steam request failed with status ${response.status ?? "unknown"}`);
  }
  try {
    const parsed = JSON.parse(response.body_text) as unknown;
    const obj = objectValue(parsed);
    if (!obj) throw new Error("not an object");
    return obj;
  } catch {
    throw new Error("Steam returned invalid JSON");
  }
}

function priceFrom(value: unknown): Price | undefined {
  const obj = objectValue(value);
  if (!obj) {
    return textValue(value);
  }
  const formatted = textValue(obj.final_formatted) ?? textValue(obj.initial_formatted);
  if (formatted) return formatted;
  const currency = textValue(obj.currency);
  const final = numberValue(obj.final);
  if (currency && final !== undefined) return `${currency} ${final}`;
  return undefined;
}

function namesFromArray(value: unknown): string | undefined {
  const names = arrayValue(value)
    .map((item) => {
      if (typeof item === "string") return item.trim();
      return textValue(objectValue(item)?.description);
    })
    .filter((item): item is string => Boolean(item));
  return names.length ? names.join(", ") : undefined;
}

function platformsFromFlags(value: unknown): string | undefined {
  const obj = objectValue(value);
  if (!obj) return undefined;
  const platforms = [
    ["windows", obj.windows],
    ["mac", obj.mac],
    ["linux", obj.linux],
  ]
    .filter(([, enabled]) => enabled === true)
    .map(([name]) => name as string);
  return platforms.length ? platforms.join(", ") : undefined;
}

function searchResultFrom(item: unknown, rank: number): GameSearchResult | undefined {
  const obj = objectValue(item);
  if (!obj) return undefined;
  const appId = numberValue(obj.id);
  const name = textValue(obj.name);
  if (!appId || !name) return undefined;
  return compact({
    rank,
    app_id: appId,
    name,
    type: textValue(obj.type),
    store_url: storeUrl(appId),
    price: priceFrom(obj.price),
    metascore: numberValue(obj.metascore),
    platforms: platformsFromFlags(obj.platforms),
    image_url: textValue(obj.tiny_image) ?? textValue(obj.capsule),
  });
}

function detailsFrom(data: JsonObject, appId: number): GameDetails | undefined {
  const wrapper = objectValue(data[String(appId)]);
  if (!wrapper || wrapper.success !== true) return undefined;
  const obj = objectValue(wrapper.data);
  if (!obj) return undefined;
  const release = objectValue(obj.release_date);
  const metacritic = objectValue(obj.metacritic);
  const recommendations = objectValue(obj.recommendations);
  const screenshots = arrayValue(obj.screenshots)
    .map((item) => textValue(objectValue(item)?.path_full))
    .filter((item): item is string => Boolean(item))
    .slice(0, 5);

  return compact({
    app_id: appId,
    name: textValue(obj.name),
    type: textValue(obj.type),
    store_url: storeUrl(appId),
    short_description: truncate(textValue(obj.short_description), 700),
    is_free: booleanValue(obj.is_free),
    required_age: numberValue(obj.required_age),
    release_date: textValue(release?.date),
    coming_soon: booleanValue(release?.coming_soon),
    developers: namesFromArray(obj.developers),
    publishers: namesFromArray(obj.publishers),
    genres: namesFromArray(obj.genres),
    categories: namesFromArray(obj.categories),
    platforms: platformsFromFlags(obj.platforms),
    recommendations_total: numberValue(recommendations?.total),
    metacritic_score: numberValue(metacritic?.score),
    metacritic_url: textValue(metacritic?.url),
    website: textValue(obj.website),
    header_image: textValue(obj.header_image),
    capsule_image: textValue(obj.capsule_image),
    screenshots: screenshots.length ? screenshots.join(", ") : undefined,
    price: priceFrom(obj.price_overview),
  });
}

function summaryFrom(value: unknown): ReviewSummary | undefined {
  const obj = objectValue(value);
  if (!obj) return undefined;
  return compact({
    num_reviews: numberValue(obj.num_reviews),
    review_score: numberValue(obj.review_score),
    review_score_desc: textValue(obj.review_score_desc),
    total_positive: numberValue(obj.total_positive),
    total_negative: numberValue(obj.total_negative),
    total_reviews: numberValue(obj.total_reviews),
  });
}

function reviewFrom(item: unknown): Review | undefined {
  const obj = objectValue(item);
  if (!obj) return undefined;
  const author = objectValue(obj.author);
  return compact({
    recommendation_id: textValue(obj.recommendationid),
    steam_id: textValue(author?.steamid),
    language: textValue(obj.language),
    review: truncate(textValue(obj.review), 1800),
    voted_up: booleanValue(obj.voted_up),
    votes_up: numberValue(obj.votes_up),
    votes_funny: numberValue(obj.votes_funny),
    weighted_vote_score: textValue(obj.weighted_vote_score),
    timestamp_created: numberValue(obj.timestamp_created),
    timestamp_updated: numberValue(obj.timestamp_updated),
    playtime_forever_minutes: numberValue(author?.playtime_forever),
    playtime_at_review_minutes: numberValue(author?.playtime_at_review),
    steam_purchase: booleanValue(obj.steam_purchase),
    received_for_free: booleanValue(obj.received_for_free),
    written_during_early_access: booleanValue(obj.written_during_early_access),
  });
}

async function fetchReviews(input: Input, bf: Bf, appId: number, max: number): Promise<{ url: string; data: JsonObject; reviews: Review[] }> {
  const url = reviewsUrl(input, appId, max);
  const data = await fetchJson(bf, url);
  const reviews = arrayValue(data.reviews)
    .map(reviewFrom)
    .filter((item): item is Review => item !== undefined)
    .slice(0, max);
  return { url, data, reviews };
}

export default defineTool<Input, Output>(async (input, bf) => {
  const mode = cleanMode(input);
  const country = cleanCountry(input.country);
  const language = cleanLanguage(input.language);

  if (mode === "search") {
    const query = cleanQuery(input.query);
    const max = limit(input.limit, 25);
    const url = searchUrl(query, country, language);
    const data = await fetchJson(bf, url);
    const games = arrayValue(data.items)
      .map((item, index) => searchResultFrom(item, index + 1))
      .filter((item): item is GameSearchResult => item !== undefined)
      .slice(0, max);
    return {
      mode,
      source_url: url,
      count: games.length,
      query,
      country,
      language,
      games,
    };
  }

  const appId = appIdFrom(input.app_id);
  const maxReviews = limit(input.limit, 20);

  if (mode === "reviews") {
    const fetched = await fetchReviews(input, bf, appId, maxReviews);
    return compact({
      mode,
      source_url: fetched.url,
      count: fetched.reviews.length,
      app_id: appId,
      country,
      language,
      review_summary: summaryFrom(fetched.data.query_summary),
      reviews: fetched.reviews,
      next_cursor: textValue(fetched.data.cursor),
    });
  }

  const details = detailsUrl(appId, country, language);
  const data = await fetchJson(bf, details);
  const app = detailsFrom(data, appId);
  if (!app) throw new Error(`Steam app ${appId} did not return public store details`);

  let reviews: Review[] | undefined;
  let reviewSummary: ReviewSummary | undefined;
  let reviewUrl: string | undefined;
  let nextCursor: string | undefined;
  if (input.include_reviews) {
    const fetched = await fetchReviews(input, bf, appId, Math.min(maxReviews, 10));
    reviews = fetched.reviews;
    reviewSummary = summaryFrom(fetched.data.query_summary);
    reviewUrl = fetched.url;
    nextCursor = textValue(fetched.data.cursor);
  }

  return compact({
    mode,
    source_url: details,
    count: app ? 1 : 0,
    app_id: appId,
    country,
    language,
    app,
    review_summary: reviewSummary,
    reviews,
    next_cursor: nextCursor,
    reviews_url: reviewUrl,
  });
});
