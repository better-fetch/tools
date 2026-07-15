import { defineTool } from "@better-fetch/tools";

type Input = { url: string; max_collections?: number; max_trending?: number };
type Social = { platform: string; url: string };
type Collection = { id: string; title: string; url: string; item_count?: number; image?: string };
type Product = { asin: string; url: string; image?: string; price?: number; currency?: string; badge?: string };
type Output = {
  source_url: string; handle: string; name: string; description?: string; avatar?: string;
  socials: Social[]; collections: Collection[]; trending_products: Product[]; count: number;
};

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== "")) as T;
}

function decode(value: string): string {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function strip(value: string): string {
  return decode(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function meta(html: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const pattern of [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`, "i"),
  ]) {
    const value = html.match(pattern)?.[1];
    if (value) return decode(value);
  }
  return undefined;
}

function target(raw: string): { url: string; handle: string } {
  let value = raw.trim();
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  const url = new URL(value);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!/^amazon\.[a-z.]+$/.test(host)) throw new Error("url must be a public Amazon creator shop URL");
  const match = url.pathname.match(/^\/shop\/([^/?#]+)/i);
  if (!match) throw new Error("url must use Amazon's /shop/{handle} creator storefront format");
  return { url: `https://www.${host}/shop/${match[1]}`, handle: decodeURIComponent(match[1]) };
}

function uniqueBy<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => { const id = key(value); if (!id || seen.has(id)) return false; seen.add(id); return true; });
}

function socials(html: string): Social[] {
  const values: Social[] = [];
  for (const match of html.matchAll(/<a[^>]+class=["'][^"']*social-media-link[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>[\s\S]*?<img[^>]+alt=["']([^"']+)/gi)) {
    values.push({ platform: strip(match[2]).toLowerCase(), url: decode(match[1]) });
  }
  return uniqueBy(values, (item) => item.url);
}

function collections(html: string, base: string, limit: number): Collection[] {
  const values: Collection[] = [];
  for (const match of html.matchAll(/<a[^>]+href=["']([^"']*\/shop\/[^"']+\/list\/([A-Z0-9]+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const text = strip(match[3]);
    if (!text || /^see all$/i.test(text)) continue;
    const countMatch = text.match(/(\d[\d,]*)\s+Items?\s*$/i);
    const title = text.replace(/\s*\d[\d,]*\s+Items?\s*$/i, "").trim();
    const image = match[3].match(/<img[^>]+src=["']([^"']+)/i)?.[1];
    values.push(compact({ id: match[2], title, url: new URL(decode(match[1]), base).toString(),
      item_count: countMatch ? Number(countMatch[1].replace(/,/g, "")) : undefined, image: image ? decode(image) : undefined }));
  }
  return uniqueBy(values, (item) => item.id).slice(0, limit);
}

function trending(html: string, base: string, limit: number): Product[] {
  const container = html.match(/<div[^>]+class=["'][^"']*trending-asin-widget[^"']*["'][^>]*>([\s\S]*?)(?=<div[^>]+class=["'][^"']*(?:shopItem|curation|feed)[^"']*["']|<\/body>)/i)?.[1] ?? html;
  const starts = [...container.matchAll(/<li[^>]+data-asin=["'](?:amzn1\.asin\.)?([A-Z0-9]{10})["'][^>]*>/gi)];
  const values: Product[] = [];
  for (let index = 0; index < Math.min(starts.length, limit); index++) {
    const start = starts[index].index ?? 0;
    const end = starts[index + 1]?.index ?? Math.min(start + 20_000, container.length);
    const segment = container.slice(start, end);
    const asin = starts[index][1];
    const image = segment.match(/<img[^>]+class=["'][^"']*trending-asin-carousel-image[^"']*["'][^>]+src=["']([^"']+)/i)?.[1]
      ?? segment.match(/<img[^>]+src=["']([^"']+)["'][^>]+class=["'][^"']*trending-asin-carousel-image/i)?.[1];
    const priceText = strip(segment.match(/<span[^>]+class=["'][^"']*a-offscreen[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? "");
    const numeric = priceText.match(/([\d,.]+)/)?.[1];
    const badge = strip(segment.match(/class=["'][^"']*product-badge-label[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? "");
    values.push(compact({
      asin, url: new URL(`/shop/_/getProductDetails/${asin}`, base).toString(), image: image ? decode(image) : undefined,
      price: numeric ? Number(numeric.replace(/,/g, "")) : undefined,
      currency: priceText.startsWith("$") ? "USD" : priceText.startsWith("£") ? "GBP" : priceText.startsWith("€") ? "EUR" : undefined,
      badge: badge || undefined,
    }));
  }
  return uniqueBy(values, (item) => item.asin).slice(0, limit);
}

export default defineTool<Input, Output>(async (input, bf) => {
  const shop = target(input.url);
  const collectionLimit = Math.min(Math.max(input.max_collections ?? 20, 1), 50);
  const trendingLimit = Math.min(Math.max(input.max_trending ?? 16, 1), 30);
  const response = await bf.fetch({
    url: shop.url, strategy: "browser", json_mode: false, wait_until: "domcontentloaded", wait_ms: 5000,
    timeout_ms: 60000, include_html: true, locale: "en-US",
  });
  if (response.blocked) throw new Error(`Amazon blocked the storefront request (${response.block_reason ?? "unknown"})`);
  const html = response.html ?? response.body_text ?? "";
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const name = strip(title ?? "").replace(/['’]s Amazon Page\s*$/i, "").trim();
  if (!name || !/shop-influencer-profile|influencer storefront|storefront-common/i.test(html)) throw new Error("Amazon returned no public creator storefront");
  const description = strip(html.match(/id=["']shop-influencer-profile-description-text["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "");
  const socialValues = socials(html);
  const collectionValues = collections(html, response.final_url ?? shop.url, collectionLimit);
  const productValues = trending(html, response.final_url ?? shop.url, trendingLimit);
  return compact({
    source_url: response.final_url ?? shop.url, handle: shop.handle, name, description: description || undefined,
    avatar: meta(html, "og:image") ?? meta(html, "twitter:image:src"), socials: socialValues,
    collections: collectionValues, trending_products: productValues,
    count: 1 + socialValues.length + collectionValues.length + productValues.length,
  });
});
