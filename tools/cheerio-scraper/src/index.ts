import { defineTool } from "@better-fetch/tools";

type Input = {
  url: string;
  selectors?: string[];
  max_text_chars?: number;
  max_links?: number;
  max_images?: number;
};

type LinkItem = { url: string; text?: string };
type ImageItem = { url: string; alt?: string };
type SelectorResult = { selector: string; text?: string; count: number };

type Output = {
  url: string;
  final_url: string;
  status?: number;
  content_type?: string;
  title: string;
  description?: string;
  canonical_url?: string;
  text: string;
  word_count: number;
  html_bytes?: number;
  json_ld_types?: string[];
  links?: LinkItem[];
  images?: ImageItem[];
  selector_results?: SelectorResult[];
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

function attr(tag: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text(tag.match(new RegExp(`${escaped}=["']([^"']*)["']`, "i"))?.[1]);
}

function metaContent(html: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `<meta\\s+([^>]*(?:name|property)=["']${escaped}["'][^>]*)>|<meta\\s+([^>]*content=["'][^"']*["'][^>]*(?:name|property)=["']${escaped}["'][^>]*)>`,
    "i",
  );
  const attrs = html.match(re)?.[1] ?? html.match(re)?.[2];
  const content = attrs?.match(/content=["']([^"']*)["']/i)?.[1];
  return text(content);
}

function absoluteUrl(value: string | undefined, base: string): string | undefined {
  if (!value) return undefined;
  const clean = decodeEntities(value).trim();
  if (!clean || /^(mailto|tel|javascript):/i.test(clean)) return undefined;
  try {
    const parsed = new URL(clean, base);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function titleFrom(html: string, fallback: string): string {
  return (
    metaContent(html, "og:title") ??
    metaContent(html, "twitter:title") ??
    text(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]) ??
    fallback
  );
}

function canonicalFrom(html: string, base: string): string | undefined {
  const tag = html.match(/<link[^>]+rel=["'][^"']*\bcanonical\b[^"']*["'][^>]*>/i)?.[0] ?? "";
  return absoluteUrl(attr(tag, "href"), base);
}

function readableText(html: string, maxChars: number): string {
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

  const blocks: string[] = [];
  const seen = new Set<string>();
  const blockRe = /<(h[1-4]|p|li|blockquote|td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(doc))) {
    const clean = text(match[2]);
    if (!clean || clean.length < 8 || seen.has(clean)) continue;
    seen.add(clean);
    blocks.push(clean);
  }

  const cleanText = blocks.length ? blocks.join("\n\n") : (text(doc) ?? "");
  return cleanText.length > maxChars ? `${cleanText.slice(0, maxChars)}...` : cleanText;
}

function linksFrom(html: string, base: string, limit: number): LinkItem[] | undefined {
  if (limit <= 0) return undefined;
  const links: LinkItem[] = [];
  const seen = new Set<string>();
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) && links.length < limit) {
    const url = absoluteUrl(attr(match[0], "href"), base);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    links.push(compactLink({ url, text: text(match[2]) }));
  }
  return links.length ? links : undefined;
}

function imagesFrom(html: string, base: string, limit: number): ImageItem[] | undefined {
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
    images.push(compactImage({ url, alt: attr(tag, "alt") }));
  }
  return images.length ? images : undefined;
}

function selectorPattern(selector: string): RegExp | null {
  const clean = selector.trim();
  if (!clean || clean.length > 80) return null;
  const tag = "[a-z][a-z0-9-]*";
  const name = "[A-Za-z0-9_-]+";
  if (new RegExp(`^${tag}$`, "i").test(clean)) {
    return new RegExp(`<(${clean})\\b[^>]*>([\\s\\S]*?)<\\/\\1>`, "gi");
  }
  if (new RegExp(`^\\.${name}$`).test(clean)) {
    const cls = clean.slice(1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`<(${tag})\\b[^>]*class=["'][^"']*(?:^|\\s)${cls}(?:\\s|$)[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`, "gi");
  }
  if (new RegExp(`^#${name}$`).test(clean)) {
    const id = clean.slice(1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`<(${tag})\\b[^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/\\1>`, "gi");
  }
  const tagClass = clean.match(new RegExp(`^(${tag})\\.(${name})$`, "i"));
  if (tagClass) {
    const cls = tagClass[2].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`<(${tagClass[1]})\\b[^>]*class=["'][^"']*(?:^|\\s)${cls}(?:\\s|$)[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`, "gi");
  }
  return null;
}

function selectorResults(html: string, selectors: string[] | undefined): SelectorResult[] | undefined {
  const requested = selectors?.map((s) => s.trim()).filter(Boolean).slice(0, 10) ?? [];
  if (!requested.length) return undefined;
  const results: SelectorResult[] = [];
  for (const selector of requested) {
    const pattern = selectorPattern(selector);
    if (!pattern) {
      results.push({ selector, count: 0 });
      continue;
    }
    const values: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) && values.length < 5) {
      const clean = text(match[2]);
      if (clean) values.push(clean);
    }
    results.push(compactSelector({ selector, text: values.join("\n\n"), count: values.length }));
  }
  return results;
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

function compactLink(link: LinkItem): LinkItem {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(link)) {
    if (value !== undefined && value !== "") out[key] = value;
  }
  return out as LinkItem;
}

function compactImage(image: ImageItem): ImageItem {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(image)) {
    if (value !== undefined && value !== "") out[key] = value;
  }
  return out as ImageItem;
}

function compactSelector(result: SelectorResult): SelectorResult {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(result)) {
    if (value !== undefined && value !== "") out[key] = value;
  }
  return out as SelectorResult;
}

function compact(output: Output): Output {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(output)) {
    if (value !== undefined && value !== "" && (!Array.isArray(value) || value.length > 0)) out[key] = value;
  }
  return out as Output;
}

export default defineTool<Input, Output>(async (input, bf) => {
  let requested: URL;
  try {
    requested = new URL(input.url);
  } catch {
    throw new Error("url must be a valid http(s) URL");
  }
  if (!["http:", "https:"].includes(requested.protocol)) throw new Error("url must use http or https");

  const page = await bf.fetch({
    url: requested.toString(),
    return_response_text: true,
    include_html: true,
    strategy: "http",
    locale: "en-US",
    extra_headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.5",
      "accept-language": "en-US,en;q=0.9",
      "user-agent": "Mozilla/5.0 (compatible; BetterFetchCheerioScraper/0.1; +https://betterfetch.co/tools/cheerio_scraper)",
    },
  });

  const finalUrl = page.final_url ?? requested.toString();
  const html = page.body_text?.length ? page.body_text : (page.html ?? "");
  const textValue = readableText(html, Math.min(input.max_text_chars ?? 12_000, 100_000));

  return compact({
    url: requested.toString(),
    final_url: finalUrl,
    status: page.status,
    content_type: page.content_type,
    title: titleFrom(html, page.title ?? finalUrl),
    description: metaContent(html, "description") ?? metaContent(html, "og:description"),
    canonical_url: canonicalFrom(html, finalUrl),
    text: textValue,
    word_count: textValue ? textValue.split(/\s+/).length : 0,
    html_bytes: html.length,
    json_ld_types: jsonLdTypes(html),
    links: linksFrom(html, finalUrl, input.max_links ?? 25),
    images: imagesFrom(html, finalUrl, input.max_images ?? 10),
    selector_results: selectorResults(html, input.selectors),
  });
});
