import { defineTool } from "@better-fetch/tools";

type Input = {
  username?: string;
  profile_url?: string;
};

type Output = {
  profile_url: string;
  username: string;
  display_name: string;
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
  const clean = decodeEntities(value).replace(/\s+/g, " ").trim();
  return clean || undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value !== "string") return undefined;
  const n = Number(value.replace(/,/g, ""));
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function isoFromSeconds(value: unknown): string | undefined {
  const seconds = numberValue(value);
  if (!seconds) return undefined;
  return new Date(seconds * 1000).toISOString();
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

function compact(output: Output): Output {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(output)) {
    if (value !== undefined && value !== "") out[key] = value;
  }
  return out as Output;
}

export default defineTool<Input, Output>(async (input, bf) => {
  const profileUrl = profileUrlFrom(input);
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
  const output: Output = {
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
    follower_count: numberValue(stats?.followerCount),
    following_count: numberValue(stats?.followingCount),
    like_count: numberValue(stats?.heartCount ?? stats?.heart),
    video_count: numberValue(stats?.videoCount),
    share_title: text(shareMeta?.title),
    share_description: text(shareMeta?.desc),
  };

  return compact(output);
});
