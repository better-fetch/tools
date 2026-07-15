import { defineTool } from "@better-fetch/tools";

type Mode = "search" | "products" | "product" | "product_reviews";

type Input = {
  mode?: Mode;
  query?: string;
  url?: string;
  product_id?: string;
  page?: number;
  max_results?: number;
  region?: string;
  sort_by?: "top" | "new_releases";
};

type ProductSummary = {
  product_id: string;
  title: string;
  url: string;
  description?: string;
  price?: string;
  original_price?: string;
  currency?: string;
  discount?: string;
  rating?: number;
  review_count?: number;
  sold_count?: number;
  seller_name?: string;
  images_csv?: string;
  categories_csv?: string;
};

type ProductReview = {
  reviewer_name: string;
  country?: string;
  text: string;
  sku?: string;
  date?: string;
  verified_purchase: boolean;
};

type Output = {
  mode: Mode;
  source_url: string;
  source_type: "public_index" | "public_product_page";
  region: string;
  query?: string;
  page?: number;
  count: number;
  total?: number;
  has_more?: boolean;
  next_page?: number;
  sort_by?: string;
  shop?: { name: string; url: string; seller_id?: string };
  products?: ProductSummary[];
  product?: ProductSummary;
  reviews?: ProductReview[];
  rating_distribution?: Record<string, number>;
};

function decodeEntities(value: string): string {
  return value
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
  const cleaned = value ? decodeEntities(value).replace(/\s+/g, " ").trim() : "";
  return cleaned || undefined;
}

function stripHtml(html: string): string {
  return decodeEntities(html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function safeDecode(value: string): string {
  let decoded = decodeEntities(value);
  for (let i = 0; i < 2; i++) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
}

function normalizeProductUrl(raw: string): { id: string; url: string } | undefined {
  let value = safeDecode(raw.trim());
  const redirect = value.match(/[?&](?:q|url)=(https?[^&]+)/i);
  if (redirect) value = safeDecode(redirect[1]);
  if (value.startsWith("//")) value = `https:${value}`;
  if (/^(?:www\.)?tiktok\.com\//i.test(value)) value = `https://${value}`;
  const match = value.match(/^https?:\/\/(?:www\.)?tiktok\.com\/shop\/pdp\/(?:[^/?#]+\/)?(\d{15,24})/i);
  if (!match) return undefined;
  const path = value.split(/[?#]/, 1)[0].replace(/^http:\/\//i, "https://");
  return { id: match[1], url: path };
}

function productTarget(input: Input): { id: string; url: string } {
  const fromUrl = input.url?.trim() ? normalizeProductUrl(input.url) : undefined;
  if (fromUrl) return fromUrl;
  const id = input.product_id?.trim();
  if (!id || !/^\d{15,24}$/.test(id)) {
    throw new Error("url or product_id must identify a public TikTok Shop product");
  }
  return { id, url: `https://www.tiktok.com/shop/pdp/${id}` };
}

function parseAbbreviatedNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = value.replace(/,/g, "").trim().match(/^(\d+(?:\.\d+)?)([KMB])?\+?$/i);
  if (!match) return undefined;
  const multiplier = match[2]?.toUpperCase() === "K" ? 1_000
    : match[2]?.toUpperCase() === "M" ? 1_000_000
      : match[2]?.toUpperCase() === "B" ? 1_000_000_000
        : 1;
  return Math.round(Number(match[1]) * multiplier);
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== "")) as T;
}

function indexedProducts(html: string, limit: number): ProductSummary[] {
  const products: ProductSummary[] = [];
  const seen = new Set<string>();
  const addProduct = (rawUrl: string, rawTitle?: string, rawDescription?: string): void => {
    if (products.length >= limit) return;
    const target = normalizeProductUrl(rawUrl);
    if (!target || seen.has(target.id)) return;
    seen.add(target.id);
    const slug = target.url.match(/\/shop\/pdp\/([^/]+)\/\d+$/i)?.[1];
    const fallbackTitle = slug ? slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : `TikTok Shop product ${target.id}`;
    products.push(compact({
      product_id: target.id,
      title: cleanText(rawTitle?.replace(/<[^>]+>/g, " "))?.replace(/\s*[-|]\s*TikTok Shop.*$/i, "").trim() || fallbackTitle,
      url: target.url,
      description: cleanText(rawDescription?.replace(/<[^>]+>/g, " ")),
    }));
  };
  const links = /<a[^>]+href=["']([^"']+)["'][^>]*>(?:(?!<\/a>).)*?<h3[^>]*>((?:(?!<\/h3>).)*)<\/h3>/gis;
  let match: RegExpExecArray | null;
  while ((match = links.exec(html)) && products.length < limit) {
    const tail = html.slice(match.index + match[0].length, match.index + match[0].length + 3500);
    const snippetMatch = tail.match(/<(?:div|span)[^>]*(?:data-sncf|class=["'][^"']*(?:VwiC3b|IsZvec)[^"']*["'])[^>]*>((?:(?!<\/(?:div|span)>).)*)/is);
    addProduct(match[1], match[2], snippetMatch?.[1]);
  }

  // Search result DOM changes frequently. Recover source-linked PDP URLs even
  // when the heading is no longer nested in the result anchor (or uses h2).
  const rawUrls = /https?:\/\/(?:www\.)?tiktok\.com\/shop\/pdp\/(?:[^"'<>&\s/]+\/)?\d{15,24}[^"'<>&\s]*/gi;
  while ((match = rawUrls.exec(html)) && products.length < limit) {
    const context = html.slice(match.index, match.index + 4500);
    const title = context.match(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/i)?.[1];
    const description = context.match(/<(?:div|p|span)[^>]*(?:data-sncf|class=["'][^"']*(?:VwiC3b|IsZvec|b_caption)[^"']*["'])[^>]*>([\s\S]*?)<\/(?:div|p|span)>/i)?.[1];
    addProduct(match[0], title, description);
  }
  return products;
}

async function searchIndex(
  query: string,
  limit: number,
  bf: Parameters<Parameters<typeof defineTool>[0]>[1],
): Promise<{ sourceUrl: string; products: ProductSummary[] }> {
  const sources = [
    `https://www.google.com/search?q=${encodeURIComponent(`site:tiktok.com/shop/pdp ${query}`)}&num=${Math.min(limit + 5, 30)}&hl=en`,
    `https://www.google.com/search?q=${encodeURIComponent(`site:www.tiktok.com/shop/pdp "${query}"`)}&num=${Math.min(limit + 5, 30)}&hl=en&filter=0`,
    `https://www.bing.com/search?q=${encodeURIComponent(`site:tiktok.com/shop/pdp ${query}`)}&count=${Math.min(limit + 5, 30)}&setlang=en-us`,
  ];
  let sourceUrl = "";
  for (const candidateUrl of sources) {
    sourceUrl = candidateUrl;
    try {
      const response = await bf.fetch({
        url: sourceUrl,
        strategy: "browser",
        include_html: true,
        wait_until: "domcontentloaded",
        wait_ms: 1500,
      });
      const products = indexedProducts(response.html ?? response.body_text ?? "", limit);
      if (products.length) return { sourceUrl: response.final_url ?? sourceUrl, products };
    } catch {
      // The second exact query is an independent public-index retrieval path.
    }
  }
  return { sourceUrl, products: [] };
}

function routerCategories(html: string): string[] {
  const match = html.match(/<script[^>]+id=["']__MODERN_ROUTER_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return [];
  try {
    const data = JSON.parse(match[1]) as { loaderData?: Record<string, unknown> };
    const loaders = Object.entries(data.loaderData ?? {}).filter(([name, value]) => name !== "layout" && value && typeof value === "object");
    for (const [, rawLoader] of loaders) {
      const loader = rawLoader as Record<string, unknown>;
      const pageConfig = loader.page_config as Record<string, unknown> | undefined;
      const globalData = pageConfig?.global_data as Record<string, unknown> | undefined;
      const wrapper = globalData?.product_info as Record<string, unknown> | undefined;
      const categories = wrapper?.categories;
      if (!Array.isArray(categories)) continue;
      return categories.map((item) => cleanText((item as Record<string, unknown>)?.category_name as string)).filter((item): item is string => Boolean(item));
    }
  } catch { /* fall through */ }
  return [];
}

function imageUrls(html: string): string[] {
  const urls: string[] = [];
  for (const match of html.matchAll(/<img\b[^>]*(?:src|data-src)=["']([^"']+)["'][^>]*>/gi)) {
    const url = safeDecode(match[1]);
    if (!/^https?:\/\//i.test(url) || !/tiktokcdn|ttcdn/i.test(url) || urls.includes(url)) continue;
    urls.push(url);
    if (urls.length >= 12) break;
  }
  return urls;
}

function visibleReviews(text: string): { total?: number; reviews: ProductReview[] } {
  const blockMatch = text.match(/Displaying\s+([\d,]+)\s+of\s+([\d,]+)\s+reviews\s+Reset filters\s+([\s\S]*?)\s+Previous\s+1\b/i);
  if (!blockMatch) return { reviews: [] };
  const reviews: ProductReview[] = [];
  const block = blockMatch[3];
  const pattern = /(.{1,80}?)\s+·\s+Verified purchase\s+([A-Z]{2})\s+([\s\S]*?)\s+Item\s*:\s*([\s\S]*?)\s+(\d{4}-\d{2}-\d{2})(?=\s+.{1,80}?\s+·\s+Verified purchase|$)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(block)) && reviews.length < 20) {
    reviews.push({
      reviewer_name: cleanText(match[1]) ?? "Anonymous",
      country: match[2],
      text: cleanText(match[3]) ?? "",
      sku: cleanText(match[4]),
      date: match[5],
      verified_purchase: true,
    });
  }
  return { total: parseAbbreviatedNumber(blockMatch[2]), reviews: reviews.filter((review) => review.text) };
}

function parseProduct(html: string, target: { id: string; url: string }): { product: ProductSummary; reviews: ProductReview[]; totalReviews?: number; distribution?: Record<string, number> } {
  const text = stripHtml(html);
  const titleTag = cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1])?.replace(/\s*[-|]\s*TikTok Shop.*$/i, "").trim();
  const commerce = text.match(/Free shipping\s+(.{10,700}?)\s+Sold by\s+(.{2,120}?)\s+([0-5](?:\.\d)?)\s+\(\s*([\d,.KMB]+)\s*\)\s+([\d,.KMB]+)\s+sold/i);
  const prices = text.match(/(-\d+%)\s+\$\s*([\d,]+)\s*\.\s*(\d{2})\s+\$\s*([\d,.]+)/i)
    ?? text.match(/()\$\s*([\d,]+)\s*\.\s*(\d{2})()/i);
  const globalRating = text.match(/([0-5](?:\.\d)?)\s+([\d,.KMB]+)\s+global reviews/i);
  const description = cleanText(text.match(/Product description\s+([\s\S]*?)\s+View more\s+Safety & compliance/i)?.[1]);
  const visible = visibleReviews(text);
  const distributionMatch = text.match(/global reviews\s+5\s+([\d,]+)\s+4\s+([\d,]+)\s+3\s+([\d,]+)\s+2\s+([\d,]+)\s+1\s+([\d,]+)/i);
  const distribution = distributionMatch ? {
    "5": Number(distributionMatch[1].replace(/,/g, "")),
    "4": Number(distributionMatch[2].replace(/,/g, "")),
    "3": Number(distributionMatch[3].replace(/,/g, "")),
    "2": Number(distributionMatch[4].replace(/,/g, "")),
    "1": Number(distributionMatch[5].replace(/,/g, "")),
  } : undefined;
  const product = compact({
    product_id: target.id,
    title: cleanText(commerce?.[1]) ?? titleTag ?? `TikTok Shop product ${target.id}`,
    url: target.url,
    description,
    price: prices ? `${prices[2].replace(/,/g, "")}.${prices[3]}` : undefined,
    original_price: cleanText(prices?.[4])?.replace(/,/g, ""),
    currency: prices ? "USD" : undefined,
    discount: cleanText(prices?.[1]),
    rating: commerce ? Number(commerce[3]) : globalRating ? Number(globalRating[1]) : undefined,
    review_count: parseAbbreviatedNumber(commerce?.[4]) ?? parseAbbreviatedNumber(globalRating?.[2]) ?? visible.total,
    sold_count: parseAbbreviatedNumber(commerce?.[5]),
    seller_name: cleanText(commerce?.[2]),
    images_csv: imageUrls(html).join(", ") || undefined,
    categories_csv: routerCategories(html).join(", ") || undefined,
  });
  return { product, reviews: visible.reviews, totalReviews: visible.total, distribution };
}

async function fetchProductPage(
  target: { id: string; url: string },
  bf: Parameters<Parameters<typeof defineTool>[0]>[1],
): Promise<{ sourceUrl: string; html: string }> {
  const response = await bf.fetch({
    url: target.url,
    strategy: "browser",
    json_mode: false,
    wait_until: "domcontentloaded",
    wait_ms: 4_000,
    timeout_ms: 120_000,
    return_response_text: true,
    include_html: true,
    locale: "en-US",
  });
  if (response.blocked) throw new Error(`TikTok Shop blocked the public product page (${response.block_reason ?? "unknown"})`);
  const html = response.html ?? response.body_text ?? "";
  if (!html.includes(target.id) || /<title[^>]*>\s*Security Check\s*<\/title>/i.test(html)) {
    throw new Error("TikTok Shop returned no public product content");
  }
  return { sourceUrl: response.final_url ?? target.url, html };
}

export default defineTool(async (input: Input, bf): Promise<Output> => {
  const mode = input.mode ?? "search";
  const region = input.region?.trim().toUpperCase() || "US";
  if (region !== "US") throw new Error("TikTok Shop public-page support currently requires region US");
  const maxResults = Math.min(Math.max(input.max_results ?? 10, 1), 20);

  if (mode === "search") {
    const query = input.query?.trim();
    if (!query) throw new Error("query is required for search mode");
    const indexed = await searchIndex(query, maxResults, bf);
    if (!indexed.products.length) throw new Error("Public indexes returned no TikTok Shop products");
    return { mode, source_url: indexed.sourceUrl, source_type: "public_index", region, query, page: Math.max(1, input.page ?? 1), count: indexed.products.length, products: indexed.products };
  }

  if (mode === "products") {
    const rawUrl = input.url?.trim();
    const match = rawUrl?.match(/^(?:https?:\/\/)?(?:www\.)?tiktok\.com\/shop\/store\/([^/?#]+)\/(\d{15,24})/i);
    if (!match) throw new Error("url must be a public TikTok Shop store URL");
    const shopUrl = `https://www.tiktok.com/shop/store/${match[1]}/${match[2]}`;
    const shopName = match[1].replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const indexed = await searchIndex(shopName, maxResults, bf);
    const shopPattern = new RegExp(`(?:^|\\b)${shopName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\b|$)`, "i");
    const products = indexed.products.filter((product) =>
      shopPattern.test(product.title) || new RegExp(`sold by\\s+${shopName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(product.description ?? "")
    );
    if (!products.length) throw new Error("Public indexes returned no source-linked products for this TikTok Shop name");
    return { mode, source_url: indexed.sourceUrl, source_type: "public_index", region, count: products.length, sort_by: input.sort_by ?? "top", shop: { name: shopName, url: shopUrl, seller_id: match[2] }, products };
  }

  const target = productTarget(input);
  const page = await fetchProductPage(target, bf);
  const parsed = parseProduct(page.html, target);
  if (mode === "product") {
    return { mode, source_url: page.sourceUrl, source_type: "public_product_page", region, count: 1, product: parsed.product };
  }
  if (mode === "product_reviews") {
    if (!parsed.reviews.length) throw new Error("TikTok Shop returned no public visible product reviews");
    return {
      mode,
      source_url: page.sourceUrl,
      source_type: "public_product_page",
      region,
      page: Math.max(1, input.page ?? 1),
      count: parsed.reviews.length,
      total: parsed.totalReviews ?? parsed.product.review_count,
      has_more: (parsed.totalReviews ?? 0) > parsed.reviews.length,
      next_page: (parsed.totalReviews ?? 0) > parsed.reviews.length ? Math.max(1, input.page ?? 1) + 1 : undefined,
      product: parsed.product,
      reviews: parsed.reviews,
      rating_distribution: parsed.distribution,
    };
  }
  throw new Error(`Unsupported mode: ${String(mode)}`);
});
