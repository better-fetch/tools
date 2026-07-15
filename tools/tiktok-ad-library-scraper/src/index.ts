import { defineTool, type Bf } from "@better-fetch/tools";

type Mode = "search" | "ad";
type Input = {
  mode: Mode;
  ad_id?: string;
  region?: string;
  period?: "7" | "30" | "180";
  page?: number;
  query?: string;
  max_results?: number;
};

type Ad = {
  ad_id: string;
  url: string;
  title?: string;
  brand_name?: string;
  industry_key?: string;
  objective_key?: string;
  landing_page?: string;
  countries_csv?: string;
  source?: string;
  ctr?: number;
  cost?: number;
  like_count?: number;
  comment_count?: number;
  share_count?: number;
  video_id?: string;
  video_duration_seconds?: number;
  video_cover_url?: string;
  video_url?: string;
  video_width?: number;
  video_height?: number;
};

type Output = {
  mode: Mode;
  source_url: string;
  api_source_url: string;
  count: number;
  total_count?: number;
  page?: number;
  has_more?: boolean;
  query_applied_locally?: boolean;
  ads: Ad[];
  ad?: Ad;
};

type Obj = Record<string, unknown>;

const LIST_PAGE = "https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en";

function objectValue(value: unknown): Obj | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Obj : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function publicJson(network: unknown, path: string): { url: string; payload: Obj }[] {
  if (!Array.isArray(network)) return [];
  const results: { url: string; payload: Obj }[] = [];
  for (const raw of network) {
    const entry = objectValue(raw);
    const url = stringValue(entry?.url);
    if (!url?.includes(path)) continue;
    let payload = objectValue(entry?.json);
    if (!payload) {
      const body = stringValue(entry?.body_text);
      if (body) {
        try { payload = objectValue(JSON.parse(body)); } catch { /* ignore malformed capture */ }
      }
    }
    if (payload && numberValue(payload.code) === 0 && objectValue(payload.data)) {
      results.push({ url, payload });
    }
  }
  return results;
}

function videoFrom(value: unknown): Omit<Ad, "ad_id" | "url"> {
  const video = objectValue(value);
  if (!video) return {};
  const sources = objectValue(video.video_url);
  const videoUrl = stringValue(sources?.["720p"])
    ?? stringValue(sources?.["540p"])
    ?? Object.values(sources ?? {}).map(stringValue).find(Boolean);
  return {
    video_id: stringValue(video.vid),
    video_duration_seconds: numberValue(video.duration),
    video_cover_url: stringValue(video.cover),
    video_url: videoUrl,
    video_width: numberValue(video.width),
    video_height: numberValue(video.height),
  };
}

function adFrom(value: unknown): Ad | undefined {
  const item = objectValue(value);
  const id = stringValue(item?.id);
  if (!item || !id || !/^\d{8,30}$/.test(id)) return undefined;
  const countries = Array.isArray(item.country_code)
    ? item.country_code.map(stringValue).filter((code): code is string => Boolean(code))
    : undefined;
  return {
    ad_id: id,
    url: `https://ads.tiktok.com/business/creativecenter/topads/${id}/pc/en`,
    title: stringValue(item.ad_title),
    brand_name: stringValue(item.brand_name),
    industry_key: stringValue(item.industry_key),
    objective_key: stringValue(item.objective_key),
    landing_page: stringValue(item.landing_page),
    countries_csv: countries?.length ? countries.join(",") : undefined,
    source: stringValue(item.source),
    ctr: numberValue(item.ctr),
    cost: numberValue(item.cost),
    like_count: numberValue(item.like),
    comment_count: numberValue(item.comment),
    share_count: numberValue(item.share),
    ...videoFrom(item.video_info),
  };
}

function regionCode(value: string | undefined): string {
  const region = (value ?? "US").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(region)) throw new Error("region must be a 2-letter country code");
  return region;
}

async function capturedPage(bf: Bf, url: string) {
  const response = await bf.fetch({
    url,
    strategy: "browser",
    include_html: false,
    json_mode: false,
    wait_until: "domcontentloaded",
    wait_ms: 3_500,
    timeout_ms: 90_000,
    proxy: "auto",
    capture_network: true,
    network_resource_types: ["xhr", "fetch"],
    network_include_bodies: true,
    network_max_entries: 100,
    network_max_body_bytes: 1_048_576,
  });
  if (response.blocked) {
    throw new Error(`TikTok blocked the public Creative Center request (${response.block_reason ?? "unknown"})`);
  }
  return { response, sourceUrl: response.final_url ?? url };
}

export default defineTool<Input, Output>(async (input, bf) => {
  if (input.mode === "ad") {
    const id = input.ad_id?.trim();
    if (!id || !/^\d{8,30}$/.test(id)) throw new Error("ad_id is required for ad mode");
    const url = `https://ads.tiktok.com/business/creativecenter/topads/${id}/pc/en`;
    const page = await capturedPage(bf, url);
    const captures = publicJson(page.response.network, "/top_ads/v2/detail");
    const selected = captures.find((capture) => new URL(capture.url).searchParams.get("material_id") === id)
      ?? captures.at(-1);
    const ad = adFrom(objectValue(selected?.payload.data));
    if (!selected || !ad || ad.ad_id !== id) throw new Error("TikTok returned no public details for this ad");
    return { mode: input.mode, source_url: page.sourceUrl, api_source_url: selected.url, count: 1, ads: [ad], ad };
  }

  const region = regionCode(input.region);
  const period = input.period ?? "30";
  const pageNumber = Math.min(Math.max(Math.trunc(input.page ?? 1), 1), 10);
  const maxResults = Math.min(Math.max(Math.trunc(input.max_results ?? 10), 1), 20);
  const params = new URLSearchParams({ region, period, page: String(pageNumber) });
  const url = `${LIST_PAGE}?${params.toString()}`;
  const page = await capturedPage(bf, url);
  const captures = publicJson(page.response.network, "/top_ads/v2/list");
  const selected = captures.find((capture) => {
    const source = new URL(capture.url);
    return source.searchParams.get("country_code") === region
      && source.searchParams.get("period") === period;
  }) ?? captures.at(-1);
  const data = objectValue(selected?.payload.data);
  const pagination = objectValue(data?.pagination);
  let ads = (Array.isArray(data?.materials) ? data.materials : []).map(adFrom).filter((ad): ad is Ad => Boolean(ad));
  const query = input.query?.trim().toLowerCase();
  if (query) {
    ads = ads.filter((ad) => `${ad.title ?? ""} ${ad.brand_name ?? ""}`.toLowerCase().includes(query));
  }
  ads = ads.slice(0, maxResults);
  if (!selected || !ads.length) {
    throw new Error(query
      ? "TikTok returned no matching ads on the current public result page"
      : "TikTok returned no public Creative Center ads");
  }
  return {
    mode: input.mode,
    source_url: page.sourceUrl,
    api_source_url: selected.url,
    count: ads.length,
    total_count: numberValue(pagination?.total_count),
    page: numberValue(pagination?.page),
    has_more: pagination?.has_more === true,
    query_applied_locally: query ? true : undefined,
    ads,
  };
});
