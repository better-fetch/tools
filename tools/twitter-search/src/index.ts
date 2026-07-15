import { defineTool, type Bf } from "@better-fetch/tools";

type Input = {
  mode?: "profile" | "user_posts" | "post" | "community" | "community_posts" | "transcript";
  handle?: string;
  profile_url?: string;
  post_url?: string;
  community_url?: string;
  max_results?: number;
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

type JsonObject = Record<string, unknown>;

type Output = {
  mode: "profile" | "user_posts" | "post" | "community" | "community_posts" | "transcript";
  source_url: string;
  count: number;
  profile_url?: string;
  handle?: string;
  display_name?: string;
  bio?: string;
  user_id?: string;
  joined_at?: string;
  joined_label?: string;
  avatar?: string;
  banner_image?: string;
  follower_count?: number;
  following_count?: number;
  post_count?: number;
  protected_account?: boolean;
  tweets?: Tweet[];
  tweet?: Tweet;
  transcript?: TranscriptSummary;
  transcript_segments?: NonNullable<Transcript["segments"]>;
  community?: {
    id: string;
    url: string;
    name?: string;
    description?: string;
    member_count?: number;
    post_count?: number;
    creator_handle?: string;
    join_policy?: string;
    banner_image?: string;
    created_at?: string;
  };
};

type Tweet = {
  id: string;
  url: string;
  text: string;
  created_at?: string;
  author_id?: string;
  author_handle?: string;
  author_name?: string;
  author_avatar?: string;
  reply_count?: number;
  retweet_count?: number;
  quote_count?: number;
  like_count?: number;
  view_count?: number;
  media_urls?: string;
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
  const expanded = value
    .replace(/,/g, "")
    .replace(/^([\d.]+)\s*K$/i, (_, n) => String(Number(n) * 1_000))
    .replace(/^([\d.]+)\s*M$/i, (_, n) => String(Number(n) * 1_000_000));
  const n = Number(expanded);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

function booleanFromFlight(value: string | undefined): boolean | undefined {
  if (value === "!0") return true;
  if (value === "!1") return false;
  return undefined;
}

function objectValue(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : undefined;
}

function arrayValue(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function profileUrlFrom(input: Input): string {
  const rawUrl = input.profile_url?.trim();
  if (rawUrl) {
    const match = rawUrl.match(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,64})\/?$/i);
    if (!match) throw new Error("profile_url must be a public X/Twitter profile URL like https://x.com/openai");
    return `https://x.com/${match[1]}`;
  }

  const handle = input.handle?.trim().replace(/^@/, "");
  if (!handle || !/^[A-Za-z0-9_]{1,64}$/.test(handle)) {
    throw new Error("Provide an X/Twitter handle or profile_url");
  }
  return `https://x.com/${handle}`;
}

function postUrlFrom(input: Input): string {
  const raw = input.post_url?.trim();
  if (!raw) throw new Error("post_url is required for post mode");
  const match = raw.match(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,64})\/status\/(\d+)/i);
  if (!match) throw new Error("post_url must look like https://x.com/handle/status/1234567890");
  return `https://x.com/${match[1]}/status/${match[2]}`;
}

function syndicationToken(id: string): string {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(?:0+|\.)/g, "");
}

function syndicationTweet(value: unknown, canonicalUrl: string): { tweet: Tweet; videoUrl: string } {
  const root = objectValue(value);
  if (!root || text(root.id_str) === undefined) throw new Error("X returned no public post payload");
  const mediaDetails = arrayValue(root.mediaDetails) ?? [];
  const variants = mediaDetails.flatMap((entry) => {
    const detail = objectValue(entry);
    const videoInfo = objectValue(detail?.video_info);
    const durationMs = numberValue(videoInfo?.duration_millis) ?? 0;
    return (arrayValue(videoInfo?.variants) ?? []).flatMap((variant) => {
      const item = objectValue(variant);
      const url = text(item?.url);
      if (!url || text(item?.content_type) !== "video/mp4") return [];
      return [{ url, bitrate: numberValue(item?.bitrate) ?? 0, durationMs }];
    });
  }).sort((a, b) => b.bitrate - a.bitrate);
  // Keep the rendition comfortably inside the engine's 32 MB media ceiling.
  // X exposes bitrate and duration, so select the best expected to fit rather
  // than blindly choosing a 1080p asset that cannot be processed.
  const maxEstimatedBytes = 28 * 1024 * 1024;
  const selected = variants.find((variant) => (
    variant.bitrate <= 0 || variant.durationMs <= 0
      ? false
      : (variant.bitrate * variant.durationMs) / 8_000 <= maxEstimatedBytes
  )) ?? variants.at(-1);
  const videoUrl = selected?.url;
  if (!videoUrl) throw new Error("X post does not expose a public MP4 video rendition");
  const user = objectValue(root.user);
  return {
    videoUrl,
    tweet: {
      id: text(root.id_str) ?? canonicalUrl.match(/status\/(\d+)/)?.[1] ?? "",
      url: canonicalUrl,
      text: text(root.text) ?? "",
      created_at: isoFromDate(root.created_at),
      author_id: text(user?.id_str),
      author_handle: text(user?.screen_name),
      author_name: text(user?.name),
      author_avatar: text(user?.profile_image_url_https),
      reply_count: numberValue(root.conversation_count),
      retweet_count: numberValue(root.retweet_count),
      quote_count: numberValue(root.quote_count),
      like_count: numberValue(root.favorite_count),
      view_count: numberValue(objectValue(root.video)?.viewCount),
      media_urls: videoUrl,
    },
  };
}

function communityUrlFrom(input: Input): string {
  const raw = input.community_url?.trim();
  if (!raw) throw new Error("community_url is required for community mode");
  const match = raw.match(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/i\/communities\/(\d+)/i);
  if (!match) throw new Error("community_url must look like https://x.com/i/communities/1234567890");
  return `https://x.com/i/communities/${match[1]}`;
}

function parseJsonLd(html: string): JsonObject[] {
  const scripts: JsonObject[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(re)) {
    try {
      scripts.push(JSON.parse(decodeEntities(match[1])) as JsonObject);
    } catch {
      // Ignore malformed JSON-LD blocks and continue to meta fallbacks.
    }
  }
  return scripts;
}

function metaContent(html: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`<meta\\s+([^>]*(?:name|property)=["']${escaped}["'][^>]*)>`, "i");
  const attrs = html.match(re)?.[1];
  const content = attrs?.match(/content=["']([^"']*)["']/i)?.[1];
  return text(content);
}

function isoFromDate(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  const time = Date.parse(raw);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

function isoFromMs(value: unknown): string | undefined {
  const ms = numberValue(value);
  if (!ms) return undefined;
  return new Date(ms).toISOString();
}

function statCount(mainEntity: JsonObject | undefined, name: string): number | undefined {
  const stats = arrayValue(mainEntity?.interactionStatistic);
  if (!stats) return undefined;
  for (const stat of stats) {
    const item = objectValue(stat);
    if (text(item?.name)?.toLowerCase() === name.toLowerCase()) {
      return numberValue(item?.userInteractionCount);
    }
  }
  return undefined;
}

function profileImage(mainEntity: JsonObject | undefined): string | undefined {
  const image = objectValue(mainEntity?.image);
  return text(image?.contentUrl) ?? text(image?.thumbnailUrl) ?? text(mainEntity?.image);
}

function relayString(html: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`${escaped}:"([^"]*)"`, "i"));
  return text(match?.[1]);
}

function relayNumber(html: string, key: string): number | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`${escaped}:(\\d+)`, "i"));
  return numberValue(match?.[1]);
}

function relayBoolean(html: string, key: string): boolean | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`${escaped}:(![01])`, "i"));
  return booleanFromFlight(match?.[1]);
}

function compact(output: Output): Output {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(output)) {
    if (value !== undefined && value !== "") out[key] = value;
  }
  return out as Output;
}

type MetaProperty = { property?: string; content?: string };

function metaProperties(html: string): MetaProperty[] {
  const out: MetaProperty[] = [];
  for (const match of html.matchAll(/<meta\b([^>]*)>/gi)) {
    const attrs = match[1];
    const property = attrs.match(/\bitemprop=["']([^"']+)["']/i)?.[1];
    const content = attrs.match(/\bcontent=["']([^"']*)["']/i)?.[1];
    if (property && content !== undefined) out.push({ property: decodeEntities(property), content: decodeEntities(content) });
  }
  return out;
}

function tweetFromArticle(article: string): Tweet | undefined {
  const metas = metaProperties(article);
  const values = (property: string) => metas.filter((meta) => meta.property === property).map((meta) => text(meta.content)).filter((value): value is string => Boolean(value));
  const id = article.match(/\bdata-tweet-id=["'](\d+)["']/i)?.[1] ?? values("identifier")[0];
  const url = values("mainEntityOfPage")[0] ?? values("url").find((value) => /\/status\/\d+/.test(value));
  const body = values("articleBody")[0] ?? values("text")[0] ?? values("headline")[0];
  if (!id || !url || !body) return undefined;

  const authorIndex = metas.findIndex((meta) => meta.property === "alternateName");
  const afterAuthor = authorIndex >= 0 ? metas.slice(authorIndex) : metas;
  const authorHandle = text(metas[authorIndex]?.content)?.replace(/^@/, "");
  const authorName = text(afterAuthor.find((meta) => meta.property === "name")?.content);
  const authorAvatar = text(afterAuthor.find((meta) => meta.property === "image")?.content);
  const ids = values("identifier");
  const stats = new Map<string, number>();
  for (let index = 0; index < metas.length; index += 1) {
    if (metas[index].property !== "name") continue;
    const name = text(metas[index].content)?.toLowerCase();
    const count = metas.slice(index + 1).find((meta) => meta.property === "userInteractionCount");
    const parsed = numberValue(count?.content);
    if (name && parsed !== undefined) stats.set(name, parsed);
  }
  const media = values("contentUrl").filter((value) => /^https?:\/\//.test(value));
  return {
    id,
    url,
    text: body,
    created_at: values("dateCreated")[0] ?? values("datePublished")[0],
    author_id: ids[1],
    author_handle: authorHandle,
    author_name: authorName,
    author_avatar: authorAvatar,
    reply_count: stats.get("replies") ?? numberValue(values("commentCount")[0]),
    retweet_count: stats.get("retweets"),
    quote_count: stats.get("quotes"),
    like_count: stats.get("likes"),
    view_count: stats.get("views"),
    media_urls: media.length ? [...new Set(media)].join("\n") : undefined,
  };
}

function tweetsFromHtml(html: string, maxResults: number): Tweet[] {
  const tweets: Tweet[] = [];
  const articles = /<article\b[^>]*\bdata-tweet-id=["']\d+["'][^>]*>[\s\S]*?<\/article>/gi;
  for (const match of html.matchAll(articles)) {
    const tweet = tweetFromArticle(match[0]);
    if (!tweet || tweets.some((item) => item.id === tweet.id)) continue;
    tweets.push(tweet);
    if (tweets.length >= maxResults) break;
  }
  return tweets;
}

export default defineTool<Input, Output>(async (input, bf) => {
  const mode = input.mode ?? (input.post_url ? "post" : "profile");
  if (mode === "transcript") {
    const sourceUrl = postUrlFrom(input);
    const id = sourceUrl.match(/status\/(\d+)/)?.[1];
    if (!id) throw new Error("X post id was not found");
    const endpoint = `https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en&token=${syndicationToken(id)}`;
    const response = await bf.fetchJson(endpoint, {
      strategy: "http",
      extra_headers: { accept: "application/json", "accept-language": "en-US,en;q=0.9" },
    });
    const media = syndicationTweet(response.json, sourceUrl);
    const transcriptResult = await (bf as TranscriptionBf).transcribe({
      url: media.videoUrl,
      language: input.language,
    });
    const { segments: transcriptSegments, ...transcript } = transcriptResult;
    return compact({ mode, source_url: sourceUrl, count: 1, tweet: media.tweet, transcript, transcript_segments: transcriptSegments });
  }
  if (mode === "community" || mode === "community_posts") {
    const sourceUrl = communityUrlFrom(input);
    const maxResults = Math.min(Math.max(input.max_results ?? 10, 1), 50);
    const page = await bf.fetch({
      url: sourceUrl,
      return_response_text: true,
      include_html: true,
      strategy: "browser",
      wait_until: "domcontentloaded",
      wait_selector: "article[data-tweet-id]",
      wait_ms: 1000,
      timeout_ms: 90_000,
      locale: "en-US",
      extra_headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36",
      },
    });
    const raw = page.body_text ?? "";
    const html = raw.includes("discussion:name") || raw.includes("data-tweet-id") ? raw : page.html ?? raw;
    const id = sourceUrl.match(/communities\/(\d+)/)?.[1];
    if (!id) throw new Error("X/Twitter community id was not found");
    const community = {
      id,
      url: sourceUrl,
      name: metaContent(html, "discussion:name") ?? metaContent(html, "og:title")?.replace(/ on X$/, ""),
      description: metaContent(html, "discussion:description") ?? metaContent(html, "og:description"),
      member_count: numberValue(metaContent(html, "discussion:members") ?? metaContent(html, "twitter:data1")),
      post_count: numberValue(metaContent(html, "discussion:posts")),
      creator_handle: metaContent(html, "discussion:creator") ?? metaContent(html, "twitter:creator")?.replace(/^@/, ""),
      join_policy: metaContent(html, "discussion:policy"),
      banner_image: metaContent(html, "og:image") ?? metaContent(html, "twitter:image"),
      created_at: metaContent(html, "article:published_time"),
    };
    if (!community.name) throw new Error("X/Twitter community metadata was not found in the public page");
    const tweets = mode === "community_posts" ? tweetsFromHtml(html, maxResults) : [];
    if (mode === "community_posts" && !tweets.length) throw new Error("X/Twitter returned no public community posts");
    return compact({
      mode,
      source_url: page.final_url ?? sourceUrl,
      count: mode === "community" ? 1 : tweets.length,
      community,
      tweets: mode === "community_posts" ? tweets : undefined,
    });
  }

  if (mode === "post" || mode === "user_posts") {
    const sourceUrl = mode === "post" ? postUrlFrom(input) : profileUrlFrom(input);
    const maxResults = mode === "post" ? 1 : Math.min(Math.max(input.max_results ?? 10, 1), 50);
    const page = await bf.fetch({
      url: sourceUrl,
      return_response_text: true,
      include_html: true,
      strategy: "browser",
      wait_until: "domcontentloaded",
      wait_selector: "article[data-tweet-id]",
      wait_ms: 1000,
      timeout_ms: 90_000,
      locale: "en-US",
      extra_headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36",
      },
    });
    const raw = page.body_text ?? "";
    const html = raw.includes("data-tweet-id") ? raw : page.html ?? raw;
    const tweets = tweetsFromHtml(html, maxResults);
    if (!tweets.length) throw new Error(`X/Twitter returned no public ${mode === "post" ? "post" : "profile posts"}`);
    return compact({
      mode,
      source_url: page.final_url ?? sourceUrl,
      count: tweets.length,
      tweet: mode === "post" ? tweets[0] : undefined,
      tweets: mode === "user_posts" ? tweets : undefined,
      profile_url: mode === "user_posts" ? sourceUrl : undefined,
      handle: mode === "user_posts" ? sourceUrl.match(/x\.com\/([^/?#]+)/)?.[1] : undefined,
    });
  }

  const profileUrl = profileUrlFrom(input);
  const page = await bf.fetch({
    url: profileUrl,
    return_response_text: true,
    include_html: true,
    strategy: "browser",
    wait_until: "domcontentloaded",
    wait_ms: 750,
    locale: "en-US",
    extra_headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36",
    },
  });

  const raw = page.body_text ?? "";
  const html = raw.includes("<html") || raw.includes("application/ld+json") ? raw : (page.html ?? raw);
  const profile = parseJsonLd(html).find((item) => item["@type"] === "ProfilePage");
  const mainEntity = objectValue(profile?.mainEntity);
  if (!mainEntity) throw new Error("X/Twitter profile metadata was not found in the public page payload");

  const metaCreator = metaContent(html, "twitter:creator")?.replace(/^@/, "");
  const handle = text(mainEntity.additionalName) ?? relayString(html, "screen_name") ?? metaCreator;
  const displayName = text(mainEntity.name) ?? relayString(html, "name") ?? handle;
  if (!handle || !displayName) throw new Error("X/Twitter profile payload was missing handle or display name");

  const output: Output = {
    mode: "profile",
    source_url: text(page.final_url) ?? profileUrl,
    count: 1,
    profile_url: text(page.final_url) ?? text(mainEntity.url) ?? profileUrl,
    handle,
    display_name: displayName,
    bio: text(mainEntity.description) ?? metaContent(html, "twitter:description"),
    user_id: text(mainEntity.identifier),
    joined_at: isoFromDate(profile?.dateCreated) ?? isoFromMs(relayNumber(html, "created_at_ms")),
    joined_label: metaContent(html, "twitter:data2"),
    avatar: profileImage(mainEntity) ?? relayString(html, "image_url"),
    banner_image: metaContent(html, "twitter:image") ?? relayString(html, "image_url"),
    follower_count: statCount(mainEntity, "Follows"),
    following_count: statCount(mainEntity, "Friends"),
    post_count: statCount(mainEntity, "Tweets") ?? numberValue(metaContent(html, "twitter:data1")),
    protected_account: relayBoolean(html, "protected"),
  };

  return compact(output);
});
