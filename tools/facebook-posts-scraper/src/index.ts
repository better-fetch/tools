import { defineTool, type Bf } from "@better-fetch/tools";

type Input = {
  page_url?: string;
  page_slug?: string;
  max_results?: number;
  wait_ms?: number;
};

type PostRecord = {
  type: "post";
  author_name?: string;
  post_url: string;
  posted_at_label?: string;
  posted_at?: string;
  text?: string;
  like_count?: number;
  comment_count?: number;
  share_count?: number;
  media_url?: string;
  external_links?: string;
};

type Output = {
  source_url: string;
  page_url: string;
  page_name?: string;
  followers?: number;
  count: number;
  posts: PostRecord[];
};

function limitFrom(value: number | undefined): number {
  return Math.min(Math.max(value ?? 5, 1), 10);
}

function waitFrom(value: number | undefined): number {
  return Math.min(Math.max(value ?? 4000, 1000), 12000);
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function stripTags(value: string): string {
  return decodeEntities(
    value
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function attr(attrs: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = attrs.match(new RegExp(`${escaped}=["']([^"']*)["']`, "i"));
  return match?.[1] ? decodeEntities(match[1]).trim() : undefined;
}

function compact<T extends Record<string, unknown>>(record: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined && value !== "" && value !== null) out[key] = value;
  }
  return out as T;
}

function facebookPageUrl(input: Input): string {
  const raw = (input.page_url ?? input.page_slug ?? "").trim();
  if (!raw) throw new Error("page_url or page_slug is required");
  let path = raw;
  const match = raw.match(/facebook\.com\/([^?#]+)(?:[?#].*)?$/i);
  if (match) path = match[1];
  path = decodeURIComponent(path).replace(/^\/+|\/+$/g, "");
  if (!/^[A-Za-z0-9_.-]{2,120}(?:\/[A-Za-z0-9_.-]+)?$/.test(path)) {
    throw new Error("page_url or page_slug must point to a public Facebook Page path");
  }
  return `https://www.facebook.com/${path}`;
}

function pluginUrl(pageUrl: string): string {
  const params: Record<string, string | number | boolean> = {
    href: pageUrl,
    tabs: "timeline",
    width: 500,
    height: 800,
    small_header: false,
    adapt_container_width: true,
    hide_cover: false,
    show_facepile: false,
  };
  const qs = Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
  return `https://www.facebook.com/plugins/page.php?${qs}`;
}

function canonicalFacebookUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let url = decodeEntities(value);
  if (url.startsWith("/")) url = `https://www.facebook.com${url}`;
  if (!/^https:\/\/www\.facebook\.com\//i.test(url)) return undefined;
  url = url.replace(/\?ref=embed_page.*$/i, "").replace(/&ref=embed_page.*$/i, "");
  return url;
}

function parseCompactNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const clean = decodeEntities(value).replace(/,/g, "").trim();
  const match = clean.match(/^([\d.]+)\s*([KMB])?$/i);
  if (!match) return undefined;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return undefined;
  const suffix = (match[2] ?? "").toUpperCase();
  const factor = suffix === "K" ? 1_000 : suffix === "M" ? 1_000_000 : suffix === "B" ? 1_000_000_000 : 1;
  return Math.round(base * factor);
}

function extractMetric(segment: string, title: string): number | undefined {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = segment.match(new RegExp(`title=["']${escaped}["'][\\s\\S]*?<\\/i>([^<]+)<\\/div>`, "i"));
  return parseCompactNumber(match?.[1]);
}

function extractPostText(segment: string): string | undefined {
  const start = segment.search(/data-testid=["']post_message["']/i);
  if (start < 0) return undefined;
  const after = segment.slice(start);
  const contentStart = after.indexOf(">");
  if (contentStart < 0) return undefined;
  const body = after.slice(contentStart + 1);
  const endCandidates = ["<div></div>", "<div class=\"_2162", "<table class=\"uiGrid"];
  let end = body.length;
  for (const marker of endCandidates) {
    const idx = body.indexOf(marker);
    if (idx >= 0) end = Math.min(end, idx);
  }
  const text = stripTags(body.slice(0, end)).replace(/\s*See more\s*$/i, "").trim();
  return text || undefined;
}

function extractAuthor(segment: string): string | undefined {
  const match = segment.match(/<div class="_2_79[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  return match ? stripTags(match[1]) : undefined;
}

function extractTimestamp(segment: string): { label?: string; iso?: string } {
  const match = segment.match(/<abbr([^>]*)>([\s\S]*?)<\/abbr>/i);
  if (!match) return {};
  const timestamp = attr(match[1], "data-utime");
  const label = stripTags(match[2]) || attr(match[1], "data-tooltip-content");
  const unix = timestamp ? Number(timestamp) : undefined;
  return {
    ...(label ? { label } : {}),
    ...(unix && Number.isFinite(unix) ? { iso: new Date(unix * 1000).toISOString() } : {}),
  };
}

function extractPostUrl(segment: string): string | undefined {
  const hrefs = [...segment.matchAll(/href=["']([^"']+)["']/gi)].map((m) => decodeEntities(m[1]));
  const preferred = hrefs.find((href) => /\/posts\/pfbid|\/reel\/\d+|photo\.php\?fbid=/i.test(href));
  return canonicalFacebookUrl(preferred);
}

function extractMediaUrl(segment: string): string | undefined {
  const imgMatches = [...segment.matchAll(/<img([^>]+)>/gi)];
  for (const match of imgMatches) {
    const src = attr(match[1], "src");
    const classes = attr(match[1], "class") ?? "";
    if (src && /_1p6f|_3fnw|scaledImageFit/i.test(classes)) return src;
  }
  return undefined;
}

function extractExternalLinks(segment: string): string | undefined {
  const links = new Set<string>();
  for (const match of segment.matchAll(/href=["']([^"']+)["']/gi)) {
    const href = decodeEntities(match[1]);
    let url: string | undefined;
    const lynx = href.match(/[?&]u=([^&]+)/);
    if (/l\.facebook\.com\/l\.php/i.test(href) && lynx) {
      try {
        url = decodeURIComponent(lynx[1]);
      } catch {
        url = lynx[1];
      }
    } else if (/^https?:\/\//i.test(href) && !/facebook\.com/i.test(href)) {
      url = href;
    }
    if (url) links.add(url);
  }
  return links.size ? [...links].slice(0, 10).join(", ") : undefined;
}

function splitPostSegments(html: string): string[] {
  const segments: string[] = [];
  const marker = '<div class="_4-u2';
  let cursor = html.indexOf(marker);
  while (cursor >= 0) {
    const next = html.indexOf(marker, cursor + marker.length);
    const segment = html.slice(cursor, next >= 0 ? next : undefined);
    if (/data-testid=["']post_message["']|\/posts\/pfbid|\/reel\/\d+|photo\.php\?fbid=/i.test(segment)) {
      segments.push(segment);
    }
    cursor = next;
  }
  return segments;
}

function parsePageName(html: string): string | undefined {
  const match = html.match(/<a[^>]+href=["'][^"']*facebook\.com\/[^"']*ref=embed_page[^"']*["'][^>]*>([^<]{3,160})<\/a>/i);
  return match ? stripTags(match[1]) : undefined;
}

function parseFollowers(html: string): number | undefined {
  const text = stripTags(html);
  const match = text.match(/([\d,]+)\s+followers/i);
  return match ? parseCompactNumber(match[1]) : undefined;
}

function parsePosts(html: string, maxResults: number): PostRecord[] {
  const posts: PostRecord[] = [];
  const seen = new Set<string>();
  for (const segment of splitPostSegments(html)) {
    const postUrl = extractPostUrl(segment);
    if (!postUrl || seen.has(postUrl)) continue;
    seen.add(postUrl);
    const timestamp = extractTimestamp(segment);
    posts.push(
      compact({
        type: "post",
        author_name: extractAuthor(segment),
        post_url: postUrl,
        posted_at_label: timestamp.label,
        posted_at: timestamp.iso,
        text: extractPostText(segment),
        like_count: extractMetric(segment, "Like"),
        comment_count: extractMetric(segment, "Comment"),
        share_count: extractMetric(segment, "Share"),
        media_url: extractMediaUrl(segment),
        external_links: extractExternalLinks(segment),
      }),
    );
    if (posts.length >= maxResults) break;
  }
  return posts;
}

export default defineTool<Input, Output>(async (input, bf) => {
  const pageUrl = facebookPageUrl(input);
  const sourceUrl = pluginUrl(pageUrl);
  const response = await bf.fetch({
    url: sourceUrl,
    strategy: "browser",
    include_html: true,
    return_response_text: true,
    wait_ms: waitFrom(input.wait_ms),
    timeout_ms: 90_000,
  });
  const html = response.html ?? response.body_text ?? "";
  if (!response.ok || !html) {
    throw new Error(`Facebook Page Plugin request failed with status ${response.status ?? "unknown"}`);
  }
  const posts = parsePosts(html, limitFrom(input.max_results));
  return compact({
    source_url: sourceUrl,
    page_url: pageUrl,
    page_name: parsePageName(html),
    followers: parseFollowers(html),
    count: posts.length,
    posts,
  });
});
