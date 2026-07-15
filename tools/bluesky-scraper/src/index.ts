import { defineTool } from "@better-fetch/tools";

type Mode = "profile" | "posts" | "post";

type Input = {
  mode?: Mode;
  actor?: string;
  post_url?: string;
  max_results?: number;
};

type Profile = {
  did: string;
  handle: string;
  display_name?: string;
  description?: string;
  avatar?: string;
  banner?: string;
  followers_count?: number;
  follows_count?: number;
  posts_count?: number;
  created_at?: string;
  indexed_at?: string;
};

type Post = {
  uri: string;
  cid?: string;
  url?: string;
  text: string;
  created_at?: string;
  indexed_at?: string;
  author_did: string;
  author_handle: string;
  author_name?: string;
  author_avatar?: string;
  reply_count?: number;
  repost_count?: number;
  like_count?: number;
  quote_count?: number;
  languages?: string;
  image_url?: string;
  image_alt?: string;
  image_thumbnail?: string;
};

type Output = {
  mode: Mode;
  source_url: string;
  count: number;
  profile?: Profile;
  posts?: Post[];
  post?: Post;
};

const API = "https://public.api.bsky.app/xrpc";

function rec(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

function clamp(value: number | undefined, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value ?? 10)));
}

function cleanActor(value: string | undefined): string {
  const raw = value?.trim().replace(/^@/, "") ?? "";
  const fromUrl = raw.match(/bsky\.app\/profile\/([^/?#]+)/i)?.[1];
  const actor = fromUrl ?? raw;
  if (!actor || !/^(?:did:[a-z0-9:._-]+|[a-z0-9.-]+)$/i.test(actor)) {
    throw new Error("actor must be a Bluesky handle, DID, or profile URL");
  }
  return actor;
}

function postParts(value: string | undefined): { actor: string; rkey: string } {
  const raw = value?.trim() ?? "";
  const web = raw.match(/bsky\.app\/profile\/([^/?#]+)\/post\/([^/?#]+)/i);
  if (web) return { actor: web[1], rkey: web[2] };
  const at = raw.match(/^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/?#]+)/i);
  if (at) return { actor: at[1], rkey: at[2] };
  throw new Error(
    "post_url must be a bsky.app post URL or an at:// post URI",
  );
}

function profile(value: unknown): Profile | undefined {
  const item = rec(value);
  const did = str(item?.did);
  const handle = str(item?.handle);
  if (!did || !handle) return undefined;
  return {
    did,
    handle,
    display_name: str(item?.displayName),
    description: str(item?.description),
    avatar: str(item?.avatar),
    banner: str(item?.banner),
    followers_count: num(item?.followersCount),
    follows_count: num(item?.followsCount),
    posts_count: num(item?.postsCount),
    created_at: str(item?.createdAt),
    indexed_at: str(item?.indexedAt),
  };
}

function post(value: unknown): Post | undefined {
  const wrapper = rec(value);
  const item = rec(wrapper?.post) ?? wrapper;
  const uri = str(item?.uri);
  const author = profile(item?.author);
  const record = rec(item?.record);
  const text = str(record?.text);
  if (!uri || !author || text === undefined) return undefined;
  const rkey = uri.split("/").pop();
  const firstImage = rec(arr(rec(item?.embed)?.images)[0]);
  return {
    uri,
    cid: str(item?.cid),
    url: rkey ? `https://bsky.app/profile/${author.handle}/post/${rkey}` : undefined,
    text,
    created_at: str(record?.createdAt),
    indexed_at: str(item?.indexedAt),
    author_did: author.did,
    author_handle: author.handle,
    author_name: author.display_name,
    author_avatar: author.avatar,
    reply_count: num(item?.replyCount),
    repost_count: num(item?.repostCount),
    like_count: num(item?.likeCount),
    quote_count: num(item?.quoteCount),
    languages: arr(record?.langs)
      .filter((item): item is string => typeof item === "string")
      .join(", ") || undefined,
    image_url: str(firstImage?.fullsize),
    image_alt: str(firstImage?.alt),
    image_thumbnail: str(firstImage?.thumb),
  };
}

async function getJson(
  bf: Parameters<Parameters<typeof defineTool>[0]>[1],
  url: string,
): Promise<unknown> {
  const response = await bf.fetch({
    url,
    strategy: "http",
    return_response_text: true,
    include_html: false,
    extra_headers: { accept: "application/json" },
  });
  if (response.json != null) return response.json;
  try {
    return JSON.parse(response.body_text ?? "");
  } catch {
    throw new Error("Bluesky did not return JSON");
  }
}

export default defineTool<Input, Output>(async (input, bf) => {
  const mode = input.mode ?? (input.post_url ? "post" : "profile");

  if (mode === "post") {
    const { actor, rkey } = postParts(input.post_url);
    const uri = `at://${actor}/app.bsky.feed.post/${rkey}`;
    const url = `${API}/app.bsky.feed.getPostThread?uri=${encodeURIComponent(uri)}&depth=0`;
    const data = rec(await getJson(bf, url));
    const value = post(rec(data?.thread)?.post);
    if (!value) throw new Error("Bluesky post was not found");
    return { mode, source_url: url, count: 1, post: value };
  }

  const actor = cleanActor(input.actor);
  if (mode === "posts") {
    const limit = clamp(input.max_results, 1, 100);
    const url = `${API}/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(actor)}&limit=${limit}&filter=posts_no_replies`;
    const data = rec(await getJson(bf, url));
    const posts = arr(data?.feed)
      .map(post)
      .filter((item): item is Post => Boolean(item))
      .slice(0, limit);
    return { mode, source_url: url, count: posts.length, posts };
  }

  const url = `${API}/app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`;
  const value = profile(await getJson(bf, url));
  if (!value) throw new Error("Bluesky profile was not found");
  return { mode, source_url: url, count: 1, profile: value };
});
