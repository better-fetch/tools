import { defineTool } from "@better-fetch/tools";

type Mode = "artist" | "album" | "track" | "search";
type Input = {
  mode?: Mode;
  id?: string;
  url?: string;
  query?: string;
  country?: string;
  max_results?: number;
};
type Item = {
  type: string;
  id: string;
  title: string;
  artist_name?: string;
  artist_id?: string;
  collection_name?: string;
  collection_id?: string;
  url?: string;
  preview_url?: string;
  artwork_url?: string;
  release_date?: string;
  genre?: string;
  country?: string;
  track_count?: number;
  track_number?: number;
  disc_number?: number;
  duration_ms?: number;
  price?: number;
  currency?: string;
  explicit?: boolean;
};
type Output = { mode: Mode; source_url: string; count: number; items: Item[] };

function rec(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
const number = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

function country(value: string | undefined): string {
  const clean = value?.trim().toUpperCase() || "US";
  if (!/^[A-Z]{2}$/.test(clean)) throw new Error("country must be a two-letter code");
  return clean;
}

function limit(value: number | undefined): number {
  return Math.max(1, Math.min(50, Math.round(value ?? 10)));
}

function idFrom(input: Input): string {
  const raw = input.id?.trim() ?? input.url?.match(/(?:\/|[?&]i=)(\d{5,20})(?:[?&#]|$)/)?.[1];
  if (!raw || !/^\d{5,20}$/.test(raw)) throw new Error("Provide a numeric Apple Music id or public Apple Music URL");
  return raw;
}

function normalize(value: unknown): Item | undefined {
  const item = rec(value);
  if (!item) return undefined;
  const type = text(item.wrapperType) ?? text(item.kind) ?? "item";
  const id = number(item.trackId) ?? number(item.collectionId) ?? number(item.artistId);
  const title = text(item.trackName) ?? text(item.collectionName) ?? text(item.artistName);
  if (id === undefined || !title) return undefined;
  const explicit = text(item.trackExplicitness) ?? text(item.collectionExplicitness);
  return {
    type,
    id: String(id),
    title,
    artist_name: text(item.artistName),
    artist_id: number(item.artistId) !== undefined ? String(number(item.artistId)) : undefined,
    collection_name: text(item.collectionName),
    collection_id: number(item.collectionId) !== undefined ? String(number(item.collectionId)) : undefined,
    url: text(item.trackViewUrl) ?? text(item.collectionViewUrl) ?? text(item.artistViewUrl),
    preview_url: text(item.previewUrl),
    artwork_url: text(item.artworkUrl100)?.replace("100x100", "600x600"),
    release_date: text(item.releaseDate),
    genre: text(item.primaryGenreName),
    country: text(item.country),
    track_count: number(item.trackCount),
    track_number: number(item.trackNumber),
    disc_number: number(item.discNumber),
    duration_ms: number(item.trackTimeMillis),
    price: number(item.trackPrice) ?? number(item.collectionPrice),
    currency: text(item.currency),
    explicit: explicit ? explicit === "explicit" : undefined,
  };
}

export default defineTool<Input, Output>(async (input, bf) => {
  const mode: Mode = input.mode ?? (input.query ? "search" : "track");
  const max = limit(input.max_results);
  const region = country(input.country);
  let sourceUrl: string;
  if (mode === "search") {
    const query = input.query?.trim();
    if (!query) throw new Error("query is required for search mode");
    sourceUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&country=${region}&limit=${max}`;
  } else {
    const id = idFrom(input);
    const entity = mode === "artist" ? "album" : mode === "album" ? "song" : undefined;
    sourceUrl = `https://itunes.apple.com/lookup?id=${id}&country=${region}${entity ? `&entity=${entity}&limit=${max}` : ""}`;
  }
  const response = await bf.fetch({
    url: sourceUrl,
    strategy: "http",
    return_response_text: true,
    include_html: false,
    extra_headers: { accept: "application/json" },
  });
  let payload = rec(response.json);
  if (!payload && response.body_text) {
    try { payload = rec(JSON.parse(response.body_text)); } catch { /* handled below */ }
  }
  if (!payload) throw new Error("Apple did not return public catalogue JSON");
  const items = (Array.isArray(payload.results) ? payload.results : [])
    .map(normalize)
    .filter((item): item is Item => Boolean(item))
    .slice(0, mode === "search" ? max : max + 1);
  if (!items.length) throw new Error("No public Apple Music catalogue records were found");
  return { mode, source_url: sourceUrl, count: items.length, items };
});
