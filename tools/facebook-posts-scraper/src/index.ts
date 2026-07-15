import { defineTool, type Bf } from "@better-fetch/tools";

type Input = {
  page_url?: string;
  page_slug?: string;
  group_url?: string;
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
  group_id?: string;
};

type Output = {
  source_url: string;
  page_url: string;
  page_name?: string;
  followers?: number;
  group_id?: string;
  group_name?: string;
  members?: number;
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

function groupTarget(raw: string): { id: string; url: string } {
  const value = raw.trim();
  const id = value.match(/(?:facebook\.com\/groups\/)?(\d{5,30})/i)?.[1];
  if (!id) throw new Error("group_url must be a public Facebook group URL or numeric group id");
  return { id, url: `https://www.facebook.com/groups/${id}/` };
}

function groupPostText(segment: string, author: string | undefined, timestamp: string | undefined): string | undefined {
  let value = stripTags(segment).split(/All reactions:/i, 1)[0] ?? "";
  if (author) value = value.replace(author, "");
  if (timestamp) value = value.replace(timestamp, "");
  value = value
    .replace(/\b\d+:\d+\s*\/\s*\d+:\d+\b/g, " ")
    .replace(/\b(?:Play Video|Play|Settings|Enlarge|Unmute|Mute)\b/gi, " ")
    .replace(/[·•]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return value.length > 2 ? value.slice(0, 12_000) : undefined;
}

function groupMetrics(segment: string): { like_count?: number; comment_count?: number; share_count?: number } {
  const visible = stripTags(segment);
  const match = visible.match(/All reactions:\s*([\d.,KMB]+)\s+([\d.,KMB]+)\s+([\d.,KMB]+)\s+Like\s+Comment\s+Share/i);
  return {
    like_count: parseCompactNumber(match?.[1]),
    comment_count: parseCompactNumber(match?.[2]),
    share_count: parseCompactNumber(match?.[3]),
  };
}

function parseGroupPosts(html: string, groupId: string, maxResults: number): PostRecord[] {
  const linkPattern = new RegExp(`href=["']([^"']*facebook\\.com/groups/${groupId}/(?:posts|permalink)/(\\d+)[^"']*)["']`, "gi");
  const matches: Array<{ id: string; index: number; url: string; articleStart: number }> = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(linkPattern)) {
    const id = match[2];
    if (seen.has(id) || match.index === undefined) continue;
    seen.add(id);
    const role = html.lastIndexOf('role="article"', match.index);
    const articleStart = role >= 0 ? Math.max(html.lastIndexOf("<div", role), 0) : Math.max(0, match.index - 100_000);
    matches.push({ id, index: match.index, url: `https://www.facebook.com/groups/${groupId}/posts/${id}/`, articleStart });
    if (matches.length >= maxResults + 1) break;
  }
  const posts: PostRecord[] = [];
  for (let index = 0; index < Math.min(matches.length, maxResults); index++) {
    const item = matches[index];
    const end = matches[index + 1]?.articleStart ?? Math.min(html.length, item.index + 500_000);
    const segment = html.slice(item.articleStart, end);
    const authorHtml = segment.match(/data-ad-rendering-role=["']profile_name["'][^>]*>([\s\S]*?)<\/(?:span|h\d|div)>/i)?.[1]
      ?? segment.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1];
    const author = authorHtml ? stripTags(authorHtml) : undefined;
    const timestampHtml = segment.match(new RegExp(`<a\\b[^>]*href=["'][^"']*/groups/${groupId}/(?:posts|permalink)/${item.id}[^"']*["'][^>]*>([\\s\\S]*?)<\\/a>`, "i"))?.[1];
    const timestamp = timestampHtml ? stripTags(timestampHtml) : undefined;
    const metrics = groupMetrics(segment);
    const images = [...segment.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)].map((image) => decodeEntities(image[1]));
    const media = images.find((image) => /scontent|fbcdn/i.test(image) && !/s40x40|s60x60|cp0_dst-jpg_s64x64/i.test(image));
    posts.push(compact({
      type: "post",
      group_id: groupId,
      author_name: author,
      post_url: item.url,
      posted_at_label: timestamp,
      text: groupPostText(segment, author, timestamp),
      ...metrics,
      media_url: media,
      external_links: extractExternalLinks(segment),
    }));
  }
  return posts;
}

function indexedGroupPosts(html: string, groupId: string, maxResults: number): PostRecord[] {
  const posts: PostRecord[] = [];
  const seen = new Set<string>();
  const links = /<a[^>]+href="(https?:\/\/[^\"]+)"[^>]*>(?:(?!<\/a>).)*?<h3[^>]*>((?:(?!<\/h3>).)*)<\/h3>/gs;
  let match: RegExpExecArray | null;
  while ((match = links.exec(html)) && posts.length < maxResults) {
    let url = decodeEntities(match[1]);
    const redirect = url.match(/[?&]q=(https?[^&]+)/);
    if (redirect) url = decodeURIComponent(redirect[1]);
    const target = url.match(new RegExp(`facebook\\.com/groups/${groupId}/(?:posts|permalink)/(\\d+)`, "i"));
    if (!target || seen.has(target[1])) continue;
    seen.add(target[1]);
    const tail = html.slice(match.index + match[0].length, match.index + match[0].length + 4_000);
    const snippetMatch = tail.match(/<(?:div|span)[^>]*(?:data-sncf|class="[^"]*(?:VwiC3b|IsZvec)[^"]*")[^>]*>((?:(?!<\/(?:div|span)>).)*)/s);
    const heading = stripTags(match[2]);
    const snippet = snippetMatch ? stripTags(snippetMatch[1]) : undefined;
    const date = snippet?.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}/i)?.[0];
    posts.push(compact({
      type: "post",
      group_id: groupId,
      post_url: `https://www.facebook.com/groups/${groupId}/posts/${target[1]}/`,
      posted_at_label: date,
      text: heading.slice(0, 2_000),
    }));
  }
  return posts;
}

async function scrapeGroup(input: Input, bf: Bf): Promise<Output> {
  const target = groupTarget(input.group_url ?? "");
  const response = await bf.fetch({
    url: target.url,
    strategy: "browser",
    include_html: true,
    return_response_text: true,
    wait_until: "networkidle",
    wait_ms: waitFrom(input.wait_ms),
    timeout_ms: 90_000,
    proxy: "auto",
  });
  const rawHtml = response.body_text ?? "";
  const renderedHtml = response.html ?? "";
  const html = `${rawHtml}\n${renderedHtml}`;
  let posts = parseGroupPosts(html, target.id, Math.min(limitFrom(input.max_results), 3));
  let resolvedSource = response.final_url ?? target.url;
  if (!posts.length) {
    const query = `site:facebook.com/groups/${target.id}/posts`;
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=10&hl=en`;
    const search = await bf.fetch({
      url: searchUrl,
      include_html: true,
      strategy: "browser",
      wait_until: "domcontentloaded",
      wait_ms: 1_500,
      proxy: "auto",
    });
    posts = indexedGroupPosts(search.html ?? "", target.id, Math.min(limitFrom(input.max_results), 3));
    resolvedSource = search.final_url ?? searchUrl;
  }
  if (!posts.length) throw new Error("Facebook returned no posts from this public group");
  const groupNameHtml = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const visible = stripTags(html);
  const members = parseCompactNumber(visible.match(/([\d.,]+[KMB]?)\s+members/i)?.[1]);
  return compact({
    source_url: resolvedSource,
    page_url: target.url,
    group_id: target.id,
    group_name: groupNameHtml ? stripTags(groupNameHtml) : undefined,
    members,
    count: posts.length,
    posts,
  });
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

function indexedPosts(html: string, pageSlug: string, maxResults: number): PostRecord[] {
  const posts: PostRecord[] = [];
  const seen = new Set<string>();
  const links = /<a[^>]+href="(https?:\/\/[^\"]+)"[^>]*>(?:(?!<\/a>).)*?<h3[^>]*>((?:(?!<\/h3>).)*)<\/h3>/gs;
  let match: RegExpExecArray | null;
  while ((match = links.exec(html)) && posts.length < maxResults) {
    let url = decodeEntities(match[1]);
    const redirect = url.match(/[?&]q=(https?[^&]+)/);
    if (redirect) url = decodeURIComponent(redirect[1]);
    const target = url.match(/^https?:\/\/(?:www\.)?facebook\.com\/([^/?#]+)\/posts\/([^/?#]+)/i);
    if (!target || target[1].toLowerCase() !== pageSlug.toLowerCase()) continue;
    const canonical = `https://www.facebook.com/${target[1]}/posts/${target[2]}/`;
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    const tail = html.slice(match.index + match[0].length, match.index + match[0].length + 3000);
    const snippetMatch = tail.match(/<(?:div|span)[^>]*(?:data-sncf|class="[^"]*(?:VwiC3b|IsZvec)[^"]*")[^>]*>((?:(?!<\/(?:div|span)>).)*)/s);
    posts.push(compact({
      type: "post",
      author_name: stripTags(match[2]),
      post_url: canonical,
      posted_at_label: snippetMatch ? stripTags(snippetMatch[1]).slice(0, 120) : undefined,
    }));
  }
  return posts;
}

export default defineTool<Input, Output>(async (input, bf) => {
  if (input.group_url?.trim()) return scrapeGroup(input, bf);
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
  let posts = parsePosts(html, limitFrom(input.max_results));
  let resolvedSource = sourceUrl;
  if (!posts.length) {
    const pageSlug = pageUrl.match(/facebook\.com\/([^/?#]+)/i)?.[1];
    if (!pageSlug) throw new Error("Facebook Page slug was not found");
    const query = `site:facebook.com/${pageSlug}/posts`;
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${Math.min(limitFrom(input.max_results) + 5, 20)}&hl=en`;
    const search = await bf.fetch({
      url: searchUrl,
      include_html: true,
      strategy: "browser",
      wait_until: "domcontentloaded",
      wait_ms: 1500,
      proxy: "auto",
    });
    posts = indexedPosts(search.html ?? "", pageSlug, limitFrom(input.max_results));
    resolvedSource = search.final_url ?? searchUrl;
  }
  if (!posts.length) throw new Error("Facebook returned no public Page posts through the plugin or public search index");
  return compact({
    source_url: resolvedSource,
    page_url: pageUrl,
    page_name: parsePageName(html),
    followers: parseFollowers(html),
    count: posts.length,
    posts,
  });
});
