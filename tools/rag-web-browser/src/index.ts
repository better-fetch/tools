import { defineTool } from "@better-fetch/tools";

type Input = {
  url: string;
  query?: string;
  max_text_chars?: number;
  max_links?: number;
  max_images?: number;
  wait_ms?: number;
  country?: string;
};

type Heading = {
  level: number;
  text: string;
};

type LinkItem = {
  url: string;
  text?: string;
};

type ImageItem = {
  url: string;
  alt?: string;
};

type QueryMatch = {
  term: string;
  count: number;
};

type Output = {
  url: string;
  final_url: string;
  title: string;
  description?: string;
  canonical_url?: string;
  language?: string;
  text: string;
  markdown: string;
  word_count: number;
  reading_time_minutes: number;
  headings?: Heading[];
  links?: LinkItem[];
  images?: ImageItem[];
  json_ld_types?: string[];
  query?: string;
  query_matches?: QueryMatch[];
  snippets?: string[];
};

type Block = {
  tag: string;
  text: string;
};

type ParsedUrl = {
  origin: string;
  path: string;
  query: string;
  href: string;
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

function cleanText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const clean = decodeEntities(value.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  return clean || undefined;
}

function clamp(raw: number | undefined, fallback: number, min: number, max: number): number {
  const n = Number.isFinite(raw) ? Math.round(raw as number) : fallback;
  return Math.max(min, Math.min(max, n));
}

function metaContent(html: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`<meta\\s+([^>]*(?:name|property)=["']${escaped}["'][^>]*)>`, "i");
  const attrs = html.match(re)?.[1];
  return cleanText(attrs?.match(/content=["']([^"']*)["']/i)?.[1]);
}

function attr(tag: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return cleanText(tag.match(new RegExp(`${escaped}=["']([^"']*)["']`, "i"))?.[1]);
}

function parseUrl(raw: string): ParsedUrl | null {
  const match = raw.trim().match(/^(https?:\/\/[^/?#]+)([^?#]*)?(\?[^#]*)?(?:#.*)?$/i);
  if (!match) return null;
  const origin = match[1].replace(/\/$/, "");
  const path = match[2]?.startsWith("/") ? match[2] : "/";
  const query = match[3] ?? "";
  return { origin, path, query, href: `${origin}${path}${query}` };
}

function absoluteUrl(value: string | undefined, base: ParsedUrl): string | undefined {
  if (!value) return undefined;
  const clean = decodeEntities(value).trim();
  if (!clean || /^(mailto|tel|javascript):/i.test(clean)) return undefined;
  if (clean.startsWith("//")) return parseUrl(`https:${clean}`)?.href;
  if (/^https?:\/\//i.test(clean)) return parseUrl(clean)?.href;
  if (clean.startsWith("/")) return parseUrl(`${base.origin}${clean}`)?.href;
  const dir = base.path.endsWith("/") ? base.path : base.path.replace(/\/[^/]*$/, "/");
  return parseUrl(`${base.origin}${dir}${clean}`)?.href;
}

function titleFrom(html: string, fallback: string): string {
  return (
    metaContent(html, "og:title") ??
    metaContent(html, "twitter:title") ??
    cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]) ??
    fallback
  );
}

function canonicalFrom(html: string, base: ParsedUrl): string | undefined {
  const tag = html.match(/<link[^>]+rel=["'][^"']*\bcanonical\b[^"']*["'][^>]*>/i)?.[0] ?? "";
  return absoluteUrl(attr(tag, "href"), base);
}

function languageFrom(html: string): string | undefined {
  const htmlTag = html.match(/<html\b[^>]*>/i)?.[0] ?? "";
  return attr(htmlTag, "lang");
}

function mainDocument(html: string): string {
  let doc = html
    .replace(/<(script|style|noscript|template|svg|iframe)[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  for (const container of [/<main[\s\S]*?<\/main>/i, /<article[\s\S]*?<\/article>/i]) {
    const match = doc.match(container);
    if (match && match[0].length > 300) {
      doc = match[0];
      break;
    }
  }
  return doc;
}

function blocksFrom(html: string, maxChars: number): Block[] {
  const doc = mainDocument(html);
  const blocks: Block[] = [];
  const seen = new Set<string>();
  const blockRe = /<(h[1-4]|p|li|blockquote|pre|td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let total = 0;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(doc))) {
    const text = cleanText(match[2]);
    if (!text || text.length < 3 || seen.has(text)) continue;
    seen.add(text);
    blocks.push({ tag: match[1].toLowerCase(), text });
    total += text.length;
    if (total >= maxChars) break;
  }

  if (blocks.length) return blocks;
  const fallback = cleanText(doc) ?? "";
  return fallback ? [{ tag: "p", text: fallback.slice(0, maxChars) }] : [];
}

function textFromBlocks(blocks: Block[], maxChars: number): string {
  const text = blocks.map((b) => b.text).join("\n\n");
  return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
}

function markdownFromBlocks(blocks: Block[], maxChars: number): string {
  const lines: string[] = [];
  for (const block of blocks) {
    if (/^h[1-4]$/.test(block.tag)) {
      const level = Number(block.tag.slice(1));
      lines.push(`${"#".repeat(level)} ${block.text}`);
    } else if (block.tag === "li") {
      lines.push(`- ${block.text}`);
    } else if (block.tag === "blockquote") {
      lines.push(`> ${block.text}`);
    } else {
      lines.push(block.text);
    }
  }
  const markdown = lines.join("\n\n");
  return markdown.length > maxChars ? `${markdown.slice(0, maxChars)}...` : markdown;
}

function headingsFrom(blocks: Block[]): Heading[] | undefined {
  const headings = blocks
    .filter((b) => /^h[1-4]$/.test(b.tag))
    .map((b) => ({ level: Number(b.tag.slice(1)), text: b.text }))
    .slice(0, 40);
  return headings.length ? headings : undefined;
}

function linksFrom(html: string, base: ParsedUrl, limit: number): LinkItem[] | undefined {
  if (limit <= 0) return undefined;
  const links: LinkItem[] = [];
  const seen = new Set<string>();
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) && links.length < limit) {
    const url = absoluteUrl(attr(match[0], "href"), base);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const item: LinkItem = { url };
    const label = cleanText(match[2]);
    if (label) item.text = label;
    links.push(item);
  }
  return links.length ? links : undefined;
}

function imagesFrom(html: string, base: ParsedUrl, limit: number): ImageItem[] | undefined {
  if (limit <= 0) return undefined;
  const images: ImageItem[] = [];
  const seen = new Set<string>();
  const re = /<img\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) && images.length < limit) {
    const tag = match[0];
    const url = absoluteUrl(attr(tag, "src") ?? attr(tag, "data-src") ?? attr(tag, "data-delayed-url"), base);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const image: ImageItem = { url };
    const alt = attr(tag, "alt");
    if (alt) image.alt = alt;
    images.push(image);
  }
  return images.length ? images : undefined;
}

function jsonLdTypes(html: string): string[] | undefined {
  const types = new Set<string>();
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(re)) {
    try {
      const parsed = JSON.parse(decodeEntities(match[1]));
      const stack = [parsed];
      while (stack.length) {
        const value = stack.pop();
        if (!value || typeof value !== "object") continue;
        if (Array.isArray(value)) {
          stack.push(...value);
          continue;
        }
        const record = value as Record<string, unknown>;
        const typeValue = record["@type"];
        if (typeof typeValue === "string") types.add(typeValue);
        else if (Array.isArray(typeValue)) {
          for (const item of typeValue) if (typeof item === "string") types.add(item);
        }
        for (const nested of [record["@graph"], record.mainEntity, record.itemListElement]) {
          if (nested && typeof nested === "object") stack.push(nested);
        }
      }
    } catch {
      /* skip malformed JSON-LD */
    }
  }
  return types.size ? [...types].slice(0, 20) : undefined;
}

function queryTerms(query: string | undefined): string[] {
  if (!query) return [];
  const seen = new Set<string>();
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((term) => term.length >= 3)
    .filter((term) => {
      if (seen.has(term)) return false;
      seen.add(term);
      return true;
    })
    .slice(0, 12);
}

function queryMatches(text: string, query: string | undefined): QueryMatch[] | undefined {
  const terms = queryTerms(query);
  if (!terms.length) return undefined;
  const lower = text.toLowerCase();
  const matches = terms.map((term) => ({
    term,
    count: lower.split(term).length - 1,
  }));
  return matches.some((m) => m.count > 0) ? matches : undefined;
}

function snippetsFor(text: string, query: string | undefined): string[] | undefined {
  const terms = queryTerms(query);
  if (!terms.length) return undefined;
  const lower = text.toLowerCase();
  const snippets: string[] = [];
  for (const term of terms) {
    const index = lower.indexOf(term);
    if (index < 0) continue;
    const start = Math.max(0, index - 140);
    const end = Math.min(text.length, index + term.length + 220);
    snippets.push(text.slice(start, end).replace(/\s+/g, " ").trim());
    if (snippets.length >= 5) break;
  }
  return snippets.length ? snippets : undefined;
}

function compact<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== "") out[key] = value;
  }
  return out as T;
}

export default defineTool<Input, Output>(async (input, bf) => {
  const parsed = parseUrl(input.url);
  if (!parsed) throw new Error("url must be a valid http(s) URL");

  const maxTextChars = clamp(input.max_text_chars, 12_000, 500, 50_000);
  const maxLinks = clamp(input.max_links, 20, 0, 100);
  const maxImages = clamp(input.max_images, 0, 0, 50);
  const waitMs = clamp(input.wait_ms, 500, 0, 5_000);

  const page = await bf.fetch({
    url: parsed.href,
    include_html: true,
    return_response_text: true,
    strategy: "browser",
    wait_until: "domcontentloaded",
    wait_ms: waitMs,
    proxy: "auto",
    ...(input.country ? { country: input.country.toUpperCase(), geoip: true } : {}),
  });

  const finalParsed = parseUrl(page.final_url ?? parsed.href) ?? parsed;
  const finalUrl = finalParsed.href;
  const html = page.html ?? page.body_text ?? "";
  const blocks = blocksFrom(html, maxTextChars);
  const text = textFromBlocks(blocks, maxTextChars);
  const markdown = markdownFromBlocks(blocks, maxTextChars);
  const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
  const query = input.query?.trim();

  return compact({
    url: parsed.href,
    final_url: finalUrl,
    title: titleFrom(html, page.title ?? finalUrl),
    description: metaContent(html, "description") ?? metaContent(html, "og:description"),
    canonical_url: canonicalFrom(html, finalParsed),
    language: languageFrom(html),
    text,
    markdown,
    word_count: words,
    reading_time_minutes: Math.max(1, Math.ceil(words / 225)),
    headings: headingsFrom(blocks),
    links: linksFrom(html, finalParsed, maxLinks),
    images: imagesFrom(html, finalParsed, maxImages),
    json_ld_types: jsonLdTypes(html),
    query,
    query_matches: queryMatches(text, query),
    snippets: snippetsFor(text, query),
  }) as Output;
});
