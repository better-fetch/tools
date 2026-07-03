import { defineTool } from "@better-fetch/tools";

type Input = {
  app_id_or_url: string;
  country?: string;
  page?: number;
  max_reviews?: number;
};

type Review = {
  review_id: string;
  title?: string;
  body?: string;
  rating: number;
  version?: string;
  author?: string;
  author_url?: string;
  published_at?: string;
  url?: string;
  vote_sum?: number;
  vote_count?: number;
};

type Output = {
  app_id: string;
  country: string;
  page: number;
  source_url: string;
  count: number;
  reviews: Review[];
};

type FeedLabel = { label?: string };

type FeedEntry = {
  author?: {
    name?: FeedLabel;
    uri?: FeedLabel;
  };
  updated?: FeedLabel;
  "im:rating"?: FeedLabel;
  "im:version"?: FeedLabel;
  id?: FeedLabel;
  title?: FeedLabel;
  content?: FeedLabel;
  link?: {
    attributes?: {
      href?: string;
    };
  };
  "im:voteSum"?: FeedLabel;
  "im:voteCount"?: FeedLabel;
};

type FeedResponse = {
  feed?: {
    entry?: FeedEntry | FeedEntry[];
  };
};

function cleanCountry(value: string | undefined): string {
  const clean = value?.trim().toUpperCase();
  return clean && /^[A-Z]{2}$/.test(clean) ? clean : "US";
}

function appIdFrom(value: string): string {
  const clean = value.trim();
  const direct = clean.match(/^\d{5,}$/)?.[0];
  if (direct) return direct;
  const fromUrl = clean.match(/\/id(\d{5,})(?:[/?#]|$)/)?.[1] ?? clean.match(/[?&]id=(\d{5,})/)?.[1];
  if (fromUrl) return fromUrl;
  throw new Error("app_id_or_url must be a numeric Apple App Store ID or URL containing an id segment");
}

function text(label: string | undefined): string | undefined {
  const clean = label?.replace(/\s+/g, " ").trim();
  return clean || undefined;
}

function intValue(label: string | undefined): number | undefined {
  if (!label) return undefined;
  const value = Number(label);
  return Number.isInteger(value) ? value : undefined;
}

function toIso(label: string | undefined): string | undefined {
  if (!label) return undefined;
  const time = Date.parse(label);
  return Number.isFinite(time) ? new Date(time).toISOString() : label;
}

function compactReview(review: Review): Review {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(review)) {
    if (value !== undefined && value !== "") out[key] = value;
  }
  return out as Review;
}

function entriesFrom(payload: unknown): FeedEntry[] {
  const feed = (payload as FeedResponse | null)?.feed;
  const entries = feed?.entry;
  if (!entries) return [];
  return Array.isArray(entries) ? entries : [entries];
}

function toReview(entry: FeedEntry): Review | undefined {
  const reviewId = text(entry.id?.label);
  const rating = intValue(entry["im:rating"]?.label);
  if (!reviewId || !rating) return undefined;
  return compactReview({
    review_id: reviewId,
    title: text(entry.title?.label),
    body: text(entry.content?.label),
    rating,
    version: text(entry["im:version"]?.label),
    author: text(entry.author?.name?.label),
    author_url: text(entry.author?.uri?.label),
    published_at: toIso(entry.updated?.label),
    url: text(entry.link?.attributes?.href),
    vote_sum: intValue(entry["im:voteSum"]?.label),
    vote_count: intValue(entry["im:voteCount"]?.label),
  });
}

export default defineTool<Input, Output>(async (input, bf) => {
  const appId = appIdFrom(input.app_id_or_url);
  const country = cleanCountry(input.country);
  const page = Math.min(Math.max(input.page ?? 1, 1), 10);
  const limit = Math.min(input.max_reviews ?? 20, 50);
  const url = `https://itunes.apple.com/${country.toLowerCase()}/rss/customerreviews/page=${page}/id=${encodeURIComponent(appId)}/sortby=mostrecent/json`;
  const response = await bf.fetch({
    url,
    strategy: "http",
    return_response_text: true,
    extra_headers: {
      accept: "application/json,text/javascript;q=0.9,*/*;q=0.5",
      "accept-language": "en-US,en;q=0.9",
    },
  });
  let payload: unknown;
  try {
    payload = JSON.parse(response.body_text ?? "");
  } catch {
    throw new Error("Apple App Store review feed returned invalid JSON");
  }
  const reviews = entriesFrom(payload).map(toReview).filter((review): review is Review => Boolean(review)).slice(0, limit);
  if (!reviews.length) throw new Error("No Apple App Store reviews were found for this app and country");
  return {
    app_id: appId,
    country,
    page,
    source_url: response.final_url ?? url,
    count: reviews.length,
    reviews,
  };
});
