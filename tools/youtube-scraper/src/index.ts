import { defineTool } from "@better-fetch/tools";

type Input = {
  query?: string;
  channel_url?: string;
  max_results?: number;
};

type Video = {
  video_id: string;
  title: string;
  url: string;
  channel?: string;
  channel_url?: string;
  duration?: string;
  views_text?: string;
  view_count?: number;
  published?: string;
  thumbnail?: string;
  description?: string;
};

type Output = {
  source: string;
  source_url: string;
  count: number;
  videos: Video[];
};

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
  const obj = node as Record<string, unknown>;
  if (typeof obj.simpleText === "string") return obj.simpleText.trim();
  if (Array.isArray(obj.runs)) {
    const text = obj.runs
      .map((run) => (run && typeof run === "object" ? (run as Record<string, unknown>).text : ""))
      .filter((value): value is string => typeof value === "string")
      .join("")
      .trim();
    if (text) return text;
  }
  const accessibility = obj.accessibility as Record<string, unknown> | undefined;
  const data = accessibility?.accessibilityData as Record<string, unknown> | undefined;
  return typeof data?.label === "string" ? data.label.trim() : undefined;
}

function firstRunUrl(node: unknown): string | undefined {
  if (!node || typeof node !== "object") return undefined;
  const runs = (node as Record<string, unknown>).runs;
  if (!Array.isArray(runs)) return undefined;
  for (const run of runs) {
    if (!run || typeof run !== "object") continue;
    const endpoint = (run as Record<string, unknown>).navigationEndpoint as Record<string, unknown> | undefined;
    const command = endpoint?.commandMetadata as Record<string, unknown> | undefined;
    const web = command?.webCommandMetadata as Record<string, unknown> | undefined;
    const url = web?.url;
    if (typeof url === "string") return absoluteYouTubeUrl(url);
  }
  return undefined;
}

function absoluteYouTubeUrl(path: string | undefined): string | undefined {
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith("//")) return `https:${path}`;
  if (path.startsWith("/")) return `https://www.youtube.com${path}`;
  return `https://www.youtube.com/${path}`;
}

function thumbnailFrom(node: unknown): string | undefined {
  const thumbs = ((node as Record<string, unknown> | undefined)?.thumbnail as Record<string, unknown> | undefined)
    ?.thumbnails;
  if (!Array.isArray(thumbs) || !thumbs.length) return undefined;
  const last = thumbs[thumbs.length - 1];
  const url = last && typeof last === "object" ? (last as Record<string, unknown>).url : undefined;
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

function extractInitialData(html: string): unknown | null {
  const marker = "ytInitialData";
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
    } else if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function compact(video: Video): Video {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(video)) {
    if (value !== undefined && value !== "") out[key] = value;
  }
  return out as Video;
}

function videoFromRenderer(renderer: Record<string, unknown>): Video | null {
  const videoId = typeof renderer.videoId === "string" ? renderer.videoId : undefined;
  const title = textFrom(renderer.title);
  if (!videoId || !title) return null;

  const nav = renderer.navigationEndpoint as Record<string, unknown> | undefined;
  const command = nav?.commandMetadata as Record<string, unknown> | undefined;
  const web = command?.webCommandMetadata as Record<string, unknown> | undefined;
  const url = absoluteYouTubeUrl(typeof web?.url === "string" ? web.url : `/watch?v=${videoId}`);
  const viewsText = textFrom(renderer.viewCountText) ?? textFrom(renderer.shortViewCountText);
  const description = Array.isArray(renderer.detailedMetadataSnippets)
    ? textFrom((renderer.detailedMetadataSnippets[0] as Record<string, unknown> | undefined)?.snippetText)
    : undefined;

  return compact({
    video_id: videoId,
    title: decodeEntities(title),
    url: url ?? `https://www.youtube.com/watch?v=${videoId}`,
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

function parseVideos(initialData: unknown, limit: number): Video[] {
  const videos: Video[] = [];
  const seen = new Set<string>();
  const stack: unknown[] = [initialData];

  while (stack.length && videos.length < limit) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) stack.push(node[i]);
      continue;
    }

    const obj = node as Record<string, unknown>;
    const renderer = obj.videoRenderer;
    if (renderer && typeof renderer === "object") {
      const video = videoFromRenderer(renderer as Record<string, unknown>);
      if (video && !seen.has(video.video_id)) {
        seen.add(video.video_id);
        videos.push(video);
      }
      continue;
    }

    const values = Object.values(obj);
    for (let i = values.length - 1; i >= 0; i--) stack.push(values[i]);
  }

  return videos;
}

function channelVideosUrl(raw: string): string {
  if (!/^https?:\/\/(www\.)?youtube\.com\//i.test(raw)) {
    throw new Error("channel_url must be a youtube.com channel URL");
  }
  const clean = raw.replace(/[?#].*$/, "").replace(/\/$/, "");
  const withTab = /\/(videos|shorts|streams)$/i.test(clean) ? clean : `${clean}/videos`;
  return `${withTab}?hl=en`;
}

function sourceFrom(input: Input): { source: string; url: string } {
  if (input.query?.trim()) {
    const query = input.query.trim();
    return {
      source: query,
      url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=en`,
    };
  }
  if (input.channel_url?.trim()) {
    const url = channelVideosUrl(input.channel_url.trim());
    return { source: input.channel_url.trim(), url };
  }
  throw new Error("Provide query or channel_url");
}

export default defineTool<Input, Output>(async (input, bf) => {
  const limit = Math.min(input.max_results ?? 10, 25);
  const source = sourceFrom(input);
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
  const videos = initialData ? parseVideos(initialData, limit) : [];

  return {
    source: source.source,
    source_url: page.final_url ?? source.url,
    count: videos.length,
    videos,
  };
});
