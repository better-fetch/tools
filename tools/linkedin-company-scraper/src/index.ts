import { defineTool } from "@better-fetch/tools";

type Input = {
  company_url?: string;
  slug?: string;
  max_recent_posts?: number;
};

type JsonObject = Record<string, unknown>;

type RecentPost = {
  url: string;
  text?: string;
  date_published?: string;
};

type Output = {
  company_url: string;
  slug: string;
  name: string;
  description?: string;
  website?: string;
  industry?: string;
  company_size?: string;
  headquarters?: string;
  organization_type?: string;
  specialties?: string[];
  follower_count?: number;
  logo?: string;
  recent_posts?: RecentPost[];
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

function stripTags(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = stripTags(value);
  return clean || undefined;
}

function objectValue(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : undefined;
}

function arrayValue(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value !== "string") return undefined;
  const n = Number(value.replace(/,/g, ""));
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

function metaContent(html: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`<meta\\s+([^>]*(?:name|property)=["']${escaped}["'][^>]*)>`, "i");
  const attrs = html.match(re)?.[1];
  const content = attrs?.match(/content=["']([^"']*)["']/i)?.[1];
  return text(content);
}

function canonicalUrl(input: Input): { url: string; slug: string } {
  if (input.company_url?.trim()) {
    let parsed: URL;
    try {
      parsed = new URL(input.company_url.trim());
    } catch {
      throw new Error("company_url must be a valid LinkedIn company URL");
    }
    if (!/^(www\.)?linkedin\.com$/i.test(parsed.hostname)) {
      throw new Error("company_url must be a LinkedIn company URL");
    }
    const match = parsed.pathname.match(/^\/company\/([^/?#]+)/i);
    if (!match) throw new Error("company_url must look like https://www.linkedin.com/company/openai/");
    return { url: `https://www.linkedin.com/company/${match[1]}/`, slug: match[1] };
  }

  const slug = input.slug?.trim().replace(/^\/?company\//, "").replace(/\/$/, "");
  if (!slug || !/^[A-Za-z0-9._-]{2,120}$/.test(slug)) {
    throw new Error("Provide a LinkedIn company_url or slug");
  }
  return { url: `https://www.linkedin.com/company/${slug}/`, slug };
}

function sectionForKey(html: string, key: string): string | undefined {
  const marker = `data-test-id="about-us__${key}"`;
  const start = html.indexOf(marker);
  if (start < 0) return undefined;
  const next = html.indexOf('data-test-id="about-us__', start + marker.length);
  const end = next > start ? next : html.indexOf("</dl>", start);
  return html.slice(start, end > start ? end : start + 2500);
}

function valueForKey(html: string, key: string): string | undefined {
  const section = sectionForKey(html, key);
  if (!section) return undefined;
  const dd = section.match(/<dd[^>]*>([\s\S]*?)<\/dd>/i)?.[1];
  return text(dd ?? section.replace(/<dt[\s\S]*?<\/dt>/i, ""));
}

function websiteForKey(html: string): string | undefined {
  const section = sectionForKey(html, "website");
  if (!section) return undefined;
  const href = section.match(/href=["']([^"']+)["']/i)?.[1];
  if (href) {
    try {
      const parsed = new URL(decodeEntities(href), "https://www.linkedin.com");
      const redirected = parsed.searchParams.get("url");
      if (redirected) return redirected;
    } catch {
      /* fall through to visible text */
    }
  }
  return valueForKey(html, "website")?.replace(/\s*External link.*$/i, "");
}

function parseJsonLd(html: string): JsonObject[] {
  const items: JsonObject[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(re)) {
    try {
      const parsed = JSON.parse(decodeEntities(match[1])) as JsonObject;
      const graph = arrayValue(parsed["@graph"]);
      if (graph) {
        for (const item of graph) {
          const obj = objectValue(item);
          if (obj) items.push(obj);
        }
      } else {
        items.push(parsed);
      }
    } catch {
      /* skip malformed structured data */
    }
  }
  return items;
}

function isoDate(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  const time = Date.parse(raw);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

function recentPosts(html: string, limit: number): RecentPost[] | undefined {
  if (limit <= 0) return undefined;
  const posts: RecentPost[] = [];
  for (const item of parseJsonLd(html)) {
    if (posts.length >= limit) break;
    if (item["@type"] !== "DiscussionForumPosting") continue;
    const url = text(item.mainEntityOfPage);
    if (!url) continue;
    posts.push(
      compactPost({
        url,
        text: text(item.text),
        date_published: isoDate(item.datePublished),
      }),
    );
  }
  return posts.length ? posts : undefined;
}

function parseName(html: string): string | undefined {
  return (
    metaContent(html, "og:title")?.replace(/\s+\|\s+LinkedIn$/i, "") ??
    text(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1])?.replace(/\s+\|\s+LinkedIn$/i, "")
  );
}

function parseFollowers(html: string): number | undefined {
  const description = metaContent(html, "description") ?? metaContent(html, "og:description");
  return numberValue(description?.match(/\|\s*([\d,]+)\s+followers/i)?.[1]);
}

function parseDescription(html: string): string | undefined {
  return (
    text(html.match(/data-test-id=["']about-us__description["'][^>]*>([\s\S]*?)<\/p>/i)?.[1]) ??
    metaContent(html, "description")?.replace(/^.*?\|\s*[\d,]+\s+followers\s+on\s+LinkedIn\.\s*/i, "")
  );
}

function splitSpecialties(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const list = value
    .split(/,\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
  return list.length ? list : [value];
}

function compactPost(post: RecentPost): RecentPost {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(post)) {
    if (value !== undefined && value !== "") out[key] = value;
  }
  return out as RecentPost;
}

function compact(output: Output): Output {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(output)) {
    if (value !== undefined && value !== "" && (!Array.isArray(value) || value.length > 0)) out[key] = value;
  }
  return out as Output;
}

export default defineTool<Input, Output>(async (input, bf) => {
  const { url, slug } = canonicalUrl(input);
  const maxRecent = Math.min(input.max_recent_posts ?? 5, 10);
  const page = await bf.fetch({
    url,
    return_response_text: true,
    include_html: true,
    strategy: "http",
    locale: "en-US",
    extra_headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36",
    },
  });

  const html = page.body_text ?? page.html ?? "";
  const name = parseName(html);
  if (!name) throw new Error("LinkedIn company profile metadata was not found in the public page");

  return compact({
    company_url: page.final_url ?? url,
    slug,
    name,
    description: parseDescription(html),
    website: websiteForKey(html),
    industry: valueForKey(html, "industry"),
    company_size: valueForKey(html, "size"),
    headquarters: valueForKey(html, "headquarters"),
    organization_type: valueForKey(html, "organizationType"),
    specialties: splitSpecialties(valueForKey(html, "specialties")),
    follower_count: parseFollowers(html),
    logo: metaContent(html, "og:image") ?? metaContent(html, "twitter:image"),
    recent_posts: recentPosts(html, maxRecent),
  });
});
