import { defineTool } from "@better-fetch/tools";

type Mode = "profile" | "user_posts" | "post";
type Input = { mode: Mode; username?: string; post_url?: string; max_results?: number };
type Profile = {
  username: string; display_name: string; url: string; bio?: string; avatar?: string;
  followers_text?: string; following_text?: string; likes_text?: string; verified?: boolean;
};
type Post = {
  post_id: string; username: string; url: string; caption: string; published_at?: string;
  likes?: number; comments?: number; views_text?: string; thumbnail?: string; media_url?: string;
};
type Output = { mode: Mode; source_url: string; count: number; profile?: Profile; posts: Post[] };

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== "")) as T;
}

function decode(value: string): string {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\u002F/g, "/")
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function strip(value: string): string {
  return decode(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function meta(html: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const pattern of [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`, "i"),
  ]) {
    const value = html.match(pattern)?.[1];
    if (value) return decode(value);
  }
  return undefined;
}

function username(raw: string | undefined): string {
  const value = raw?.trim().replace(/^@/, "").replace(/^https?:\/\/(?:www\.)?kwai\.com\/@?/i, "").split(/[/?#]/)[0];
  if (!value || !/^[A-Za-z0-9._-]{2,64}$/.test(value)) throw new Error("username must be a public Kwai username or profile URL");
  return value;
}

function postTarget(raw: string | undefined): { username: string; id: string; url: string } {
  const value = raw?.trim() ?? "";
  const match = value.match(/kwai\.com\/@([^/?#]+)\/video\/(\d+)/i);
  if (!match) throw new Error("post_url must be a public Kwai /@creator/video/{id} URL");
  return { username: match[1], id: match[2], url: `https://www.kwai.com/@${match[1]}/video/${match[2]}` };
}

function parseCompactCount(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = value.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*([KMB])?/i);
  if (!match) return undefined;
  const multiplier = match[2]?.toUpperCase() === "B" ? 1e9 : match[2]?.toUpperCase() === "M" ? 1e6 : match[2]?.toUpperCase() === "K" ? 1e3 : 1;
  return Math.round(Number(match[1]) * multiplier);
}

function profileFrom(html: string, handle: string): Profile {
  const title = meta(html, "og:title")?.replace(/\s*\(@.*$/, "").trim() ?? handle;
  const header = html.match(/<div[^>]+class=["']header["'][^>]*data-v-036bed4c[\s\S]*?<div[^>]+class=["']right["']/i)?.[0] ?? "";
  const info = strip(header);
  const stats = info.match(/([\d.]+[KMB]?)\s+Followers\s*\|\s*([\d.]+[KMB]?)\s+Following\s*\|\s*([\d.]+[KMB]?)\s+Likes/i);
  const bio = strip(header.match(/<div[^>]+class=["']user-text["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "");
  const avatar = header.match(/<img[^>]+class=["']avatar["'][^>]+src=["']([^"']+)/i)?.[1];
  return compact({
    username: handle,
    display_name: title,
    url: `https://www.kwai.com/@${handle}`,
    bio,
    avatar: avatar ? decode(avatar).replace(/^http:/, "https:") : meta(html, "og:image"),
    followers_text: stats?.[1],
    following_text: stats?.[2],
    likes_text: stats?.[3],
    verified: /yellow\.png|verified/i.test(header) ? true : undefined,
  });
}

function uniqueIds(html: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/photo_id_str:["'](\d+)["']/g)) {
    if (!seen.has(match[1])) { seen.add(match[1]); ids.push(match[1]); }
  }
  return ids;
}

function listPosts(html: string, handle: string, limit: number): Post[] {
  const ids = uniqueIds(html);
  const starts = [...html.matchAll(/<div[^>]+class=["']video-content["'][^>]*>/gi)].map((match) => match.index!);
  const posts: Post[] = [];
  for (let index = 0; index < Math.min(ids.length, starts.length, limit); index++) {
    const segment = html.slice(starts[index], starts[index + 1] ?? Math.min(starts[index] + 25_000, html.length));
    const caption = strip(segment.match(/class=["']content-convert text["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? "");
    const views = strip(segment.match(/class=["']num["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? "");
    const thumbnail = segment.match(/(?:data-src|src)=["'](https?:\/\/[^"']+\.(?:webp|jpg|jpeg|png)[^"']*)/i)?.[1];
    const media = segment.match(/<video[^>]+src=["'](https?:\/\/[^"']+)/i)?.[1];
    posts.push(compact({
      post_id: ids[index], username: handle, url: `https://www.kwai.com/@${handle}/video/${ids[index]}`,
      caption: caption || "Kwai video", views_text: views || undefined,
      thumbnail: thumbnail ? decode(thumbnail) : undefined, media_url: media ? decode(media) : undefined,
    }));
  }
  return posts;
}

function detailPost(html: string, target: { username: string; id: string; url: string }): Post {
  const caption = meta(html, "og:title") ?? "Kwai video";
  const description = meta(html, "og:description") ?? "";
  const likes = description.match(/([\d,.]+)\s+Like/i)?.[1];
  const comments = description.match(/([\d,.]+)\s+Comment/i)?.[1];
  const idIndex = html.indexOf(`photo_id_str:\"${target.id}\"`);
  const nearby = idIndex >= 0 ? html.slice(idIndex, idIndex + 80_000) : html;
  const timestampMs = nearby.match(/timestamp:(\d{13})/)?.[1];
  const media = nearby.match(/main_mv_urls:\[\{[^}]*url:["']([^"']+)/)?.[1];
  return compact({
    post_id: target.id, username: target.username, url: target.url, caption,
    published_at: timestampMs ? new Date(Number(timestampMs)).toISOString() : undefined,
    likes: likes ? Number(likes.replace(/,/g, "")) : undefined,
    comments: comments ? Number(comments.replace(/,/g, "")) : undefined,
    thumbnail: meta(html, "og:image"), media_url: media ? decode(media) : undefined,
  });
}

export default defineTool<Input, Output>(async (input, bf) => {
  const limit = Math.min(Math.max(input.max_results ?? 10, 1), 25);
  const target = input.mode === "post" ? postTarget(input.post_url) : undefined;
  const handle = target?.username ?? username(input.username);
  const sourceUrl = target?.url ?? `https://www.kwai.com/@${handle}`;
  const response = await bf.fetch(input.mode === "user_posts" ? {
    url: sourceUrl,
    strategy: "browser",
    json_mode: false,
    wait_until: "domcontentloaded",
    wait_ms: 5000,
    timeout_ms: 60000,
    include_html: true,
    locale: "en-US",
  } : {
    url: sourceUrl,
    strategy: "http",
    return_response_text: true,
    include_html: true,
    extra_headers: { "user-agent": "Mozilla/5.0", "accept-language": "en-US,en;q=0.9" },
  });
  if (response.blocked) throw new Error(`Kwai blocked the request (${response.block_reason ?? "unknown"})`);
  const raw = response.body_text ?? "";
  const html = input.mode === "user_posts" ? response.html ?? raw : raw.includes("window.__NUXT__") ? raw : response.html ?? raw;
  const profile = input.mode === "profile" ? profileFrom(html, handle) : undefined;
  const posts = input.mode === "user_posts" ? listPosts(html, handle, limit) : target ? [detailPost(html, target)] : [];
  const count = profile ? 1 : posts.length;
  if (!count) throw new Error(`Kwai returned no public data for ${input.mode}`);
  return compact({ mode: input.mode, source_url: response.final_url ?? sourceUrl, count, profile, posts });
});
