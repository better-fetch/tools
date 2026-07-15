import { defineTool } from "@better-fetch/tools";

type Mode = "location_search" | "search" | "item";
type Input = {
  mode: Mode;
  query?: string;
  id?: string;
  url?: string;
  lat?: number;
  lng?: number;
  radius_km?: number;
  min_price?: number;
  max_price?: number;
  count?: number;
  sort_by?: string;
  delivery_method?: string;
  condition?: string;
  date_listed?: string;
  availability?: string;
  cursor?: string;
};
type Location = { name: string; display_name: string; latitude: number; longitude: number; type?: string; country_code?: string };
type Listing = { id: string; url: string; title: string; description?: string; price_label?: string; location?: string; listed_at_label?: string; condition?: string; availability?: string };
type Output = { mode: Mode; source_url: string; query?: string; count: number; locations: Location[]; listings: Listing[]; item?: Listing; next_cursor?: string; applied_filters?: Record<string, string | number> };
type IndexedResult = { title: string; url: string; snippet?: string };

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, number) => String.fromCodePoint(parseInt(number, 16)))
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)));
}

function stripTags(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function marketplaceTarget(value: string): { id: string; url: string } | undefined {
  const normalized = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const match = normalized.match(/^https?:\/\/(?:www\.|m\.)?facebook\.com\/marketplace\/item\/(\d+)/i);
  return match ? { id: match[1], url: `https://www.facebook.com/marketplace/item/${match[1]}` } : undefined;
}

function indexedResults(html: string, limit: number): IndexedResult[] {
  const results: IndexedResult[] = [];
  const seen = new Set<string>();
  const links = /<a[^>]+href="(https?:\/\/[^\"]+)"[^>]*>(?:(?!<\/a>).)*?<h3[^>]*>((?:(?!<\/h3>).)*)<\/h3>/gs;
  let match: RegExpExecArray | null;
  while ((match = links.exec(html)) && results.length < limit) {
    let url = decodeEntities(match[1]);
    const redirect = url.match(/[?&]q=(https?[^&]+)/);
    if (redirect) {
      try { url = decodeURIComponent(redirect[1]); } catch { url = redirect[1]; }
    }
    const target = marketplaceTarget(url);
    if (!target || seen.has(target.id)) continue;
    seen.add(target.id);
    const tail = html.slice(match.index + match[0].length, match.index + match[0].length + 3500);
    const snippetMatch = tail.match(/<(?:div|span)[^>]*(?:data-sncf|class="[^"]*(?:VwiC3b|IsZvec)[^"]*")[^>]*>((?:(?!<\/(?:div|span)>).)*)/s);
    results.push({ title: stripTags(match[2]), url: target.url, snippet: snippetMatch ? stripTags(snippetMatch[1]).slice(0, 1200) : undefined });
  }
  return results;
}

function listingFrom(result: IndexedResult): Listing | undefined {
  const target = marketplaceTarget(result.url);
  if (!target) return undefined;
  const snippet = result.snippet;
  const price = snippet?.match(/\b(?:[A-Z]{1,3}\$|\$)[\d,.]+(?:\.\d{2})?\b|\bFREE\b/i)?.[0];
  const listed = snippet?.match(/Listed\s+(?:\d+\s+\w+\s+ago|on\s+[^.·,]+|over\s+a\s+week\s+ago|about\s+[^.·,]+)(?:\s+in\s+[A-Z][A-Za-z .'-]+,\s*[A-Z]{2,4})?/i)?.[0];
  const location = snippet?.match(/\bin\s+([A-Z][A-Za-z .'-]+,\s*(?:[A-Z]{2,4}|[A-Za-z ]+Australia))(?=[.·,]|$)/)?.[1]?.trim();
  const condition = snippet?.match(/\b(?:New|Used)\s+-\s+(?:Like New|Good|Fair)\b/i)?.[0];
  const availability = snippet?.match(/\b(?:Available|Pending|Sold out|Sold)\b/i)?.[0];
  return { id: target.id, url: target.url, title: result.title, description: snippet, price_label: price, location, listed_at_label: listed, condition, availability };
}

function compactFilters(input: Input): Record<string, string | number> | undefined {
  const values: Record<string, string | number | undefined> = {
    lat: input.lat, lng: input.lng, radius_km: input.radius_km, min_price: input.min_price, max_price: input.max_price,
    sort_by: input.sort_by, delivery_method: input.delivery_method, condition: input.condition, date_listed: input.date_listed, availability: input.availability,
  };
  const out = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== "")) as Record<string, string | number>;
  return Object.keys(out).length ? out : undefined;
}

export default defineTool<Input, Output>(async (input, bf) => {
  if (input.mode === "location_search") {
    const query = input.query?.trim();
    if (!query) throw new Error("query is required for location_search mode");
    const sourceUrl = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5&q=${encodeURIComponent(query)}`;
    const response = await bf.fetch({ url: sourceUrl, strategy: "http", return_response_text: true, include_html: false, extra_headers: { accept: "application/json", "user-agent": "Better-Fetch/1.0 (public location lookup)" } });
    let payload = response.json;
    if (!Array.isArray(payload) && response.body_text) {
      try { payload = JSON.parse(response.body_text); } catch { /* handled below */ }
    }
    const locations = (Array.isArray(payload) ? payload : []).flatMap((value) => {
      const item = objectValue(value);
      const display = typeof item?.display_name === "string" ? item.display_name : undefined;
      const lat = Number(item?.lat);
      const lon = Number(item?.lon);
      if (!display || !Number.isFinite(lat) || !Number.isFinite(lon)) return [];
      const address = objectValue(item?.address);
      const name = [address?.city, address?.town, address?.village, item?.name].find((candidate) => typeof candidate === "string") as string | undefined;
      return [{ name: name ?? display.split(",")[0], display_name: display, latitude: lat, longitude: lon, type: typeof item?.type === "string" ? item.type : undefined, country_code: typeof address?.country_code === "string" ? address.country_code.toUpperCase() : undefined }];
    });
    if (!locations.length) throw new Error("Public geocoder returned no locations");
    return { mode: input.mode, source_url: sourceUrl, query, count: locations.length, locations, listings: [] };
  }

  if (input.mode === "item") {
    const target = input.url ? marketplaceTarget(input.url) : input.id?.trim() && /^\d{8,30}$/.test(input.id.trim()) ? marketplaceTarget(`facebook.com/marketplace/item/${input.id.trim()}`) : undefined;
    if (!target) throw new Error("url or numeric Marketplace item id is required for item mode");
    const query = `site:facebook.com/marketplace/item/${target.id}`;
    const sourceUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=10&hl=en`;
    let response = await bf.fetch({ url: sourceUrl, include_html: true, strategy: "browser", wait_until: "domcontentloaded", wait_ms: 1500, proxy: "auto" });
    let item = indexedResults(response.html ?? "", 10).map(listingFrom).find((listing) => listing?.id === target.id);
    if (!item) {
      response = await bf.fetch({ url: `${sourceUrl}&filter=0`, include_html: true, strategy: "browser", wait_until: "domcontentloaded", wait_ms: 1500, proxy: "auto" });
      item = indexedResults(response.html ?? "", 10).map(listingFrom).find((listing) => listing?.id === target.id);
    }
    if (!item) throw new Error("Google returned no indexed public Marketplace item");
    return { mode: input.mode, source_url: response.final_url ?? sourceUrl, count: 1, locations: [], listings: [item], item };
  }

  const query = input.query?.trim();
  if (!query) throw new Error("query is required for search mode");
  const limit = Math.min(Math.max(input.count ?? 10, 1), 20);
  const cursor = Number(input.cursor ?? "0");
  if (!Number.isInteger(cursor) || cursor < 0 || cursor > 90) throw new Error("cursor must be an offset from 0 to 90");
  const sourceQuery = `site:facebook.com/marketplace/item ${query}`;
  const sourceUrl = `https://www.google.com/search?q=${encodeURIComponent(sourceQuery)}&num=${Math.min(limit + 5, 30)}&start=${cursor}&hl=en`;
  let response = await bf.fetch({ url: sourceUrl, include_html: true, strategy: "browser", wait_until: "domcontentloaded", wait_ms: 1500, proxy: "auto" });
  let listings = indexedResults(response.html ?? "", limit).map(listingFrom).filter((listing): listing is Listing => Boolean(listing));
  if (!listings.length) {
    response = await bf.fetch({ url: `${sourceUrl}&filter=0`, include_html: true, strategy: "browser", wait_until: "domcontentloaded", wait_ms: 1500, proxy: "auto" });
    listings = indexedResults(response.html ?? "", limit).map(listingFrom).filter((listing): listing is Listing => Boolean(listing));
  }
  if (input.min_price !== undefined || input.max_price !== undefined) {
    listings = listings.filter((listing) => {
      const price = Number(listing.price_label?.replace(/[^\d.]/g, ""));
      if (!Number.isFinite(price)) return true;
      return (input.min_price === undefined || price >= input.min_price) && (input.max_price === undefined || price <= input.max_price);
    });
  }
  if (!listings.length) throw new Error("Google returned no indexed public Marketplace listings");
  return { mode: input.mode, source_url: response.final_url ?? sourceUrl, query, count: listings.length, locations: [], listings, next_cursor: cursor < 90 ? String(cursor + 10) : undefined, applied_filters: compactFilters(input) };
});
