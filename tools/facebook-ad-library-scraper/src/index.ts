import { defineTool, type Bf } from "@better-fetch/tools";

type Mode = "search_ads" | "company_ads" | "search_companies" | "ad" | "ad_transcript";
type Input = {
  mode: Mode;
  query?: string;
  page_id?: string;
  id?: string;
  url?: string;
  country?: string;
  status?: "ALL" | "ACTIVE" | "INACTIVE";
  media_type?: "ALL" | "IMAGE" | "VIDEO" | "MEME" | "IMAGE_AND_MEME" | "NONE";
  search_type?: "keyword_unordered" | "keyword_exact_phrase";
  max_results?: number;
  max_body_chars?: number;
  language?: string;
};

type Transcript = {
  text: string;
  language?: string;
  language_probability?: number;
  duration_seconds?: number;
  segments?: Array<{ start: number; end: number; text: string }>;
};
type TranscriptSummary = Omit<Transcript, "segments">;

type TranscriptionBf = Bf & {
  transcribe(payload: { url: string; language?: string }): Promise<Transcript>;
};

type Ad = {
  ad_archive_id: string;
  url: string;
  is_active?: boolean;
  started_running?: string;
  page_id?: string;
  page_handle?: string;
  page_name?: string;
  page_url?: string;
  body?: string;
  body_truncated?: boolean;
  destination_url?: string;
  creative_image_url?: string;
  creative_video_url?: string;
  page_image_url?: string;
};

type Company = { page_id?: string; page_handle?: string; page_name: string; page_url: string; image_uri?: string };
type Output = { mode: Mode; source_url: string; count: number; total_matches?: number; ads: Ad[]; companies: Company[]; ad?: Ad; transcript?: TranscriptSummary; transcript_segments?: NonNullable<Transcript["segments"]> };

const BASE = "https://www.facebook.com/ads/library/";

function decodeEntities(value: string): string {
  return value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function stripTags(value: string): string {
  return decodeEntities(value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ").replace(/\n\s+/g, "\n").trim();
}

function countryCode(value: string | undefined): string {
  const country = (value ?? "ALL").trim().toUpperCase();
  if (country !== "ALL" && !/^[A-Z]{2}$/.test(country)) throw new Error("country must be ALL or a 2-letter country code");
  return country;
}

function adTarget(input: Input): string | undefined {
  const raw = input.url?.trim();
  if (raw) {
    const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const id = normalized.match(/[?&]id=(\d{8,30})/i)?.[1];
    if (id) return id;
  }
  return input.id?.trim().match(/^\d{8,30}$/)?.[0];
}

function adDetailUrl(input: Input, id: string): string {
  if (input.query?.trim()) return searchUrl(input, "search_ads");
  const raw = input.url?.trim();
  if (!raw) return `${BASE}?id=${id}`;
  const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const parsed = new URL(normalized);
  if (!/(^|\.)facebook\.com$/i.test(parsed.hostname) || !/^\/ads\/library\/?$/i.test(parsed.pathname)) {
    throw new Error("url must be a public facebook.com/ads/library URL");
  }
  if (parsed.searchParams.get("id") !== id) throw new Error("Meta Ad Library URL id does not match the requested ad");
  return parsed.toString();
}

function externalDestination(raw: string): string | undefined {
  const decoded = decodeEntities(raw);
  try {
    const url = new URL(decoded);
    if (/^(?:l|lm)\.facebook\.com$/i.test(url.hostname) && url.pathname === "/l.php") {
      const target = url.searchParams.get("u");
      return target && /^https?:\/\//i.test(target) ? target : undefined;
    }
    return /(?:^|\.)facebook\.com$|(?:^|\.)fbcdn\.net$|(?:^|\.)fbsbx\.com$/i.test(url.hostname) ? undefined : url.toString();
  } catch {
    return undefined;
  }
}

function publicVideoUrl(html: string): string | undefined {
  const candidates = [
    ...[...html.matchAll(/<(?:video|source)\b[^>]*\bsrc=["']([^"']+)["']/gi)].map((match) => match[1]),
    ...[...html.matchAll(/(?:playable_url(?:_quality_hd)?|video_url)\\?"\s*:\s*\\?"(https?:\\?\/\\?\/[^"<]+?)(?=\\?")/gi)].map((match) => match[1]),
  ].map((value) => decodeEntities(value)
    .replace(/\\\//g, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003d/gi, "=")
    .replace(/\\u0025/gi, "%"));
  return candidates.find((value) => /^https:\/\/[^\s]+/i.test(value) && /(?:fbcdn\.net|fbsbx\.com)/i.test(value));
}

function publicVideoUrlNearAd(html: string, id: string): string | undefined {
  const markers = [
    `"ad_archive_id":"${id}"`,
    `\\"ad_archive_id\\":\\"${id}\\"`,
  ];
  for (const marker of markers) {
    let offset = 0;
    while (offset < html.length) {
      const index = html.indexOf(marker, offset);
      if (index < 0) break;
      const start = Math.max(0, index - 400_000);
      const end = Math.min(html.length, index + 100_000);
      const video = publicVideoUrl(html.slice(start, end));
      if (video) return video;
      offset = index + marker.length;
    }
  }
  return undefined;
}

function hasStructuredAd(html: string, id: string): boolean {
  return html.includes(`"ad_archive_id":"${id}"`)
    || html.includes(`\\"ad_archive_id\\":\\"${id}\\"`);
}

async function browserPage(bf: Bf, url: string, proxy: "auto" | "residential" = "auto") {
  const response = await bf.fetch({ url, strategy: "browser", include_html: true, json_mode: false, wait_until: "domcontentloaded", wait_ms: 5000, timeout_ms: 90_000, proxy });
  const html = response.html ?? response.body_text ?? "";
  if (!html) throw new Error("Meta Ad Library returned no public HTML");
  return { html, sourceUrl: response.final_url ?? url };
}

function cardAds(html: string, limit: number, maxBodyChars: number): Ad[] {
  const segments = html.split(/Library ID:\s*/i).slice(1);
  const ads: Ad[] = [];
  const seen = new Set<string>();
  for (const segment of segments) {
    if (ads.length >= limit) break;
    const text = stripTags(segment);
    const id = text.match(/^(\d{8,30})\b/)?.[1];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const current = segment.slice(0, 1_000_000);
    const profileLinks = [...current.matchAll(/<a\b[^>]*href=["'](https:\/\/www\.facebook\.com\/([^"'/?#]+)\/?(?:[?#][^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/gi)]
      .map((match) => ({ url: decodeEntities(match[1]), handle: match[2], name: stripTags(match[3]) }))
      .filter((profile) => profile.name && !/^(?:ads|adlibrary|privacy|business|help|watch|reel|marketplace)$/i.test(profile.handle));
    const profile = profileLinks.find((candidate) => /^\d+$/.test(candidate.handle)) ?? profileLinks[0];
    const pageId = profile && /^\d+$/.test(profile.handle) ? profile.handle : undefined;
    const pageHandle = profile && !pageId ? profile.handle : undefined;
    const pageName = profile?.name;
    const body = current.match(/style=["']white-space:\s*pre-wrap;?["'][^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i)?.[1];
    const allLinks = [...current.matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)].map((match) => match[1]);
    const destination = allLinks.map(externalDestination).find(Boolean);
    const images = [...current.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi)].map((match) => decodeEntities(match[1]));
    const pageImage = images[0];
    const creativeImage = images.find((value, index) => index > 0 && /(?:fbcdn\.net|fbsbx\.com)/i.test(value));
    const creativeVideo = publicVideoUrl(current);
    const started = text.match(/Started running on\s+(.+?)(?:\s+Platforms|\s+EU transparency|\s+Open Drop-down)/i)?.[1]?.trim();
    const status = text.match(/\b(Active|Inactive)\b/i)?.[1]?.toLowerCase();
    const bodyText = body ? stripTags(body) : undefined;
    ads.push({
      ad_archive_id: id,
      url: `${BASE}?id=${id}`,
      is_active: status ? status === "active" : undefined,
      started_running: started,
      page_id: pageId,
      page_handle: pageHandle,
      page_name: pageName,
      page_url: profile?.url,
      body: bodyText?.slice(0, maxBodyChars),
      body_truncated: bodyText ? bodyText.length > maxBodyChars : undefined,
      destination_url: destination,
      creative_image_url: creativeImage,
      creative_video_url: creativeVideo,
      page_image_url: pageImage,
    });
  }
  return ads;
}

function cardForId(html: string, id: string, maxBodyChars: number): Ad | undefined {
  const marker = new RegExp(`Library ID:\\s*${id}\\b`, "i");
  const match = marker.exec(html);
  if (!match || match.index === undefined) return undefined;
  const start = match.index + match[0].indexOf(id);
  const next = html.slice(start + id.length).search(/Library ID:\s*\d{8,30}/i);
  const end = next >= 0 ? start + id.length + next : html.length;
  return cardAds(`Library ID: ${html.slice(start, end)}`, 1, maxBodyChars)[0];
}

function companiesFromAds(ads: Ad[]): Company[] {
  const companies: Company[] = [];
  const seen = new Set<string>();
  for (const ad of ads) {
    if (!ad.page_url || !ad.page_name || seen.has(ad.page_url)) continue;
    seen.add(ad.page_url);
    companies.push({ page_id: ad.page_id, page_handle: ad.page_handle, page_name: ad.page_name, page_url: ad.page_url, image_uri: ad.page_image_url });
  }
  return companies;
}

function searchUrl(input: Input, mode: Mode): string {
  const params = new URLSearchParams();
  const status = input.status ?? "ACTIVE";
  params.set("active_status", status.toLowerCase());
  params.set("ad_type", "all");
  params.set("country", countryCode(input.country));
  params.set("media_type", (input.media_type ?? "ALL").toLowerCase());
  if (mode === "company_ads") {
    const pageId = input.page_id?.trim();
    if (!pageId || !/^\d{5,30}$/.test(pageId)) throw new Error("numeric page_id is required for company_ads mode");
    params.set("view_all_page_id", pageId);
    params.set("search_type", "page");
  } else {
    const query = input.query?.trim();
    if (!query) throw new Error("query is required for search modes");
    params.set("q", query);
    params.set("search_type", input.search_type ?? "keyword_unordered");
  }
  return `${BASE}?${params.toString()}`;
}

export default defineTool<Input, Output>(async (input, bf) => {
  const limit = Math.min(Math.max(input.max_results ?? 10, 1), 20);
  const maxBodyChars = Math.min(Math.max(input.max_body_chars ?? 3_000, 200), 20_000);
  if (input.mode === "ad" || input.mode === "ad_transcript") {
    const id = adTarget(input);
    if (!id) throw new Error("id or a Meta Ad Library URL containing id is required for ad mode");
    const url = adDetailUrl(input, id);
    let page: Awaited<ReturnType<typeof browserPage>> | undefined;
    let ad: Ad | undefined;
    for (let attempt = 0; attempt < 3 && !ad; attempt += 1) {
      page = await browserPage(bf, url, attempt === 0 ? "auto" : "residential");
      const parsedAd = cardForId(page.html, id, maxBodyChars)
        ?? cardAds(page.html, 100, maxBodyChars).find((candidate) => candidate.ad_archive_id === id);
      if (parsedAd) {
        ad = {
          ...parsedAd,
          creative_video_url: parsedAd.creative_video_url ?? publicVideoUrlNearAd(page.html, id),
        };
      } else if (hasStructuredAd(page.html, id)) {
        const creativeVideoUrl = publicVideoUrlNearAd(page.html, id);
        if (input.mode === "ad" || creativeVideoUrl) {
          ad = {
            ad_archive_id: id,
            url: `${BASE}?id=${id}`,
            creative_video_url: creativeVideoUrl,
          };
        }
      }
    }
    if (!page || !ad) throw new Error("Meta returned no public details for this ad after three public-page attempts");
    if (input.mode === "ad_transcript") {
      if (!ad.creative_video_url) throw new Error("Meta ad does not expose a public video creative");
      const transcriptResult = await (bf as TranscriptionBf).transcribe({
        url: ad.creative_video_url,
        language: input.language,
      });
      const { segments: transcriptSegments, ...transcript } = transcriptResult;
      return { mode: input.mode, source_url: page.sourceUrl, count: 1, ads: [ad], companies: companiesFromAds([ad]), ad, transcript, transcript_segments: transcriptSegments };
    }
    return { mode: input.mode, source_url: page.sourceUrl, count: 1, ads: [ad], companies: companiesFromAds([ad]), ad };
  }

  const url = searchUrl(input, input.mode);
  let page: Awaited<ReturnType<typeof browserPage>> | undefined;
  let ads: Ad[] = [];
  for (let attempt = 0; attempt < 3 && !ads.length; attempt += 1) {
    page = await browserPage(bf, url, attempt === 0 ? "auto" : "residential");
    ads = cardAds(page.html, input.mode === "search_companies" ? 20 : limit, maxBodyChars);
  }
  if (!page || !ads.length) throw new Error("Meta returned no public Ad Library results after three public-page attempts");
  const companies = companiesFromAds(ads);
  const totalLabel = stripTags(page.html).match(/([>~]?[\d,]+)\s+results/i)?.[1];
  const totalMatches = totalLabel && !totalLabel.startsWith(">") ? Number(totalLabel.replace(/[^\d]/g, "")) : undefined;
  if (input.mode === "search_companies") {
    if (!companies.length) throw new Error("Meta returned ads but no public advertiser identities");
    return { mode: input.mode, source_url: page.sourceUrl, count: Math.min(companies.length, limit), total_matches: totalMatches, ads: [], companies: companies.slice(0, limit) };
  }
  return { mode: input.mode, source_url: page.sourceUrl, count: ads.length, total_matches: totalMatches, ads, companies };
});
