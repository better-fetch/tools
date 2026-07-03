import { defineTool } from "@better-fetch/tools";

type Input = {
  query?: string;
  app_id?: string;
  country?: string;
  max_results?: number;
};

type App = {
  app_id: string;
  bundle_id?: string;
  title: string;
  developer?: string;
  genre?: string;
  genres?: string;
  rating?: number;
  rating_count?: number;
  price?: number;
  currency?: string;
  url: string;
  icon?: string;
  version?: string;
  release_date?: string;
  updated_at?: string;
  description?: string;
};

type Output = {
  mode: "search" | "lookup";
  query?: string;
  app_id?: string;
  country: string;
  source_url: string;
  count: number;
  apps: App[];
};

type SearchApiRow = {
  trackId?: number;
  bundleId?: string;
  trackName?: string;
  sellerName?: string;
  artistName?: string;
  primaryGenreName?: string;
  genres?: string[];
  averageUserRating?: number;
  userRatingCount?: number;
  price?: number;
  currency?: string;
  trackViewUrl?: string;
  artworkUrl100?: string;
  version?: string;
  releaseDate?: string;
  currentVersionReleaseDate?: string;
  description?: string;
};

type SearchApiResponse = {
  resultCount?: number;
  results?: SearchApiRow[];
};

function cleanCountry(value: string | undefined): string {
  const clean = value?.trim().toUpperCase();
  return clean && /^[A-Z]{2}$/.test(clean) ? clean : "US";
}

function cleanAppId(value: string | undefined): string | undefined {
  const clean = value?.trim();
  if (!clean) return undefined;
  const match = clean.match(/\d{5,}/);
  return match?.[0];
}

function compactApp(app: App): App {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(app)) {
    if (value !== undefined && value !== "") out[key] = value;
  }
  return out as App;
}

function toIso(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : value;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function toApp(row: SearchApiRow): App | undefined {
  if (!row.trackId || !row.trackName || !row.trackViewUrl) return undefined;
  return compactApp({
    app_id: String(row.trackId),
    bundle_id: row.bundleId,
    title: row.trackName,
    developer: row.sellerName ?? row.artistName,
    genre: row.primaryGenreName,
    genres: Array.isArray(row.genres) ? row.genres.join(", ") : undefined,
    rating: asNumber(row.averageUserRating),
    rating_count: asInteger(row.userRatingCount),
    price: asNumber(row.price),
    currency: row.currency,
    url: row.trackViewUrl,
    icon: row.artworkUrl100,
    version: row.version,
    release_date: toIso(row.releaseDate),
    updated_at: toIso(row.currentVersionReleaseDate),
    description: row.description,
  });
}

function parsePayload(raw: unknown): SearchApiResponse {
  if (!raw || typeof raw !== "object") throw new Error("Apple App Store API returned a non-object payload");
  const data = raw as SearchApiResponse;
  return {
    resultCount: typeof data.resultCount === "number" ? data.resultCount : 0,
    results: Array.isArray(data.results) ? data.results : [],
  };
}

export default defineTool<Input, Output>(async (input, bf) => {
  const country = cleanCountry(input.country);
  const appId = cleanAppId(input.app_id);
  const params = new URLSearchParams({ country: country.toLowerCase() });
  let mode: "search" | "lookup";
  let query: string | undefined;

  if (appId) {
    mode = "lookup";
    params.set("id", appId);
  } else {
    query = input.query?.trim();
    if (!query) throw new Error("Provide either query or app_id");
    mode = "search";
    params.set("term", query);
    params.set("media", "software");
    params.set("entity", "software");
    params.set("limit", String(Math.min(input.max_results ?? 10, 50)));
  }

  const url = `https://itunes.apple.com/${mode}?${params}`;
  const response = await bf.fetch({
    url,
    strategy: "http",
    return_response_text: true,
    extra_headers: {
      accept: "application/json,text/javascript;q=0.9,*/*;q=0.5",
      "user-agent": "Mozilla/5.0 (compatible; BetterFetchAppleAppStoreScraper/0.1; +https://betterfetch.co/tools/apple_app_store_scraper)",
    },
  });
  let json: unknown;
  try {
    json = JSON.parse(response.body_text ?? "");
  } catch {
    throw new Error("Apple App Store API returned invalid JSON");
  }
  const payload = parsePayload(json);
  const apps = payload.results?.map(toApp).filter((app): app is App => Boolean(app)) ?? [];
  if (!apps.length) throw new Error("No Apple App Store software results were found");
  return {
    mode,
    query,
    app_id: appId,
    country,
    source_url: response.final_url ?? url,
    count: apps.length,
    apps,
  };
});
