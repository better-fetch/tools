import { defineTool } from "@better-fetch/tools";

type Mode = "search" | "channel_videos" | "video" | "transcript" | "comments";

type Input = {
  mode: Mode;
  query?: string;
  handle?: string;
  url?: string;
  page?: number;
  max_results?: number;
};

type Video = {
  id?: number;
  permalink_id?: string;
  title: string;
  url: string;
  thumbnail_url?: string;
  author_name?: string;
  author_url?: string;
  upload_date?: string;
  duration_seconds?: number;
  views?: number;
  comments?: number;
  tags?: string;
  is_live?: boolean;
  is_short?: boolean;
};

type Output = {
  mode: Mode;
  source_url: string;
  query?: string;
  channel_handle?: string;
  page?: number;
  next_url?: string;
  count?: number;
  videos?: Video[];
  video?: Video & {
    embed_html?: string;
    embed_width?: number;
    embed_height?: number;
    provider_name?: string;
  };
  language?: string;
  transcript?: string;
  numeric_id?: number;
  comments?: Array<{
    id: string;
    text: string;
    author_name?: string;
    author_url?: string;
    author_avatar?: string;
    created_at?: string;
    created_at_text?: string;
    like_count?: number;
    dislike_count?: number;
    reply_count?: number;
  }>;
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
const number = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const boolean = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

function positiveInt(value: number | undefined, fallback: number, max: number): number {
  return Number.isInteger(value) && (value as number) > 0
    ? Math.min(value as number, max)
    : fallback;
}

function channel(input: Input): { handle: string; url: string } {
  const fromUrl = input.url?.trim().match(
    /^https?:\/\/(?:www\.)?rumble\.com\/(?:c|user)\/([^/?#]+)(?:[/?#]|$)/i,
  )?.[1];
  const raw = fromUrl ?? input.handle?.trim().replace(/^@/, "");
  if (!raw || !/^[A-Za-z0-9_.-]{1,80}$/.test(raw)) {
    throw new Error("Provide a public Rumble channel handle or channel URL");
  }
  return { handle: raw, url: `https://rumble.com/c/${raw}` };
}

function videoUrl(value: string | undefined): string {
  const raw = value?.trim();
  if (!raw || !/^https?:\/\/(?:www\.)?rumble\.com\/v[a-z0-9]+-[^?#]+\.html(?:[?#].*)?$/i.test(raw)) {
    throw new Error("url must be a public Rumble video URL");
  }
  const parsed = new URL(raw);
  return `https://rumble.com${parsed.pathname}`;
}

function htmlJsonScripts(html: string): unknown[] {
  const values: unknown[] = [];
  const pattern = /<script\b[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    try {
      values.push(JSON.parse(match[1].trim()));
    } catch {
      // Ignore unrelated or incomplete script blocks.
    }
  }
  return values;
}

function normalizeVideo(value: unknown): Video | undefined {
  const item = record(value);
  const title = text(item?.title);
  const url = text(item?.url);
  if (!item || !title || !url) return undefined;
  const author = record(item.by);
  const comments = record(item.comments);
  return {
    id: number(item.id),
    permalink_id: text(item.permalink_id),
    title,
    url,
    thumbnail_url: text(item.thumb),
    author_name: text(author?.name) ?? text(author?.title),
    author_url: text(author?.url),
    upload_date: text(item.upload_date),
    duration_seconds: number(item.duration),
    views: number(item.views),
    comments: number(comments?.count),
    tags: Array.isArray(item.tags)
      ? item.tags.map(text).filter((entry): entry is string => Boolean(entry)).join(", ")
      : undefined,
    is_live: boolean(item.live),
    is_short: boolean(item.is_short),
  };
}

function listing(html: string, maxResults: number): Video[] {
  const results: Video[] = [];
  for (const value of htmlJsonScripts(html)) {
    const root = record(value);
    const candidates = Array.isArray(root?.items) ? root.items : [];
    for (const candidate of candidates) {
      const item = normalizeVideo(candidate);
      if (item && !results.some((existing) => existing.url === item.url)) results.push(item);
      if (results.length >= maxResults) return results;
    }
  }
  if (results.length) return results;

  const cards = /<article\b[^>]*class=["'][^"']*\bvideo-item\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi;
  for (const match of html.matchAll(cards)) {
    const card = match[1];
    const href = card.match(/<a\b[^>]*class=["'][^"']*\bvideo-item--a\b[^"']*["'][^>]*href=["']([^"']+)/i)?.[1]
      ?? card.match(/href=["'](\/v[a-z0-9]+-[^"']+\.html[^"']*)/i)?.[1];
    const rawTitle = card.match(/<img\b[^>]*alt=["']([^"']+)["']/i)?.[1];
    if (!href || !rawTitle) continue;
    const pathname = htmlDecode(href).split(/[?#]/, 1)[0];
    const image = card.match(/<img\b[^>]*(?:data-src|src)=["']([^"']+)["']/i)?.[1];
    const durationText = card.match(/class=["'][^"']*\bvideo-item--duration\b[^"']*["'][^>]*>([\s\S]*?)<\//i)?.[1];
    const viewsText = card.match(/class=["'][^"']*\bvideo-item--views\b[^"']*["'][^>]*>([\s\S]*?)<\//i)?.[1];
    const date = card.match(/<time\b[^>]*datetime=["']([^"']+)["']/i)?.[1]
      ?? card.match(/title=["']([A-Z][a-z]+ \d{1,2}, \d{4})["']/)?.[1];
    results.push({
      permalink_id: pathname.match(/\/(v[a-z0-9]+)-/i)?.[1],
      title: htmlDecode(rawTitle),
      url: `https://rumble.com${pathname}`,
      thumbnail_url: image ? htmlDecode(image) : undefined,
      upload_date: date ? htmlDecode(date) : undefined,
      duration_seconds: durationText ? durationSeconds(stripTags(durationText)) : undefined,
      views: viewsText ? compactNumber(stripTags(viewsText)) : undefined,
    });
    if (results.length >= maxResults) break;
  }
  return results;
}

function htmlDecode(value: string): string {
  return value
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .trim();
}

function stripTags(value: string): string {
  return htmlDecode(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
}

function durationSeconds(value: string): number | undefined {
  const parts = value.match(/\d+/g)?.map(Number);
  if (!parts?.length || parts.some((part) => !Number.isFinite(part))) return undefined;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function compactNumber(value: string): number | undefined {
  const match = value.replace(/,/g, "").match(/([0-9]+(?:\.[0-9]+)?)\s*([KMB])?/i);
  if (!match) return undefined;
  const scale = { K: 1_000, M: 1_000_000, B: 1_000_000_000 }[match[2]?.toUpperCase() as "K" | "M" | "B"] ?? 1;
  return Math.round(Number(match[1]) * scale);
}

function nextPage(html: string): string | undefined {
  const match = html.match(/<link\b[^>]*rel=["']?next["']?[^>]*href=["']?([^"' >]+)/i);
  return match?.[1]?.replace(/&amp;/g, "&");
}

function attr(attributes: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return attributes.match(new RegExp(`\\b${escaped}=["']([^"']*)`, "i"))?.[1];
}

function topLevelCommentsHtml(html: string): string[] {
  const marker = html.search(/<ul\b[^>]*class=["'][^"']*\bcomments-1\b/i);
  if (marker < 0) return [];
  const start = html.indexOf(">", marker) + 1;
  if (start <= 0) return [];
  const items: string[] = [];
  const tokens = /<\/?(?:ul|li)\b[^>]*>/gi;
  tokens.lastIndex = start;
  let ulDepth = 1;
  let liDepth = 0;
  let itemStart = -1;
  for (let token = tokens.exec(html); token; token = tokens.exec(html)) {
    const value = token[0];
    const closing = /^<\//.test(value);
    const isUl = /^<\/?ul\b/i.test(value);
    if (isUl) {
      ulDepth += closing ? -1 : 1;
      if (ulDepth === 0) break;
      continue;
    }
    if (!closing) {
      if (ulDepth === 1 && liDepth === 0) itemStart = token.index;
      liDepth++;
    } else {
      liDepth--;
      if (liDepth === 0 && itemStart >= 0) {
        items.push(html.slice(itemStart, tokens.lastIndex));
        itemStart = -1;
      }
    }
  }
  return items;
}

function parseComments(html: string, limit: number): NonNullable<Output["comments"]> {
  const comments: NonNullable<Output["comments"]> = [];
  for (const segment of topLevelCommentsHtml(html)) {
    const opening = segment.match(/^<li\b([^>]*)>/i)?.[1] ?? "";
    const id = attr(opening, "data-comment-id");
    if (!id || /comments-create/.test(opening)) continue;
    const top = segment.split(/<div\b[^>]*class=["'][^"']*\bcomment-replies\b/i, 1)[0];
    const authorMatch = top.match(/<a\b[^>]*class=["'][^"']*\bcomments-meta-author\b[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    const timeMatch = top.match(/<a\b[^>]*class=["'][^"']*\bcomments-meta-post-time\b[^"']*["'][^>]*title=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    const content = top.match(/<p\b[^>]*class=["'][^"']*\bcomment-text\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1];
    if (!content) continue;
    const createdLabel = timeMatch ? htmlDecode(timeMatch[1]) : undefined;
    const parsedDate = createdLabel ? new Date(createdLabel) : undefined;
    const avatar = top.match(/<img\b[^>]*class=["'][^"']*\bcomments-author-image\b[^"']*["'][^>]*src=["']([^"']+)/i)?.[1]
      ?? top.match(/<img\b[^>]*src=["']([^"']+)["'][^>]*class=["'][^"']*\bcomments-author-image\b/i)?.[1];
    const votes = [...top.matchAll(/<span\b[^>]*class=["'][^"']*\brumbles-up-votes\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi)]
      .map((match) => compactNumber(stripTags(match[1])));
    comments.push({
      id,
      text: stripTags(content),
      author_name: authorMatch ? stripTags(authorMatch[2]) : attr(opening, "data-username"),
      author_url: authorMatch ? new URL(htmlDecode(authorMatch[1]), "https://rumble.com").toString() : undefined,
      author_avatar: avatar ? htmlDecode(avatar) : undefined,
      created_at: parsedDate && !Number.isNaN(parsedDate.valueOf()) ? parsedDate.toISOString() : undefined,
      created_at_text: timeMatch ? stripTags(timeMatch[2]) : undefined,
      like_count: votes[0],
      dislike_count: votes[1],
      reply_count: compactNumber(attr(opening, "data-num-replies") ?? ""),
    });
    if (comments.length >= limit) break;
  }
  return comments;
}

async function fetchHtml(
  bf: Parameters<Parameters<typeof defineTool>[0]>[1],
  url: string,
): Promise<string> {
  const response = await bf.fetch({
    url,
    strategy: "http",
    return_response_text: true,
    include_html: false,
    extra_headers: { accept: "text/html,application/xhtml+xml" },
  });
  const html = response.body_text;
  if (!html) throw new Error("Rumble returned no public page content");
  return html;
}

async function fetchRenderedHtml(
  bf: Parameters<Parameters<typeof defineTool>[0]>[1],
  url: string,
): Promise<string> {
  const response = await bf.fetch({
    url,
    strategy: "browser",
    json_mode: false,
    wait_until: "domcontentloaded",
    wait_ms: 4000,
    timeout_ms: 60000,
    return_response_text: true,
    include_html: true,
    locale: "en-US",
    proxy: "auto",
  });
  if (response.blocked) throw new Error(`Rumble blocked the rendered request (${response.block_reason ?? "unknown"})`);
  const html = response.html ?? response.body_text;
  if (!html) throw new Error("Rumble returned no rendered page content");
  return html;
}

export default defineTool<Input, Output>(async (input, bf) => {
  if (input.mode === "transcript") {
    const target = videoUrl(input.url);
    const oembedUrl = `https://rumble.com/api/Media/oembed.json?url=${encodeURIComponent(target)}`;
    const oembed = await bf.fetch({
      url: oembedUrl,
      strategy: "http",
      return_response_text: true,
      include_html: false,
      extra_headers: { accept: "application/json" },
    });
    let metadata = record(oembed.json);
    if (!metadata && oembed.body_text) {
      try { metadata = record(JSON.parse(oembed.body_text)); } catch { /* handled below */ }
    }
    const embedId = text(metadata?.html)?.match(/rumble\.com\/embed\/([^/"']+)/i)?.[1];
    if (!embedId) throw new Error("Rumble did not return a public embed id for this video");
    const embedHtml = await fetchHtml(bf, `https://rumble.com/embed/${embedId}/`);
    const caption = embedHtml.match(/"cc"\s*:\s*\{[\s\S]*?"language"\s*:\s*"([^"]+)"[\s\S]*?"path"\s*:\s*"([^"]+\.vtt[^"]*)"/i);
    if (!caption) throw new Error("Rumble did not expose public captions for this video");
    const language = htmlDecode(caption[1]);
    let transcriptUrl: string;
    try { transcriptUrl = JSON.parse(`"${caption[2]}"`) as string; } catch { transcriptUrl = caption[2].replace(/\\\//g, "/"); }
    const transcript = await bf.fetch({
      url: transcriptUrl,
      strategy: "http",
      return_response_text: true,
      include_html: false,
      extra_headers: { accept: "text/vtt,text/plain" },
    });
    const value = transcript.body_text?.trim();
    if (!value || !/^WEBVTT/i.test(value)) throw new Error("Rumble's public caption track returned no WEBVTT transcript");
    return { mode: "transcript", source_url: target, language, transcript: value };
  }
  if (input.mode === "comments") {
    const target = videoUrl(input.url);
    const oembedUrl = `https://rumble.com/api/Media/oembed.json?url=${encodeURIComponent(target)}`;
    const oembed = await bf.fetch({
      url: oembedUrl,
      strategy: "http",
      return_response_text: true,
      include_html: false,
      extra_headers: { accept: "application/json" },
    });
    let metadata = record(oembed.json);
    if (!metadata && oembed.body_text) {
      try { metadata = record(JSON.parse(oembed.body_text)); } catch { /* handled below */ }
    }
    const embedId = text(metadata?.html)?.match(/rumble\.com\/embed\/([^/"']+)/i)?.[1]?.replace(/^v/i, "");
    if (!embedId) throw new Error("Rumble did not return a public comment key for this video");
    const serviceUrl = `https://rumble.com/service.php?video=${encodeURIComponent(embedId)}&name=comment.list`;
    const service = await bf.fetch({
      url: serviceUrl,
      strategy: "http",
      return_response_text: true,
      include_html: false,
      extra_headers: { accept: "application/json" },
    });
    let payload = record(service.json);
    if (!payload && service.body_text) {
      try { payload = record(JSON.parse(service.body_text)); } catch { /* handled below */ }
    }
    const html = text(payload?.html);
    if (!html) throw new Error("Rumble's public comment service returned no comment HTML");
    const maxResults = positiveInt(input.max_results, 100, 1000);
    const comments = parseComments(html, maxResults);
    if (!comments.length) throw new Error("Rumble returned no public top-level comments");
    const numericId = Number(html.match(/data-video-fid=["'](\d+)/i)?.[1]);
    return {
      mode: "comments",
      source_url: target,
      numeric_id: Number.isFinite(numericId) ? numericId : undefined,
      count: comments.length,
      comments,
    };
  }
  if (input.mode === "video") {
    const target = videoUrl(input.url);
    const sourceUrl = `https://rumble.com/api/Media/oembed.json?url=${encodeURIComponent(target)}`;
    const response = await bf.fetch({
      url: sourceUrl,
      strategy: "http",
      return_response_text: true,
      include_html: false,
      extra_headers: { accept: "application/json" },
    });
    let data = record(response.json);
    if (!data && response.body_text) {
      try { data = record(JSON.parse(response.body_text)); } catch { /* stable error below */ }
    }
    const title = text(data?.title);
    if (!data || !title) throw new Error("Rumble did not return public video metadata");
    const embed = text(data.html);
    const embedId = embed?.match(/rumble\.com\/embed\/([^/"']+)/i)?.[1];
    return {
      mode: "video",
      source_url: sourceUrl,
      video: {
        permalink_id: embedId,
        title,
        url: target,
        thumbnail_url: text(data.thumbnail_url),
        author_name: text(data.author_name),
        author_url: text(data.author_url),
        duration_seconds: number(data.duration),
        embed_html: embed,
        embed_width: number(data.width),
        embed_height: number(data.height),
        provider_name: text(data.provider_name),
      },
    };
  }

  const page = positiveInt(input.page, 1, 1000);
  const maxResults = positiveInt(input.max_results, 20, 100);
  if (input.mode === "search") {
    const query = input.query?.trim();
    if (!query) throw new Error("query is required for search mode");
    const sourceUrl = `https://rumble.com/search/video?q=${encodeURIComponent(query)}${page > 1 ? `&page=${page}` : ""}`;
    const html = await fetchHtml(bf, sourceUrl);
    const videos = listing(html, maxResults);
    if (!videos.length) throw new Error("Rumble returned no public search results");
    return { mode: "search", source_url: sourceUrl, query, page, next_url: nextPage(html), count: videos.length, videos };
  }

  const item = channel(input);
  const sourceUrl = `${item.url}${page > 1 ? `?page=${page}` : ""}`;
  const html = await fetchHtml(bf, sourceUrl);
  const videos = listing(html, maxResults);
  if (!videos.length) throw new Error("Rumble returned no public channel videos");
  return {
    mode: "channel_videos",
    source_url: sourceUrl,
    channel_handle: item.handle,
    page,
    next_url: nextPage(html),
    count: videos.length,
    videos,
  };
});
