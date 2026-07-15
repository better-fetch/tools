import { defineTool, type Bf } from "@better-fetch/tools";

type Mode = "search" | "ad";
type Input = {
  mode: Mode;
  company?: string;
  keyword?: string;
  companyId?: string;
  countries?: string;
  startDate?: string;
  endDate?: string;
  paginationToken?: string;
  id?: string;
  url?: string;
  max_results?: number;
};

type Ad = {
  id: string;
  url: string;
  advertiser?: string;
  format?: string;
  description?: string;
  headline?: string;
  image_url?: string;
  logo_url?: string;
  paid_for_by?: string;
  ran_from?: string;
  ran_to?: string;
  total_impressions?: string;
  targeting?: string;
  has_multiple_variants?: boolean;
};

type Output = { mode: Mode; source_url: string; count: number; total_matches?: number; ads: Ad[]; ad?: Ad; pagination_token?: string };

const BASE = "https://www.linkedin.com/ad-library";

function decodeEntities(value: string): string {
  return value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function stripTags(value: string): string {
  return decodeEntities(value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ").trim();
}

function textFrom(html: string, pattern: RegExp): string | undefined {
  const value = pattern.exec(html)?.[1];
  return value ? stripTags(value) || undefined : undefined;
}

function adTarget(input: Input): { id: string; url: string } | undefined {
  const raw = input.url?.trim();
  if (raw) {
    const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const match = normalized.match(/^https?:\/\/(?:www\.)?linkedin\.com\/ad-library\/detail\/(\d+)/i);
    if (match) return { id: match[1], url: `${BASE}/detail/${match[1]}` };
  }
  const id = input.id?.trim();
  return id && /^\d{6,20}$/.test(id) ? { id, url: `${BASE}/detail/${id}` } : undefined;
}

async function browserPage(bf: Bf, url: string) {
  const response = await bf.fetch({ url, strategy: "browser", include_html: true, json_mode: false, wait_until: "networkidle", wait_ms: 2500, timeout_ms: 90_000, proxy: "auto" });
  const html = response.html ?? response.body_text ?? "";
  if (!html) throw new Error("LinkedIn Ad Library returned no public HTML");
  return { html, sourceUrl: response.final_url ?? url };
}

function searchAds(html: string, limit: number): Ad[] {
  const segments = html.split(/<li\b[^>]*class=["'][^"']*search-result-item[^"']*["'][^>]*>/i).slice(1);
  const ads: Ad[] = [];
  const seen = new Set<string>();
  for (const segment of segments) {
    if (ads.length >= limit) break;
    const id = segment.match(/href=["']\/ad-library\/detail\/(\d+)/i)?.[1];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const label = decodeEntities(segment.match(/aria-label=["']([^"']+),\s*View details["']/i)?.[1] ?? "");
    const parts = label.split(",").map((part) => part.trim()).filter(Boolean);
    const advertiser = parts[0] || undefined;
    const format = parts.slice(1).join(", ") || undefined;
    const description = textFrom(segment, /class=["'][^"']*commentary__content[^"']*["'][^>]*>([\s\S]*?)<\/p>/i);
    const headline = textFrom(segment, /class=["'][^"']*sponsored-content-headline[^"']*["'][\s\S]*?<h2[^>]*>([\s\S]*?)<\/h2>/i);
    const logo = decodeEntities(segment.match(/<img[^>]+alt=["']advertiser logo["'][^>]+src=["']([^"']+)/i)?.[1] ?? "") || undefined;
    const images = [...segment.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi)].map((match) => decodeEntities(match[1]));
    const image = images.find((value) => value !== logo && /media\.licdn\.com/i.test(value));
    ads.push({ id, url: `${BASE}/detail/${id}`, advertiser, format, description, headline, image_url: image, logo_url: logo });
  }
  return ads;
}

function detailAd(html: string, target: { id: string; url: string }): Ad {
  const text = stripTags(html);
  const advertiser = text.match(/Promoted\s+(.+?)\s+(?:…see more\s+)?(?:Please note|About the ad)/i)?.[1]?.trim();
  const format = text.match(/About the ad\s+(.+?)\s+Advertiser/i)?.[1]?.trim();
  const advertiserAbout = text.match(/About the ad\s+.+?\s+Advertiser\s+(.+?)\s+Paid for by/i)?.[1]?.trim();
  const paidForBy = text.match(/Paid for by\s+(.+?)\s+Ran from/i)?.[1]?.trim();
  const dates = text.match(/Ran from\s+(.+?)\s+to\s+(.+?)\s+Ad Impressions/i);
  const impressionMatches = [...text.matchAll(/Total Impressions\s+([\d,.]+[KMB]?(?:\s*-\s*[\d,.]+[KMB]?))/gi)];
  const impressions = impressionMatches.at(-1)?.[1]?.replace(/\s+/g, "").trim();
  const description = textFrom(html, /class=["'][^"']*commentary__content[^"']*["'][^>]*>([\s\S]*?)<\/p>/i);
  const imageHeadline = decodeEntities(html.match(/<img[^>]+class=["'][^"']*ad-preview__dynamic-dimensions-image[^"']*["'][^>]+alt=["']([^"']+)/i)?.[1] ?? "") || undefined;
  const headline = textFrom(html, /class=["'][^"']*sponsored-content-headline[^"']*["'][\s\S]*?<h2[^>]*>([\s\S]*?)<\/h2>/i) ?? imageHeadline;
  const logo = decodeEntities(html.match(/<img[^>]+alt=["']advertiser logo["'][^>]+src=["']([^"']+)/i)?.[1] ?? "") || undefined;
  const images = [...html.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi)].map((match) => decodeEntities(match[1]));
  const image = images.find((value) => value !== logo && /media\.licdn\.com/i.test(value));
  const targeting = [...text.matchAll(/Targeting (?:includes|excludes)\s+(.+?)(?=\s+(?:Language|Location|Audience|Demographic|Company|Education|Job|Member Interests|Targeting parameter|LinkedIn Corporation)|$)/gi)]
    .map((match) => match[0].trim()).slice(0, 20);
  const resolvedAdvertiser = advertiserAbout ?? advertiser;
  if (!resolvedAdvertiser && !description && !format) throw new Error("LinkedIn returned no public details for this ad");
  return {
    id: target.id, url: target.url, advertiser: resolvedAdvertiser, format, description, headline, image_url: image, logo_url: logo,
    paid_for_by: paidForBy, ran_from: dates?.[1]?.trim(), ran_to: dates?.[2]?.trim(), total_impressions: impressions,
    targeting: targeting.length ? targeting.join("; ") : undefined, has_multiple_variants: /This ad has multiple variants/i.test(text),
  };
}

function dateValue(value: string | undefined, name: string): string | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${name} must use YYYY-MM-DD`);
  return value;
}

export default defineTool<Input, Output>(async (input, bf) => {
  if (input.mode === "ad") {
    const target = adTarget(input);
    if (!target) throw new Error("id or a public LinkedIn Ad Library detail URL is required for ad mode");
    const page = await browserPage(bf, target.url);
    const ad = detailAd(page.html, target);
    return { mode: input.mode, source_url: page.sourceUrl, count: 1, ads: [ad], ad };
  }

  const company = input.company?.trim();
  const keyword = input.keyword?.trim();
  const companyId = input.companyId?.trim();
  if (!company && !keyword && !companyId) throw new Error("company, keyword, or companyId is required for search mode");
  const params = new URLSearchParams();
  if (company) params.set("accountOwner", company);
  if (keyword) params.set("keyword", keyword);
  if (companyId) params.set("companyId", companyId);
  if (input.countries?.trim()) params.set("countries", input.countries.trim().toUpperCase());
  const startDate = dateValue(input.startDate, "startDate");
  const endDate = dateValue(input.endDate, "endDate");
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);
  if (input.paginationToken?.trim()) params.set("paginationToken", input.paginationToken.trim());
  const url = `${BASE}/search?${params.toString()}`;
  const page = await browserPage(bf, url);
  const limit = Math.min(Math.max(input.max_results ?? 10, 1), 24);
  const ads = searchAds(page.html, limit);
  if (!ads.length) throw new Error("LinkedIn returned no public ads for this search");
  const totalMatches = Number(stripTags(page.html).match(/([\d,]+)\s+ads match your search criteria/i)?.[1]?.replace(/,/g, ""));
  return { mode: input.mode, source_url: page.sourceUrl, count: ads.length, total_matches: Number.isFinite(totalMatches) ? totalMatches : undefined, ads };
});
