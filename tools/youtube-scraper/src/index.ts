import { defineTool } from "@better-fetch/tools";

type Mode =
  | "search"
  | "channel"
  | "channel_videos"
  | "channel_shorts"
  | "channel_lives"
  | "channel_playlists"
  | "channel_posts"
  | "hashtag_search"
  | "playlist"
  | "community_post"
  | "video_comments"
  | "comment_replies"
  | "video_sponsors"
  | "trending_shorts"
  | "video";

type Input = {
  mode?: Mode;
  query?: string;
  channel_url?: string;
  video_url?: string;
  comment_id?: string;
  playlist_id?: string;
  hashtag?: string;
  post_url?: string;
  content_type?: "all" | "shorts";
  max_results?: number;
};

type Video = {
  video_id: string;
  title: string;
  url: string;
  channel?: string;
  channel_id?: string;
  channel_url?: string;
  duration?: string;
  duration_seconds?: number;
  views_text?: string;
  view_count?: number;
  like_count?: number;
  comment_count?: number;
  published?: string;
  thumbnail?: string;
  description?: string;
  keywords?: string;
};

type Playlist = {
  playlist_id: string;
  title: string;
  url: string;
  video_count_text?: string;
  updated?: string;
  thumbnail?: string;
};

type Channel = {
  channel_id: string;
  title: string;
  url: string;
  handle_url?: string;
  description?: string;
  avatar?: string;
  rss_url?: string;
  is_family_safe?: boolean;
};

type PlaylistDetail = {
  playlist_id: string;
  title: string;
  url: string;
  description?: string;
  owner?: string;
  owner_url?: string;
  owner_channel_id?: string;
  total_videos?: number;
  views_text?: string;
  updated?: string;
  thumbnail?: string;
};

type CommunityPost = {
  id: string;
  url: string;
  channel_title?: string;
  channel_id?: string;
  channel_url?: string;
  content?: string;
  image_urls?: string;
  image_count?: number;
  like_count_text?: string;
  like_count?: number;
  published?: string;
  video_id?: string;
  video_title?: string;
  video_url?: string;
  video_thumbnail?: string;
};

type Comment = {
  id: string;
  content: string;
  url: string;
  published?: string;
  reply_level?: number;
  author_name?: string;
  author_channel_id?: string;
  author_verified?: boolean;
  author_creator?: boolean;
  author_avatar_url?: string;
  author_channel_url?: string;
  like_count_text?: string;
  like_count?: number;
  reply_count_text?: string;
  reply_count?: number;
  replies_continuation_token?: string;
};

type Output = {
  source: string;
  source_url: string;
  count: number;
  videos: Video[];
  playlists?: Playlist[];
  channel?: Channel;
  playlist?: PlaylistDetail;
  posts?: CommunityPost[];
  comments?: Comment[];
  parent_comment_id?: string;
  total_count?: number;
  comments_continuation_token?: string;
  continuation_token?: string;
  sponsor_video?: {
    id: string;
    url: string;
    title: string;
    channel?: string;
    channel_id?: string;
    channel_url?: string;
    is_paid_promotion: boolean;
  };
  suspected_sponsors?: Array<{
    name: string;
    website?: string;
    confidence: "high" | "medium";
    evidence_source: string;
    evidence_text: string;
  }>;
  sponsor_segments?: Array<{
    start_seconds: number;
    end_seconds: number;
    duration_seconds: number;
    category: string;
    votes?: number;
    locked?: boolean;
  }>;
  sponsor_detection?: {
    status: "found" | "paid_promotion_only" | "not_found";
    methods: string;
    note: string;
  };
};

type JsonObject = Record<string, unknown>;

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function textFrom(node: unknown): string | undefined {
  if (!node) return undefined;
  if (typeof node === "string") return node.trim() || undefined;
  if (typeof node !== "object") return undefined;
  const obj = node as JsonObject;
  if (typeof obj.simpleText === "string") return obj.simpleText.trim();
  if (typeof obj.content === "string") return obj.content.trim();
  if (Array.isArray(obj.runs)) {
    const text = obj.runs
      .map((run) => (run && typeof run === "object" ? (run as JsonObject).text : ""))
      .filter((value): value is string => typeof value === "string")
      .join("")
      .trim();
    if (text) return text;
  }
  const accessibility = obj.accessibility as JsonObject | undefined;
  const data = accessibility?.accessibilityData as JsonObject | undefined;
  return typeof data?.label === "string" ? data.label.trim() : undefined;
}

function absoluteYouTubeUrl(path: string | undefined): string | undefined {
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith("//")) return `https:${path}`;
  if (path.startsWith("/")) return `https://www.youtube.com${path}`;
  return `https://www.youtube.com/${path}`;
}

function firstRunUrl(node: unknown): string | undefined {
  if (!node || typeof node !== "object") return undefined;
  const runs = (node as JsonObject).runs;
  if (!Array.isArray(runs)) return undefined;
  for (const run of runs) {
    if (!run || typeof run !== "object") continue;
    const endpoint = (run as JsonObject).navigationEndpoint as JsonObject | undefined;
    const command = endpoint?.commandMetadata as JsonObject | undefined;
    const web = command?.webCommandMetadata as JsonObject | undefined;
    if (typeof web?.url === "string") return absoluteYouTubeUrl(web.url);
  }
  return undefined;
}

function imageSource(node: unknown): string | undefined {
  const stack: unknown[] = [node];
  let best: string | undefined;
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      for (const value of current) stack.push(value);
      continue;
    }
    const obj = current as JsonObject;
    if (typeof obj.url === "string" && /^https?:\/\//.test(obj.url)) best = obj.url;
    for (const value of Object.values(obj)) stack.push(value);
  }
  return best;
}

function thumbnailFrom(node: unknown): string | undefined {
  const thumbs = ((node as JsonObject | undefined)?.thumbnail as JsonObject | undefined)?.thumbnails;
  if (!Array.isArray(thumbs) || !thumbs.length) return undefined;
  const last = thumbs[thumbs.length - 1];
  const url = last && typeof last === "object" ? (last as JsonObject).url : undefined;
  return typeof url === "string" ? absoluteYouTubeUrl(url) : undefined;
}

function parseViewCount(label: string | undefined): number | undefined {
  if (!label) return undefined;
  const compact = label.toLowerCase().replace(/views?.*/, "").trim();
  const match = compact.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*([kmb])?/);
  if (!match) return undefined;
  const value = Number(match[1]);
  const suffix = match[2];
  const multiplier = suffix === "b" ? 1_000_000_000 : suffix === "m" ? 1_000_000 : suffix === "k" ? 1_000 : 1;
  const count = Math.round(value * multiplier);
  return Number.isFinite(count) ? count : undefined;
}

function parseCompactCount(label: string | undefined): number | undefined {
  if (!label) return undefined;
  const match = label.toLowerCase().replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*([kmb])?/);
  if (!match) return undefined;
  const multiplier = match[2] === "b" ? 1_000_000_000 : match[2] === "m" ? 1_000_000 : match[2] === "k" ? 1_000 : 1;
  const value = Math.round(Number(match[1]) * multiplier);
  return Number.isFinite(value) ? value : undefined;
}

function extractInitialData(html: string): unknown | null {
  return extractObjectAfter(html, "ytInitialData");
}

function extractObjectAfter(html: string, marker: string): unknown | null {
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = html.indexOf("{", markerIndex);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try { return JSON.parse(html.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

function extractPlayerResponse(html: string): JsonObject | undefined {
  const marker = "ytInitialPlayerResponse";
  let offset = 0;
  while (offset < html.length) {
    const found = html.indexOf(marker, offset);
    if (found < 0) return undefined;
    const candidate = record(extractObjectAfter(html.slice(found), marker));
    if (record(candidate?.videoDetails)) return candidate;
    offset = found + marker.length;
  }
  return undefined;
}

function record(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function sponsorCandidates(description: string): Array<{ name: string; website?: string; confidence: "high" | "medium"; evidence_source: string; evidence_text: string }> {
  const lines = description.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const ignored = new Set(["youtube.com", "instagram.com", "tiktok.com", "facebook.com", "twitter.com", "x.com"]);
  const results: Array<{ name: string; website?: string; confidence: "high" | "medium"; evidence_source: string; evidence_text: string }> = [];
  const seen = new Set<string>();
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const explicit = line.match(/(?:thanks\s+to|(?:our\s+)?sponsor(?:ed\s+by)?)[\s:,-]+([A-Za-z0-9][A-Za-z0-9&.'’ -]{1,48})/i)?.[1]
      ?.replace(/\b(?:click|for|and|get|use)\b[\s\S]*$/i, "").trim().replace(/[.,:;!]+$/, "");
    const context = [line, lines[index + 1] ?? ""].join(" ").trim();
    const host = context.match(/https?:\/\/(?:www\.)?([^/\s?#]+)/i)?.[1]?.toLowerCase();
    const promotional = /\b(sponsor|sponsored|promo\s*code|discount|%\s*off|thanks\s+to)\b/i.test(context);
    if (!explicit && !(host && !ignored.has(host) && promotional)) continue;
    const name = explicit || host!.split(".")[0].replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      name,
      website: host && !ignored.has(host) ? host : undefined,
      confidence: explicit && /\bsponsor/i.test(context) ? "high" : "medium",
      evidence_source: "description",
      evidence_text: context.slice(0, 500),
    });
  }
  return results;
}

function collectRenderers(initialData: unknown, key: string): JsonObject[] {
  const found: JsonObject[] = [];
  const stack: unknown[] = [initialData];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) stack.push(node[i]);
      continue;
    }
    const obj = node as JsonObject;
    const renderer = obj[key];
    if (renderer && typeof renderer === "object" && !Array.isArray(renderer)) found.push(renderer as JsonObject);
    for (const value of Object.values(obj)) stack.push(value);
  }
  return found;
}

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== "")) as T;
}

function videoFromRenderer(renderer: JsonObject): Video | null {
  const videoId = typeof renderer.videoId === "string" ? renderer.videoId : undefined;
  const title = textFrom(renderer.title);
  if (!videoId || !title) return null;
  const nav = renderer.navigationEndpoint as JsonObject | undefined;
  const command = nav?.commandMetadata as JsonObject | undefined;
  const web = command?.webCommandMetadata as JsonObject | undefined;
  const viewsText = textFrom(renderer.viewCountText) ?? textFrom(renderer.shortViewCountText);
  const description = Array.isArray(renderer.detailedMetadataSnippets)
    ? textFrom((renderer.detailedMetadataSnippets[0] as JsonObject | undefined)?.snippetText)
    : undefined;
  return compact({
    video_id: videoId,
    title: decodeEntities(title),
    url: absoluteYouTubeUrl(typeof web?.url === "string" ? web.url : `/watch?v=${videoId}`) ?? `https://www.youtube.com/watch?v=${videoId}`,
    channel: textFrom(renderer.ownerText) ?? textFrom(renderer.longBylineText),
    channel_url: firstRunUrl(renderer.ownerText) ?? firstRunUrl(renderer.longBylineText),
    duration: textFrom(renderer.lengthText),
    views_text: viewsText,
    view_count: parseViewCount(viewsText),
    published: textFrom(renderer.publishedTimeText),
    thumbnail: thumbnailFrom(renderer),
    description: description ? decodeEntities(description) : undefined,
  });
}

function metadataContents(node: unknown): string[] {
  const values: string[] = [];
  const stack: unknown[] = [node];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      for (let i = current.length - 1; i >= 0; i--) stack.push(current[i]);
      continue;
    }
    const obj = current as JsonObject;
    if (typeof obj.content === "string" && obj.content.trim()) values.push(obj.content.trim());
    for (const [key, value] of Object.entries(obj)) if (key !== "content") stack.push(value);
  }
  return values;
}

function lockupVideo(renderer: JsonObject): Video | null {
  if (renderer.contentType !== "LOCKUP_CONTENT_TYPE_VIDEO" || typeof renderer.contentId !== "string") return null;
  const id = renderer.contentId;
  const metadata = (renderer.metadata as JsonObject | undefined)?.lockupMetadataViewModel as JsonObject | undefined;
  const title = textFrom(metadata?.title);
  if (!title) return null;
  const values = metadataContents(metadata?.metadata);
  const views = values.find((value) => /views?$/i.test(value));
  const published = values.find((value) => /(?:ago|streamed|premiered|scheduled)/i.test(value));
  const badges = collectRenderers(renderer.contentImage, "thumbnailBadgeViewModel");
  const duration = badges.map((badge) => textFrom(badge.text)).find((value) => value && /^\d+(?::\d+)+$/.test(value));
  const onTap = (((renderer.rendererContext as JsonObject | undefined)?.commandContext as JsonObject | undefined)?.onTap as JsonObject | undefined)?.innertubeCommand as JsonObject | undefined;
  const web = (onTap?.commandMetadata as JsonObject | undefined)?.webCommandMetadata as JsonObject | undefined;
  return compact({
    video_id: id,
    title: decodeEntities(title),
    url: absoluteYouTubeUrl(typeof web?.url === "string" ? web.url : `/watch?v=${id}`) ?? `https://www.youtube.com/watch?v=${id}`,
    duration,
    views_text: views,
    view_count: parseViewCount(views),
    published,
    thumbnail: imageSource(renderer.contentImage),
  });
}

function shortVideo(renderer: JsonObject): Video | null {
  const onTap = (renderer.onTap as JsonObject | undefined)?.innertubeCommand as JsonObject | undefined;
  const reel = onTap?.reelWatchEndpoint as JsonObject | undefined;
  const id = typeof reel?.videoId === "string" ? reel.videoId : undefined;
  const overlay = renderer.overlayMetadata as JsonObject | undefined;
  const title = textFrom(overlay?.primaryText);
  if (!id || !title) return null;
  const views = textFrom(overlay?.secondaryText);
  return compact({
    video_id: id,
    title: decodeEntities(title),
    url: `https://www.youtube.com/shorts/${id}`,
    views_text: views,
    view_count: parseViewCount(views),
    thumbnail: imageSource(renderer.thumbnailViewModel) ?? imageSource(reel?.thumbnail),
  });
}

function parseVideos(initialData: unknown, limit: number, kind: "standard" | "shorts" | "lockup" = "standard"): Video[] {
  const key = kind === "shorts" ? "shortsLockupViewModel" : kind === "lockup" ? "lockupViewModel" : "videoRenderer";
  const parse = kind === "shorts" ? shortVideo : kind === "lockup" ? lockupVideo : videoFromRenderer;
  const videos: Video[] = [];
  const seen = new Set<string>();
  for (const renderer of collectRenderers(initialData, key)) {
    const video = parse(renderer);
    if (video && !seen.has(video.video_id)) {
      seen.add(video.video_id);
      videos.push(video);
      if (videos.length >= limit) break;
    }
  }
  return videos;
}

function parsePlaylists(initialData: unknown, limit: number): Playlist[] {
  const playlists: Playlist[] = [];
  const seen = new Set<string>();
  for (const renderer of collectRenderers(initialData, "lockupViewModel")) {
    if (renderer.contentType !== "LOCKUP_CONTENT_TYPE_PLAYLIST" || typeof renderer.contentId !== "string") continue;
    const metadata = (renderer.metadata as JsonObject | undefined)?.lockupMetadataViewModel as JsonObject | undefined;
    const title = textFrom(metadata?.title);
    if (!title || seen.has(renderer.contentId)) continue;
    const values = metadataContents(metadata?.metadata);
    const badges = collectRenderers(renderer.contentImage, "thumbnailBadgeViewModel");
    const count = badges.map((badge) => textFrom(badge.text)).find((value) => value && /videos?/i.test(value));
    seen.add(renderer.contentId);
    playlists.push(compact({
      playlist_id: renderer.contentId,
      title: decodeEntities(title),
      url: `https://www.youtube.com/playlist?list=${renderer.contentId}`,
      video_count_text: count,
      updated: values.find((value) => /^Updated /i.test(value)),
      thumbnail: imageSource(renderer.contentImage),
    }));
    if (playlists.length >= limit) break;
  }
  return playlists;
}

function parseChannel(initialData: unknown): Channel | undefined {
  const renderer = collectRenderers(initialData, "channelMetadataRenderer")[0];
  if (!renderer || typeof renderer.externalId !== "string" || typeof renderer.title !== "string") return undefined;
  const ownerUrls = Array.isArray(renderer.ownerUrls) ? renderer.ownerUrls : [];
  return compact({
    channel_id: renderer.externalId,
    title: decodeEntities(renderer.title),
    url: typeof renderer.channelUrl === "string" ? renderer.channelUrl : `https://www.youtube.com/channel/${renderer.externalId}`,
    handle_url: ownerUrls.find((url): url is string => typeof url === "string") ?? (typeof renderer.vanityChannelUrl === "string" ? renderer.vanityChannelUrl : undefined),
    description: typeof renderer.description === "string" ? renderer.description.trim() : undefined,
    avatar: imageSource(renderer.avatar),
    rss_url: typeof renderer.rssUrl === "string" ? renderer.rssUrl : undefined,
    is_family_safe: typeof renderer.isFamilySafe === "boolean" ? renderer.isFamilySafe : undefined,
  });
}

function parsePlaylistDetail(initialData: unknown, playlistId: string): PlaylistDetail | undefined {
  const metadata = collectRenderers(initialData, "playlistMetadataRenderer")[0];
  const primary = collectRenderers(initialData, "playlistSidebarPrimaryInfoRenderer")[0];
  const owner = collectRenderers(initialData, "videoOwnerRenderer")[0];
  const title = typeof metadata?.title === "string" ? metadata.title : textFrom(primary?.title);
  if (!title) return undefined;
  const stats = Array.isArray(primary?.stats) ? primary.stats : [];
  const statTexts = stats.map(textFrom).filter((value): value is string => Boolean(value));
  const countText = statTexts.find((value) => /videos?/i.test(value));
  const totalVideos = countText ? Number(countText.replace(/[^0-9]/g, "")) : undefined;
  const nav = owner?.navigationEndpoint as JsonObject | undefined;
  const browse = nav?.browseEndpoint as JsonObject | undefined;
  const command = nav?.commandMetadata as JsonObject | undefined;
  const web = command?.webCommandMetadata as JsonObject | undefined;
  return compact({
    playlist_id: playlistId,
    title: decodeEntities(title),
    url: `https://www.youtube.com/playlist?list=${playlistId}`,
    description: typeof metadata?.description === "string" ? decodeEntities(metadata.description) : textFrom(primary?.description),
    owner: textFrom(owner?.title),
    owner_url: absoluteYouTubeUrl(typeof web?.url === "string" ? web.url : undefined),
    owner_channel_id: typeof browse?.browseId === "string" ? browse.browseId : undefined,
    total_videos: Number.isFinite(totalVideos) ? totalVideos : undefined,
    views_text: statTexts.find((value) => /views?/i.test(value)),
    updated: statTexts.find((value) => /^updated /i.test(value)),
    thumbnail: imageSource(primary?.thumbnailRenderer),
  });
}

function parseCommunityPosts(initialData: unknown, limit: number): CommunityPost[] {
  const posts: CommunityPost[] = [];
  const seen = new Set<string>();
  for (const renderer of collectRenderers(initialData, "backstagePostRenderer")) {
    const id = typeof renderer.postId === "string" ? renderer.postId : undefined;
    if (!id || seen.has(id)) continue;
    const authorEndpoint = renderer.authorEndpoint as JsonObject | undefined;
    const browse = authorEndpoint?.browseEndpoint as JsonObject | undefined;
    const command = authorEndpoint?.commandMetadata as JsonObject | undefined;
    const web = command?.webCommandMetadata as JsonObject | undefined;
    const attachment = renderer.backstageAttachment;
    const images = collectRenderers(attachment, "backstageImageRenderer")
      .map((image) => imageSource(image.image))
      .filter((value): value is string => Boolean(value));
    const attachedVideo = collectRenderers(attachment, "videoRenderer")[0];
    const video = attachedVideo ? videoFromRenderer(attachedVideo) : null;
    const likes = textFrom(renderer.voteCount);
    seen.add(id);
    posts.push(compact({
      id,
      url: `https://www.youtube.com/post/${id}`,
      channel_title: textFrom(renderer.authorText),
      channel_id: typeof browse?.browseId === "string" ? browse.browseId : undefined,
      channel_url: absoluteYouTubeUrl(typeof web?.url === "string" ? web.url : undefined),
      content: textFrom(renderer.contentText),
      image_urls: images.length ? images.join("\n") : undefined,
      image_count: images.length || undefined,
      like_count_text: likes,
      like_count: parseCompactCount(likes),
      published: textFrom(renderer.publishedTimeText),
      video_id: video?.video_id,
      video_title: video?.title,
      video_url: video?.url,
      video_thumbnail: video?.thumbnail,
    }));
    if (posts.length >= limit) break;
  }
  return posts;
}

function continuationToken(initialData: unknown): string | undefined {
  for (const renderer of collectRenderers(initialData, "continuationItemRenderer")) {
    const endpoint = renderer.continuationEndpoint as JsonObject | undefined;
    const command = endpoint?.continuationCommand as JsonObject | undefined;
    if (typeof command?.token === "string" && command.token) return command.token;
  }
  return undefined;
}

function continuationFromRenderer(renderer: JsonObject): string | undefined {
  const endpoint = record(renderer.continuationEndpoint);
  return string(record(endpoint?.continuationCommand)?.token);
}

function commentIdFromThread(thread: JsonObject): string | undefined {
  for (const view of collectRenderers(thread, "commentViewModel")) {
    const id = string(view.commentId) ?? string(record(view.commentViewModel)?.commentId);
    if (id) return id;
  }
  return undefined;
}

function capturedYouTubeJson(network: unknown): unknown[] {
  if (!Array.isArray(network)) return [];
  const payloads: unknown[] = [];
  for (const rawEntry of network) {
    const entry = record(rawEntry);
    if (!entry || !string(entry.url)?.includes("/youtubei/v1/next")) continue;
    if (entry.json !== undefined && entry.json !== null) payloads.push(entry.json);
    const body = string(entry.body_text);
    if (!body) continue;
    try { payloads.push(JSON.parse(body)); } catch { /* not a JSON response body */ }
  }
  return payloads;
}

function capturedShortSequenceJson(network: unknown): unknown[] {
  if (!Array.isArray(network)) return [];
  const payloads: unknown[] = [];
  for (const rawEntry of network) {
    const entry = record(rawEntry);
    const url = string(entry?.url);
    if (!entry || !url || !/\/youtubei\/v1\/(?:reel\/(?:reel_watch_sequence|reel_item_watch)|player)/.test(url)) continue;
    if (entry.json !== undefined && entry.json !== null) payloads.push(entry.json);
    const body = string(entry.body_text);
    if (!body) continue;
    try { payloads.push(JSON.parse(body)); } catch { /* not a JSON response body */ }
  }
  return payloads;
}

function formattedDuration(seconds: number | undefined): string | undefined {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return undefined;
  const total = Math.trunc(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`
    : `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function trendingShortsFromPayloads(payloads: unknown[], limit: number): Video[] {
  const videos: Video[] = [];
  const seen = new Set<string>();
  const engagementByVideo = new Map<string, { like_count?: number; comment_count?: number }>();

  for (const payload of payloads) {
    const buttons = collectRenderers(payload, "buttonViewModel");
    const likeButton = buttons.find((button) => string(button.iconName) === "SHORTS_LIKE");
    const commentButton = buttons.find((button) => string(button.iconName) === "SHORTS_COMMENT");
    if (!likeButton && !commentButton) continue;

    const frequencies = new Map<string, number>();
    for (const endpoint of collectRenderers(payload, "watchEndpoint")) {
      const id = string(endpoint.videoId);
      if (id) frequencies.set(id, (frequencies.get(id) ?? 0) + 1);
    }
    const videoId = [...frequencies.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
    if (!videoId) continue;
    engagementByVideo.set(videoId, {
      like_count: parseCompactCount(string(likeButton?.accessibilityText) ?? string(likeButton?.title)),
      comment_count: parseCompactCount(string(commentButton?.accessibilityText) ?? string(commentButton?.title)),
    });
  }

  for (const payload of payloads) {
    // YouTube currently places one item in `entries` and preloads the rest of
    // the public sequence under response actions. Traverse every endpoint and
    // keep only those carrying a complete, unserialized player response.
    const endpoints = collectRenderers(payload, "reelWatchEndpoint");
    const prefetched: Array<{ endpoint: JsonObject; prefetch: JsonObject }> = endpoints.flatMap((endpoint) => {
      const prefetch = record(endpoint.unserializedPrefetchData);
      return prefetch ? [{ endpoint, prefetch }] : [];
    });
    const root = record(payload);
    if (record(root?.playerResponse)) prefetched.push({ endpoint: {}, prefetch: root as JsonObject });
    const rootDetails = record(root?.videoDetails);
    if (rootDetails) {
      prefetched.push({
        endpoint: compact({ videoId: string(rootDetails.videoId) }),
        prefetch: { playerResponse: root },
      });
    }

    for (const { endpoint, prefetch } of prefetched) {
      const player = record(prefetch?.playerResponse);
      const details = record(player?.videoDetails);
      const microformat = record(record(player?.microformat)?.playerMicroformatRenderer);
      const videoId = string(endpoint?.videoId) ?? string(details?.videoId) ?? string(microformat?.externalVideoId);
      const title = string(details?.title) ?? textFrom(microformat?.title);
      if (!player || !videoId || !title || seen.has(videoId)) continue;

      const secondsRaw = string(details?.lengthSeconds) ?? string(microformat?.lengthSeconds);
      const seconds = secondsRaw !== undefined && Number.isFinite(Number(secondsRaw)) ? Number(secondsRaw) : undefined;
      const viewCount = parseCompactCount(string(microformat?.viewCount) ?? string(details?.viewCount));
      const likeCount = parseCompactCount(string(microformat?.likeCount));
      const itemWatch = record(prefetch?.reelItemWatchResponse);
      const commentButton = collectRenderers(itemWatch, "buttonViewModel")
        .find((button) => string(button.iconName) === "SHORTS_COMMENT");
      const commentCount = parseCompactCount(
        string(commentButton?.accessibilityText) ?? string(commentButton?.title),
      );
      const engagement = engagementByVideo.get(videoId);
      const rawKeywords = array(details?.keywords).filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
      seen.add(videoId);
      videos.push(compact({
        video_id: videoId,
        title: decodeEntities(title),
        url: string(microformat?.canonicalUrl) ?? `https://www.youtube.com/shorts/${videoId}`,
        channel: string(details?.author) ?? string(microformat?.ownerChannelName),
        channel_id: string(details?.channelId) ?? string(microformat?.externalChannelId),
        channel_url: string(microformat?.ownerProfileUrl)?.replace(/^http:/i, "https:"),
        duration: formattedDuration(seconds),
        duration_seconds: seconds,
        views_text: string(microformat?.viewCount),
        view_count: viewCount,
        like_count: engagement?.like_count ?? likeCount,
        comment_count: engagement?.comment_count ?? commentCount,
        published: string(microformat?.publishDate) ?? string(microformat?.uploadDate),
        thumbnail: imageSource(microformat?.thumbnail) ?? imageSource(endpoint?.thumbnail),
        description: string(details?.shortDescription) ?? textFrom(microformat?.description),
        keywords: rawKeywords.length ? rawKeywords.join("\n") : undefined,
      }));
      if (videos.length >= limit) return videos;
    }
  }
  return videos;
}

function parseYouTubeComments(
  payloads: unknown[],
  videoId: string,
  limit: number,
  replyLevel?: number,
): {
  comments: Comment[];
  total_count?: number;
  continuation_token?: string;
} {
  const replyTokens = new Map<string, string>();
  const allReplyTokens = new Set<string>();
  const pageTokens: string[] = [];
  let totalCount: number | undefined;

  for (const payload of payloads) {
    for (const header of collectRenderers(payload, "commentsHeaderRenderer")) {
      totalCount ??= parseCompactCount(textFrom(header.countText));
    }
    for (const thread of collectRenderers(payload, "commentThreadRenderer")) {
      const commentId = commentIdFromThread(thread);
      const replies = collectRenderers(thread, "commentRepliesRenderer")[0];
      if (!commentId || !replies) continue;
      const token = collectRenderers(replies, "continuationItemRenderer")
        .map(continuationFromRenderer)
        .find((value): value is string => Boolean(value));
      if (token) {
        replyTokens.set(commentId, token);
        allReplyTokens.add(token);
      }
    }
    for (const renderer of collectRenderers(payload, "continuationItemRenderer")) {
      const token = continuationFromRenderer(renderer);
      if (token) pageTokens.push(token);
    }
  }

  const comments: Comment[] = [];
  const seen = new Set<string>();
  for (const payload of payloads) {
    for (const entity of collectRenderers(payload, "commentEntityPayload")) {
      const properties = record(entity.properties);
      const author = record(entity.author);
      const toolbar = record(entity.toolbar);
      const id = string(properties?.commentId);
      const content = string(record(properties?.content)?.content);
      const level = number(properties?.replyLevel);
      if (
        !id
        || !content
        || seen.has(id)
        || (replyLevel !== undefined && level !== replyLevel)
      ) continue;
      const command = record(record(record(author?.channelCommand)?.innertubeCommand)?.commandMetadata);
      const web = record(command?.webCommandMetadata);
      const likeText = string(toolbar?.likeCountNotliked) ?? string(toolbar?.likeCountLiked);
      const replyText = string(toolbar?.replyCount);
      seen.add(id);
      comments.push(compact({
        id,
        content: decodeEntities(content),
        url: `https://www.youtube.com/watch?v=${videoId}&lc=${encodeURIComponent(id)}`,
        published: string(properties?.publishedTime),
        reply_level: level,
        author_name: string(author?.displayName) ?? string(properties?.authorButtonA11y),
        author_channel_id: string(author?.channelId),
        author_verified: typeof author?.isVerified === "boolean" ? author.isVerified : undefined,
        author_creator: typeof author?.isCreator === "boolean" ? author.isCreator : undefined,
        author_avatar_url: string(author?.avatarThumbnailUrl),
        author_channel_url: absoluteYouTubeUrl(string(web?.url)),
        like_count_text: likeText,
        like_count: parseCompactCount(likeText),
        reply_count_text: replyText,
        reply_count: parseCompactCount(replyText),
        replies_continuation_token: replyTokens.get(id),
      }));
      if (comments.length >= limit) break;
    }
    if (comments.length >= limit) break;
  }

  return {
    comments,
    total_count: totalCount,
    continuation_token: pageTokens.find((token) => !allReplyTokens.has(token)),
  };
}

function normalizedChannelUrl(raw: string): string {
  if (!/^https?:\/\/(www\.)?youtube\.com\//i.test(raw)) throw new Error("channel_url must be a youtube.com channel URL");
  return raw.replace(/[?#].*$/, "").replace(/\/(videos|shorts|streams|playlists|posts)\/?$/i, "").replace(/\/$/, "");
}

function channelTabUrl(raw: string, mode: Mode): string {
  const base = normalizedChannelUrl(raw);
  const tab = mode === "channel_videos" ? "videos"
    : mode === "channel_shorts" ? "shorts"
      : mode === "channel_lives" ? "streams"
        : mode === "channel_playlists" ? "playlists"
          : mode === "channel_posts" ? "posts"
          : "";
  return `${base}${tab ? `/${tab}` : ""}?hl=en`;
}

function inferMode(input: Input): Mode {
  if (input.mode) return input.mode;
  if (input.video_url?.trim()) return "video";
  if (input.playlist_id?.trim()) return "playlist";
  if (input.hashtag?.trim()) return "hashtag_search";
  if (input.post_url?.trim()) return "community_post";
  if (input.query?.trim()) return "search";
  if (input.channel_url?.trim()) return "channel_videos";
  throw new Error("Provide query, channel_url, or video_url");
}

function sourceFrom(input: Input, mode: Mode): { source: string; url: string } {
  if (mode === "search") {
    const query = input.query?.trim();
    if (!query) throw new Error("query is required for search mode");
    return { source: query, url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=en` };
  }
  if (mode === "hashtag_search") {
    const hashtag = input.hashtag?.trim().replace(/^#/, "");
    if (!hashtag) throw new Error("hashtag is required for hashtag_search mode");
    return { source: `#${hashtag}`, url: `https://www.youtube.com/hashtag/${encodeURIComponent(hashtag)}?hl=en` };
  }
  if (mode === "playlist") {
    const raw = input.playlist_id?.trim();
    const playlistId = raw?.match(/[?&]list=([A-Za-z0-9_-]+)/)?.[1] ?? raw;
    if (!playlistId || !/^[A-Za-z0-9_-]{10,80}$/.test(playlistId)) throw new Error("playlist_id must be a public YouTube playlist id or URL");
    return { source: playlistId, url: `https://www.youtube.com/playlist?list=${playlistId}&hl=en` };
  }
  if (mode === "community_post") {
    const raw = input.post_url?.trim();
    const id = raw?.match(/(?:youtube\.com\/post\/)?(Ugk[A-Za-z0-9_-]+)/i)?.[1];
    if (!id) throw new Error("post_url must be a public youtube.com/post URL or post id");
    return { source: id, url: `https://www.youtube.com/post/${id}?hl=en` };
  }
  const channelUrl = input.channel_url?.trim();
  if (!channelUrl) throw new Error("channel_url is required for channel modes");
  return { source: channelUrl, url: channelTabUrl(channelUrl, mode) };
}

function videoTarget(raw: string): { id: string; url: string } {
  const value = raw.trim();
  const id = value.match(/[?&]v=([A-Za-z0-9_-]{6,})/i)?.[1]
    ?? value.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/i)?.[1]
    ?? value.match(/youtube\.com\/(?:shorts|embed)\/([A-Za-z0-9_-]{6,})/i)?.[1];
  if (!id) throw new Error("video_url must be a public YouTube watch, Shorts, youtu.be, or embed URL");
  return { id, url: `https://www.youtube.com/watch?v=${id}` };
}

async function videoDetails(raw: string, bf: Parameters<Parameters<typeof defineTool>[0]>[1]): Promise<Output> {
  const target = videoTarget(raw);
  const sourceUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(target.url)}&format=json`;
  const response = await bf.fetch({
    url: sourceUrl,
    strategy: "http",
    return_response_text: true,
    include_html: false,
    extra_headers: { accept: "application/json" },
  });
  let data = response.json as JsonObject | null | undefined;
  if (!data && response.body_text) {
    try { data = JSON.parse(response.body_text) as JsonObject; } catch { /* handled below */ }
  }
  const title = typeof data?.title === "string" ? data.title : undefined;
  if (!title) throw new Error("YouTube did not return public video metadata");
  return {
    source: raw,
    source_url: sourceUrl,
    count: 1,
    videos: [compact({
      video_id: target.id,
      title: decodeEntities(title),
      url: target.url,
      channel: typeof data?.author_name === "string" ? data.author_name : undefined,
      channel_url: typeof data?.author_url === "string" ? data.author_url : undefined,
      thumbnail: typeof data?.thumbnail_url === "string" ? data.thumbnail_url : undefined,
    })],
  };
}

async function videoSponsors(raw: string, bf: Parameters<Parameters<typeof defineTool>[0]>[1]): Promise<Output> {
  const target = videoTarget(raw);
  const watchUrl = `${target.url}&hl=en`;
  const page = await bf.fetch({
    url: watchUrl,
    strategy: "browser",
    json_mode: false,
    wait_until: "domcontentloaded",
    wait_ms: 4000,
    timeout_ms: 60000,
    return_response_text: true,
    include_html: true,
    locale: "en-US",
  });
  if (page.blocked) throw new Error(`YouTube blocked the sponsor inspection (${page.block_reason ?? "unknown"})`);
  const rawHtml = page.body_text ?? "";
  const html = rawHtml.includes("ytInitialPlayerResponse") ? rawHtml : page.html || rawHtml;
  const player = extractPlayerResponse(html);
  const details = record(player?.videoDetails);
  const microformat = record(record(player?.microformat)?.playerMicroformatRenderer);
  let title = string(details?.title);
  let channel = string(details?.author);
  let channelUrl = string(microformat?.ownerProfileUrl)?.replace(/^http:/i, "https:");
  if (!title) {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(target.url)}&format=json`;
    const metadata = await bf.fetch({
      url: oembedUrl,
      strategy: "http",
      return_response_text: true,
      include_html: false,
      extra_headers: { accept: "application/json" },
    });
    let json = record(metadata.json);
    if (!json && metadata.body_text) {
      try { json = record(JSON.parse(metadata.body_text)); } catch { /* stable error below */ }
    }
    title = string(json?.title);
    channel = string(json?.author_name);
    channelUrl = string(json?.author_url);
  }
  if (!title) throw new Error("YouTube did not return public video data for sponsor inspection");
  const description = string(details?.shortDescription) ?? "";
  const suspects = sponsorCandidates(description);
  const categories = encodeURIComponent(JSON.stringify(["sponsor", "selfpromo"]));
  const segmentUrl = `https://sponsor.ajay.app/api/skipSegments?videoID=${encodeURIComponent(target.id)}&categories=${categories}`;
  const segmentResponse = await bf.fetch({
    url: segmentUrl,
    strategy: "http",
    return_response_text: true,
    include_html: false,
    extra_headers: { accept: "application/json" },
  });
  let segmentJson = segmentResponse.json;
  if (!Array.isArray(segmentJson) && segmentResponse.body_text) {
    try { segmentJson = JSON.parse(segmentResponse.body_text); } catch { segmentJson = []; }
  }
  const segments = array(segmentJson).flatMap((entry) => {
    const item = record(entry);
    const range = array(item?.segment);
    const start = number(range[0]);
    const end = number(range[1]);
    if (start === undefined || end === undefined || end <= start) return [];
    return [compact({
      start_seconds: start,
      end_seconds: end,
      duration_seconds: Math.round((end - start) * 1000) / 1000,
      category: string(item?.category) ?? "sponsor",
      votes: number(item?.votes),
      locked: number(item?.locked) !== undefined ? number(item?.locked) === 1 : undefined,
    })];
  });
  const isPaidPromotion = /Includes paid promotion|paidContentOverlayRenderer/i.test(page.html ?? html);
  const methods = [
    ...(isPaidPromotion ? ["YouTube paid-promotion disclosure"] : []),
    ...(suspects.length ? ["public description evidence"] : []),
    ...(segments.length ? ["SponsorBlock community segments"] : []),
  ];
  return {
    source: raw,
    source_url: page.final_url ?? watchUrl,
    count: suspects.length,
    videos: [],
    sponsor_video: compact({
      id: target.id,
      url: target.url,
      title: decodeEntities(title),
      channel,
      channel_id: string(details?.channelId),
      channel_url: channelUrl,
      is_paid_promotion: isPaidPromotion,
    }),
    suspected_sponsors: suspects,
    sponsor_segments: segments,
    sponsor_detection: {
      status: suspects.length ? "found" : isPaidPromotion || segments.length ? "paid_promotion_only" : "not_found",
      methods: methods.join(", "),
      note: "Sponsor names are inferred from public description evidence; timing segments come from SponsorBlock and are not official YouTube sponsor fields.",
    },
  };
}

function trendingShortsFromHtml(html: string, limit: number): Video[] {
  const videos: Video[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attributes = match[1];
    if (!/\bytp-title-link\b/i.test(attributes)) continue;
    const href = attributes.match(/\bhref=["'](?:https?:\/\/(?:www\.)?youtube\.com)?\/shorts\/([A-Za-z0-9_-]{6,20})[^"']*["']/i);
    if (!href || seen.has(href[1])) continue;
    const title = decodeEntities(match[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (!title) continue;
    seen.add(href[1]);
    videos.push({ video_id: href[1], title, url: `https://www.youtube.com/shorts/${href[1]}` });
    if (videos.length >= limit) break;
  }
  return videos;
}

function trendingShortFromPlayer(html: string): Video | undefined {
  const player = extractPlayerResponse(html);
  const details = record(player?.videoDetails);
  const videoId = string(details?.videoId);
  const title = string(details?.title);
  if (!videoId || !title) return undefined;
  return compact({
    video_id: videoId,
    title: decodeEntities(title),
    url: `https://www.youtube.com/shorts/${videoId}`,
    channel: string(details?.author),
    channel_id: string(details?.channelId),
    duration_seconds: number(details?.lengthSeconds),
    view_count: number(details?.viewCount),
  });
}

async function videoComments(raw: string, maxResults: number | undefined, bf: Parameters<Parameters<typeof defineTool>[0]>[1]): Promise<Output> {
  const target = videoTarget(raw);
  const watchUrl = `${target.url}&hl=en`;
  const limit = Math.min(Math.max(maxResults ?? 20, 1), 20);
  const page = await bf.fetch({
    url: watchUrl,
    strategy: "browser",
    json_mode: false,
    wait_until: "domcontentloaded",
    wait_selector: "#comments",
    scroll_selector: "#comments",
    wait_ms: 8000,
    timeout_ms: 90000,
    include_html: false,
    capture_network: true,
    network_resource_types: ["xhr", "fetch"],
    network_include_bodies: true,
    network_max_entries: 200,
    network_max_body_bytes: 1_048_576,
    locale: "en-US",
    humanize: false,
  } as any);
  if (page.blocked) throw new Error(`YouTube blocked the public comments request (${page.block_reason ?? "unknown"})`);
  const result = parseYouTubeComments(capturedYouTubeJson(page.network), target.id, limit);
  if (!result.comments.length) throw new Error("YouTube did not expose public comments for this video");
  return compact({
    source: raw,
    source_url: page.final_url ?? watchUrl,
    count: result.comments.length,
    videos: [],
    comments: result.comments,
    total_count: result.total_count,
    comments_continuation_token: result.continuation_token,
  });
}

async function commentReplies(
  raw: string,
  rawCommentId: string | undefined,
  maxResults: number | undefined,
  bf: Parameters<Parameters<typeof defineTool>[0]>[1],
): Promise<Output> {
  const target = videoTarget(raw);
  const commentId = rawCommentId?.trim();
  if (!commentId || !/^[A-Za-z0-9_-]{8,128}$/.test(commentId)) {
    throw new Error("comment_id must be a public YouTube parent comment id");
  }
  const watchUrl = `${target.url}&lc=${encodeURIComponent(commentId)}&hl=en`;
  const limit = Math.min(Math.max(maxResults ?? 20, 1), 20);
  const repliesSelector = "ytd-comment-thread-renderer:first-of-type button[aria-label$=' replies']:not([aria-label='Hide replies']):visible";
  const page = await bf.fetch({
    url: watchUrl,
    strategy: "browser",
    json_mode: false,
    wait_until: "domcontentloaded",
    wait_selector: "#comments",
    scroll_selector: "#comments",
    click_selector: repliesSelector,
    humanize: false,
    wait_ms: 5000,
    timeout_ms: 90000,
    include_html: false,
    capture_network: true,
    network_resource_types: ["xhr", "fetch"],
    network_include_bodies: true,
    network_max_entries: 200,
    network_max_body_bytes: 1_048_576,
    locale: "en-US",
  } as any);
  if (page.blocked) throw new Error(`YouTube blocked the public comment replies request (${page.block_reason ?? "unknown"})`);
  const result = parseYouTubeComments(
    capturedYouTubeJson(page.network),
    target.id,
    limit,
    1,
  );
  if (!result.comments.length) {
    throw new Error("YouTube did not expose public replies for this parent comment");
  }
  return compact({
    source: raw,
    source_url: page.final_url ?? watchUrl,
    count: result.comments.length,
    videos: [],
    comments: result.comments,
    parent_comment_id: commentId,
    comments_continuation_token: result.continuation_token,
  });
}

async function trendingShorts(maxResults: number | undefined, bf: Parameters<Parameters<typeof defineTool>[0]>[1]): Promise<Output> {
  const sourceUrl = "https://www.youtube.com/shorts/";
  const limit = Math.min(Math.max(maxResults ?? 20, 1), 25);
  const page = await bf.fetch({
    url: sourceUrl,
    strategy: "browser",
    json_mode: false,
    wait_until: "domcontentloaded",
    timeout_ms: 90_000,
    return_response_text: true,
    include_html: true,
    capture_network: true,
    network_resource_types: ["xhr", "fetch"],
    network_include_bodies: true,
    network_max_entries: 250,
    network_max_body_bytes: 1_048_576,
    locale: "en-US",
    press_key: "ArrowDown",
    press_count: Math.min(limit, 10),
    wait_ms: 1_000,
  } as any);
  if (page.blocked) throw new Error(`YouTube blocked the public Shorts feed (${page.block_reason ?? "unknown"})`);
  const html = page.html || page.body_text || "";
  const videos = trendingShortsFromPayloads(capturedShortSequenceJson(page.network), limit);
  if (!videos.length) videos.push(...trendingShortsFromHtml(html, limit));
  if (!videos.length) {
    const current = trendingShortFromPlayer(html);
    if (current) videos.push(current);
  }
  if (!videos.length && /youtube\.com\/shorts\/[A-Za-z0-9_-]{6,20}/i.test(page.final_url ?? "")) {
    const current = await videoDetails(page.final_url as string, bf);
    videos.push(...current.videos.slice(0, limit));
  }
  if (!videos.length) throw new Error("YouTube did not expose a public trending Shorts sequence");
  return {
    source: "trending Shorts",
    source_url: page.final_url ?? sourceUrl,
    count: videos.length,
    videos,
  };
}

export default defineTool<Input, Output>(async (input, bf) => {
  const mode = inferMode(input);
  if (mode === "video") {
    if (!input.video_url?.trim()) throw new Error("video_url is required for video mode");
    return videoDetails(input.video_url, bf);
  }
  if (mode === "video_sponsors") {
    if (!input.video_url?.trim()) throw new Error("video_url is required for video_sponsors mode");
    return videoSponsors(input.video_url, bf);
  }
  if (mode === "video_comments") {
    if (!input.video_url?.trim()) throw new Error("video_url is required for video_comments mode");
    return videoComments(input.video_url, input.max_results, bf);
  }
  if (mode === "comment_replies") {
    if (!input.video_url?.trim()) throw new Error("video_url is required for comment_replies mode");
    return commentReplies(input.video_url, input.comment_id, input.max_results, bf);
  }
  if (mode === "trending_shorts") return trendingShorts(input.max_results, bf);
  const limit = Math.min(Math.max(input.max_results ?? 10, 1), 25);
  const source = sourceFrom(input, mode);
  const page = await bf.fetch({
    url: source.url,
    return_response_text: true,
    include_html: true,
    strategy: "browser",
    wait_until: "domcontentloaded",
    wait_ms: 1000,
    locale: "en-US",
  });
  const raw = page.body_text ?? "";
  const html = raw.includes("ytInitialData") ? raw : (page.html ?? raw);
  const initialData = extractInitialData(html);
  if (!initialData) throw new Error("YouTube did not expose public page data");

  const channel = mode === "channel" ? parseChannel(initialData) : undefined;
  const playlists = mode === "channel_playlists" ? parsePlaylists(initialData, limit) : undefined;
  const playlist = mode === "playlist" ? parsePlaylistDetail(initialData, source.source) : undefined;
  const posts = mode === "channel_posts" || mode === "community_post"
    ? parseCommunityPosts(initialData, mode === "community_post" ? 1 : limit)
    : undefined;
  const hashtagVideos = mode === "hashtag_search"
    ? input.content_type === "shorts"
      ? parseVideos(initialData, limit, "shorts")
      : [...parseVideos(initialData, limit), ...parseVideos(initialData, limit, "shorts")]
        .filter((video, index, values) => values.findIndex((item) => item.video_id === video.video_id) === index)
        .slice(0, limit)
    : [];
  const videos = mode === "channel_shorts" ? parseVideos(initialData, limit, "shorts")
    : mode === "channel_lives" || mode === "channel_videos" ? parseVideos(initialData, limit, "lockup")
      : mode === "playlist" ? parseVideos(initialData, limit, "lockup")
        : mode === "hashtag_search" ? hashtagVideos
      : mode === "search" ? parseVideos(initialData, limit)
        : [];
  const count = channel ? 1 : playlists?.length ?? posts?.length ?? videos.length;
  if (count === 0) throw new Error(`YouTube returned no public results for ${mode}`);

  return compact({
    source: source.source,
    source_url: page.final_url ?? source.url,
    count,
    videos,
    playlists,
    channel,
    playlist,
    posts,
    continuation_token: mode === "channel_posts" ? continuationToken(initialData) : undefined,
  });
});
