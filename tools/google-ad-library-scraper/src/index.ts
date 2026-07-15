import { defineTool, type Bf } from "@better-fetch/tools";

type Mode = "advertiser_search" | "company_ads" | "ad";
type Input = {
  mode: Mode;
  query?: string;
  domain?: string;
  advertiser_id?: string;
  creative_id?: string;
  url?: string;
  region?: string;
  max_results?: number;
};

type Advertiser = {
  name: string;
  advertiser_id: string;
  region?: string;
  legal_name?: string;
  based_in?: string;
  number_of_ads_estimate?: number;
  url: string;
};

type Ad = {
  advertiser_id: string;
  creative_id: string;
  ad_url: string;
  advertiser_name?: string;
  format?: string;
  image_url?: string;
  last_shown?: string;
  shown_in?: string;
  funded_by?: string;
};

type Output = {
  mode: Mode;
  source_url: string;
  count: number;
  query?: string;
  region?: string;
  websites: Array<{ domain: string }>;
  advertisers: Advertiser[];
  ads: Ad[];
  ad?: Ad;
};

const BASE = "https://adstransparency.google.com";

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, number) => String.fromCodePoint(parseInt(number, 16)))
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)));
}

function stripTags(value: string): string {
  return decodeEntities(value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function cleanRegion(value: string | undefined): string {
  const region = (value ?? "US").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(region)) throw new Error("region must be a 2-letter country code");
  return region;
}

function cleanDomain(value: string): string {
  const candidate = value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?\.)+[a-z]{2,24}$/i.test(candidate)) {
    throw new Error("domain must be a public hostname like example.com");
  }
  return candidate;
}

function creativeTarget(value: string): { advertiser_id: string; creative_id: string; url: string } | undefined {
  const normalized = /^https?:\/\//i.test(value) ? value : `${BASE}${value.startsWith("/") ? "" : "/"}${value}`;
  const match = normalized.match(/^https?:\/\/adstransparency\.google\.com\/advertiser\/(AR\d+)\/creative\/(CR\d+)/i);
  if (!match) return undefined;
  return {
    advertiser_id: match[1].toUpperCase(),
    creative_id: match[2].toUpperCase(),
    url: `${BASE}/advertiser/${match[1].toUpperCase()}/creative/${match[2].toUpperCase()}`,
  };
}

function adLinks(html: string, limit: number): Ad[] {
  const ads: Ad[] = [];
  const seen = new Set<string>();
  const links = /href=["']([^"']*\/advertiser\/(AR\d+)\/creative\/(CR\d+)[^"']*)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = links.exec(html)) && ads.length < limit) {
    const advertiserId = match[2].toUpperCase();
    const creativeId = match[3].toUpperCase();
    if (seen.has(creativeId)) continue;
    seen.add(creativeId);
    const nearby = html.slice(match.index, match.index + 8000);
    const image = decodeEntities(nearby.match(/https:\/\/tpc\.googlesyndication\.com\/archive\/simgad\/\d+/i)?.[0] ?? "") || undefined;
    ads.push({
      advertiser_id: advertiserId,
      creative_id: creativeId,
      ad_url: `${BASE}/advertiser/${advertiserId}/creative/${creativeId}`,
      format: image ? "image" : nearby.includes("displayads-formats.googleusercontent.com") ? "dynamic" : undefined,
      image_url: image,
    });
  }
  return ads;
}

function numberFromLabel(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = value.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*([KMB])?/i);
  if (!match) return undefined;
  const multiplier = match[2]?.toUpperCase() === "K" ? 1_000 : match[2]?.toUpperCase() === "M" ? 1_000_000 : match[2]?.toUpperCase() === "B" ? 1_000_000_000 : 1;
  return Math.round(Number(match[1]) * multiplier);
}

function cleanUiLabel(value: string | undefined): string | undefined {
  const clean = value
    ?.replace(/\b(?:close|info|flag|how_to_reg|arrow_drop_down|keyboard_arrow_right|calendar_today|hide_image)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean || undefined;
}

function advertiserFromPage(html: string, advertiserId: string, region: string): Advertiser {
  const text = stripTags(html);
  const legalName = text.match(/Legal name:\s*(.+?)\s+Based in:/i)?.[1]?.trim();
  const basedIn = cleanUiLabel(text.match(/Based in:\s*(.+?)(?:\s+Advertiser has verified|\s+Some advertisers|\s+~?\d[\d,.KMB]*\s+ads)/i)?.[1]);
  const headingName = text.match(/Advertiser Details\s+(.+?)\s+Legal name:/i)?.[1]?.trim();
  const adEstimate = numberFromLabel(text.match(/~?[\d,.]+(?:\.\d+)?[KMB]?\s+ads/i)?.[0]);
  const name = legalName ?? headingName;
  if (!name) throw new Error("Google returned an advertiser page without public identity details");
  return {
    name,
    advertiser_id: advertiserId,
    region,
    legal_name: legalName,
    based_in: basedIn,
    number_of_ads_estimate: adEstimate,
    url: `${BASE}/advertiser/${advertiserId}?region=${region}`,
  };
}

function adFromPage(html: string, target: { advertiser_id: string; creative_id: string; url: string }): Ad {
  const text = stripTags(html);
  const detailStart = text.lastIndexOf("Ad details");
  const detail = detailStart >= 0 ? text.slice(detailStart) : text;
  const advertiserName = cleanUiLabel(detail.match(/Ad details\s+(.+?)\s+The information about this ad/i)?.[1]);
  const shownIn = cleanUiLabel(detail.match(/Shown in\s+(.+?)\s+Last shown:/i)?.[1]);
  const lastShown = cleanUiLabel(detail.match(/Last shown:\s*(.+?)\s+Format:/i)?.[1]);
  const format = cleanUiLabel(detail.match(/Format:\s*(.+?)\s+Ad funded by:/i)?.[1])?.toLowerCase();
  const fundedBy = cleanUiLabel(detail.match(/Ad funded by:\s*(.+?)(?:\s+End payer information|\s+Report this ad)/i)?.[1]);
  const image = format === "image" ? decodeEntities(html.match(/https:\/\/tpc\.googlesyndication\.com\/archive\/simgad\/\d+/i)?.[0] ?? "") || undefined : undefined;
  if (!advertiserName && !lastShown && !fundedBy) throw new Error("Google returned no public details for this ad");
  return {
    advertiser_id: target.advertiser_id,
    creative_id: target.creative_id,
    ad_url: target.url,
    advertiser_name: advertiserName,
    shown_in: shownIn,
    last_shown: lastShown,
    format,
    funded_by: fundedBy,
    image_url: image,
  };
}

function resultDomains(html: string, limit: number): string[] {
  const domains: string[] = [];
  const seen = new Set<string>();
  const links = /href=["'](https?:\/\/[^"']+)["']/gi;
  const excluded = /(?:google\.|gstatic\.|youtube\.com|facebook\.com|instagram\.com|linkedin\.com|wikipedia\.org|x\.com$|twitter\.com|tiktok\.com)/i;
  let match: RegExpExecArray | null;
  while ((match = links.exec(html)) && domains.length < limit) {
    let url = decodeEntities(match[1]);
    const redirect = url.match(/[?&](?:q|url)=(https?[^&]+)/);
    if (redirect) {
      try { url = decodeURIComponent(redirect[1]); } catch { url = redirect[1]; }
    }
    try {
      const domain = cleanDomain(new URL(url).hostname);
      if (excluded.test(domain) || seen.has(domain)) continue;
      seen.add(domain);
      domains.push(domain);
    } catch { /* ignore malformed or non-public result links */ }
  }
  return domains;
}

async function browserPage(bf: Bf, url: string, waitMs = 4500) {
  const response = await bf.fetch({
    url,
    strategy: "browser",
    include_html: true,
    json_mode: false,
    wait_until: "networkidle",
    wait_ms: waitMs,
    timeout_ms: 90_000,
    proxy: "auto",
  });
  const html = response.html ?? response.body_text ?? "";
  if (!html) throw new Error("Public page returned no HTML");
  return { html, sourceUrl: response.final_url ?? url };
}

export default defineTool<Input, Output>(async (input, bf) => {
  const region = cleanRegion(input.region);
  const limit = Math.min(Math.max(input.max_results ?? 10, 1), 40);

  if (input.mode === "ad") {
    const target = input.url ? creativeTarget(input.url) : input.advertiser_id?.match(/^AR\d+$/i) && input.creative_id?.match(/^CR\d+$/i)
      ? creativeTarget(`/advertiser/${input.advertiser_id}/creative/${input.creative_id}`)
      : undefined;
    if (!target) throw new Error("url or advertiser_id plus creative_id is required for ad mode");
    const url = `${target.url}?region=${region}`;
    const page = await browserPage(bf, url);
    const ad = adFromPage(page.html, target);
    return { mode: input.mode, source_url: page.sourceUrl, count: 1, region, websites: [], advertisers: [], ads: [ad], ad };
  }

  if (input.mode === "company_ads") {
    let url: string;
    if (input.advertiser_id?.match(/^AR\d+$/i)) {
      url = `${BASE}/advertiser/${input.advertiser_id.toUpperCase()}?region=${region}`;
    } else if (input.domain) {
      url = `${BASE}/?region=${region}&domain=${encodeURIComponent(cleanDomain(input.domain))}`;
    } else {
      throw new Error("domain or advertiser_id is required for company_ads mode");
    }
    const page = await browserPage(bf, url);
    const ads = adLinks(page.html, limit);
    if (!ads.length) throw new Error("Google returned no public ads for this company");
    return { mode: input.mode, source_url: page.sourceUrl, count: ads.length, region, websites: input.domain ? [{ domain: cleanDomain(input.domain) }] : [], advertisers: [], ads };
  }

  const query = input.query?.trim();
  if (!query) throw new Error("query is required for advertiser_search mode");
  const directDomain = /\./.test(query) ? cleanDomain(query) : undefined;
  let domains = directDomain ? [directDomain] : [];
  let searchUrl = `${BASE}/?region=${region}&domain=${encodeURIComponent(directDomain ?? query)}`;
  if (!directDomain) {
    searchUrl = `https://www.google.com/search?q=${encodeURIComponent(`${query} official website`)}&num=10&hl=en`;
    const search = await browserPage(bf, searchUrl, 1500);
    domains = resultDomains(search.html, 3);
  }
  if (!domains.length) throw new Error("Could not resolve a public website for this advertiser query");

  const domainUrl = `${BASE}/?region=${region}&domain=${encodeURIComponent(domains[0])}`;
  const domainPage = await browserPage(bf, domainUrl);
  const seedAds = adLinks(domainPage.html, limit);
  const advertiserIds = [...new Set(seedAds.map((ad) => ad.advertiser_id))].slice(0, limit);
  if (!advertiserIds.length) throw new Error("Google returned no advertisers for the resolved website");

  const detailUrl = `${BASE}/advertiser/${advertiserIds[0]}?region=${region}`;
  const advertiserPage = await browserPage(bf, detailUrl);
  const first = advertiserFromPage(advertiserPage.html, advertiserIds[0], region);
  const advertisers: Advertiser[] = [first, ...advertiserIds.slice(1).map((id) => ({ name: query, advertiser_id: id, region, url: `${BASE}/advertiser/${id}?region=${region}` }))];
  return { mode: input.mode, source_url: advertiserPage.sourceUrl, count: advertisers.length, query, region, websites: domains.map((domain) => ({ domain })), advertisers, ads: [] };
});
