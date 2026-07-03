import { defineTool } from "@better-fetch/tools";

type Input = {
  query: string;
  max_results?: number;
};

type Place = {
  name: string;
  address?: string;
  rating?: number;
  reviews?: number;
  category?: string;
  phone?: string;
  website?: string;
  lat?: number;
  lng?: number;
};

type Output = {
  query: string;
  places: Place[];
  count: number;
};

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

// Primary parser: the rendered results feed. Each result is an
// <a class="hfpxzc" aria-label="<name>" href=".../maps/place/...!3d<lat>!4d<lng>...">
// followed by detail rows (class W4Efsd: "Category · Address" / hours / phone)
// and rating spans (MW4etd = rating, review count inside an aria-label or
// the UY7F9 span). Class names rot occasionally — that's what the repo
// model is for — and the APP_INITIALIZATION_STATE fallback below covers
// server-rendered variants.
function parseDom(html: string, limit: number): Place[] {
  const anchors = [...html.matchAll(/<a[^>]+class="[^"]*hfpxzc[^"]*"[^>]*>/g)];
  const places: Place[] = [];
  for (let i = 0; i < anchors.length && places.length < limit; i++) {
    const start = anchors[i].index ?? 0;
    const seg = html.slice(start, anchors[i + 1]?.index ?? start + 8000);

    const name = seg.match(/aria-label="([^"]+)"/)?.[1];
    if (!name) continue;
    const place: Place = { name: decodeEntities(name) };

    const href = seg.match(/href="([^"]+)"/)?.[1] ?? "";
    const coords = href.match(/!3d(-?[\d.]+)!4d(-?[\d.]+)/);
    if (coords) {
      place.lat = Number(coords[1]);
      place.lng = Number(coords[2]);
    }

    const rating = seg.match(/class="MW4etd"[^>]*>([\d.]+)</)?.[1];
    if (rating) place.rating = Number(rating);
    const reviews =
      seg.match(/aria-label="[\d.]+ stars? ([\d,]+) Reviews?"/i)?.[1] ??
      seg.match(/class="UY7F9"[^>]*>[^(]*\(([\d,]+)\)/)?.[1];
    if (reviews) place.reviews = Number(reviews.replace(/,/g, ""));

    // Rows separated by middle-dot variants (U+00B7, U+22C5): a rating row,
    // "Category . Address", and "Open . Closes 3 pm . phone".
    const HOURS = /^(open\b|closed|opens|closes|24 hours|temporarily)/i;
    for (const row of seg.matchAll(/class="W4Efsd"[^>]*>([\s\S]{0,400}?)<\/div>/g)) {
      const parts = decodeEntities(row[1].replace(/<[^>]+>/g, " "))
        .split(/[\u00b7\u22c5]/)
        .map((p) => p.replace(/\s+/g, " ").trim())
        .filter(Boolean);
      if (!parts.length) continue;
      const phone = parts.find((p) => /^\+?\(?\d[\d\s()-]{6,}$/.test(p));
      if (phone) place.phone ??= phone;
      // Rating rows start with a number; hours rows with Open/Closed.
      if (/^[\d.(]/.test(parts[0]) || HOURS.test(parts[0])) continue;
      place.category ??= parts[0];
      const addr = parts.find(
        (p) =>
          p !== parts[0] &&
          /\d/.test(p) &&
          p !== phone &&
          !HOURS.test(p) &&
          !/\b(am|pm)\b/i.test(p),
      );
      if (addr) place.address ??= addr;
    }

    const website = seg.match(/href="(https?:\/\/(?!www\.google\.)[^"]+)"[^>]*aria-label="[^"]*[Ww]ebsite/)?.[1];
    if (website) place.website = website;

    places.push(place);
  }
  return places;
}

// Fallback: walk window.APP_INITIALIZATION_STATE (and its embedded )]}'
// payload strings) for arrays shaped like place entries — [11] name,
// [39] address, [4][7]/[4][8] rating/reviews.
type Nested = unknown;

function get(entry: Nested, path: number[]): unknown {
  let v: unknown = entry;
  for (const i of path) {
    if (!Array.isArray(v)) return undefined;
    v = v[i];
  }
  return v;
}

function toPlace(entry: Nested): Place | null {
  const name = get(entry, [11]);
  if (typeof name !== "string" || !name) return null;
  const place: Place = { name };
  const address = get(entry, [39]);
  if (typeof address === "string" && address) place.address = address;
  const rating = get(entry, [4, 7]);
  if (typeof rating === "number" && rating >= 1 && rating <= 5) place.rating = rating;
  const reviews = get(entry, [4, 8]);
  if (typeof reviews === "number") place.reviews = Math.trunc(reviews);
  const category = get(entry, [13, 0]);
  if (typeof category === "string") place.category = category;
  const lat = get(entry, [9, 2]);
  const lng = get(entry, [9, 3]);
  if (typeof lat === "number" && typeof lng === "number") {
    place.lat = lat;
    place.lng = lng;
  }
  return place.address || place.rating != null || place.category ? place : null;
}

function parseState(html: string, limit: number): Place[] {
  const m = html.match(/window\.APP_INITIALIZATION_STATE\s*=\s*\[/);
  if (!m || m.index == null) return [];
  const start = html.indexOf("[", m.index);
  let depth = 0;
  let inString = false;
  let blob: Nested = null;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        try {
          blob = JSON.parse(html.slice(start, i + 1));
        } catch {
          return [];
        }
        break;
      }
    }
  }

  const places: Place[] = [];
  const seen = new Set<string>();
  const stack: Nested[] = [blob];
  while (stack.length && places.length < limit) {
    const node = stack.pop();
    if (typeof node === "string" && node.length > 500) {
      // Results often ship as an embedded )]}' JSON payload string.
      try {
        stack.push(JSON.parse(node.replace(/^\)\]\}'\n?/, "")));
      } catch {
        /* not a payload string */
      }
      continue;
    }
    if (!Array.isArray(node)) continue;
    const place = toPlace(node);
    if (place && !seen.has(place.name)) {
      seen.add(place.name);
      places.push(place);
      continue;
    }
    for (const child of node) stack.push(child);
  }
  return places;
}

export default defineTool<Input, Output>(async (input, bf) => {
  const limit = Math.min(input.max_results ?? 10, 40);
  const page = await bf.fetch({
    url: `https://www.google.com/maps/search/${encodeURIComponent(input.query)}?hl=en`,
    include_html: true,
    strategy: "browser",
    wait_until: "domcontentloaded",
    wait_ms: 3500,
  });

  const html = page.html ?? "";
  let places = parseDom(html, limit);
  if (!places.length) places = parseState(html, limit);
  return { query: input.query, places, count: places.length };
});
