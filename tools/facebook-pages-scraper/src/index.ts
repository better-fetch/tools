import { defineTool, type Bf } from "@better-fetch/tools";

type Input = {
  page_url?: string;
  page_slug?: string;
  page_urls?: string[];
  wait_ms?: number;
};

type PageRecord = {
  type: "page";
  input: string;
  page_name?: string;
  facebook_url?: string;
  facebook_id?: string;
  followers?: number;
  followers_label?: string;
  verified?: boolean;
  intro?: string;
  profile_image_url?: string;
  source_url: string;
};

type Output = {
  count: number;
  source_urls: string[];
  pages: PageRecord[];
};

type Target = {
  input: string;
  pageUrl: string;
};

function waitFrom(value: number | undefined): number {
  return Math.min(Math.max(value ?? 3500, 1000), 12000);
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
  return decodeEntities(value.replace(/<[^>]*>/g, " "))
    .replace(/\s{2,}/g, " ")
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

function cleanTarget(value: string | undefined): Target | undefined {
  const raw = (value ?? "").trim();
  if (!raw) return undefined;

  const profileId = raw.match(/facebook\.com\/profile\.php\?id=(\d+)/i)?.[1];
  if (profileId) {
    return { input: raw, pageUrl: `https://www.facebook.com/profile.php?id=${profileId}` };
  }

  let path = raw;
  const match = raw.match(/facebook\.com\/([^?#]+)(?:[?#].*)?$/i);
  if (match) path = match[1];
  path = decodeURIComponent(path).replace(/^\/+|\/+$/g, "");
  path = path.replace(/^pages\//i, "");

  if (!/^[A-Za-z0-9_.-]{2,120}(?:\/[A-Za-z0-9_.-]{2,120}){0,2}$/.test(path)) {
    throw new Error("Facebook page inputs must be public page URLs, slugs, or numeric page IDs");
  }
  return { input: raw, pageUrl: `https://www.facebook.com/${path}` };
}

function targetsFrom(input: Input): Target[] {
  const values = [input.page_url, input.page_slug, ...(input.page_urls ?? [])];
  const seen = new Set<string>();
  const targets: Target[] = [];
  for (const value of values) {
    const target = cleanTarget(value);
    if (!target || seen.has(target.pageUrl)) continue;
    seen.add(target.pageUrl);
    targets.push(target);
    if (targets.length >= 5) break;
  }
  if (!targets.length) throw new Error("page_url, page_slug, or page_urls is required");
  return targets;
}

function pluginUrl(pageUrl: string): string {
  const params: Record<string, string | number | boolean> = {
    href: pageUrl,
    tabs: "",
    width: 500,
    height: 500,
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
  if (/\/sharer\/sharer\.php/i.test(url)) return undefined;
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

function textContent(html: string): string {
  return stripTags(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " "),
  )
    .replace(/\s{2,}/g, " ")
    .trim();
}

function pageNameFromAnchors(html: string): string | undefined {
  for (const match of html.matchAll(/<a([^>]+)>([\s\S]*?)<\/a>/gi)) {
    const attrs = match[1];
    const href = canonicalFacebookUrl(attr(attrs, "href"));
    const title = attr(attrs, "title");
    const label = stripTags(match[2]);
    const candidate = title || label;
    if (!href || !candidate) continue;
    if (/^(Follow|Follow Page|Followed|Share)$/i.test(candidate)) continue;
    return candidate;
  }
  return undefined;
}

function pageNameFromText(text: string): string | undefined {
  const match = text.match(/\)\(\);\s*([A-Z0-9][\s\S]{1,140}?)\s+(?:Verified account\s+)?[\d,.]+[KMB]?\s+followers/i);
  return match?.[1]?.replace(/\s+/g, " ").trim();
}

function followerLabel(html: string, text: string): string | undefined {
  const htmlMatch = html.match(/>([\d,.]+(?:\s*[KMB])?)\s+followers</i);
  if (htmlMatch) return htmlMatch[1]?.replace(/\s+/g, "").trim();
  const match = text.match(/([\d,.]+(?:\s*[KMB])?)\s+followers/i);
  return match?.[1]?.replace(/\s+/g, "").trim();
}

function introText(text: string): string | undefined {
  const match = text.match(/followers\s+([\s\S]{24,360}?)\s+(?:Follow Page|Followed|Follow|Share)\b/i);
  const intro = match?.[1]?.replace(/\s+/g, " ").trim();
  if (!intro || /^Follow/i.test(intro)) return undefined;
  return intro.slice(0, 500);
}

function profileImageUrl(html: string): string | undefined {
  for (const match of html.matchAll(/<img([^>]+)>/gi)) {
    const src = attr(match[1], "src");
    if (src && /^https?:\/\//i.test(src)) return src;
  }
  return undefined;
}

function facebookUrls(html: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<a([^>]+)>/gi)) {
    const href = canonicalFacebookUrl(attr(match[1], "href"));
    if (!href || seen.has(href)) continue;
    seen.add(href);
    urls.push(href);
  }
  return urls;
}

function numericFacebookId(urls: string[]): string | undefined {
  for (const url of urls) {
    const match = url.match(/facebook\.com\/(\d+)(?:$|[/?#])/i);
    if (match) return match[1];
  }
  return undefined;
}

function preferredFacebookUrl(urls: string[], requestedPageUrl: string): string | undefined {
  const nonNumeric = urls.find((url) => !/facebook\.com\/\d+(?:$|[/?#])/i.test(url));
  return nonNumeric ?? urls[0] ?? requestedPageUrl;
}

function parsePage(html: string, target: Target, sourceUrl: string): PageRecord | undefined {
  const text = textContent(html);
  const urls = facebookUrls(html);
  const followersLabel = followerLabel(html, text);
  const record = compact<PageRecord>({
    type: "page",
    input: target.input,
    page_name: pageNameFromAnchors(html) ?? pageNameFromText(text),
    facebook_url: preferredFacebookUrl(urls, target.pageUrl),
    facebook_id: numericFacebookId(urls),
    followers: parseCompactNumber(followersLabel),
    followers_label: followersLabel ? `${followersLabel} followers` : undefined,
    verified: /Verified account|aria-label=["']Verified Page/i.test(`${text} ${html}`) ? true : undefined,
    intro: introText(text),
    profile_image_url: profileImageUrl(html),
    source_url: sourceUrl,
  });
  if (!record.page_name && !record.followers && !record.profile_image_url && !record.facebook_url) return undefined;
  return record;
}

export default defineTool<Input, Output>(async (input, bf: Bf) => {
  const targets = targetsFrom(input);
  const waitMs = waitFrom(input.wait_ms);
  const pages: PageRecord[] = [];
  const sourceUrls: string[] = [];

  for (const target of targets) {
    const sourceUrl = pluginUrl(target.pageUrl);
    sourceUrls.push(sourceUrl);
    const response = await bf.fetch({
      url: sourceUrl,
      strategy: "browser",
      include_html: true,
      return_response_text: true,
      wait_ms: waitMs,
      timeout_ms: 90_000,
    });
    const html = response.html ?? response.body_text ?? "";
    if (!response.ok || !html) {
      throw new Error(`Facebook Page Plugin request failed with status ${response.status ?? "unknown"}`);
    }
    const page = parsePage(html, target, sourceUrl);
    if (page) pages.push(page);
  }

  return {
    count: pages.length,
    source_urls: sourceUrls,
    pages,
  };
});
