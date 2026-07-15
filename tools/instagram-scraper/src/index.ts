import { defineTool, type Bf } from "@better-fetch/tools";

type Transcript = {
  text: string;
  language?: string;
  language_probability?: number;
  duration_seconds?: number;
  segments?: Array<{ start: number; end: number; text: string }>;
};
type TranscriptSummary = Omit<Transcript, "segments">;

type TranscriptionBf = Bf & {
  transcribe(payload: { url: string; language?: string }): Promise<Transcript>;
};

type Input = {
  mode?: "profile_posts" | "user_reels" | "audio_reels" | "story_highlights" | "highlight_detail" | "embed" | "post" | "post_comments" | "transcript";
  username?: string;
  profile_url?: string;
  max_recent_posts?: number;
  max_results?: number;
  post_url?: string;
  audio_id?: string;
  highlight_id?: string;
  language?: string;
};

type RecentPost = {
  shortcode: string;
  url: string;
  caption?: string;
  thumbnail?: string;
  is_video?: boolean;
  taken_at?: string;
  like_count?: number;
  comment_count?: number;
};

type Output = {
  mode: "profile_posts" | "user_reels" | "audio_reels" | "story_highlights" | "highlight_detail" | "embed" | "post" | "post_comments" | "transcript";
  source_url: string;
  username?: string;
  full_name?: string;
  audio_id?: string;
  audio_title?: string;
  audio_artist?: string;
  audio_reel_count_text?: string;
  biography?: string;
  external_url?: string;
  profile_pic_url?: string;
  verified?: boolean;
  private_account?: boolean;
  follower_count?: number;
  following_count?: number;
  media_count?: number;
  recent_posts?: RecentPost[];
  reels?: Array<{
    shortcode: string;
    url: string;
    thumbnail?: string;
    video_url?: string;
    caption?: string;
    taken_at?: string;
    view_count?: number;
    like_count?: number;
    comment_count?: number;
    author_id?: string;
    author_username?: string;
    author_name?: string;
    author_verified?: boolean;
  }>;
  embed_html?: string;
  post?: {
    id: string;
    shortcode: string;
    url: string;
    type?: string;
    caption?: string;
    accessibility_caption?: string;
    thumbnail?: string;
    video_url?: string;
    video_duration?: number;
    has_audio?: boolean;
    view_count?: number;
    play_count?: number;
    like_count?: number;
    comment_count?: number;
    taken_at?: string;
    author_id?: string;
    author_username?: string;
    author_name?: string;
    author_avatar?: string;
  };
  transcript?: TranscriptSummary;
  transcript_segments?: NonNullable<Transcript["segments"]>;
  comments?: Array<{
    id: string;
    text: string;
    created_at?: string;
    like_count?: number;
    reply_count?: number;
    author_id?: string;
    author_username?: string;
    author_avatar?: string;
    author_verified?: boolean;
  }>;
  highlight_id?: string;
  highlight_title?: string;
  highlights?: Array<{
    id: string;
    title: string;
    url: string;
    cover_url?: string;
  }>;
  highlight_items?: Array<{
    id: string;
    code?: string;
    media_type?: number;
    media_type_name?: string;
    taken_at?: string;
    expires_at?: string;
    image_url?: string;
    video_url?: string;
    width?: number;
    height?: number;
    duration?: number;
    has_audio?: boolean;
    accessibility_caption?: string;
    caption?: string;
    owner_id?: string;
    owner_username?: string;
    owner_name?: string;
    cta_url?: string;
  }>;
  count?: number;
  next_cursor?: string;
  has_more?: boolean;
};

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.replace(/\s+/g, " ").trim();
  return clean || undefined;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value !== "string") return undefined;
  const n = Number(value.replace(/,/g, ""));
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

function abbreviatedNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = value.trim().replace(/,/g, "").match(/^(\d+(?:\.\d+)?)([KMB])?$/i);
  if (!match) return undefined;
  const multiplier = match[2]?.toUpperCase() === "K" ? 1_000
    : match[2]?.toUpperCase() === "M" ? 1_000_000
      : match[2]?.toUpperCase() === "B" ? 1_000_000_000
        : 1;
  return Math.round(Number(match[1]) * multiplier);
}

function metaContent(html: string, key: string): string | undefined {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const name = tag.match(/(?:property|name)=["']([^"']+)["']/i)?.[1];
    if (name?.toLowerCase() !== key.toLowerCase()) continue;
    const content = tag.match(/content=["']([\s\S]*?)["']/i)?.[1];
    if (content) return text(decodeEntities(content));
  }
  return undefined;
}

function audioReelsFromHtml(html: string, limit: number): NonNullable<Output["reels"]> {
  const reels: NonNullable<Output["reels"]> = [];
  const anchors = /<a\b[^>]*href=["']\/(?:[^"']*\/)?reel\/([A-Za-z0-9_-]+)\/?["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchors)) {
    const shortcode = match[1];
    if (reels.some((reel) => reel.shortcode === shortcode)) continue;
    const body = match[2];
    const background = body.match(/background-image:\s*url\(&quot;([\s\S]*?)&quot;\)/i)?.[1]
      ?? body.match(/background-image:\s*url\(["']([^"']+)["']\)/i)?.[1];
    const visibleText = decodeEntities(body.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    const values = [...visibleText.matchAll(/\b(\d[\d,.]*(?:\.\d+)?[KMB]?)\b/gi)].map((value) => value[1]);
    const [likes, comments] = values;
    const views = visibleText.match(/View count icon\s*(\d[\d,.]*(?:\.\d+)?[KMB]?)/i)?.[1]
      ?? values.at(-1);
    reels.push(compact({
      shortcode,
      url: `https://www.instagram.com/reel/${shortcode}/`,
      thumbnail: background ? decodeEntities(background) : undefined,
      view_count: abbreviatedNumber(views),
      like_count: abbreviatedNumber(likes),
      comment_count: abbreviatedNumber(comments),
    }));
    if (reels.length >= limit) break;
  }
  return reels;
}

function storyHighlightsFromHtml(html: string, limit: number): NonNullable<Output["highlights"]> {
  const highlights: NonNullable<Output["highlights"]> = [];
  const anchors = /<a\b([^>]*\bhref=["']\/stories\/highlights\/(\d+)\/?["'][^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchors)) {
    const id = match[2];
    if (highlights.some((highlight) => highlight.id === id)) continue;
    const attributes = match[1];
    const body = match[3];
    const label = attributes.match(/\baria-label=["']View\s+([\s\S]*?)\s+highlight["']/i)?.[1];
    const image = body.match(/<img\b[^>]*\bsrc=["']([\s\S]*?)["']/i)?.[1];
    const alt = body.match(/<img\b[^>]*\balt=["']([\s\S]*?)["']/i)?.[1];
    const title = text(decodeEntities(label ?? alt?.replace(/'s profile picture$/i, "") ?? ""));
    if (!title) continue;
    highlights.push(compact({
      id,
      title,
      url: `https://www.instagram.com/stories/highlights/${id}/`,
      cover_url: image ? decodeEntities(image) : undefined,
    }));
    if (highlights.length >= limit) break;
  }
  return highlights;
}

function jsonFromNetworkBody(body: unknown): unknown {
  if (typeof body !== "string") return undefined;
  const normalized = body.replace(/^for \(;;\);/, "").trim();
  if (!normalized.startsWith("{")) return undefined;
  try { return JSON.parse(normalized); } catch { return undefined; }
}

function audioPayloadFromNetwork(network: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(network)) return undefined;
  for (const entry of network) {
    const item = objectValue(entry);
    if (!item || !text(item.url)?.includes("/api/v1/clips/music/")) continue;
    const json = objectValue(jsonFromNetworkBody(item.body_text));
    const payload = objectValue(json?.payload);
    if (payload) return payload;
  }
  return undefined;
}

function audioReelsFromPayload(payload: Record<string, unknown>, limit: number): NonNullable<Output["reels"]> {
  const items = Array.isArray(payload.items) ? payload.items : [];
  const reels: NonNullable<Output["reels"]> = [];
  for (const item of items) {
    const media = objectValue(objectValue(item)?.media);
    const shortcode = text(media?.code);
    if (!media || !shortcode || reels.some((reel) => reel.shortcode === shortcode)) continue;
    const user = objectValue(media.user);
    const caption = objectValue(media.caption);
    const imageVersions = objectValue(media.image_versions2);
    reels.push(compact({
      shortcode,
      url: `https://www.instagram.com/reel/${shortcode}/`,
      thumbnail: firstUrl(imageVersions?.candidates),
      video_url: firstUrl(media.video_versions),
      caption: text(caption?.text),
      taken_at: isoFromSeconds(media.taken_at),
      view_count: numberValue(media.play_count ?? media.ig_play_count),
      like_count: numberValue(media.like_count),
      comment_count: numberValue(media.comment_count),
      author_id: text(user?.id ?? user?.pk),
      author_username: text(user?.username),
      author_name: text(user?.full_name),
      author_verified: booleanValue(user?.is_verified),
    }));
    if (reels.length >= limit) break;
  }
  return reels;
}

function audioMetadataFromPayload(payload: Record<string, unknown>): { title?: string; artist?: string } {
  const items = Array.isArray(payload.items) ? payload.items : [];
  for (const item of items) {
    const media = objectValue(objectValue(item)?.media);
    const clips = objectValue(media?.clips_metadata);
    const music = objectValue(objectValue(clips?.music_info)?.music_asset_info);
    if (music) return { title: text(music.title), artist: text(music.display_artist) };
    const sound = objectValue(clips?.original_sound_info);
    if (sound) {
      const artist = objectValue(sound.ig_artist);
      return { title: text(sound.original_audio_title), artist: text(artist?.full_name ?? artist?.username) };
    }
  }
  return {};
}

function countFromEdge(value: unknown): number | undefined {
  return numberValue(objectValue(value)?.count);
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function usernameFrom(input: Input): string {
  if (input.profile_url?.trim()) {
    const match = input.profile_url
      .trim()
      .match(/^https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9._]+)\/?/i);
    if (!match) throw new Error("profile_url must be an Instagram profile URL");
    return match[1];
  }
  const username = input.username?.trim().replace(/^@/, "");
  if (!username || !/^[A-Za-z0-9._]{1,64}$/.test(username)) {
    throw new Error("Provide an Instagram username or profile_url");
  }
  return username;
}

function profileUrl(username: string): string {
  return `https://www.instagram.com/${username}/`;
}

function postUrlFrom(input: Input): { url: string; username: string; shortcode: string } {
  const raw = input.post_url?.trim();
  if (!raw) throw new Error("post_url is required for post mode");
  const match = raw.match(/^https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9._]+)\/(reel|p)\/([A-Za-z0-9_-]+)/i);
  if (!match) throw new Error("post_url must be a public Instagram post or reel URL");
  return { url: `https://www.instagram.com/${match[1]}/${match[2]}/${match[3]}/`, username: match[1], shortcode: match[3] };
}

function apiUrl(username: string): string {
  return `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
}

function isoFromSeconds(value: unknown): string | undefined {
  const seconds = numberValue(value);
  return seconds ? new Date(seconds * 1000).toISOString() : undefined;
}

function captionFrom(node: Record<string, unknown>): string | undefined {
  const edges = objectValue(node.edge_media_to_caption)?.edges;
  if (!Array.isArray(edges)) return undefined;
  return text(objectValue(objectValue(edges[0])?.node)?.text);
}

function compact<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined && item !== "" && (!Array.isArray(item) || item.length > 0)) out[key] = item;
  }
  return out as T;
}

function scriptJson(html: string): unknown[] {
  const values: unknown[] = [];
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { values.push(JSON.parse(match[1])); } catch { /* ignore unrelated malformed payloads */ }
  }
  return values;
}

function objectsWithCode(root: unknown, shortcode: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const stack: unknown[] = [root];
  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== "object") continue;
    if (Array.isArray(value)) {
      for (const item of value) stack.push(item);
      continue;
    }
    const object = value as Record<string, unknown>;
    if (object.code === shortcode) found.push(object);
    for (const item of Object.values(object)) stack.push(item);
  }
  return found;
}

function objectsWhere(root: unknown, predicate: (value: Record<string, unknown>) => boolean): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const stack: unknown[] = [root];
  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== "object") continue;
    if (Array.isArray(value)) {
      for (const item of value) stack.push(item);
      continue;
    }
    const object = value as Record<string, unknown>;
    if (predicate(object)) found.push(object);
    for (const item of Object.values(object)) stack.push(item);
  }
  return found;
}

function firstNestedUrl(value: unknown): string | undefined {
  const stack: unknown[] = [value];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }
    const object = current as Record<string, unknown>;
    for (const key of ["url", "link", "web_uri", "webUri"]) {
      const candidate = text(object[key]);
      if (candidate && /^https?:\/\//i.test(candidate)) return candidate;
    }
    for (const item of Object.values(object)) stack.push(item);
  }
  return undefined;
}

function highlightTarget(input: Input): { id: string; url: string } {
  const raw = input.highlight_id?.trim();
  const id = raw?.match(/(?:stories\/highlights\/)?(\d{8,30})/i)?.[1];
  if (!id) throw new Error("highlight_id must be a numeric Instagram highlight id or highlight URL");
  return { id, url: `https://www.instagram.com/stories/highlights/${id}/` };
}

function highlightItems(reel: Record<string, unknown>, limit: number): NonNullable<Output["highlight_items"]> {
  const owner = objectValue(reel.user);
  const items = Array.isArray(reel.items) ? reel.items : [];
  const results: NonNullable<Output["highlight_items"]> = [];
  for (const rawItem of items) {
    const item = objectValue(rawItem);
    const id = text(item?.pk ?? item?.id)?.split("_", 1)[0];
    if (!item || !id || results.some((result) => result.id === id)) continue;
    const mediaType = numberValue(item.media_type);
    const caption = objectValue(item.caption);
    const storyOwner = objectValue(item.user) ?? owner;
    results.push(compact({
      id,
      code: text(item.code),
      media_type: mediaType,
      media_type_name: mediaType === 1 ? "image" : mediaType === 2 ? "video" : mediaType === 8 ? "carousel" : undefined,
      taken_at: isoFromSeconds(item.taken_at),
      expires_at: isoFromSeconds(item.expiring_at),
      image_url: firstUrl(objectValue(item.image_versions2)?.candidates),
      video_url: firstUrl(item.video_versions),
      width: numberValue(item.original_width),
      height: numberValue(item.original_height),
      duration: typeof item.video_duration === "number" ? item.video_duration : undefined,
      has_audio: booleanValue(item.has_audio),
      accessibility_caption: text(item.accessibility_caption),
      caption: text(caption?.text),
      owner_id: text(storyOwner?.id ?? storyOwner?.pk),
      owner_username: text(storyOwner?.username),
      owner_name: text(storyOwner?.full_name),
      cta_url: firstNestedUrl(item.story_cta) ?? firstNestedUrl(item.story_link_stickers),
    }));
    if (results.length >= limit) break;
  }
  return results;
}

function firstUrl(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  for (const item of value) {
    const url = text(objectValue(item)?.url);
    if (url) return url;
  }
  return undefined;
}

function recentPosts(value: unknown, limit: number): RecentPost[] | undefined {
  const edges = objectValue(value)?.edges;
  if (!Array.isArray(edges) || limit <= 0) return undefined;
  const posts: RecentPost[] = [];
  for (const edge of edges) {
    if (posts.length >= limit) break;
    const node = objectValue(objectValue(edge)?.node);
    const shortcode = text(node?.shortcode);
    if (!node || !shortcode) continue;
    posts.push(
      compact({
        shortcode,
        url: `https://www.instagram.com/p/${shortcode}/`,
        caption: captionFrom(node),
        thumbnail: text(node.display_url) ?? text(node.thumbnail_src),
        is_video: booleanValue(node.is_video),
        taken_at: isoFromSeconds(node.taken_at_timestamp),
        like_count: countFromEdge(node.edge_liked_by) ?? countFromEdge(node.edge_media_preview_like),
        comment_count: countFromEdge(node.edge_media_to_comment),
      }),
    );
  }
  return posts.length ? posts : undefined;
}

function reelsFromHtml(html: string, username: string, limit: number): NonNullable<Output["reels"]> {
  const reels: NonNullable<Output["reels"]> = [];
  const anchors = /<a\b[^>]*href=["']\/(?:[^"']*\/)?reel\/([A-Za-z0-9_-]+)\/?["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchors)) {
    const shortcode = match[1];
    if (reels.some((reel) => reel.shortcode === shortcode)) continue;
    const body = match[2];
    const background = body.match(/background-image:\s*url\(&quot;([\s\S]*?)&quot;\)/i)?.[1]
      ?? body.match(/background-image:\s*url\(["']([^"']+)["']\)/i)?.[1];
    const label = decodeEntities(body.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().split(" ")[0];
    reels.push({
      shortcode,
      url: `https://www.instagram.com/${username}/reel/${shortcode}/`,
      thumbnail: background ? decodeEntities(background) : undefined,
      view_count: abbreviatedNumber(label),
    });
    if (reels.length >= limit) break;
  }
  return reels;
}

function recentReels(value: unknown, username: string, limit: number): NonNullable<Output["reels"]> {
  const edges = objectValue(value)?.edges;
  if (!Array.isArray(edges)) return [];
  const reels: NonNullable<Output["reels"]> = [];
  for (const edge of edges) {
    const node = objectValue(objectValue(edge)?.node);
    const shortcode = text(node?.shortcode);
    if (!node || !shortcode || node.is_video !== true) continue;
    reels.push({
      shortcode,
      url: `https://www.instagram.com/${username}/reel/${shortcode}/`,
      thumbnail: text(node.display_url) ?? text(node.thumbnail_src),
      view_count: numberValue(node.video_view_count ?? node.video_play_count),
    });
    if (reels.length >= limit) break;
  }
  return reels;
}

export default defineTool<Input, Output>(async (input, bf) => {
  const mode = input.mode ?? (input.post_url ? "post" : "profile_posts");
  if (mode === "highlight_detail") {
    const target = highlightTarget(input);
    const maxResults = Math.min(Math.max(input.max_results ?? 50, 1), 100);
    const page = await bf.fetch({
      url: target.url,
      strategy: "browser",
      return_response_text: true,
      include_html: true,
      wait_until: "domcontentloaded",
      wait_ms: 2500,
      timeout_ms: 90_000,
      locale: "en-US",
      proxy: "auto",
      extra_headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
    });
    if (page.blocked) throw new Error(`Instagram blocked the public highlight (${page.block_reason ?? "unknown"})`);
    const html = page.body_text ?? page.html ?? "";
    const reel = scriptJson(html)
      .flatMap((root) => objectsWhere(root, (value) => value.id === `highlight:${target.id}` && Array.isArray(value.items)))
      .sort((a, b) => (Array.isArray(b.items) ? b.items.length : 0) - (Array.isArray(a.items) ? a.items.length : 0))[0];
    if (!reel) throw new Error("Instagram highlight metadata was not found in the public page payload");
    const items = highlightItems(reel, maxResults);
    if (!items.length) throw new Error("Instagram returned no public highlight items");
    const owner = objectValue(reel.user);
    return compact({
      mode,
      source_url: page.final_url ?? target.url,
      username: text(owner?.username),
      full_name: text(owner?.full_name) ?? text(owner?.username),
      highlight_id: target.id,
      highlight_title: text(reel.title),
      highlight_items: items,
      count: items.length,
    });
  }
  if (mode === "audio_reels") {
    const audioId = input.audio_id?.trim();
    if (!audioId || !/^\d{5,30}$/.test(audioId)) throw new Error("audio_id is required for audio_reels mode");
    const maxResults = Math.min(Math.max(input.max_results ?? 12, 1), 30);
    const sourceUrl = `https://www.instagram.com/reels/audio/${audioId}/`;
    const page = await bf.fetch({
      url: sourceUrl,
      strategy: "browser",
      return_response_text: true,
      include_html: true,
      wait_until: "domcontentloaded",
      wait_selector: 'a[href*="/reel/"]',
      wait_ms: 1500,
      timeout_ms: 90_000,
      locale: "en-US",
      proxy: "auto",
      capture_network: true,
      network_resource_types: ["xhr", "fetch"],
      network_include_bodies: true,
      network_max_entries: 50,
      network_max_body_bytes: 1_048_576,
      extra_headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
    });
    const html = page.html || page.body_text || "";
    const payload = audioPayloadFromNetwork(page.network);
    const payloadReels = payload ? audioReelsFromPayload(payload, maxResults) : [];
    // Instagram can emit a metadata-only music payload while the rendered
    // logged-out page still contains the public reel grid.
    const reels = payloadReels.length ? payloadReels : audioReelsFromHtml(html, maxResults);
    if (!reels.length) throw new Error("Instagram returned no public reels for this audio page");
    const title = metaContent(html, "og:title")?.replace(/\s+on Instagram$/i, "");
    const [titleArtist, titleAudio] = title?.split(/\s+\|\s+/, 2) ?? [];
    const metadata = payload ? audioMetadataFromPayload(payload) : {};
    const description = metaContent(html, "og:description") ?? metaContent(html, "description");
    const paging = objectValue(payload?.paging_info);
    return compact({
      mode,
      source_url: page.final_url ?? sourceUrl,
      count: reels.length,
      audio_id: audioId,
      audio_title: metadata.title ?? titleAudio,
      audio_artist: metadata.artist ?? titleArtist,
      audio_reel_count_text: text(payload?.formatted_media_count)
        ?? description?.match(/^([^–-]+)\s+[–-]\s+/)?.[1]?.trim(),
      reels,
      next_cursor: text(paging?.max_id),
      has_more: booleanValue(paging?.more_available),
    });
  }
  if (mode === "post" || mode === "post_comments" || mode === "transcript") {
    const target = postUrlFrom(input);
    const page = await bf.fetch({
      url: target.url,
      strategy: "browser",
      return_response_text: true,
      include_html: true,
      wait_until: "domcontentloaded",
      wait_ms: 2000,
      timeout_ms: 90_000,
      locale: "en-US",
      extra_headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36",
      },
    });
    const html = page.body_text ?? page.html ?? "";
    const candidates = scriptJson(html).flatMap((value) => objectsWithCode(value, target.shortcode));
    if (mode === "post_comments") {
      const connection = candidates.map((item) => objectValue(item.comments_connection)).find(Boolean);
      const edges = Array.isArray(connection?.edges) ? connection.edges : [];
      const maxResults = Math.min(Math.max(input.max_results ?? 20, 1), 50);
      const comments = edges.flatMap((edge) => {
        const node = objectValue(objectValue(edge)?.node);
        const id = text(node?.id ?? node?.pk);
        const body = text(node?.text);
        if (!node || !id || !body) return [];
        const user = objectValue(node.user);
        return [{
          id,
          text: body,
          created_at: isoFromSeconds(node.created_at),
          like_count: numberValue(node.comment_like_count),
          reply_count: numberValue(node.child_comment_count),
          author_id: text(user?.id ?? user?.pk),
          author_username: text(user?.username),
          author_avatar: text(user?.profile_pic_url),
          author_verified: booleanValue(user?.is_verified),
        }];
      }).slice(0, maxResults);
      if (!comments.length) throw new Error("Instagram returned no public post comments");
      const pageInfo = objectValue(connection?.page_info);
      return {
        mode,
        source_url: page.final_url ?? target.url,
        username: target.username,
        full_name: target.username,
        comments,
        count: comments.length,
        next_cursor: text(pageInfo?.end_cursor),
        has_more: booleanValue(pageInfo?.has_next_page),
      };
    }
    const media = candidates.sort((a, b) => Object.keys(b).length - Object.keys(a).length)
      .find((item) => objectValue(item.caption) || item.display_uri || item.video_versions);
    if (!media) throw new Error("Instagram post metadata was not found in the public page payload");
    const user = objectValue(media.user);
    const caption = objectValue(media.caption);
    const post = compact({
      id: text(media.pk) ?? text(media.id)?.replace(/^POLARIS_/, "") ?? target.shortcode,
      shortcode: target.shortcode,
      url: target.url,
      type: text(media.product_type) ?? text(media.__typename),
      caption: text(caption?.text),
      accessibility_caption: text(media.accessibility_caption),
      thumbnail: text(media.display_uri),
      video_url: firstUrl(media.video_versions),
      video_duration: typeof media.video_duration === "number" ? media.video_duration : undefined,
      has_audio: booleanValue(media.has_audio),
      view_count: numberValue(media.video_view_count),
      play_count: numberValue(media.play_count ?? media.ig_play_count),
      like_count: numberValue(media.like_count),
      comment_count: numberValue(media.comment_count),
      taken_at: isoFromSeconds(media.taken_at ?? media.taken_at_timestamp),
      author_id: text(user?.pk ?? user?.id),
      author_username: text(user?.username) ?? target.username,
      author_name: text(user?.full_name),
      author_avatar: text(user?.profile_pic_url),
    });
    if (mode === "transcript") {
      if (!post.video_url) throw new Error("Instagram post does not expose a public video rendition");
      const transcriptResult = await (bf as TranscriptionBf).transcribe({
        url: post.video_url,
        language: input.language,
      });
      const { segments: transcriptSegments, ...transcript } = transcriptResult;
      return {
        mode,
        source_url: page.final_url ?? target.url,
        username: text(user?.username) ?? target.username,
        full_name: text(user?.full_name) ?? text(user?.username) ?? target.username,
        post,
        transcript,
        transcript_segments: transcriptSegments,
      };
    }
    return {
      mode,
      source_url: page.final_url ?? target.url,
      username: text(user?.username) ?? target.username,
      full_name: text(user?.full_name) ?? text(user?.username) ?? target.username,
      post,
    };
  }
  const username = usernameFrom(input);
  const sourceUrl = profileUrl(username);
  if (mode === "story_highlights") {
    const maxResults = Math.min(Math.max(input.max_results ?? 20, 1), 50);
    const page = await bf.fetch({
      url: sourceUrl,
      strategy: "browser",
      return_response_text: true,
      include_html: true,
      wait_until: "domcontentloaded",
      wait_selector: 'a[href*="/stories/highlights/"]',
      wait_ms: 1000,
      timeout_ms: 90_000,
      locale: "en-US",
      proxy: "auto",
    });
    if (page.blocked) throw new Error(`Instagram blocked the public profile highlights (${page.block_reason ?? "unknown"})`);
    const highlights = storyHighlightsFromHtml(page.html ?? page.body_text ?? "", maxResults);
    if (!highlights.length) throw new Error("Instagram returned no public story highlights for this profile");
    return {
      mode,
      source_url: page.final_url ?? sourceUrl,
      username,
      full_name: username,
      highlights,
      count: highlights.length,
    };
  }
  if (mode === "embed") {
    const embedUrl = `https://www.instagram.com/${username}/embed/`;
    const page = await bf.fetch({
      url: embedUrl,
      strategy: "http",
      return_response_text: true,
      include_html: true,
      extra_headers: { accept: "text/html,application/xhtml+xml", "accept-language": "en-US,en;q=0.9" },
    });
    const html = page.body_text ?? page.html ?? "";
    if (!/<html\b/i.test(html)) throw new Error("Instagram did not return public profile embed HTML");
    return { mode, source_url: page.final_url ?? embedUrl, username, full_name: username, embed_html: html };
  }
  const maxRecent = Math.min(input.max_recent_posts ?? 6, 12);
  const page = await bf.fetch({
    url: apiUrl(username),
    strategy: "browser",
    return_response_text: true,
    include_html: true,
    wait_until: "domcontentloaded",
    wait_ms: 1500,
    timeout_ms: 90_000,
    proxy: "auto",
    extra_headers: {
      accept: "*/*",
      "accept-language": "en-US,en;q=0.9",
      referer: sourceUrl,
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36",
      "x-asbd-id": "129477",
      "x-ig-app-id": "936619743392459",
      "x-requested-with": "XMLHttpRequest",
    },
  });

  let json = page.json;
  const raw = page.body_text || page.html;
  if (!json && raw) {
    try {
      json = JSON.parse(raw);
    } catch {
      /* handled below */
    }
  }
  const user = objectValue(objectValue(objectValue(json)?.data)?.user);
  if (!user) throw new Error("Instagram profile metadata was not found in the public web response");

  if (mode === "user_reels") {
    const maxResults = Math.min(Math.max(input.max_results ?? 12, 1), 30);
    const reels = recentReels(user.edge_owner_to_timeline_media, username, maxResults);
    if (!reels.length) throw new Error("Instagram returned no public video reels for this profile");
    return {
      mode,
      source_url: `https://www.instagram.com/${username}/reels/`,
      username: text(user.username) ?? username,
      full_name: text(user.full_name) ?? text(user.username) ?? username,
      reels,
    };
  }

  return compact({
    mode: "profile_posts" as const,
    source_url: sourceUrl,
    username: text(user.username) ?? username,
    full_name: text(user.full_name) ?? text(user.username) ?? username,
    biography: text(user.biography),
    external_url: text(user.external_url),
    profile_pic_url: text(user.profile_pic_url_hd) ?? text(user.profile_pic_url),
    verified: booleanValue(user.is_verified),
    private_account: booleanValue(user.is_private),
    follower_count: countFromEdge(user.edge_followed_by),
    following_count: countFromEdge(user.edge_follow),
    media_count: countFromEdge(user.edge_owner_to_timeline_media),
    recent_posts: recentPosts(user.edge_owner_to_timeline_media, maxRecent),
  });
});
