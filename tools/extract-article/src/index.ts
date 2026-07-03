import { defineTool } from "@better-fetch/tools";

type Input = {
  url: string;
  max_chars?: number;
};

type Output = {
  title: string;
  byline?: string;
  published?: string;
  site_name?: string;
  text: string;
  word_count: number;
  final_url: string;
};

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

function metaContent(html: string, patterns: string[]): string | undefined {
  for (const name of patterns) {
    // <meta property="og:title" content="..."> — attribute order varies.
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']+)["']` +
        `|<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${name}["']`,
      "i",
    );
    const m = html.match(re);
    const value = m?.[1] ?? m?.[2];
    if (value) return decodeEntities(value.trim());
  }
  return undefined;
}

// Readability-lite: prefer the <article>/<main> region, then join block-level
// text (headings, paragraphs, list items). No DOM available in the isolate,
// so this is regex-based — good enough for the long tail of article pages.
function extractText(html: string): string {
  let doc = html
    .replace(/<(script|style|noscript|template|svg|iframe)[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  for (const container of [/<article[\s\S]*?<\/article>/i, /<main[\s\S]*?<\/main>/i]) {
    const m = doc.match(container);
    if (m && m[0].length > 500) {
      doc = m[0];
      break;
    }
  }

  const blocks: string[] = [];
  const seen = new Set<string>();
  const blockRe = /<(h[1-4]|p|li|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(doc))) {
    const tag = m[1].toLowerCase();
    const text = decodeEntities(m[2].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
    if (!text) continue;
    // Nav/menu cruft: short list items and repeated blocks.
    if (tag === "li" && text.split(/\s+/).length < 4) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    blocks.push(text);
  }
  if (blocks.length) return blocks.join("\n\n");

  // No block markup at all — fall back to stripping every tag.
  return decodeEntities(doc.replace(/<[^>]+>/g, " ")).replace(/[ \t]+/g, " ").trim();
}

export default defineTool<Input, Output>(async (input, bf) => {
  const page = await bf.fetch({
    url: input.url,
    return_response_text: true,
    include_html: true,
  });
  // Prefer the raw response document (body_text): it is authoritative for
  // article pages, and the rendered-DOM html snapshot can lag the response
  // on pooled browser contexts. Fall back to the DOM for JS-only pages.
  const raw = page.body_text ?? "";
  const html = /<(article|p|h1)\b/i.test(raw) ? raw : (page.html?.length ? page.html : raw);
  const maxChars = input.max_chars ?? 100_000;

  const title =
    metaContent(html, ["og:title", "twitter:title"]) ??
    (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? page.title ?? "")
      .replace(/\s+/g, " ")
      .trim();

  let text = extractText(html);
  if (text.length > maxChars) text = `${text.slice(0, maxChars)}…`;

  return {
    title: decodeEntities(title),
    byline: metaContent(html, ["author", "article:author", "parsely-author", "sailthru.author"]),
    published: metaContent(html, [
      "article:published_time",
      "parsely-pub-date",
      "date",
      "sailthru.date",
    ]),
    site_name: metaContent(html, ["og:site_name"]),
    text,
    word_count: text ? text.split(/\s+/).length : 0,
    final_url: page.final_url ?? input.url,
  };
});
