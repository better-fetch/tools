import { defineTool } from "@better-fetch/tools";

type Mode = "profile" | "spotlight" | "spotlight_comments";
type Input = { mode: Mode; username?: string; spotlight_url?: string; max_comments?: number };
type Obj = Record<string, unknown>;
type Profile = {
  username: string;
  display_name: string;
  url: string;
  bio?: string;
  subscriber_count?: number;
  website_url?: string;
  profile_picture_url?: string;
  hero_image_url?: string;
  snapcode_image_url?: string;
  verified?: boolean;
  has_story?: boolean;
  has_spotlight_highlights?: boolean;
  business_profile_id?: string;
};
type Spotlight = {
  spotlight_id: string;
  url: string;
  title: string;
  description?: string;
  creator_username?: string;
  creator_name?: string;
  creator_url?: string;
  uploaded_at?: string;
  duration_ms?: number;
  view_count?: number;
  share_count?: number;
  comment_count?: number;
  boost_count?: number;
  recommend_count?: number;
  thumbnail_url?: string;
  media_url?: string;
  transcript_url?: string;
  width?: number;
  height?: number;
};
type Comment = {
  comment_id: string;
  text: string;
  author_name?: string;
  author_avatar?: string;
  created_at?: string;
  reaction_count?: number;
  reply_count?: number;
};
type Output = { mode: Mode; source_url: string; count: number; profile?: Profile; spotlight?: Spotlight; comments: Comment[] };

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== "")) as T;
}

function obj(value: unknown): Obj | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Obj : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numeric(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function wrapped(value: unknown): string | undefined {
  const object = obj(value);
  return str(object?.value) ?? str(value);
}

function timestamp(value: unknown): string | undefined {
  const ms = numeric(value);
  if (ms === undefined) return undefined;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function nextData(html: string): Obj {
  const match = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) throw new Error("Snapchat did not expose server-rendered page data");
  const root = JSON.parse(match[1]) as Obj;
  const props = obj(root.props);
  const pageProps = obj(props?.pageProps);
  if (!pageProps) throw new Error("Snapchat page data was incomplete");
  return pageProps;
}

function cleanUsername(raw: string | undefined): string {
  const username = raw?.trim().replace(/^@/, "").replace(/^https?:\/\/(?:www\.)?snapchat\.com\/(?:add\/|@)?/i, "").split(/[/?#]/)[0];
  if (!username || !/^[A-Za-z0-9._-]{2,64}$/.test(username)) throw new Error("username must be a public Snapchat username or profile URL");
  return username;
}

function spotlightId(raw: string | undefined): string {
  const value = raw?.trim() ?? "";
  const id = value.match(/snapchat\.com\/spotlight\/([^/?#]+)/i)?.[1] ?? (/^[A-Za-z0-9_-]{20,}$/.test(value) ? value : undefined);
  if (!id) throw new Error("spotlight_url must be a public Snapchat Spotlight URL or id");
  return id;
}

function profileFrom(page: Obj, username: string): Profile {
  const userProfile = obj(page.userProfile);
  const publicProfile = obj(userProfile?.publicProfileInfo);
  if (!publicProfile || !str(publicProfile.title)) throw new Error("Snapchat public profile was not found");
  return compact({
    username: str(publicProfile.username) ?? username,
    display_name: str(publicProfile.title)!,
    url: str(obj(page.pageLinks)?.canonicalUrl) ?? `https://www.snapchat.com/@${username}`,
    bio: str(publicProfile.bio),
    subscriber_count: numeric(publicProfile.subscriberCount),
    website_url: str(publicProfile.websiteUrl),
    profile_picture_url: str(publicProfile.profilePictureUrl),
    hero_image_url: str(publicProfile.squareHeroImageUrl),
    snapcode_image_url: str(publicProfile.snapcodeImageUrl),
    verified: numeric(publicProfile.badge) === 1 ? true : undefined,
    has_story: typeof publicProfile.hasStory === "boolean" ? publicProfile.hasStory : undefined,
    has_spotlight_highlights: typeof publicProfile.hasSpotlightHighlights === "boolean" ? publicProfile.hasSpotlightHighlights : undefined,
    business_profile_id: str(publicProfile.businessProfileId),
  });
}

function spotlightFrom(page: Obj, id: string): Spotlight {
  const feed = obj(page.spotlightFeed);
  const stories = Array.isArray(feed?.spotlightStories) ? feed.spotlightStories : [];
  const first = obj(stories[0]);
  const story = obj(first?.story);
  const metadata = obj(first?.metadata);
  const video = obj(metadata?.videoMetadata) ?? obj(page.videoMetadata);
  const engagement = obj(metadata?.engagementStats);
  const creator = obj(obj(video?.creator)?.personCreator);
  const snaps = Array.isArray(story?.snapList) ? story.snapList : [];
  const firstSnap = obj(snaps[0]);
  const snapUrls = obj(firstSnap?.snapUrls);
  const transcript = wrapped(firstSnap?.audioTranscriptionObjectUrl);
  const title = str(metadata?.llmTitle) ?? str(video?.embeddedTextCaption) ?? str(video?.name);
  if (!video || !title) throw new Error("Snapchat Spotlight metadata was not found");
  return compact({
    spotlight_id: wrapped(story?.storyId) ?? id,
    url: `https://www.snapchat.com/spotlight/${id}`,
    title,
    description: str(metadata?.llmDescription) ?? str(metadata?.description) ?? str(video.description),
    creator_username: str(creator?.username),
    creator_name: str(creator?.name),
    creator_url: str(creator?.url),
    uploaded_at: timestamp(video.uploadDateMs),
    duration_ms: numeric(video.durationMs),
    view_count: numeric(engagement?.viewCount) ?? numeric(video.viewCount),
    share_count: numeric(engagement?.shareCount) ?? numeric(video.shareCount),
    comment_count: numeric(engagement?.commentCount),
    boost_count: numeric(engagement?.boostCount),
    recommend_count: numeric(engagement?.recommendCount),
    thumbnail_url: str(video.thumbnailUrl),
    media_url: str(video.contentUrl) ?? str(snapUrls?.mediaUrl),
    transcript_url: transcript,
    width: numeric(video.width),
    height: numeric(video.height),
  });
}

function idPart(value: unknown): string | undefined {
  const object = obj(value);
  const high = str(object?.highBits);
  const low = str(object?.lowBits);
  return high && low ? `${high}-${low}` : undefined;
}

function commentsFrom(page: Obj, limit: number): Comment[] {
  const encoded = str(page.encodedComments);
  if (!encoded) return [];
  let values: unknown;
  try { values = JSON.parse(encoded); } catch { return []; }
  if (!Array.isArray(values)) return [];
  return values.slice(0, limit).flatMap((value) => {
    const item = obj(value);
    const text = str(item?.replyText);
    if (!item || !text) return [];
    const reactions = Array.isArray(item.reactCounts) ? item.reactCounts : [];
    const reactionCount = reactions.reduce((total, reaction) => total + (numeric(obj(reaction)?.reactCount) ?? 0), 0);
    return [compact({
      comment_id: idPart(item.replyId) ?? `${str(item.replyTimestampMs) ?? "comment"}-${str(item.replyPosterDisplayName) ?? "anonymous"}`,
      text,
      author_name: str(item.replyPosterDisplayName),
      author_avatar: str(item.replyPosterProfileLogoUrl),
      created_at: timestamp(item.replyTimestampMs),
      reaction_count: reactionCount,
      reply_count: numeric(item.threadedReplyCount),
    })];
  });
}

export default defineTool<Input, Output>(async (input, bf) => {
  const username = input.mode === "profile" ? cleanUsername(input.username) : undefined;
  const id = input.mode !== "profile" ? spotlightId(input.spotlight_url) : undefined;
  const sourceUrl = username ? `https://www.snapchat.com/@${username}` : `https://www.snapchat.com/spotlight/${id}`;
  const response = await bf.fetch({
    url: sourceUrl,
    strategy: "http",
    return_response_text: true,
    include_html: true,
    extra_headers: { "accept-language": "en-US,en;q=0.9", "user-agent": "Mozilla/5.0" },
  });
  if (response.blocked) throw new Error(`Snapchat blocked the request (${response.block_reason ?? "unknown"})`);
  const raw = response.body_text ?? "";
  const html = raw.includes("__NEXT_DATA__") ? raw : response.html ?? raw;
  const page = nextData(html);
  const profile = username ? profileFrom(page, username) : undefined;
  const spotlight = input.mode === "spotlight" ? spotlightFrom(page, id!) : undefined;
  const comments = input.mode === "spotlight_comments" ? commentsFrom(page, Math.min(Math.max(input.max_comments ?? 20, 1), 100)) : [];
  const count = profile || spotlight ? 1 : comments.length;
  if (!count) throw new Error(`Snapchat returned no public data for ${input.mode}`);
  return compact({ mode: input.mode, source_url: response.final_url ?? sourceUrl, count, profile, spotlight, comments });
});
