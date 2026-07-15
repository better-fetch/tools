import { defineTool } from "@better-fetch/tools";

type Mode = "profile" | "profile_region" | "profile_videos" | "following" | "followers" | "audience_demographics" | "video" | "video_transcript" | "video_comments" | "comment_replies" | "search_suggestions" | "search_users" | "search_hashtag" | "search_keyword" | "search_top" | "user_live" | "live_details" | "song" | "song_videos" | "popular_creators" | "popular_hashtags" | "trending_feed";

type Input = {
  mode?: Mode;
  username?: string;
  profile_url?: string;
  video_url?: string;
  max_results?: number;
  comment_id?: string;
  cursor?: number;
  min_time?: number;
  query?: string;
  hashtag?: string;
  region?: string;
  date_posted?: "yesterday" | "this-week" | "this-month" | "last-3-months" | "last-6-months" | "all-time";
  sort_by?: "relevance" | "most-liked" | "date-posted";
  language?: string;
  clip_id?: string;
  music_url?: string;
  room_id?: string;
  user_id?: string;
  sample_size?: number;
};

type Output = {
  mode: Mode;
  source_url: string;
  title?: string;
  profile_url?: string;
  username?: string;
  display_name?: string;
  user_id?: string;
  sec_uid?: string;
  bio?: string;
  bio_link?: string;
  avatar?: string;
  verified?: boolean;
  private_account?: boolean;
  commerce_user?: boolean;
  category?: string;
  created_at?: string;
  follower_count?: number;
  following_count?: number;
  like_count?: number;
  video_count?: number;
  share_title?: string;
  share_description?: string;
  video_url?: string;
  video_id?: string;
  caption?: string;
  author_url?: string;
  author_name?: string;
  thumbnail_url?: string;
  thumbnail_width?: number;
  thumbnail_height?: number;
  embed_html?: string;
  hashtags?: string[];
  music_title?: string;
  music_url?: string;
  count?: number;
  videos?: Array<{
    id: string;
    url: string;
    caption?: string;
    thumbnail_url?: string;
    username?: string;
    author_name?: string;
    like_count?: number;
    music_title?: string;
  }>;
  creators?: Array<{
    username: string;
    profile_url: string;
    display_name?: string;
    sampled_video_count: number;
    sampled_like_count: number;
    top_video_url?: string;
  }>;
  popular_hashtags?: Array<{
    hashtag: string;
    sampled_video_count: number;
    sampled_like_count: number;
    sample_video_url?: string;
  }>;
  comments?: Array<{
    id: string;
    video_id: string;
    text: string;
    created_at?: string;
    like_count?: number;
    reply_count?: number;
    is_pinned?: boolean;
    liked_by_creator?: boolean;
    username?: string;
    display_name?: string;
    user_id?: string;
    sec_uid?: string;
    avatar_url?: string;
  }>;
  next_cursor?: number;
  has_more?: boolean;
  total?: number;
  room_id?: string;
  is_live?: boolean;
  status?: string;
  status_code?: number;
  viewer_count?: number;
  comment_count?: number;
  share_count?: number;
  cover_url?: string;
  started_at?: string;
  ended_at?: string;
  owner?: {
    id: string;
    username?: string;
    display_name?: string;
  };
  language?: string;
  region?: string;
  suggestions?: Array<{
    content: string;
    language?: string;
    score?: number;
    username?: string;
    display_name?: string;
    user_id?: string;
    sec_uid?: string;
    avatar_url?: string;
    verified?: boolean;
  }>;
  users?: Array<{
    username: string;
    display_name: string;
    profile_url: string;
    user_id?: string;
    sec_uid?: string;
    bio?: string;
    avatar_url?: string;
    verified?: boolean;
    private_account?: boolean;
    follower_count?: number;
    following_count?: number;
    like_count?: number;
    video_count?: number;
  }>;
  transcript?: string;
  transcript_not_available?: boolean;
  subtitle_source?: string;
  is_auto_generated?: boolean;
  music_id?: string;
  music_author?: string;
  music_cover_url?: string;
  music_play_url?: string;
  music_video_count?: number;
  duration?: number;
  sample_size?: number;
  located_sample_size?: number;
  unlocated_sample_size?: number;
  representative?: boolean;
  methodology?: string;
  audience_countries?: Array<{
    country_code: string;
    country_name: string;
    count: number;
    percentage_of_located_sample: number;
  }>;
};

const COUNTRY_NAMES: Record<string, string> = {
  US: "United States", GB: "United Kingdom", CA: "Canada", AU: "Australia", NZ: "New Zealand",
  IE: "Ireland", DE: "Germany", FR: "France", ES: "Spain", IT: "Italy", NL: "Netherlands",
  BE: "Belgium", CH: "Switzerland", AT: "Austria", SE: "Sweden", NO: "Norway", DK: "Denmark",
  FI: "Finland", PL: "Poland", PT: "Portugal", BR: "Brazil", MX: "Mexico", AR: "Argentina",
  CO: "Colombia", CL: "Chile", PE: "Peru", IN: "India", PK: "Pakistan", BD: "Bangladesh",
  PH: "Philippines", ID: "Indonesia", MY: "Malaysia", SG: "Singapore", TH: "Thailand",
  VN: "Vietnam", JP: "Japan", KR: "South Korea", CN: "China", TW: "Taiwan", HK: "Hong Kong",
  NG: "Nigeria", ZA: "South Africa", KE: "Kenya", GH: "Ghana", AE: "United Arab Emirates",
  SA: "Saudi Arabia", EG: "Egypt", TR: "Turkey", RU: "Russia", UA: "Ukraine",
};

const COUNTRY_ALIASES: Array<[string, string]> = [
  ["US", "united states|united states of america|u\\.?s\\.?a\\.?"],
  ["GB", "united kingdom|great britain|u\\.?k\\.?|britain"],
  ["AE", "united arab emirates|u\\.?a\\.?e\\.?"],
  ["KR", "south korea"], ["ZA", "south africa"], ["SA", "saudi arabia"], ["NZ", "new zealand"],
  ["HK", "hong kong"],
  ...Object.entries(COUNTRY_NAMES)
    .filter(([code]) => !["US", "GB", "AE", "KR", "ZA", "SA", "NZ", "HK"].includes(code))
    .map(([code, name]) => [code, name.toLowerCase()] as [string, string]),
];

function explicitBioCountry(bio: string | undefined): string | undefined {
  if (!bio) return undefined;
  for (const match of bio.matchAll(/\p{Regional_Indicator}{2}/gu)) {
    const points = Array.from(match[0], (char) => char.codePointAt(0) ?? 0);
    const code = points.map((point) => String.fromCharCode(point - 0x1f1e6 + 65)).join("");
    if (COUNTRY_NAMES[code]) return code;
  }
  const normalized = bio.toLowerCase().replace(/[_.-]+/g, " ");
  for (const [code, aliases] of COUNTRY_ALIASES) {
    if (new RegExp(`(?:^|[^a-z])(?:${aliases})(?:$|[^a-z])`, "i").test(normalized)) return code;
  }
  return undefined;
}

async function audienceDemographics(
  input: Input,
  bf: Parameters<Parameters<typeof defineTool>[0]>[1],
): Promise<Output> {
  const sampleTarget = Math.min(Math.max(input.sample_size ?? 50, 10), 100);
  const users: NonNullable<Output["users"]> = [];
  const seen = new Set<string>();
  let cursor = input.min_time ?? input.cursor ?? 0;
  let sourceUrl = profileUrlFrom(input);
  let profileUrl = sourceUrl;
  let username = input.username?.trim().replace(/^@/, "");
  while (users.length < sampleTarget) {
    const request = { ...input, max_results: Math.min(10, sampleTarget - users.length), min_time: cursor };
    let page: Output | undefined;
    try {
      // TikTok's logged-out relationship endpoint currently rejects larger
      // page sizes even though the generic relation contract permits 50.
      // Ten is the proven public page size; paginate to build the sample.
      page = await scrapeRelations(request, bf, "followers");
    } catch (firstError) {
      try {
        page = await scrapeRelations(request, bf, "followers");
      } catch (secondError) {
        if (users.length) break;
        throw secondError ?? firstError;
      }
    }
    if (!page) break;
    sourceUrl = page.source_url;
    profileUrl = page.profile_url ?? profileUrl;
    username = page.username ?? username;
    for (const user of page.users ?? []) {
      if (seen.has(user.username)) continue;
      seen.add(user.username);
      users.push(user);
    }
    if (!page.has_more || page.next_cursor === undefined || page.next_cursor === cursor) break;
    cursor = page.next_cursor;
  }
  const counts = new Map<string, number>();
  for (const user of users) {
    const country = explicitBioCountry(user.bio);
    if (country) counts.set(country, (counts.get(country) ?? 0) + 1);
  }
  const located = Array.from(counts.values()).reduce((total, count) => total + count, 0);
  const audienceCountries = Array.from(counts.entries())
    .map(([countryCode, count]) => ({
      country_code: countryCode,
      country_name: COUNTRY_NAMES[countryCode],
      count,
      percentage_of_located_sample: located ? Math.round((count / located) * 10_000) / 100 : 0,
    }))
    .sort((a, b) => b.count - a.count || a.country_code.localeCompare(b.country_code));
  return {
    mode: "audience_demographics",
    source_url: sourceUrl,
    profile_url: profileUrl,
    username,
    count: audienceCountries.length,
    sample_size: users.length,
    located_sample_size: located,
    unlocated_sample_size: users.length - located,
    representative: false,
    methodology: "Countries explicitly self-declared by sampled public followers via country name or flag; no language, city, IP, or private analytics inference.",
    audience_countries: audienceCountries,
  };
}

async function scrapeRelations(
  input: Input,
  bf: Parameters<Parameters<typeof defineTool>[0]>[1],
  mode: "following" | "followers",
): Promise<Output> {
  const profileUrl = profileUrlFrom(input);
  const profilePage = await bf.fetch({
    url: profileUrl,
    strategy: "browser",
    return_response_text: true,
    include_html: true,
    wait_until: "domcontentloaded",
    wait_ms: 750,
    timeout_ms: 90_000,
    locale: "en-US",
    proxy: "auto",
  });
  if (profilePage.blocked) throw new Error(`TikTok blocked the public profile request (${profilePage.block_reason ?? "unknown"})`);
  const rawProfile = profilePage.body_text ?? "";
  const profileHtml = rawProfile.includes("__UNIVERSAL_DATA_FOR_REHYDRATION__")
    ? rawProfile
    : (profilePage.html ?? rawProfile);
  const profileData = extractUniversalData(profileHtml);
  const profileScope = objectValue(profileData?.__DEFAULT_SCOPE__);
  const profileDetail = objectValue(profileScope?.["webapp.user-detail"]);
  const profileUser = objectValue(objectValue(profileDetail?.userInfo)?.user);
  const secUid = text(profileUser?.secUid);
  const username = text(profileUser?.uniqueId) ?? profileUrl.match(/@([^/?#]+)/)?.[1];
  if (!secUid || !username) throw new Error("TikTok profile payload did not expose the public relationship identifier");

  const count = Math.min(Math.max(input.max_results ?? 20, 1), 50);
  const requestedCursor = input.min_time ?? input.cursor ?? 0;
  if (!Number.isInteger(requestedCursor) || requestedCursor < 0) throw new Error("min_time or cursor must be a non-negative integer");
  const params: Array<[string, string]> = [
    ["aid", "1988"],
    ["app_language", "en"],
    ["app_name", "tiktok_web"],
    ["browser_language", "en-US"],
    ["browser_name", "Mozilla"],
    ["browser_platform", "MacIntel"],
    ["channel", "tiktok_web"],
    ["cookie_enabled", "true"],
    ["count", String(count)],
    ["device_platform", "web_pc"],
    ["from_page", "user"],
    ["minCursor", String(requestedCursor)],
    ["region", input.region?.trim().toUpperCase() || "US"],
    ["secUid", secUid],
    ["scene", mode === "followers" ? "67" : "21"],
    ["webcast_language", "en"],
  ];
  const query = params.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
  const sourceUrl = `https://www.tiktok.com/api/user/list/?${query}`;
  const response = await bf.fetch({
    url: sourceUrl,
    strategy: "browser",
    return_response_text: true,
    include_html: true,
    wait_until: "domcontentloaded",
    wait_ms: 500,
    timeout_ms: 90_000,
    locale: "en-US",
    proxy: "auto",
    extra_headers: { accept: "application/json", referer: profileUrl },
  });
  if (response.blocked) throw new Error(`TikTok blocked the public ${mode} request (${response.block_reason ?? "unknown"})`);
  const raw = response.body_text || response.html || "";
  let data = objectValue(response.json);
  if (!data && raw) {
    try { data = objectValue(JSON.parse(raw)); } catch { /* handled below */ }
  }
  const statusCode = numberValue(data?.statusCode ?? data?.status_code);
  if (!data || statusCode !== 0) {
    const statusMessage = text(data?.status_msg);
    throw new Error(statusMessage || `TikTok did not return a public ${mode} list for this account`);
  }
  const users = arrayValue(data.userList).flatMap((value) => {
    const relation = objectValue(value);
    const user = objectValue(relation?.user);
    const stats = objectValue(relation?.statsV2) ?? objectValue(relation?.stats);
    const relationUsername = text(user?.uniqueId);
    const displayName = text(user?.nickname);
    if (!user || !relationUsername || !displayName) return [];
    return [{
      username: relationUsername,
      display_name: displayName,
      profile_url: `https://www.tiktok.com/@${relationUsername}`,
      user_id: text(user.id),
      sec_uid: text(user.secUid),
      bio: text(user.signature),
      avatar_url: text(user.avatarLarger) ?? text(user.avatarMedium) ?? text(user.avatarThumb),
      verified: booleanValue(user.verified),
      private_account: booleanValue(user.privateAccount),
      follower_count: numberValue(stats?.followerCount),
      following_count: numberValue(stats?.followingCount),
      like_count: numberValue(stats?.heartCount ?? stats?.heart),
      video_count: numberValue(stats?.videoCount),
    }];
  }) as NonNullable<Output["users"]>;
  return compact({
    mode,
    source_url: sourceUrl,
    profile_url: profilePage.final_url ?? profileUrl,
    username,
    count: users.length,
    users,
    next_cursor: numberValue(data.minCursor),
    has_more: data.hasMore === true || data.has_more === 1 || data.has_more === true,
    total: numberValue(data.total),
  });
}

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
  const clean = decodeEntities(value).replace(/\s+/g, " ").trim();
  return clean || undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value !== "string") return undefined;
  const n = Number(value.replace(/,/g, ""));
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

function abbreviatedNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = value.trim().replace(/,/g, "").match(/^(\d+(?:\.\d+)?)([KMB])?$/i);
  if (!match) return undefined;
  const multiplier = match[2]?.toUpperCase() === "K" ? 1_000
    : match[2]?.toUpperCase() === "M" ? 1_000_000
      : match[2]?.toUpperCase() === "B" ? 1_000_000_000
        : 1;
  return Math.round(Number(match[1]) * multiplier);
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function isoFromSeconds(value: unknown): string | undefined {
  const seconds = numberValue(value);
  if (!seconds) return undefined;
  return new Date(seconds * 1000).toISOString();
}

async function scrapeLiveDetails(
  input: Input,
  bf: Parameters<Parameters<typeof defineTool>[0]>[1],
): Promise<Output> {
  const requestedRoomId = input.room_id?.trim();
  const requestedUserId = input.user_id?.trim();
  if (requestedRoomId && !/^\d{8,30}$/.test(requestedRoomId)) throw new Error("room_id must be a numeric TikTok live room id");
  if (requestedUserId && !/^\d{8,30}$/.test(requestedUserId)) throw new Error("user_id must be a numeric TikTok user id");
  const sourceUrl = profileUrlFrom(input);
  const response = await bf.fetch({
    url: sourceUrl,
    strategy: "browser",
    include_html: true,
    wait_until: "domcontentloaded",
    wait_ms: 2_500,
    timeout_ms: 90_000,
    proxy: "auto",
    capture_network: true,
    network_resource_types: ["xhr", "fetch"],
    network_include_bodies: true,
    network_max_entries: 140,
    network_max_body_bytes: 1_048_576,
  });
  if (response.blocked) {
    throw new Error(`TikTok blocked the public live profile request (${response.block_reason ?? "unknown"})`);
  }

  const raw = response.body_text ?? "";
  const html = raw.includes("__UNIVERSAL_DATA_FOR_REHYDRATION__")
    ? raw
    : (response.html ?? raw);
  const profileData = extractUniversalData(html);
  const scope = objectValue(profileData?.__DEFAULT_SCOPE__);
  const detail = objectValue(scope?.["webapp.user-detail"]);
  const profileUser = objectValue(objectValue(detail?.userInfo)?.user);
  const roomId = text(profileUser?.roomId);
  const profileUserId = text(profileUser?.id);
  const profileUsername = text(profileUser?.uniqueId) ?? sourceUrl.match(/@([^/?#]+)/)?.[1];
  const profileDisplayName = text(profileUser?.nickname);
  if (!profileUserId) throw new Error("TikTok returned no public profile metadata for live status");
  if (requestedUserId && requestedUserId !== profileUserId) throw new Error("user_id does not own this TikTok profile");
  if (!roomId || roomId === "0") {
    if (requestedRoomId) throw new Error("room_id is not active for this TikTok profile");
    return compact({
      mode: "live_details",
      source_url: sourceUrl,
      profile_url: response.final_url ?? sourceUrl,
      username: profileUsername,
      display_name: profileDisplayName,
      user_id: profileUserId,
      status: "offline",
      is_live: false,
      owner: { id: profileUserId, username: profileUsername, display_name: profileDisplayName },
    });
  }
  if (requestedRoomId && requestedRoomId !== roomId) throw new Error("room_id is not the profile's current TikTok live room");

  let room: Record<string, unknown> | undefined;
  if (Array.isArray(response.network)) {
    for (const rawEntry of response.network) {
      const entry = objectValue(rawEntry);
      const url = text(entry?.url);
      const body = typeof entry?.body_text === "string" ? entry.body_text : undefined;
      if (!url?.includes("/webcast/room/preload_room/") || !body) continue;
      try {
        const payload = objectValue(JSON.parse(body));
        const candidate = objectValue(payload?.data);
        if (candidate) room = candidate;
      } catch { /* ignore unrelated or truncated captures */ }
    }
  }
  const owner = objectValue(room?.owner);
  const ownerId = text(owner?.id_str) ?? text(owner?.id);
  if (!room || !ownerId) {
    return compact({
      mode: "live_details",
      source_url: sourceUrl,
      profile_url: response.final_url ?? sourceUrl,
      room_id: roomId,
      user_id: profileUserId,
      username: profileUsername,
      display_name: profileDisplayName,
      status: "live",
      is_live: true,
      owner: { id: profileUserId, username: profileUsername, display_name: profileDisplayName },
    });
  }
  if (ownerId !== profileUserId) throw new Error("TikTok returned live-room details for a different owner");
  const stats = objectValue(room.stats);
  const cover = objectValue(room.cover);
  const statusCode = numberValue(room.status);
  const status = statusCode === 2 ? "live" : statusCode === 4 ? "ended" : "unknown";
  const coverUrl = arrayValue(cover?.url_list).map(text).find(Boolean);
  return compact({
    mode: "live_details",
    source_url: sourceUrl,
    room_id: roomId,
    user_id: ownerId,
    title: text(room.title),
    status,
    status_code: statusCode,
    is_live: status === "live",
    viewer_count: numberValue(room.user_count) ?? numberValue(stats?.watch_user_count) ?? numberValue(stats?.total_user),
    like_count: numberValue(stats?.like_count) ?? numberValue(stats?.digg_count),
    comment_count: numberValue(stats?.comment_count),
    share_count: numberValue(stats?.share_count),
    cover_url: coverUrl,
    started_at: isoFromSeconds(room.create_time),
    ended_at: isoFromSeconds(room.finish_time),
    owner: {
      id: profileUserId,
      username: text(owner?.display_id) ?? text(owner?.unique_id) ?? profileUsername,
      display_name: text(owner?.nickname) ?? profileDisplayName,
    },
  });
}

function profileUrlFrom(input: Input): string {
  const rawUrl = input.profile_url?.trim();
  if (rawUrl) {
    const match = rawUrl.match(/^https?:\/\/(?:www\.)?tiktok\.com\/@([A-Za-z0-9._-]+)/i);
    if (!match) throw new Error("profile_url must be a TikTok profile URL like https://www.tiktok.com/@openai");
    return `https://www.tiktok.com/@${match[1]}`;
  }

  const username = input.username?.trim().replace(/^@/, "");
  if (!username || !/^[A-Za-z0-9._-]{2,64}$/.test(username)) {
    throw new Error("Provide a TikTok username or profile_url");
  }
  return `https://www.tiktok.com/@${username}`;
}

function videoUrlFrom(input: Input): string {
  const raw = input.video_url?.trim();
  if (!raw) throw new Error("video_url is required for video mode");
  const match = raw.match(
    /^https?:\/\/(?:www\.)?tiktok\.com\/@([A-Za-z0-9._-]+)\/video\/(\d+)/i,
  );
  if (!match) {
    throw new Error(
      "video_url must look like https://www.tiktok.com/@username/video/1234567890",
    );
  }
  return `https://www.tiktok.com/@${match[1]}/video/${match[2]}`;
}

function musicTarget(input: Input): { id: string; url: string } {
  const raw = input.music_url?.trim();
  let canonicalUrl: string | undefined;
  if (raw) {
    const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const match = normalized.match(/^https?:\/\/(?:www\.)?tiktok\.com\/music\/([^/?#]+)-(\d+)/i);
    if (!match) throw new Error("music_url must be a public TikTok music URL");
    canonicalUrl = `https://www.tiktok.com/music/${match[1]}-${match[2]}`;
  }
  const id = input.clip_id?.trim() ?? canonicalUrl?.match(/-(\d+)$/)?.[1];
  if (!id || !/^\d{8,30}$/.test(id)) throw new Error("clip_id or a public TikTok music_url is required for song modes");
  return { id, url: canonicalUrl ?? `https://www.tiktok.com/music/original-sound-${id}` };
}

function extractUniversalData(html: string): Record<string, unknown> | null {
  const marker = "__UNIVERSAL_DATA_FOR_REHYDRATION__";
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = html.indexOf(">", markerIndex);
  if (start < 0) return null;
  const end = html.indexOf("</script>", start + 1);
  if (end < 0) return null;
  try {
    return JSON.parse(html.slice(start + 1, end)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function arraysByKey(root: unknown, key: string): unknown[][] {
  const found: unknown[][] = [];
  const stack: unknown[] = [root];
  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== "object") continue;
    if (Array.isArray(value)) {
      for (const item of value) stack.push(item);
      continue;
    }
    for (const [name, item] of Object.entries(value as Record<string, unknown>)) {
      if (name === key && Array.isArray(item)) found.push(item);
      stack.push(item);
    }
  }
  return found;
}

function indexedVideos(html: string, limit: number): NonNullable<Output["videos"]> {
  const videos: NonNullable<Output["videos"]> = [];
  const seen = new Set<string>();
  const links = /<a[^>]+href="(https?:\/\/[^\"]+)"[^>]*>(?:(?!<\/a>).)*?<h3[^>]*>((?:(?!<\/h3>).)*)<\/h3>/gs;
  let match: RegExpExecArray | null;
  while ((match = links.exec(html)) && videos.length < limit) {
    let url = decodeEntities(match[1]);
    const redirect = url.match(/[?&]q=(https?[^&]+)/);
    if (redirect) url = decodeURIComponent(redirect[1]);
    const target = url.match(/^https?:\/\/(?:www\.)?tiktok\.com\/@([A-Za-z0-9._-]+)\/video\/(\d+)/i);
    if (!target || seen.has(target[2])) continue;
    seen.add(target[2]);
    const tail = html.slice(match.index + match[0].length, match.index + match[0].length + 3000);
    const snippetMatch = tail.match(/<(?:div|span)[^>]*(?:data-sncf|class="[^"]*(?:VwiC3b|IsZvec)[^"]*")[^>]*>((?:(?!<\/(?:div|span)>).)*)/s);
    const title = text(match[2].replace(/<[^>]+>/g, " "));
    const snippet = snippetMatch ? text(snippetMatch[1].replace(/<[^>]+>/g, " ")) : undefined;
    videos.push({
      id: target[2],
      url: `https://www.tiktok.com/@${target[1]}/video/${target[2]}`,
      caption: snippet ?? title,
    });
  }
  return videos;
}

async function indexedProfileVideos(
  username: string,
  limit: number,
  bf: Parameters<Parameters<typeof defineTool>[0]>[1],
): Promise<{ sourceUrl: string; videos: NonNullable<Output["videos"]> }> {
  const queries = [
    `site:tiktok.com/@${username}/video`,
    `site:www.tiktok.com/@${username}/video inurl:/video/`,
  ];
  let sourceUrl = "";
  for (const [index, query] of queries.entries()) {
    sourceUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${Math.min(limit + 5, 30)}&hl=en${index ? "&filter=0" : ""}`;
    try {
      const response = await bf.fetch({
        url: sourceUrl,
        include_html: true,
        strategy: "browser",
        wait_until: "domcontentloaded",
        wait_ms: 1500,
        proxy: "auto",
      });
      const videos = indexedVideos(response.html ?? response.body_text ?? "", limit)
        .filter((video) => video.url.toLowerCase().includes(`/@${username.toLowerCase()}/video/`));
      if (videos.length) return { sourceUrl: response.final_url ?? sourceUrl, videos };
    } catch {
      // Public search navigation can be aborted by a rotating consent or
      // challenge document. The alternate exact query is a real independent
      // retrieval path, not a synthetic result.
    }
  }
  return { sourceUrl, videos: [] };
}

async function searchIndexedVideos(
  input: Input,
  bf: Parameters<Parameters<typeof defineTool>[0]>[1],
): Promise<Output> {
  const hashtag = input.hashtag?.trim().replace(/^#/, "");
  const phrase = input.mode === "search_hashtag" ? hashtag : input.query?.trim();
  if (!phrase) throw new Error(`${input.mode === "search_hashtag" ? "hashtag" : "query"} is required for ${input.mode} mode`);
  const count = Math.min(Math.max(input.max_results ?? 10, 1), 20);
  const cursor = Number.isInteger(input.cursor) && (input.cursor as number) >= 0 ? Math.min(input.cursor as number, 90) : 0;
  const searchPhrase = input.mode === "search_hashtag" ? `#${phrase}` : phrase;
  const dateFilter = input.date_posted === "yesterday" ? "qdr:d"
    : input.date_posted === "this-week" ? "qdr:w"
      : input.date_posted === "this-month" ? "qdr:m"
        : input.date_posted === "last-3-months" || input.date_posted === "last-6-months" ? "qdr:y"
          : undefined;
  const tbs = [dateFilter, input.sort_by === "date-posted" ? "sbd:1" : undefined].filter(Boolean).join(",");
  // Google's public result page occasionally returns a consent/challenge
  // shell that is not classified as a hard block. A second, semantically
  // equivalent query gives the retrieval engine another public URL and exit
  // opportunity without inventing results or using private TikTok APIs.
  const queries = [
    `site:tiktok.com/@ inurl:/video/ ${searchPhrase}`,
    `site:www.tiktok.com/@ inurl:video "${searchPhrase}"`,
  ];
  let sourceUrl = "";
  let finalUrl = "";
  let videos: NonNullable<Output["videos"]> = [];
  for (const [index, query] of queries.entries()) {
    sourceUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${Math.min(count + 5, 30)}&start=${cursor}&hl=en${tbs ? `&tbs=${tbs}` : ""}${index ? "&filter=0" : ""}`;
    const response = await bf.fetch({
      url: sourceUrl,
      include_html: true,
      strategy: "browser",
      wait_until: "domcontentloaded",
      wait_ms: 1500,
      proxy: "auto",
      ...(input.region ? { country: input.region, geoip: true } : {}),
    });
    finalUrl = response.final_url ?? sourceUrl;
    videos = indexedVideos(response.html ?? response.body_text ?? "", count);
    if (videos.length) break;
  }
  if (!videos.length) throw new Error("Public search indexes returned no TikTok video pages after two attempts");
  return compact({
    mode: input.mode as "search_hashtag" | "search_keyword" | "search_top",
    source_url: finalUrl || sourceUrl,
    title: searchPhrase,
    count: videos.length,
    videos,
    next_cursor: cursor < 90 ? cursor + 10 : undefined,
  });
}

async function scrapeTranscript(
  input: Input,
  bf: Parameters<Parameters<typeof defineTool>[0]>[1],
): Promise<Output> {
  const videoUrl = videoUrlFrom(input);
  const videoId = videoUrl.match(/\/video\/(\d+)/)?.[1];
  const language = input.language?.trim().toLowerCase() || "en";
  if (!/^[a-z]{2,3}(?:-[a-z]{2})?$/.test(language)) throw new Error("language must be a 2 or 3 letter language code");
  const page = await bf.fetch({
    url: videoUrl,
    strategy: "http",
    timeout_ms: 60000,
    return_response_text: true,
    include_html: true,
    proxy: "auto",
  });
  if (page.blocked) throw new Error(`TikTok blocked the transcript request (${page.block_reason ?? "unknown"})`);
  const raw = page.body_text ?? "";
  const html = raw.includes("__UNIVERSAL_DATA_FOR_REHYDRATION__") ? raw : page.html ?? raw;
  const data = extractUniversalData(html);
  const captions = arraysByKey(data, "captionInfos").flat().map(objectValue).filter(Boolean) as Record<string, unknown>[];
  const selected = captions.find((caption) => text(caption.languageCode)?.toLowerCase() === language)
    ?? captions.find((caption) => text(caption.language)?.toLowerCase().startsWith(language))
    ?? captions.find((caption) => caption.isOriginalCaption === true)
    ?? captions[0];
  const sources = arrayValue(selected?.urlList).map(text).filter((value): value is string => Boolean(value));
  const subtitleUrl = text(selected?.url) ?? sources.find((value) => /format=webvtt|\.vtt(?:[?#]|$)/i.test(value)) ?? sources[0];
  if (!subtitleUrl) {
    return { mode: "video_transcript", source_url: page.final_url ?? videoUrl, video_url: videoUrl, video_id: videoId, language, transcript_not_available: true };
  }
  const response = await bf.fetch({
    url: subtitleUrl,
    strategy: "http",
    return_response_text: true,
    include_html: false,
    proxy: "auto",
    extra_headers: { accept: "text/vtt,text/plain", referer: videoUrl },
  });
  const transcript = response.body_text?.trim();
  if (!transcript || !/^WEBVTT/i.test(transcript)) {
    return { mode: "video_transcript", source_url: page.final_url ?? videoUrl, video_url: videoUrl, video_id: videoId, language, subtitle_source: subtitleUrl, transcript_not_available: true };
  }
  return {
    mode: "video_transcript",
    source_url: page.final_url ?? videoUrl,
    video_url: videoUrl,
    video_id: videoId,
    language: text(selected.languageCode) ?? text(selected.language) ?? language,
    transcript,
    transcript_not_available: false,
    subtitle_source: subtitleUrl,
    is_auto_generated: selected.isAutoGen === true,
  };
}

async function scrapeComments(
  input: Input,
  bf: Parameters<Parameters<typeof defineTool>[0]>[1],
  replies: boolean,
): Promise<Output> {
  const videoUrl = videoUrlFrom(input);
  const videoId = videoUrl.match(/\/video\/(\d+)/)?.[1];
  if (!videoId) throw new Error("TikTok video id was not found");
  const count = Math.min(Math.max(input.max_results ?? 20, 1), 50);
  const cursor = Number.isInteger(input.cursor) && (input.cursor as number) >= 0 ? input.cursor as number : 0;
  const params: Array<[string, string]> = [["aid", "1988"], ["count", String(count)], ["cursor", String(cursor)]];
  if (replies) {
    const commentId = input.comment_id?.trim();
    if (!commentId || !/^\d+$/.test(commentId)) throw new Error("comment_id is required for comment_replies mode");
    params.push(["comment_id", commentId], ["item_id", videoId]);
  } else {
    params.push(["aweme_id", videoId]);
  }
  const query = params.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
  const sourceUrl = `https://www.tiktok.com/api/comment/list/${replies ? "reply/" : ""}?${query}`;
  const response = await bf.fetch({
    url: sourceUrl,
    strategy: "http",
    return_response_text: true,
    include_html: false,
    extra_headers: { accept: "application/json" },
  });
  let data = objectValue(response.json);
  if (!data && response.body_text) {
    try { data = objectValue(JSON.parse(response.body_text)); } catch { /* handled below */ }
  }
  const comments = arrayValue(data?.comments).flatMap((value) => {
    const comment = objectValue(value);
    const id = text(comment?.cid);
    const body = text(comment?.text);
    if (!comment || !id || !body) return [];
    const user = objectValue(comment.user);
    const avatar = objectValue(user?.avatar_thumb);
    const labels = arrayValue(comment.label_list).map(objectValue).filter(Boolean) as Record<string, unknown>[];
    return [{
      id,
      video_id: text(comment.aweme_id) ?? videoId,
      text: body,
      created_at: isoFromSeconds(comment.create_time),
      like_count: numberValue(comment.digg_count),
      reply_count: numberValue(comment.reply_comment_total),
      is_pinned: numberValue(comment.stick_position) === 1,
      liked_by_creator: labels.some((label) => text(label.text) === "Liked by creator"),
      username: text(user?.unique_id),
      display_name: text(user?.nickname),
      user_id: text(user?.uid),
      sec_uid: text(user?.sec_uid),
      avatar_url: arrayValue(avatar?.url_list).map(text).find(Boolean),
    }];
  });
  if (!data || !comments.length) throw new Error(`TikTok returned no public ${replies ? "comment replies" : "video comments"}`);
  return compact({
    mode: replies ? "comment_replies" : "video_comments",
    source_url: sourceUrl,
    video_url: videoUrl,
    video_id: videoId,
    count: comments.length,
    comments,
    next_cursor: numberValue(data.cursor),
    has_more: data.has_more === 1 || data.has_more === true,
    total: numberValue(data.total),
  });
}

async function searchSuggestions(
  input: Input,
  bf: Parameters<Parameters<typeof defineTool>[0]>[1],
): Promise<Output> {
  const query = input.query?.trim();
  if (!query) throw new Error("query is required for search_suggestions mode");
  const region = input.region?.trim().toUpperCase() || "US";
  const params: Array<[string, string]> = [
    ["aid", "1988"],
    ["app_language", "en"],
    ["app_name", "tiktok_web"],
    ["browser_language", "en-US"],
    ["device_platform", "web_pc"],
    ["from_page", "search"],
    ["region", region],
    ["keyword", query],
  ];
  const encoded = params.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");
  const sourceUrl = `https://www.tiktok.com/api/search/general/sug/?${encoded}`;
  const response = await bf.fetch({ url: sourceUrl, strategy: "http", return_response_text: true, include_html: false, extra_headers: { accept: "application/json" } });
  let data = objectValue(response.json);
  if (!data && response.body_text) {
    try { data = objectValue(JSON.parse(response.body_text)); } catch { /* handled below */ }
  }
  const suggestions = arrayValue(data?.sug_list).flatMap((value) => {
    const suggestion = objectValue(value);
    const content = text(suggestion?.content);
    if (!suggestion || !content) return [];
    const extra = objectValue(suggestion.extra_info);
    return [{
      content,
      language: text(extra?.lang),
      score: typeof extra?.predict_ctr_score === "number" ? extra.predict_ctr_score : undefined,
      username: text(extra?.unique_id ?? extra?.sug_uniq_id),
      display_name: text(extra?.rich_sug_nickname),
      user_id: text(extra?.sug_user_id),
      sec_uid: text(extra?.sug_sec_user_id),
      avatar_url: text(extra?.rich_sug_avatar_uri),
      verified: booleanValue(extra?.is_verified),
    }];
  });
  if (!data || !suggestions.length) throw new Error("TikTok returned no public search suggestions");
  return compact({ mode: "search_suggestions", source_url: sourceUrl, title: query, count: suggestions.length, suggestions });
}

function htmlText(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

async function searchUsers(
  input: Input,
  bf: Parameters<Parameters<typeof defineTool>[0]>[1],
): Promise<Output> {
  const query = input.query?.trim();
  if (!query) throw new Error("query is required for search_users mode");
  const maxResults = Math.min(Math.max(input.max_results ?? 10, 1), 30);
  const sourceUrl = `https://www.tiktok.com/search/user?q=${encodeURIComponent(query)}`;
  const page = await bf.fetch({
    url: sourceUrl,
    strategy: "browser",
    return_response_text: true,
    include_html: true,
    wait_until: "domcontentloaded",
    wait_selector: 'a[href^="/@"] p',
    wait_ms: 1250,
    timeout_ms: 90_000,
    locale: "en-US",
    proxy: "auto",
  });
  if (page.blocked) throw new Error(`TikTok blocked user search (${page.block_reason ?? "unknown"})`);
  const html = page.html ?? page.body_text ?? "";
  const users: NonNullable<Output["users"]> = [];
  const anchorPattern = /<a\b[^>]*href=["']\/@([^"'/?#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    const username = decodeURIComponent(match[1]).trim();
    if (!username || users.some((user) => user.username.toLowerCase() === username.toLowerCase())) continue;
    const body = match[2];
    const labels = [...body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((label) => htmlText(label[1])).filter(Boolean);
    const displayName = labels[0];
    const visibleUsername = labels[1]?.replace(/^@/, "");
    if (!displayName || visibleUsername?.toLowerCase() !== username.toLowerCase()) continue;
    const followerLabel = labels.findIndex((label) => /^followers?$/i.test(label));
    const likeLabel = labels.findIndex((label) => /^likes?$/i.test(label));
    const avatar = body.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1];
    users.push({
      username,
      display_name: displayName,
      profile_url: `https://www.tiktok.com/@${username}`,
      avatar_url: avatar ? decodeEntities(avatar) : undefined,
      follower_count: followerLabel > 0 ? abbreviatedNumber(labels[followerLabel - 1]) : undefined,
      like_count: likeLabel > 0 ? abbreviatedNumber(labels[likeLabel - 1]) : undefined,
    });
    if (users.length >= maxResults) break;
  }
  if (!users.length) throw new Error("TikTok returned no public user search results");
  return compact({ mode: "search_users", source_url: page.final_url ?? sourceUrl, title: query, count: users.length, users });
}

function compact(output: Output): Output {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(output)) {
    if (value !== undefined && value !== "") out[key] = value;
  }
  return out as Output;
}

function profileVideos(html: string, maxResults: number): NonNullable<Output["videos"]> {
  const videos: NonNullable<Output["videos"]> = [];
  const anchors = /<a\b[^>]*href=["']([^"']*\/video\/(\d+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchors)) {
    const id = match[2];
    if (videos.some((video) => video.id === id)) continue;
    const url = decodeEntities(match[1]).split(/[?#]/, 1)[0];
    const image = match[3].match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1];
    const accessibleLabel = match[0].match(/aria-label=["']([^"']+)["']/i)?.[1];
    const rawCaption = match[3].match(/<img\b[^>]*\balt=["']([^"']+)["']/i)?.[1]
      ?? accessibleLabel;
    const label = rawCaption ? text(rawCaption) : undefined;
    const likeLabel = match[3].match(/data-e2e=["']explore-card-like-container["'][\s\S]*?<span[^>]*>([^<]+)<\/span>/i)?.[1];
    const authorName = label?.match(/\bcreated by\s+(.+?)(?:\s+with\s+.+)?(?:\s+\d+(?:[.,]\d+)?[KMB]?)?$/i)?.[1]?.trim();
    const caption = label?.split(/\s+created by\s+/i, 1)[0]?.trim();
    const musicTitle = label?.match(/\s+with\s+(.+?)(?:\s+\d+(?:[.,]\d+)?[KMB]?)?$/i)?.[1]?.trim();
    const username = url.match(/\/@([^/]+)\/video\//i)?.[1];
    videos.push({
      id,
      url: url.startsWith("http") ? url : `https://www.tiktok.com${url}`,
      caption,
      thumbnail_url: image ? decodeEntities(image) : undefined,
      username,
      author_name: authorName,
      like_count: abbreviatedNumber(text(likeLabel)),
      music_title: musicTitle,
    });
    if (videos.length >= maxResults) break;
  }
  return videos;
}

function profilePageVideos(
  page: { body_text?: string; html?: string },
  maxResults: number,
): NonNullable<Output["videos"]> {
  const raw = page.body_text ?? "";
  const html = raw.includes("__UNIVERSAL_DATA_FOR_REHYDRATION__")
    ? raw
    : (page.html ?? raw);
  const hydrated = extractUniversalData(html);
  const structured = itemVideos(hydrated, maxResults);
  return structured.length ? structured : profileVideos(html, maxResults);
}

async function scrapeExplore(
  input: Input,
  bf: Parameters<Parameters<typeof defineTool>[0]>[1],
): Promise<Output> {
  const mode = input.mode as "popular_creators" | "popular_hashtags" | "trending_feed";
  const maxResults = Math.min(Math.max(input.max_results ?? 10, 1), 30);
  const sourceUrl = "https://www.tiktok.com/explore";
  const page = await bf.fetch({
    url: sourceUrl,
    strategy: "browser",
    return_response_text: true,
    include_html: true,
    wait_until: "domcontentloaded",
    wait_selector: 'a[href*="/video/"]',
    wait_ms: 1_500,
    timeout_ms: 90_000,
    locale: "en-US",
    proxy: "auto",
  });
  if (page.blocked) throw new Error(`TikTok blocked the public Explore feed (${page.block_reason ?? "unknown"})`);
  const videos = profileVideos(page.html ?? page.body_text ?? "", Math.min(maxResults * 5, 50));
  if (!videos.length) throw new Error("TikTok returned no public Explore videos");

  if (mode === "trending_feed") {
    return compact({ mode, source_url: page.final_url ?? sourceUrl, count: Math.min(videos.length, maxResults), videos: videos.slice(0, maxResults) });
  }

  if (mode === "popular_creators") {
    const creatorMap = new Map<string, NonNullable<Output["creators"]>[number]>();
    for (const video of videos) {
      if (!video.username) continue;
      const key = video.username.toLowerCase();
      const current = creatorMap.get(key) ?? {
        username: video.username,
        profile_url: `https://www.tiktok.com/@${video.username}`,
        display_name: video.author_name,
        sampled_video_count: 0,
        sampled_like_count: 0,
        top_video_url: video.url,
      };
      current.sampled_video_count += 1;
      const likes = video.like_count ?? 0;
      if (likes > current.sampled_like_count) current.top_video_url = video.url;
      current.sampled_like_count += likes;
      creatorMap.set(key, current);
    }
    const creators = [...creatorMap.values()]
      .sort((a, b) => b.sampled_like_count - a.sampled_like_count)
      .slice(0, maxResults);
    if (!creators.length) throw new Error("TikTok Explore returned no public creator identities");
    return compact({ mode, source_url: page.final_url ?? sourceUrl, count: creators.length, creators });
  }

  const hashtagMap = new Map<string, NonNullable<Output["popular_hashtags"]>[number]>();
  for (const video of videos) {
    const hashtags = video.caption ? [...video.caption.matchAll(/#([\p{L}\p{N}_]+)/gu)].map((tag) => tag[1]) : [];
    for (const hashtag of hashtags) {
      const key = hashtag.toLowerCase();
      const current = hashtagMap.get(key) ?? {
        hashtag,
        sampled_video_count: 0,
        sampled_like_count: 0,
        sample_video_url: video.url,
      };
      current.sampled_video_count += 1;
      current.sampled_like_count += video.like_count ?? 0;
      hashtagMap.set(key, current);
    }
  }
  const popularHashtags = [...hashtagMap.values()]
    .sort((a, b) => b.sampled_like_count - a.sampled_like_count || b.sampled_video_count - a.sampled_video_count)
    .slice(0, maxResults);
  if (!popularHashtags.length) throw new Error("TikTok Explore returned no public hashtags");
  return compact({ mode, source_url: page.final_url ?? sourceUrl, count: popularHashtags.length, popular_hashtags: popularHashtags });
}

function itemVideos(root: unknown, maxResults: number): NonNullable<Output["videos"]> {
  const videos: NonNullable<Output["videos"]> = [];
  const seen = new Set<string>();
  for (const list of arraysByKey(root, "itemList")) {
    for (const value of list) {
      const item = objectValue(value);
      const id = text(item?.id);
      const author = objectValue(item?.author);
      const video = objectValue(item?.video);
      const username = text(author?.uniqueId);
      if (!id || !username || seen.has(id)) continue;
      seen.add(id);
      videos.push({
        id,
        url: `https://www.tiktok.com/@${username}/video/${id}`,
        caption: text(item?.desc),
        thumbnail_url: text(video?.cover) ?? text(video?.originCover) ?? text(video?.dynamicCover),
      });
      if (videos.length >= maxResults) return videos;
    }
  }
  return videos;
}

async function scrapeSong(
  input: Input,
  bf: Parameters<Parameters<typeof defineTool>[0]>[1],
  includeVideos: boolean,
): Promise<Output> {
  const target = musicTarget(input);
  const limit = Math.min(Math.max(input.max_results ?? 12, 1), 50);
  const page = await bf.fetch({
    url: target.url,
    strategy: "browser",
    include_html: true,
    wait_until: "domcontentloaded",
    wait_selector: 'a[href*="/video/"]',
    wait_ms: 1500,
    timeout_ms: 90_000,
    locale: "en-US",
    proxy: "auto",
  });
  if (page.blocked) throw new Error(`TikTok blocked the public song page (${page.block_reason ?? "unknown"})`);
  const html = page.html ?? page.body_text ?? "";
  const data = extractUniversalData(html);
  const scope = objectValue(data?.__DEFAULT_SCOPE__);
  const detail = objectValue(scope?.["webapp.music-detail"]);
  const musicInfo = objectValue(detail?.musicInfo);
  const music = objectValue(musicInfo?.music);
  const stats = objectValue(musicInfo?.stats);
  const musicId = text(music?.id) ?? target.id;
  const heading = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const subheadings = [...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)].map((match) => htmlText(match[1]));
  const title = text(music?.title) ?? (heading ? htmlText(heading[1]) : undefined);
  const itemListVideos = itemVideos(detail ?? data, limit);
  const videos = includeVideos ? (itemListVideos.length ? itemListVideos : profileVideos(html, limit)) : [];
  const visibleCount = subheadings.map((value) => value.match(/([\d,.]+)\s+videos?/i)?.[1]).find(Boolean);
  if (!title && !videos.length) throw new Error("TikTok returned no public song metadata or videos");
  if (includeVideos && !videos.length) throw new Error("TikTok returned no public videos for this song");
  return compact({
    mode: includeVideos ? "song_videos" : "song",
    source_url: page.final_url ?? target.url,
    title,
    music_title: title,
    music_url: target.url,
    music_id: musicId,
    music_author: text(music?.authorName) ?? subheadings.find((value) => !/\bvideos?\b/i.test(value)),
    music_cover_url: text(music?.coverLarge) ?? text(music?.coverMedium) ?? text(music?.coverThumb),
    music_play_url: text(music?.playUrl),
    music_video_count: numberValue(stats?.videoCount) ?? numberValue(visibleCount),
    duration: numberValue(music?.duration),
    count: includeVideos ? videos.length : undefined,
    videos: includeVideos ? videos : undefined,
  });
}

function extractLinks(html: string, kind: "tag" | "music"): { title?: string; url?: string }[] {
  const pattern = /<a\b[^>]*title="([^"]*)"[^>]*href="([^"]*)"[^>]*>/gi;
  const out: { title?: string; url?: string }[] = [];
  for (const match of html.matchAll(pattern)) {
    const title = text(match[1]);
    const url = text(match[2]);
    if (!url) continue;
    if (kind === "tag" && /\/tag\//i.test(url)) out.push({ title, url });
    if (kind === "music" && /\/music\//i.test(url)) out.push({ title, url });
  }
  return out;
}

async function scrapeVideo(
  input: Input,
  bf: Parameters<Parameters<typeof defineTool>[0]>[1],
): Promise<Output> {
  const videoUrl = videoUrlFrom(input);
  const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(videoUrl)}`;
  const response = await bf.fetch({
    url: oembedUrl,
    strategy: "http",
    return_response_text: true,
    include_html: false,
    extra_headers: { accept: "application/json" },
  });
  let payload = objectValue(response.json);
  if (!payload && response.body_text) {
    try {
      payload = objectValue(JSON.parse(response.body_text));
    } catch {
      // The error below keeps the public failure contract concise.
    }
  }
  if (!payload) throw new Error("TikTok did not return public video metadata");

  const html = text(payload.html) ?? "";
  const tags = extractLinks(html, "tag")
    .map((item) => item.title)
    .filter((item): item is string => Boolean(item));
  const music = extractLinks(html, "music")[0];
  const authorUrl = text(payload.author_url);
  const username = text(payload.author_unique_id) ?? authorUrl?.match(/@([^/?#]+)/)?.[1];
  const id = text(payload.embed_product_id) ?? videoUrl.match(/\/video\/(\d+)/)?.[1];

  return compact({
    mode: "video",
    source_url: oembedUrl,
    video_url: videoUrl,
    video_id: id,
    caption: text(payload.title),
    username,
    author_url: authorUrl,
    author_name: text(payload.author_name),
    thumbnail_url: text(payload.thumbnail_url),
    thumbnail_width: numberValue(payload.thumbnail_width),
    thumbnail_height: numberValue(payload.thumbnail_height),
    embed_html: html || undefined,
    hashtags: tags.length ? tags : undefined,
    music_title: music?.title,
    music_url: music?.url,
  });
}

export default defineTool<Input, Output>(async (input, bf) => {
  const mode = input.mode ?? (input.video_url ? "video" : "profile");
  if (mode === "live_details") return scrapeLiveDetails(input, bf);
  if (mode === "audience_demographics") return audienceDemographics(input, bf);
  if (mode === "following" || mode === "followers") return scrapeRelations(input, bf, mode);
  if (mode === "popular_creators" || mode === "popular_hashtags" || mode === "trending_feed") return scrapeExplore({ ...input, mode }, bf);
  if (mode === "song" || mode === "song_videos") return scrapeSong({ ...input, mode }, bf, mode === "song_videos");
  if (mode === "search_users") return searchUsers(input, bf);
  if (mode === "search_suggestions") return searchSuggestions(input, bf);
  if (mode === "search_hashtag" || mode === "search_keyword" || mode === "search_top") return searchIndexedVideos({ ...input, mode }, bf);
  if (mode === "video_comments") return scrapeComments(input, bf, false);
  if (mode === "comment_replies") return scrapeComments(input, bf, true);
  if (mode === "video_transcript") return scrapeTranscript(input, bf);
  if (mode === "video") return scrapeVideo(input, bf);

  const profileUrl = profileUrlFrom(input);
  if (mode === "profile_region") {
    const profilePage = await bf.fetch({
      url: profileUrl,
      return_response_text: true,
      include_html: true,
      strategy: "browser",
      wait_until: "domcontentloaded",
      wait_ms: 1000,
      timeout_ms: 90_000,
      locale: "en-US",
    });
    const username = profileUrl.match(/@([^/?#]+)/)?.[1];
    if (!username) throw new Error("TikTok profile URL did not contain a username");
    let firstVideo = profilePageVideos(profilePage, 1)[0];
    if (!firstVideo) {
      firstVideo = (await indexedProfileVideos(username, 1, bf)).videos[0];
    }
    if (!firstVideo) throw new Error("TikTok returned no public video for profile region resolution");
    const videoPage = await bf.fetch({
      url: firstVideo.url,
      strategy: "http",
      timeout_ms: 60_000,
      return_response_text: true,
      include_html: true,
      proxy: "auto",
    });
    const raw = videoPage.body_text ?? "";
    const html = raw.includes("__UNIVERSAL_DATA_FOR_REHYDRATION__") ? raw : videoPage.html ?? raw;
    const data = extractUniversalData(html);
    const scope = objectValue(data?.__DEFAULT_SCOPE__);
    const detail = objectValue(scope?.["webapp.video-detail"]);
    const itemInfo = objectValue(detail?.itemInfo);
    const item = objectValue(itemInfo?.itemStruct);
    const region = text(item?.locationCreated)?.toUpperCase();
    if (!region || !/^[A-Z]{2}$/.test(region)) throw new Error("TikTok did not expose a region on the creator's public video");
    return {
      mode,
      source_url: videoPage.final_url ?? firstVideo.url,
      profile_url: profilePage.final_url ?? profileUrl,
      username: profileUrl.match(/@([^/?#]+)/)?.[1],
      region,
    };
  }
  if (mode === "profile_videos") {
    const maxResults = Math.min(Math.max(input.max_results ?? 12, 1), 50);
    const username = profileUrl.match(/@([^/?#]+)/)?.[1];
    if (!username) throw new Error("TikTok profile URL did not contain a username");
    const page = await bf.fetch({
      url: profileUrl,
      return_response_text: true,
      include_html: true,
      strategy: "browser",
      wait_until: "domcontentloaded",
      wait_ms: 1000,
      timeout_ms: 90_000,
      locale: "en-US",
    });
    let videos = profilePageVideos(page, maxResults);
    let sourceUrl = page.final_url ?? profileUrl;
    if (!videos.length) {
      const indexed = await indexedProfileVideos(username, maxResults, bf);
      videos = indexed.videos;
      sourceUrl = indexed.sourceUrl || sourceUrl;
    }
    if (!videos.length) throw new Error("TikTok returned no public profile videos");
    return compact({
      mode,
      source_url: sourceUrl,
      profile_url: page.final_url ?? profileUrl,
      username,
      count: videos.length,
      videos,
    });
  }

  const page = await bf.fetch({
    url: profileUrl,
    return_response_text: true,
    include_html: true,
    strategy: "browser",
    wait_until: "domcontentloaded",
    wait_ms: 750,
    locale: "en-US",
  });

  const raw = page.body_text ?? "";
  const html = raw.includes("__UNIVERSAL_DATA_FOR_REHYDRATION__") ? raw : (page.html ?? raw);
  const data = extractUniversalData(html);
  const scope = objectValue(data?.__DEFAULT_SCOPE__);
  const detail = objectValue(scope?.["webapp.user-detail"]);
  const userInfo = objectValue(detail?.userInfo);
  const user = objectValue(userInfo?.user);
  const stats = objectValue(userInfo?.stats);
  const shareMeta = objectValue(detail?.shareMeta);
  if (!user) throw new Error("TikTok profile metadata was not found in the public page payload");

  const username = text(user.uniqueId);
  const displayName = text(user.nickname);
  if (!username || !displayName) throw new Error("TikTok profile payload was missing username or display name");

  const commerce = objectValue(user.commerceUserInfo);
  const bioLink = objectValue(user.bioLink);
  if (mode === "user_live") {
    const roomId = text(user.roomId);
    return compact({
      mode,
      source_url: profileUrl,
      profile_url: page.final_url ?? profileUrl,
      username,
      display_name: displayName,
      user_id: text(user.id),
      room_id: roomId,
      is_live: Boolean(roomId && roomId !== "0"),
      language: text(user.language),
    });
  }
  const output: Output = {
    mode: "profile",
    source_url: profileUrl,
    profile_url: page.final_url ?? profileUrl,
    username,
    display_name: displayName,
    user_id: text(user.id),
    sec_uid: text(user.secUid),
    bio: text(user.signature),
    bio_link: text(bioLink?.link),
    avatar: text(user.avatarLarger) ?? text(user.avatarMedium) ?? text(user.avatarThumb),
    verified: booleanValue(user.verified),
    private_account: booleanValue(user.privateAccount),
    commerce_user: booleanValue(commerce?.commerceUser),
    category: text(commerce?.category),
    created_at: isoFromSeconds(user.createTime),
    room_id: text(user.roomId),
    is_live: Boolean(text(user.roomId) && text(user.roomId) !== "0"),
    language: text(user.language),
    follower_count: numberValue(stats?.followerCount),
    following_count: numberValue(stats?.followingCount),
    like_count: numberValue(stats?.heartCount ?? stats?.heart),
    video_count: numberValue(stats?.videoCount),
    share_title: text(shareMeta?.title),
    share_description: text(shareMeta?.desc),
  };

  return compact(output);
});
