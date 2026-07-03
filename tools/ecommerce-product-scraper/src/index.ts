import { defineTool } from "@better-fetch/tools";

type Input = {
  url: string;
  max_description_chars?: number;
};

type Output = {
  url: string;
  final_url: string;
  status?: number;
  title: string;
  price?: number;
  currency?: string;
  availability?: string;
  image?: string;
  brand?: string;
  sku?: string;
  rating?: number;
  review_count?: number;
  description?: string;
};

type ProductData = {
  name?: unknown;
  description?: unknown;
  image?: unknown;
  brand?: unknown;
  sku?: unknown;
  mpn?: unknown;
  productID?: unknown;
  offers?: unknown;
  aggregateRating?: unknown;
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

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function text(value: unknown): string | undefined {
  if (typeof value === "string") {
    const clean = decodeEntities(value).replace(/\s+/g, " ").trim();
    return clean || undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function first<T>(items: (T | undefined)[]): T | undefined {
  return items.find((item) => item !== undefined);
}

function numberFrom(value: unknown): number | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  const normalized = raw.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/)?.[0];
  if (!normalized) return undefined;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : undefined;
}

function currencyFrom(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  const upper = raw.toUpperCase();
  if (/^[A-Z]{3}$/.test(upper)) return upper;
  if (raw.includes("$")) return "USD";
  if (raw.includes("\u00a3")) return "GBP";
  if (raw.includes("\u20ac")) return "EUR";
  if (raw.includes("\u00a5")) return "JPY";
  return undefined;
}

function truncate(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined;
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function attr(tag: string, name: string): string | undefined {
  const patterns = [
    new RegExp(`${name}=["']([^"']+)["']`, "i"),
    new RegExp(`${name}=([^\\s>]+)`, "i"),
  ];
  for (const re of patterns) {
    const match = tag.match(re)?.[1];
    if (match) return decodeEntities(match.trim());
  }
  return undefined;
}

function metaContent(html: string, names: string[]): string | undefined {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      `<meta[^>]+(?:property|name|itemprop)=["']${escaped}["'][^>]*content=["']([^"']+)["']` +
        `|<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name|itemprop)=["']${escaped}["']`,
      "i",
    );
    const match = html.match(re);
    const value = match?.[1] ?? match?.[2];
    if (value) return decodeEntities(value.trim());
  }
  return undefined;
}

function titleFromHtml(html: string, fallback: string): string {
  const h1 = html.match(/<h1\b[^>]*>([\s\S]{1,500}?)<\/h1>/i)?.[1];
  const raw =
    metaContent(html, ["og:title", "twitter:title"]) ??
    (h1 ? stripTags(h1) : undefined) ??
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ??
    fallback;
  return decodeEntities(raw.replace(/\s+/g, " ").trim());
}

function scriptsJsonLd(html: string): unknown[] {
  const values: unknown[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const raw = decodeEntities(match[1].trim());
    if (!raw) continue;
    try {
      values.push(JSON.parse(raw.replace(/^\s*<!--|-->\s*$/g, "")));
    } catch {
      /* Ignore invalid storefront snippets. */
    }
  }
  return values;
}

function typeMatches(value: unknown, typeName: string): boolean {
  if (typeof value === "string") return value.toLowerCase() === typeName.toLowerCase();
  return Array.isArray(value) && value.some((item) => typeMatches(item, typeName));
}

function findProduct(node: unknown): ProductData | undefined {
  const stack = [node];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    const obj = current as Record<string, unknown>;
    if (typeMatches(obj["@type"], "Product")) return obj as ProductData;
    if (Array.isArray(current)) {
      for (const child of current) stack.push(child);
    } else {
      const graph = obj["@graph"];
      if (Array.isArray(graph)) {
        for (const child of graph) stack.push(child);
      }
    }
  }
  return undefined;
}

function objectOrFirst(value: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(value)) return objectOrFirst(value[0]);
  if (value && typeof value === "object") return value as Record<string, unknown>;
  return undefined;
}

function imageFrom(value: unknown): string | undefined {
  if (typeof value === "string") return text(value);
  if (Array.isArray(value)) return imageFrom(value[0]);
  const obj = objectOrFirst(value);
  return obj ? text(obj.url ?? obj.contentUrl) : undefined;
}

function brandFrom(value: unknown): string | undefined {
  if (typeof value === "string") return text(value);
  const obj = objectOrFirst(value);
  return obj ? text(obj.name) : undefined;
}

function availabilityFrom(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  return raw.replace(/^https?:\/\/schema\.org\//i, "").replace(/([a-z])([A-Z])/g, "$1 $2");
}

function parseProductJsonLd(html: string): Partial<Output> {
  const product = scriptsJsonLd(html).map(findProduct).find(Boolean);
  if (!product) return {};

  const offer = objectOrFirst(product.offers);
  const rating = objectOrFirst(product.aggregateRating);
  return {
    title: text(product.name),
    description: text(product.description),
    image: imageFrom(product.image),
    brand: brandFrom(product.brand),
    sku: first([text(product.sku), text(product.mpn), text(product.productID)]),
    price: offer ? numberFrom(offer.price ?? offer.lowPrice ?? offer.highPrice) : undefined,
    currency: offer ? currencyFrom(offer.priceCurrency) : undefined,
    availability: offer ? availabilityFrom(offer.availability) : undefined,
    rating: rating ? numberFrom(rating.ratingValue) : undefined,
    review_count: rating ? numberFrom(rating.reviewCount ?? rating.ratingCount) : undefined,
  };
}

function itempropContent(html: string, prop: string): string | undefined {
  const escaped = prop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tag = html.match(new RegExp(`<[^>]+itemprop=["']${escaped}["'][^>]*>`, "i"))?.[0];
  if (!tag) return undefined;
  const content = attr(tag, "content");
  if (content) return content;
  const value = attr(tag, "value");
  if (value) return value;
  const src = attr(tag, "src");
  if (src) return src;
  const tagEnd = html.indexOf(">", html.indexOf(tag));
  if (tagEnd === -1) return undefined;
  const close = html.indexOf("</", tagEnd);
  if (close === -1 || close - tagEnd > 1000) return undefined;
  return stripTags(html.slice(tagEnd + 1, close));
}

function priceFromHtml(html: string): { price?: number; currency?: string } {
  const metaPrice = first([
    metaContent(html, ["product:price:amount", "og:price:amount", "price"]),
    itempropContent(html, "price"),
  ]);
  const metaCurrency = first([
    metaContent(html, ["product:price:currency", "og:price:currency", "priceCurrency"]),
    itempropContent(html, "priceCurrency"),
  ]);
  if (metaPrice) return { price: numberFrom(metaPrice), currency: currencyFrom(metaCurrency ?? metaPrice) };

  const priceBlock =
    html.match(/class=["'][^"']*(?:price|amount|sales-price|price_color)[^"']*["'][^>]*>([\s\S]{0,300}?)<\/[^>]+>/i)?.[1] ??
    html.match(/(?:price|amount)[^>]{0,80}>([\s\S]{0,300}?)<\/[^>]+>/i)?.[1];
  const clean = priceBlock ? stripTags(priceBlock) : undefined;
  return { price: numberFrom(clean), currency: currencyFrom(clean) };
}

function descriptionFromHtml(html: string): string | undefined {
  const meta = metaContent(html, ["og:description", "twitter:description", "description"]);
  if (meta) return meta;

  const productDescription =
    html.match(/id=["'][^"']*product[_-]?description[^"']*["'][^>]*>[\s\S]{0,500}?<\/[^>]+>\s*<[^>]+>([\s\S]{1,2500}?)<\/[^>]+>/i)?.[1] ??
    html.match(/class=["'][^"']*(?:description|product-description)[^"']*["'][^>]*>([\s\S]{1,2500}?)<\/[^>]+>/i)?.[1] ??
    itempropContent(html, "description");
  return productDescription ? stripTags(productDescription) : undefined;
}

function availabilityFromHtml(html: string): string | undefined {
  const meta = first([
    metaContent(html, ["product:availability", "og:availability", "availability"]),
    itempropContent(html, "availability"),
  ]);
  if (meta) return availabilityFrom(meta);

  const block = html.match(
    /<(?:p|div|span)[^>]+class=["'][^"']*(?:availability|stock|inventory)[^"']*["'][^>]*>([\s\S]{0,800}?)<\/(?:p|div|span)>/i,
  )?.[1];
  return block ? stripTags(block) : undefined;
}

function imageFromHtml(html: string): string | undefined {
  const meta = metaContent(html, ["og:image", "twitter:image"]) ?? itempropContent(html, "image");
  if (meta) return meta;

  const productImg = html.match(
    /<img[^>]+(?:class|id)=["'][^"']*(?:product|thumbnail|primary|main)[^"']*["'][^>]*>/i,
  )?.[0];
  const firstImg = productImg ?? html.match(/<img[^>]+>/i)?.[0];
  return firstImg ? attr(firstImg, "src") : undefined;
}

function normalizePath(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return `/${out.join("/")}`;
}

function absoluteUrl(value: string | undefined, finalUrl: string): string | undefined {
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return `https:${value}`;
  const origin = finalUrl.match(/^(https?:\/\/[^/?#]+)/i)?.[1];
  if (!origin) return value;
  if (value.startsWith("/")) return `${origin}${normalizePath(value)}`;
  const path = finalUrl.match(/^https?:\/\/[^/?#]+([^?#]*)/i)?.[1] ?? "/";
  const dir = path.endsWith("/") ? path : path.replace(/\/[^/]*$/, "/");
  return `${origin}${normalizePath(`${dir}${value}`)}`;
}

function compact(output: Output): Output {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(output)) {
    if (value !== undefined && value !== "" && !(typeof value === "number" && Number.isNaN(value))) {
      cleaned[key] = value;
    }
  }
  return cleaned as Output;
}

export default defineTool<Input, Output>(async (input, bf) => {
  const maxDescription = Math.min(input.max_description_chars ?? 1200, 5000);
  const page = await bf.fetch({
    url: input.url,
    return_response_text: true,
    include_html: true,
    strategy: "auto",
    wait_until: "domcontentloaded",
  });

  const finalUrl = page.final_url ?? input.url;
  const raw = page.body_text ?? "";
  const html = /<(script|meta|h1|body)\b/i.test(raw) ? raw : (page.html ?? raw);
  const jsonLd = parseProductJsonLd(html);
  const price = priceFromHtml(html);
  const title = jsonLd.title ?? titleFromHtml(html, page.title ?? finalUrl);
  const image = jsonLd.image ?? imageFromHtml(html);

  return compact({
    url: input.url,
    final_url: finalUrl,
    status: page.status,
    title,
    price: jsonLd.price ?? price.price,
    currency: jsonLd.currency ?? price.currency,
    availability: jsonLd.availability ?? availabilityFromHtml(html),
    image: absoluteUrl(image, finalUrl),
    brand: jsonLd.brand ?? itempropContent(html, "brand"),
    sku: jsonLd.sku ?? itempropContent(html, "sku") ?? itempropContent(html, "mpn"),
    rating: jsonLd.rating ?? numberFrom(itempropContent(html, "ratingValue")),
    review_count: jsonLd.review_count ?? numberFrom(itempropContent(html, "reviewCount")),
    description: truncate(jsonLd.description ?? descriptionFromHtml(html), maxDescription),
  });
});
