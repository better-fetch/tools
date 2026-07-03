import { defineTool } from "@better-fetch/tools";

type Input = {
  company_url?: string;
  slug?: string;
  max_posts?: number;
  max_text_chars?: number;
};

type JsonObject = Record<string, unknown>;

type Post = {
  url: string;
  text?: string;
  author_name?: string;
  date_published?: string;
  position?: number;
};

type Output = {
  company_url: string;
  slug: string;
  company_name?: string;
  posts: Post[];
  count: number;
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

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = decodeEntities(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  return clean || undefined;
}

function objectValue(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : undefined;
}

function arrayValue(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
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

function parseName(html: string): string | undefined {
  const title =
    html.match(/<meta\s+[^>]*(?:name|property)=["']og:title["'][^>]*content=["']([^"']*)["'][^>]*>/i)?.[1] ??
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return text(title)?.replace(/\s+\|\s+LinkedIn$/i, "");
}

function postsFrom(html: string, limit: number, maxText: number): Post[] {
  const posts: Post[] = [];
  const seen = new Set<string>();
  for (const item of parseJsonLd(html)) {
    if (posts.length >= limit) break;
    if (item["@type"] !== "DiscussionForumPosting") continue;
    const url = text(item.mainEntityOfPage);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const author = objectValue(item.author);
    let body = text(item.text);
    if (body && body.length > maxText) body = `${body.slice(0, maxText)}...`;
    posts.push(
      compactPost({
        url,
        text: body,
        author_name: text(author?.name),
        date_published: isoDate(item.datePublished),
        position: posts.length + 1,
      }),
    );
  }
  return posts;
}

function compactPost(post: Post): Post {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(post)) {
    if (value !== undefined && value !== "") out[key] = value;
  }
  return out as Post;
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
  const limit = Math.min(input.max_posts ?? 8, 20);
  const maxText = Math.min(input.max_text_chars ?? 1200, 5000);
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
  const posts = postsFrom(html, limit, maxText);
  if (!posts.length) throw new Error("LinkedIn company posts were not found in public structured data");

  return compact({
    company_url: page.final_url ?? url,
    slug,
    company_name: parseName(html),
    posts,
    count: posts.length,
  });
});
