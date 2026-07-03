import { defineTool } from "@better-fetch/tools";

type Input = {
  url: string;
  max_pages?: number;
  max_chars_per_page?: number;
  include_path_prefixes?: string[];
};

type Page = {
  url: string;
  title: string;
  text: string;
  word_count: number;
  links: number;
};

type Output = {
  start_url: string;
  origin: string;
  count: number;
  pages: Page[];
};

type ParsedUrl = { origin: string; path: string; href: string };

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function parseUrl(raw: string): ParsedUrl | null {
  const match = raw.match(/^(https?:\/\/[^/?#]+)([^?#]*)?(?:[?#].*)?$/i);
  if (!match) return null;
  const origin = match[1].replace(/\/$/, "");
  const path = match[2]?.startsWith("/") ? match[2] : "/";
  return { origin, path, href: `${origin}${path}` };
}

function normalizeLink(href: string, base: ParsedUrl): ParsedUrl | null {
  const clean = decodeEntities(href.trim()).replace(/#.*/, "");
  if (!clean || clean.startsWith("mailto:") || clean.startsWith("tel:") || clean.startsWith("javascript:")) {
    return null;
  }
  if (clean.startsWith("//")) return parseUrl(`https:${clean}`);
  if (clean.startsWith("http://") || clean.startsWith("https://")) return parseUrl(clean);
  if (clean.startsWith("/")) return parseUrl(`${base.origin}${clean}`);

  const dir = base.path.endsWith("/") ? base.path : base.path.replace(/\/[^/]*$/, "/");
  return parseUrl(`${base.origin}${dir}${clean}`);
}

function titleFrom(html: string, fallback: string): string {
  const raw =
    html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i)?.[1] ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:title["']/i)?.[1] ??
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ??
    fallback;
  return decodeEntities(raw.replace(/\s+/g, " ").trim());
}

function readableText(html: string, maxChars: number): string {
  let doc = html
    .replace(/<(script|style|noscript|template|svg|iframe|nav|footer|header)[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  for (const container of [/<main[\s\S]*?<\/main>/i, /<article[\s\S]*?<\/article>/i]) {
    const match = doc.match(container);
    if (match && match[0].length > 300) {
      doc = match[0];
      break;
    }
  }

  const blocks: string[] = [];
  const seen = new Set<string>();
  const blockRe = /<(h[1-4]|p|li|blockquote|td)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(doc))) {
    const text = decodeEntities(match[2].replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .trim();
    if (!text || text.length < 24 || seen.has(text)) continue;
    seen.add(text);
    blocks.push(text);
  }

  const text = blocks.length
    ? blocks.join("\n\n")
    : decodeEntities(doc.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
}

function sameOriginLinks(html: string, base: ParsedUrl, prefixes: string[]): string[] {
  const links: string[] = [];
  const seen = new Set<string>();
  const linkRe = /<a\b[^>]+href=["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRe.exec(html))) {
    const parsed = normalizeLink(match[1], base);
    if (!parsed || parsed.origin !== base.origin) continue;
    if (prefixes.length && !prefixes.some((prefix) => parsed.path.startsWith(prefix))) continue;
    if (seen.has(parsed.href)) continue;
    seen.add(parsed.href);
    links.push(parsed.href);
  }
  return links;
}

export default defineTool<Input, Output>(async (input, bf) => {
  const start = parseUrl(input.url);
  if (!start) throw new Error("url must be an http(s) URL");

  const maxPages = Math.min(input.max_pages ?? 3, 10);
  const maxChars = Math.min(input.max_chars_per_page ?? 12_000, 50_000);
  const prefixes = input.include_path_prefixes?.filter((p) => p.startsWith("/")) ?? [];
  const queue = [start.href];
  const seen = new Set<string>();
  const pages: Page[] = [];

  while (queue.length && pages.length < maxPages) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);

    const page = await bf.fetch({
      url,
      include_html: true,
      return_response_text: true,
      strategy: "browser",
      wait_until: "domcontentloaded",
      wait_ms: 500,
    });
    const parsed = parseUrl(page.final_url ?? url) ?? parseUrl(url)!;
    const html = page.html ?? page.body_text ?? "";
    const links = sameOriginLinks(html, parsed, prefixes);
    for (const link of links) {
      if (!seen.has(link) && queue.length + pages.length < maxPages * 3) queue.push(link);
    }

    const text = readableText(html, maxChars);
    pages.push({
      url: parsed.href,
      title: titleFrom(html, page.title ?? parsed.href),
      text,
      word_count: text ? text.split(/\s+/).length : 0,
      links: links.length,
    });
  }

  return {
    start_url: input.url,
    origin: start.origin,
    count: pages.length,
    pages,
  };
});
