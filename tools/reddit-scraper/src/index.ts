import { defineTool } from "@better-fetch/tools";

type Mode = "subreddit_details" | "posts" | "search" | "comments" | "transcript";

type Input = {
  mode?: Mode;
  subreddit?: string;
  query?: string;
  sort?: string;
  time?: string;
  post_url?: string;
  max_results?: number;
  max_comments?: number;
  language?: string;
};

type Post = {
  id: string;
  title: string;
  author?: string;
  subreddit?: string;
  score?: number;
  upvote_ratio?: number;
  num_comments?: number;
  created_utc?: number;
  permalink?: string;
  url?: string;
  domain?: string;
  flair?: string;
  over_18?: boolean;
  is_self?: boolean;
  selftext?: string;
};

type Comment = {
  id?: string;
  author?: string;
  body: string;
  score?: number;
  created_utc?: number;
  depth?: number;
  is_submitter?: boolean;
  permalink?: string;
};

type SubredditDetails = {
  id?: string;
  name: string;
  title?: string;
  description?: string;
  public_description?: string;
  subscribers?: number;
  active_users?: number;
  created_utc?: number;
  over_18?: boolean;
  url?: string;
  icon?: string;
  banner?: string;
  language?: string;
};

type Output = {
  mode: Mode;
  subreddit?: string;
  query?: string;
  source_url: string;
  count: number;
  details?: SubredditDetails;
  posts?: Post[];
  post?: Post;
  comments?: Comment[];
  post_id?: string;
  video_id?: string;
  caption_url?: string;
  language?: string;
  raw_vtt?: string;
  transcript?: string;
  transcript_not_available?: boolean;
};

const BASE = "https://www.reddit.com";

const POST_SORTS = new Set(["hot", "new", "top", "rising"]);
const SEARCH_SORTS = new Set(["relevance", "hot", "top", "new", "comments"]);
const TIMES = new Set(["hour", "day", "week", "month", "year", "all"]);

function rec(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
const asStr = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;
const asNum = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
const asBool = (v: unknown): boolean | undefined =>
  typeof v === "boolean" ? v : undefined;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'");
}

function truncate(s: string | undefined, max: number): string | undefined {
  if (!s) return undefined;
  const clean = decodeEntities(s).trim();
  if (!clean) return undefined;
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function compact<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== "") out[key] = value;
  }
  return out as T;
}

function cleanSubreddit(raw: string): string {
  const s = raw.trim();
  const fromUrl = s.match(/reddit\.com\/r\/([^/?#]+)/i);
  if (fromUrl) return fromUrl[1];
  return s.replace(/^\/?r\//i, "").replace(/^\/+|\/+$/g, "");
}

function postsUrl(sub: string, sort: string, time: string | undefined, limit: number): string {
  const s = POST_SORTS.has(sort) ? sort : "hot";
  let url = `${BASE}/r/${encodeURIComponent(sub)}/${s}.json?limit=${limit}&raw_json=1`;
  if (s === "top" && time && TIMES.has(time)) url += `&t=${time}`;
  return url;
}

function detailsUrl(sub: string): string {
  return `${BASE}/r/${encodeURIComponent(sub)}/about.json?raw_json=1`;
}

function searchUrl(
  query: string,
  sub: string | undefined,
  sort: string,
  time: string | undefined,
  limit: number,
): string {
  const s = SEARCH_SORTS.has(sort) ? sort : "relevance";
  const q = encodeURIComponent(query);
  let url = sub
    ? `${BASE}/r/${encodeURIComponent(sub)}/search.json?q=${q}&restrict_sr=1&sort=${s}&limit=${limit}&raw_json=1`
    : `${BASE}/search.json?q=${q}&sort=${s}&limit=${limit}&raw_json=1`;
  if (s === "top") url += `&t=${time && TIMES.has(time) ? time : "all"}`;
  return url;
}

function commentsUrl(postUrl: string, limit: number): string {
  let path = postUrl.trim();
  if (/^https?:\/\//i.test(path)) {
    const m = path.match(/reddit\.com(\/[^?#]*)/i);
    path = m ? m[1] : path.replace(/^https?:\/\/redd\.it\//i, "/comments/");
  } else if (!path.startsWith("/")) {
    path = `/comments/${path}`;
  }
  path = path.replace(/\/+$/, "");
  return `${BASE}${path}.json?limit=${limit}&raw_json=1`;
}

async function getJson(bf: Parameters<Parameters<typeof defineTool>[0]>[1], url: string): Promise<unknown> {
  // json_mode issues an in-page fetch() from Reddit's origin. Without a
  // same-origin Referer, Reddit's CORS policy rejects the call outright
  // ("TypeError: Failed to fetch") before the engine can classify it as a
  // block — so proxy:"auto" never escalates. With the Referer the request
  // goes through; datacenter IPs still get a plain http_403, which the
  // engine's block-retry then escalates to residential egress automatically.
  const r = await bf.fetch({
    url,
    json_mode: true,
    proxy: "auto",
    extra_headers: {
      accept: "application/json",
      referer: `${BASE}/`,
    },
  });
  if (r.json != null) return r.json;
  const text = r.body_text ?? "";
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      "Reddit did not return JSON — the request was likely rate-limited or blocked. Try again shortly.",
    );
  }
}

function normPost(child: unknown): Post | null {
  const d = rec(rec(child)?.data);
  if (!d) return null;
  const id = asStr(d.id);
  const title = asStr(d.title);
  if (!id || !title) return null;
  const permalink = asStr(d.permalink);
  return compact({
    id,
    title: decodeEntities(title),
    author: asStr(d.author),
    subreddit: asStr(d.subreddit),
    score: asNum(d.score),
    upvote_ratio: asNum(d.upvote_ratio),
    num_comments: asNum(d.num_comments),
    created_utc: asNum(d.created_utc),
    permalink: permalink ? `${BASE}${permalink}` : undefined,
    url: asStr(d.url),
    domain: asStr(d.domain),
    flair: asStr(d.link_flair_text),
    over_18: asBool(d.over_18),
    is_self: asBool(d.is_self),
    selftext: truncate(asStr(d.selftext), 600),
  }) as Post;
}

function listingChildren(listing: unknown): unknown[] {
  return arr(rec(rec(listing)?.data)?.children);
}

function normSubredditDetails(json: unknown, fallbackName: string): SubredditDetails {
  const data = rec(rec(json)?.data);
  if (!data) throw new Error("Reddit did not return subreddit details");
  const name = asStr(data.display_name) ?? fallbackName;
  const url = asStr(data.url);
  return compact({
    id: asStr(data.id),
    name,
    title: asStr(data.title),
    description: truncate(asStr(data.description), 5000),
    public_description: truncate(asStr(data.public_description), 2000),
    subscribers: asNum(data.subscribers),
    active_users: asNum(data.accounts_active),
    created_utc: asNum(data.created_utc),
    over_18: asBool(data.over18),
    url: url ? `${BASE}${url}` : `${BASE}/r/${name}/`,
    icon: asStr(data.community_icon) ?? asStr(data.icon_img),
    banner: asStr(data.banner_background_image) ?? asStr(data.banner_img),
    language: asStr(data.lang),
  }) as SubredditDetails;
}

function flattenComments(listing: unknown, max: number): Comment[] {
  const out: Comment[] = [];
  const walk = (children: unknown[], depth: number): void => {
    for (const child of children) {
      if (out.length >= max) return;
      const node = rec(child);
      if (asStr(node?.kind) !== "t1") continue;
      const d = rec(node?.data);
      if (!d) continue;
      const body = truncate(asStr(d.body), 1200);
      if (body) {
        const permalink = asStr(d.permalink);
        out.push(
          compact({
            id: asStr(d.id),
            author: asStr(d.author),
            body,
            score: asNum(d.score),
            created_utc: asNum(d.created_utc),
            depth,
            is_submitter: asBool(d.is_submitter),
            permalink: permalink ? `${BASE}${permalink}` : undefined,
          }) as Comment,
        );
      }
      const replies = rec(d.replies);
      if (replies) walk(listingChildren(replies), depth + 1);
    }
  };
  walk(listingChildren(listing), 0);
  return out;
}

function vttTranscript(vtt: string): string {
  const cues = vtt.replace(/^WEBVTT[^\n]*\n/i, "").split(/\n\s*\n/).flatMap((block) => {
    const lines = block.split(/\r?\n/).filter((line) => line.trim());
    const timing = lines.findIndex((line) => /-->/.test(line));
    if (timing < 0) return [];
    const value = decodeEntities(lines.slice(timing + 1).join(" ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    return value ? [value] : [];
  });
  const words: string[] = [];
  for (const cue of cues) {
    const incoming = cue.split(/\s+/).filter(Boolean);
    let overlap = Math.min(words.length, incoming.length);
    while (overlap > 0) {
      const tail = words.slice(-overlap).join(" ").toLowerCase();
      const head = incoming.slice(0, overlap).join(" ").toLowerCase();
      if (tail === head) break;
      overlap--;
    }
    words.push(...incoming.slice(overlap));
  }
  return words.join(" ").trim();
}

function postId(raw: string): string | undefined {
  return raw.match(/\/comments\/([A-Za-z0-9]+)/i)?.[1]
    ?? (!/[/.]/.test(raw.trim()) && /^[A-Za-z0-9]+$/.test(raw.trim()) ? raw.trim() : undefined);
}

export default defineTool<Input, Output>(async (input, bf) => {
  const mode: Mode =
    input.mode ?? (input.post_url ? "comments" : input.query ? "search" : "posts");

  if (mode === "subreddit_details") {
    const sub = input.subreddit ? cleanSubreddit(input.subreddit) : undefined;
    if (!sub) throw new Error("subreddit is required for subreddit_details mode");
    const url = detailsUrl(sub);
    const json = await getJson(bf, url);
    return {
      mode,
      subreddit: sub,
      source_url: url,
      count: 1,
      details: normSubredditDetails(json, sub),
    };
  }

  if (mode === "comments") {
    if (!input.post_url?.trim()) throw new Error("post_url is required for comments mode");
    const limit = clamp(input.max_comments ?? 20, 1, 100);
    const url = commentsUrl(input.post_url, limit);
    const json = await getJson(bf, url);
    const parts = arr(json);
    const post = normPost(listingChildren(parts[0])[0]);
    const comments = flattenComments(parts[1], limit);
    return compact({
      mode,
      source_url: url,
      count: comments.length,
      post: post ?? undefined,
      comments,
    }) as Output;
  }

  if (mode === "transcript") {
    const raw = input.post_url?.trim();
    if (!raw) throw new Error("post_url is required for transcript mode");
    const language = input.language?.trim().toLowerCase() || "en";
    if (!/^[a-z]{2,3}(?:-[a-z]{2})?$/.test(language)) throw new Error("language must be a 2 or 3 letter language code");
    let videoId = raw.match(/v\.redd\.it\/([A-Za-z0-9]+)/i)?.[1];
    const id = postId(raw);
    let sourceUrl = raw;
    if (!videoId) {
      const url = commentsUrl(raw, 1);
      const json = await getJson(bf, url);
      const data = rec(rec(listingChildren(arr(json)[0])[0])?.data);
      const media = rec(data?.secure_media) ?? rec(data?.media);
      const redditVideo = rec(media?.reddit_video);
      const fallback = asStr(redditVideo?.fallback_url) ?? asStr(redditVideo?.hls_url) ?? asStr(data?.url);
      videoId = fallback?.match(/v\.redd\.it\/([A-Za-z0-9]+)/i)?.[1];
      sourceUrl = asStr(data?.permalink) ? `${BASE}${asStr(data?.permalink)}` : raw;
    }
    if (!videoId) {
      return { mode, source_url: sourceUrl, count: 0, post_id: id, language, transcript_not_available: true };
    }
    const captionUrl = `https://v.redd.it/${videoId}/wh_ben_${encodeURIComponent(language)}.vtt`;
    const response = await bf.fetch({
      url: captionUrl,
      strategy: "http",
      return_response_text: true,
      include_html: false,
      proxy: "auto",
      extra_headers: { accept: "text/vtt,text/plain", referer: `${BASE}/` },
    });
    const rawVtt = response.body_text?.trim();
    if (!rawVtt || !/^WEBVTT/i.test(rawVtt)) {
      return { mode, source_url: sourceUrl, count: 0, post_id: id, video_id: videoId, caption_url: captionUrl, language, transcript_not_available: true };
    }
    const transcript = vttTranscript(rawVtt);
    return {
      mode,
      source_url: sourceUrl,
      count: transcript ? 1 : 0,
      post_id: id,
      video_id: videoId,
      caption_url: captionUrl,
      language,
      raw_vtt: rawVtt,
      transcript,
      transcript_not_available: !transcript,
    };
  }

  const sub = input.subreddit ? cleanSubreddit(input.subreddit) : undefined;
  const limit = clamp(input.max_results ?? 10, 1, 100);

  let url: string;
  if (mode === "search") {
    const query = input.query?.trim();
    if (!query) throw new Error("query is required for search mode");
    url = searchUrl(query, sub, input.sort ?? "relevance", input.time, limit);
  } else {
    if (!sub) throw new Error("subreddit is required for posts mode");
    url = postsUrl(sub, input.sort ?? "hot", input.time, limit);
  }

  const json = await getJson(bf, url);
  const posts = listingChildren(json)
    .map(normPost)
    .filter((p): p is Post => p !== null)
    .slice(0, limit);

  return compact({
    mode,
    subreddit: sub,
    query: input.query?.trim(),
    source_url: url,
    count: posts.length,
    posts,
  }) as Output;
});
