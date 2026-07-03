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

type ReviewRow = {
  userReviewId?: unknown;
  title?: unknown;
  body?: unknown;
  rating?: unknown;
  name?: unknown;
  viewUsersUserReviewsUrl?: unknown;
  date?: unknown;
  voteSum?: unknown;
  voteCount?: unknown;
};

type ReviewRowsResponse = {
  userReviewList?: unknown;
};

const PAGE_SIZE = 50;

/**
 * Apple iTunes storefront IDs. The itunes.apple.com userReviewsRow endpoint
 * selects the store via the X-Apple-Store-Front header, not a URL segment.
 */
const STOREFRONTS: Record<string, string> = {
  AE: "143481", AG: "143540", AI: "143538", AL: "143575", AM: "143524",
  AO: "143564", AR: "143505", AT: "143445", AU: "143460", AZ: "143568",
  BB: "143541", BD: "143490", BE: "143446", BG: "143526", BH: "143559",
  BM: "143542", BN: "143560", BO: "143556", BR: "143503", BS: "143539",
  BW: "143525", BY: "143565", BZ: "143555", CA: "143455", CH: "143459",
  CI: "143527", CL: "143483", CN: "143465", CO: "143501", CR: "143495",
  CY: "143557", CZ: "143489", DE: "143443", DK: "143458", DM: "143545",
  DO: "143508", DZ: "143563", EC: "143509", EE: "143518", EG: "143516",
  ES: "143454", FI: "143447", FR: "143442", GB: "143444", GD: "143546",
  GH: "143573", GR: "143448", GT: "143504", GY: "143553", HK: "143463",
  HN: "143510", HR: "143494", HU: "143482", ID: "143476", IE: "143449",
  IL: "143491", IN: "143467", IS: "143558", IT: "143450", JM: "143511",
  JO: "143528", JP: "143462", KE: "143529", KN: "143548", KR: "143466",
  KW: "143493", KY: "143544", KZ: "143517", LB: "143497", LC: "143549",
  LI: "143522", LK: "143486", LT: "143520", LU: "143451", LV: "143519",
  MD: "143523", MG: "143531", MK: "143530", ML: "143532", MO: "143515",
  MS: "143547", MT: "143521", MU: "143533", MV: "143488", MX: "143468",
  MY: "143473", NE: "143534", NG: "143561", NI: "143512", NL: "143452",
  NO: "143457", NP: "143484", NZ: "143461", OM: "143562", PA: "143485",
  PE: "143507", PH: "143474", PK: "143477", PL: "143478", PT: "143453",
  PY: "143513", QA: "143498", RO: "143487", RS: "143500", RU: "143469",
  SA: "143479", SE: "143456", SG: "143464", SI: "143499", SK: "143496",
  SN: "143535", SR: "143554", SV: "143506", TC: "143552", TH: "143475",
  TN: "143536", TR: "143480", TT: "143551", TW: "143470", UA: "143492",
  UG: "143537", US: "143441", UY: "143514", UZ: "143566", VC: "143550",
  VE: "143502", VG: "143543", VN: "143471", YE: "143571", ZA: "143472",
};

function cleanCountry(value: string | undefined): string {
  const clean = value?.trim().toUpperCase();
  if (!clean || !/^[A-Z]{2}$/.test(clean)) return "US";
  if (!STOREFRONTS[clean]) {
    throw new Error(`Unsupported App Store country code: ${clean}`);
  }
  return clean;
}

function appIdFrom(value: string): string {
  const clean = value.trim();
  const direct = clean.match(/^\d{5,}$/)?.[0];
  if (direct) return direct;
  const fromUrl = clean.match(/\/id(\d{5,})(?:[/?#]|$)/)?.[1] ?? clean.match(/[?&]id=(\d{5,})/)?.[1];
  if (fromUrl) return fromUrl;
  throw new Error("app_id_or_url must be a numeric Apple App Store ID or URL containing an id segment");
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.replace(/\s+/g, " ").trim();
  return clean || undefined;
}

function intValue(value: unknown): number | undefined {
  const num = typeof value === "string" ? Number(value) : value;
  return typeof num === "number" && Number.isInteger(num) ? num : undefined;
}

function toIso(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  const time = Date.parse(raw);
  return Number.isFinite(time) ? new Date(time).toISOString() : raw;
}

function compactReview(review: Review): Review {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(review)) {
    if (value !== undefined && value !== "") out[key] = value;
  }
  return out as Review;
}

function rowsFrom(payload: unknown): ReviewRow[] {
  const rows = (payload as ReviewRowsResponse | null)?.userReviewList;
  return Array.isArray(rows) ? (rows as ReviewRow[]) : [];
}

function toReview(row: ReviewRow, reviewsUrl: string): Review | undefined {
  const rawId = row.userReviewId;
  const reviewId = text(rawId) ?? (typeof rawId === "number" ? String(rawId) : undefined);
  const rating = intValue(row.rating);
  if (!reviewId || !rating) return undefined;
  return compactReview({
    review_id: reviewId,
    title: text(row.title),
    body: typeof row.body === "string" ? row.body.trim() || undefined : undefined,
    rating,
    author: text(row.name),
    author_url: text(row.viewUsersUserReviewsUrl),
    published_at: toIso(row.date),
    url: reviewsUrl,
    vote_sum: intValue(row.voteSum),
    vote_count: intValue(row.voteCount),
  });
}

export default defineTool<Input, Output>(async (input, bf) => {
  const appId = appIdFrom(input.app_id_or_url);
  const country = cleanCountry(input.country);
  const page = Math.min(Math.max(input.page ?? 1, 1), 10);
  const limit = Math.min(input.max_reviews ?? 20, PAGE_SIZE);
  const startIndex = (page - 1) * PAGE_SIZE;
  const url =
    "https://itunes.apple.com/WebObjects/MZStore.woa/wa/userReviewsRow" +
    `?id=${encodeURIComponent(appId)}&displayable-kind=11&startIndex=${startIndex}` +
    `&endIndex=${startIndex + PAGE_SIZE}&sort=4`;
  const reviewsUrl = `https://apps.apple.com/${country.toLowerCase()}/app/id${appId}?see-all=reviews`;
  const response = await bf.fetch({
    url,
    strategy: "http",
    return_response_text: true,
    extra_headers: {
      "x-apple-store-front": `${STOREFRONTS[country]},29`,
      accept: "application/json,text/javascript;q=0.9,*/*;q=0.5",
      "accept-language": "en-US,en;q=0.9",
    },
  });
  if (response.blocked) {
    throw new Error(`Apple blocked the review request (${response.block_reason ?? "unknown reason"})`);
  }
  if (response.status === 400 || response.status === 404) {
    throw new Error(`Apple returned ${response.status} — the app may not exist or may not be available in the ${country} App Store`);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(response.body_text ?? "");
  } catch {
    throw new Error("Apple App Store review endpoint returned invalid JSON");
  }
  const reviews = rowsFrom(payload)
    .map((row) => toReview(row, reviewsUrl))
    .filter((review): review is Review => Boolean(review))
    .slice(0, limit);
  if (!reviews.length) throw new Error("No Apple App Store reviews were found for this app and country");
  return {
    app_id: appId,
    country,
    page,
    source_url: url,
    count: reviews.length,
    reviews,
  };
});
