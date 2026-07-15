import { defineTool } from "@better-fetch/tools";

type Mode = "artist" | "artist_tracks" | "track";
type Input = { mode?: Mode; url?: string; handle?: string; cursor?: string; max_results?: number };
type Output = {
  mode: Mode;
  source_url: string;
  soundcloud_url: string;
  title: string;
  description?: string;
  author_name?: string;
  author_url?: string;
  thumbnail_url?: string;
  embed_html?: string;
  embed_type?: string;
  width?: number;
  height?: number;
  artist_id?: number;
  next_cursor?: string;
  count?: number;
  tracks?: Array<{
    id: number;
    title: string;
    url: string;
    artwork_url?: string;
    description?: string;
    genre?: string;
    duration_ms?: number;
    created_at?: string;
    release_date?: string;
    playback_count?: number;
    likes_count?: number;
    comment_count?: number;
    reposts_count?: number;
    is_explicit?: boolean;
    is_streamable?: boolean;
  }>;
};

function rec(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
const number = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

function target(input: Input): { mode: Mode; url: string } {
  const raw = input.url?.trim() ?? (input.handle?.trim() ? `https://soundcloud.com/${input.handle.trim().replace(/^@/, "")}` : undefined);
  const match = raw?.match(/^https?:\/\/(?:www\.)?soundcloud\.com\/([^/?#]+)(?:\/([^/?#]+))?/i);
  if (!match) throw new Error("url must be a public soundcloud.com artist or track URL");
  const mode: Mode = match[2] ? "track" : input.mode === "artist_tracks" ? "artist_tracks" : "artist";
  if (input.mode && input.mode !== mode) throw new Error(`mode ${input.mode} does not match the SoundCloud URL`);
  return { mode, url: `https://soundcloud.com/${match[1]}${match[2] ? `/${match[2]}` : ""}` };
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function hydration(html: string): Array<Record<string, unknown>> {
  const encoded = html.match(/window\.__sc_hydration\s*=\s*(\[[\s\S]*?\]);<\/script>/i)?.[1];
  if (!encoded) return [];
  try {
    return array(JSON.parse(encoded)).map(rec).filter(Boolean) as Array<Record<string, unknown>>;
  } catch {
    return [];
  }
}

function cursorFrom(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try { return new URL(url).searchParams.get("offset") ?? undefined; } catch { return undefined; }
}

function positiveInt(value: number | undefined, fallback: number, max: number): number {
  return Number.isInteger(value) && (value as number) > 0 ? Math.min(value as number, max) : fallback;
}

export default defineTool<Input, Output>(async (input, bf) => {
  const item = target(input);
  if (item.mode === "artist_tracks") {
    const profile = await bf.fetch({
      url: item.url,
      strategy: "http",
      return_response_text: true,
      include_html: false,
      extra_headers: { accept: "text/html,application/xhtml+xml" },
    });
    const values = hydration(profile.body_text ?? "");
    const client = rec(values.find((value) => value.hydratable === "apiClient")?.data);
    const user = rec(values.find((value) => value.hydratable === "user")?.data);
    const clientId = text(client?.id);
    const artistId = number(user?.id);
    const title = text(user?.username);
    if (!clientId || artistId === undefined || !title) throw new Error("SoundCloud did not expose public artist listing metadata");
    const limit = positiveInt(input.max_results, 20, 50);
    const endpoint = (cursor?: string) => {
      const params = new URLSearchParams({ client_id: clientId, limit: String(limit), linked_partitioning: "1", app_locale: "en" });
      if (cursor) params.set("offset", cursor);
      return `https://api-v2.soundcloud.com/users/${artistId}/tracks?${params}`;
    };
    let sourceUrl = endpoint(input.cursor?.trim());
    let response = await bf.fetch({ url: sourceUrl, strategy: "http", return_response_text: true, include_html: false, extra_headers: { accept: "application/json" } });
    let data = rec(response.json);
    if (!data && response.body_text) {
      try { data = rec(JSON.parse(response.body_text)); } catch { /* handled below */ }
    }
    if (!array(data?.collection).length && !input.cursor) {
      const next = cursorFrom(text(data?.next_href));
      if (next) {
        sourceUrl = endpoint(next);
        response = await bf.fetch({ url: sourceUrl, strategy: "http", return_response_text: true, include_html: false, extra_headers: { accept: "application/json" } });
        data = rec(response.json);
        if (!data && response.body_text) {
          try { data = rec(JSON.parse(response.body_text)); } catch { /* handled below */ }
        }
      }
    }
    const tracks = array(data?.collection).flatMap((value) => {
      const track = rec(value);
      if (!track) return [];
      const id = number(track.id);
      const trackTitle = text(track.title);
      const url = text(track.permalink_url);
      if (id === undefined || !trackTitle || !url) return [];
      return [{
        id,
        title: trackTitle,
        url,
        artwork_url: text(track.artwork_url),
        description: text(track.description),
        genre: text(track.genre),
        duration_ms: number(track.duration),
        created_at: text(track.created_at),
        release_date: text(track.release_date),
        playback_count: number(track.playback_count),
        likes_count: number(track.likes_count),
        comment_count: number(track.comment_count),
        reposts_count: number(track.reposts_count),
        is_explicit: rec(track.publisher_metadata)?.explicit === true,
        is_streamable: track.streamable === true,
      }];
    });
    if (!tracks.length) throw new Error("SoundCloud returned no public artist tracks");
    return {
      mode: item.mode,
      source_url: sourceUrl,
      soundcloud_url: item.url,
      title,
      artist_id: artistId,
      next_cursor: cursorFrom(text(data?.next_href)),
      count: tracks.length,
      tracks,
    };
  }
  const sourceUrl = `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(item.url)}`;
  const response = await bf.fetch({
    url: sourceUrl,
    strategy: "http",
    return_response_text: true,
    include_html: false,
    extra_headers: { accept: "application/json" },
  });
  let data = rec(response.json);
  if (!data && response.body_text) {
    try { data = rec(JSON.parse(response.body_text)); } catch { /* handled below */ }
  }
  const title = text(data?.title);
  if (!data || !title) throw new Error("SoundCloud did not return public embed metadata");
  return {
    mode: item.mode,
    source_url: sourceUrl,
    soundcloud_url: item.url,
    title,
    description: text(data.description),
    author_name: text(data.author_name),
    author_url: text(data.author_url),
    thumbnail_url: text(data.thumbnail_url),
    embed_html: text(data.html),
    embed_type: text(data.type),
    width: number(data.width),
    height: number(data.height),
  };
});
