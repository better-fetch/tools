import { defineTool } from "@better-fetch/tools";

type Mode = "artist" | "track" | "album" | "podcast" | "podcast_episodes" | "search";

type Input = {
  mode?: Mode;
  url?: string;
  spotify_id?: string;
  query?: string;
  max_results?: number;
};

type SearchResult = {
  type: string;
  id: string;
  name: string;
  url: string;
};

type Output = {
  mode: Mode;
  source_url: string;
  spotify_url: string;
  spotify_id: string;
  title: string;
  embed_type?: string;
  iframe_url?: string;
  embed_html?: string;
  thumbnail_url?: string;
  thumbnail_width?: number;
  thumbnail_height?: number;
  width?: number;
  height?: number;
  total_episodes?: number;
  next_cursor?: number;
  query?: string;
  count?: number;
  results?: SearchResult[];
  episodes?: Array<{
    id: string;
    name: string;
    url: string;
    description?: string;
    release_date?: string;
    duration_ms?: number;
    thumbnail_url?: string;
    preview_url?: string;
    is_explicit?: boolean;
    is_playable?: boolean;
    is_paywalled?: boolean;
    media_types?: string;
  }>;
};

const PATH_BY_MODE: Record<Exclude<Mode, "search">, string> = {
  artist: "artist",
  track: "track",
  album: "album",
  podcast: "show",
  podcast_episodes: "show",
};

function decode(value: string): string {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function strip(value: string): string {
  return decode(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function attribute(attributes: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return attributes.match(new RegExp(`\\b${escaped}=["']([^"']*)`, "i"))?.[1];
}

function searchResults(html: string, limit: number): SearchResult[] {
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = decode(attribute(match[1], "href") ?? "");
    const entity = href.match(/(?:https?:\/\/open\.spotify\.com)?\/(artist|track|album|playlist|show|episode|user|audiobook)\/([^/?#"']+)/i);
    if (!entity) continue;
    const type = entity[1].toLowerCase();
    const id = decodeURIComponent(entity[2]);
    const url = `https://open.spotify.com/${type}/${encodeURIComponent(id)}`;
    const name = strip(decode(attribute(match[1], "title") ?? "")) || strip(match[2]);
    if (!name || seen.has(url)) continue;
    seen.add(url);
    results.push({ type, id, name, url });
    if (results.length >= limit) break;
  }
  return results;
}

function rec(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
const number = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

function target(input: Input): { mode: Mode; url: string; id: string } {
  const raw = input.url?.trim();
  if (raw) {
    const match = raw.match(
      /^https?:\/\/open\.spotify\.com\/(artist|track|album|show)\/([A-Za-z0-9]+)(?:[/?#]|$)/i,
    );
    if (!match) {
      throw new Error("url must be a public open.spotify.com artist, track, album, or show URL");
    }
    const mode: Mode = match[1].toLowerCase() === "show"
      ? input.mode === "podcast_episodes" ? "podcast_episodes" : "podcast"
      : (match[1].toLowerCase() as Mode);
    if (input.mode && input.mode !== mode && !(match[1].toLowerCase() === "show" && input.mode === "podcast_episodes")) {
      throw new Error(`mode ${input.mode} does not match the Spotify URL type`);
    }
    return { mode, id: match[2], url: `https://open.spotify.com/${match[1].toLowerCase()}/${match[2]}` };
  }

  const mode = input.mode;
  const id = input.spotify_id?.trim();
  if (!mode || mode === "search" || !id || !/^[A-Za-z0-9]{10,64}$/.test(id)) {
    throw new Error("Provide a Spotify URL, or provide mode and spotify_id");
  }
  return { mode, id, url: `https://open.spotify.com/${PATH_BY_MODE[mode]}/${id}` };
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function nested(root: unknown, ...keys: string[]): unknown {
  let value = root;
  for (const key of keys) value = rec(value)?.[key];
  return value;
}

function decodeInitialState(html: string): Record<string, unknown> | undefined {
  const encoded = html.match(/<script\b[^>]*id=["']initialState["'][^>]*>([^<]+)<\/script>/i)?.[1]?.trim();
  if (!encoded) return undefined;
  try {
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    return rec(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return undefined;
  }
}

function podcastEpisodesFromHtml(html: string, limit: number): NonNullable<Output["episodes"]> {
  const episodes: NonNullable<Output["episodes"]> = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<a\b[^>]*href=["'](?:https?:\/\/open\.spotify\.com)?\/episode\/([A-Za-z0-9]+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const id = match[1];
    const name = strip(match[2]);
    if (!name || seen.has(id)) continue;
    seen.add(id);
    const tail = html.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 6000);
    const description = strip(tail.match(/<p\b[^>]*id=["']listrow-subtitle-episode-[^"']+["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "") || undefined;
    episodes.push({ id, name, url: `https://open.spotify.com/episode/${id}`, description });
    if (episodes.length >= limit) break;
  }
  return episodes;
}

export default defineTool<Input, Output>(async (input, bf) => {
  if (input.mode === "search" || input.query?.trim()) {
    if (input.mode && input.mode !== "search") throw new Error("query can only be used with search mode");
    const query = input.query?.trim();
    if (!query) throw new Error("query is required for Spotify search");
    const limit = Math.min(Math.max(input.max_results ?? 25, 1), 100);
    const searchUrl = `https://open.spotify.com/search/${encodeURIComponent(query)}`;
    const response = await bf.fetch({
      url: searchUrl,
      strategy: "browser",
      json_mode: false,
      wait_until: "domcontentloaded",
      wait_ms: 5000,
      timeout_ms: 60000,
      include_html: true,
      locale: "en-US",
    });
    if (response.blocked) throw new Error(`Spotify blocked the search request (${response.block_reason ?? "unknown"})`);
    const results = searchResults(response.html ?? response.body_text ?? "", limit);
    if (!results.length) throw new Error("Spotify returned no public search results");
    return {
      mode: "search",
      source_url: response.final_url ?? searchUrl,
      spotify_url: searchUrl,
      spotify_id: "search",
      title: `Spotify search: ${query}`,
      query,
      count: results.length,
      results,
    };
  }
  const item = target(input);
  if (item.mode === "podcast_episodes") {
    const response = await bf.fetch({
      url: item.url,
      strategy: "browser",
      return_response_text: true,
      include_html: true,
      wait_until: "domcontentloaded",
      wait_selector: 'a[href*="/episode/"]',
      wait_ms: 1000,
      timeout_ms: 90_000,
      locale: "en-US",
    });
    const html = response.html || response.body_text || "";
    const state = decodeInitialState(html);
    const show = rec(nested(state, "entities", "items", `spotify:show:${item.id}`));
    const pages = rec(show?.pages);
    let episodes = array(pages?.items).flatMap((entry) => {
      const data = rec(nested(entry, "entity", "data"));
      if (!data || text(data.__typename) !== "Episode") return [];
      const id = text(data.id);
      const name = text(data.name);
      if (!id || !name) return [];
      const images = array(nested(data, "coverArt", "sources")).map(rec).filter(Boolean) as Record<string, unknown>[];
      const labels = array(nested(data, "contentRatingsV2", "labels"));
      const mediaTypes = array(data.mediaTypes).map(text).filter((value): value is string => Boolean(value));
      return [{
        id,
        name,
        url: `https://open.spotify.com/episode/${id}`,
        description: text(data.description),
        release_date: text(nested(data, "releaseDate", "isoString")),
        duration_ms: number(nested(data, "duration", "totalMilliseconds")),
        thumbnail_url: text(images.at(-1)?.url),
        preview_url: text(nested(data, "previewPlayback", "audioPreview", "cdnUrl")),
        is_explicit: labels.includes("EXPLICIT"),
        is_playable: nested(data, "playability", "playable") === true,
        is_paywalled: nested(data, "restrictions", "paywallContent") === true,
        media_types: mediaTypes.join(", ") || undefined,
      }];
    });
    const limit = Math.min(Math.max(input.max_results ?? 25, 1), 100);
    if (!episodes.length) episodes = podcastEpisodesFromHtml(html, limit);
    else episodes = episodes.slice(0, limit);
    const title = text(show?.name) ?? (strip(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "") || undefined);
    if (!title || !episodes.length) throw new Error("Spotify did not return public podcast episodes");
    return {
      mode: item.mode,
      source_url: response.final_url ?? item.url,
      spotify_url: item.url,
      spotify_id: item.id,
      title,
      count: episodes.length,
      total_episodes: number(pages?.totalCount),
      next_cursor: number(nested(pages, "pagingInfo", "nextOffset")),
      episodes,
    };
  }
  const sourceUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(item.url)}`;
  const response = await bf.fetch({
    url: sourceUrl,
    strategy: "http",
    return_response_text: true,
    include_html: false,
    extra_headers: { accept: "application/json" },
  });
  let data = rec(response.json);
  if (!data && response.body_text) {
    try {
      data = rec(JSON.parse(response.body_text));
    } catch {
      // The stable error below keeps the public failure contract concise.
    }
  }
  const title = text(data?.title);
  if (!data || !title) throw new Error("Spotify did not return public embed metadata");
  return {
    mode: item.mode,
    source_url: sourceUrl,
    spotify_url: item.url,
    spotify_id: item.id,
    title,
    embed_type: text(data.type),
    iframe_url: text(data.iframe_url),
    embed_html: text(data.html),
    thumbnail_url: text(data.thumbnail_url),
    thumbnail_width: number(data.thumbnail_width),
    thumbnail_height: number(data.thumbnail_height),
    width: number(data.width),
    height: number(data.height),
  };
});
