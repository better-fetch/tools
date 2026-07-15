import { defineTool } from "@better-fetch/tools";

type Input = {
  username?: string;
  profile_url?: string;
  max_recent_posts?: number;
};

type BioLink = {
  title?: string;
  url?: string;
  link_type?: string;
};

type RecentPost = {
  shortcode: string;
  url: string;
  type?: string;
  caption?: string;
  thumbnail?: string;
  is_video?: boolean;
  taken_at?: string;
  like_count?: number;
  comment_count?: number;
};

type Output = {
  profile_url: string;
  username: string;
  full_name: string;
  user_id?: string;
  biography?: string;
  external_url?: string;
  profile_pic_url?: string;
  category?: string;
  business_category?: string;
  verified?: boolean;
  private_account?: boolean;
  business_account?: boolean;
  professional_account?: boolean;
  follower_count?: number;
  following_count?: number;
  media_count?: number;
  bio_links?: BioLink[];
  recent_posts?: RecentPost[];
};

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.replace(/\s+/g, " ").trim();
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

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function profileUsername(input: Input): string {
  const rawUrl = input.profile_url?.trim();
  if (rawUrl) {
    const match = rawUrl.match(/^https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9._]+)\/?/i);
    if (!match) throw new Error("profile_url must be an Instagram profile URL like https://www.instagram.com/openai/");
    return match[1];
  }

  const username = input.username?.trim().replace(/^@/, "");
  if (!username || !/^[A-Za-z0-9._]{1,64}$/.test(username)) {
    throw new Error("Provide an Instagram username or profile_url");
  }
  return username;
}

function profileUrl(username: string): string {
  return `https://www.instagram.com/${username}/`;
}

function apiUrl(username: string): string {
  return `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
}

function countFromEdge(value: unknown): number | undefined {
  return numberValue(objectValue(value)?.count);
}

function isoFromSeconds(value: unknown): string | undefined {
  const seconds = numberValue(value);
  if (!seconds) return undefined;
  return new Date(seconds * 1000).toISOString();
}

function bioLinks(value: unknown): BioLink[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const links = value
    .map((item) => {
      const obj = objectValue(item);
      if (!obj) return null;
      const link: BioLink = {
        title: text(obj.title),
        url: text(obj.url),
        link_type: text(obj.link_type),
      };
      return compact(link);
    })
    .filter((item): item is BioLink => Boolean(item && (item.url || item.title)));
  return links.length ? links : undefined;
}

function captionFrom(node: Record<string, unknown>): string | undefined {
  const edge = objectValue(node.edge_media_to_caption);
  const edges = edge?.edges;
  if (!Array.isArray(edges)) return undefined;
  const first = objectValue(edges[0]);
  const caption = objectValue(first?.node);
  return text(caption?.text);
}

function recentPosts(value: unknown, limit: number): RecentPost[] | undefined {
  const edges = objectValue(value)?.edges;
  if (!Array.isArray(edges) || limit <= 0) return undefined;
  const posts: RecentPost[] = [];
  for (const edge of edges) {
    if (posts.length >= limit) break;
    const node = objectValue(objectValue(edge)?.node);
    const shortcode = text(node?.shortcode);
    if (!node || !shortcode) continue;
    const post: RecentPost = {
      shortcode,
      url: `https://www.instagram.com/p/${shortcode}/`,
      type: text(node.__typename),
      caption: captionFrom(node),
      thumbnail: text(node.display_url) ?? text(node.thumbnail_src),
      is_video: booleanValue(node.is_video),
      taken_at: isoFromSeconds(node.taken_at_timestamp),
      like_count: countFromEdge(node.edge_liked_by) ?? countFromEdge(node.edge_media_preview_like),
      comment_count: countFromEdge(node.edge_media_to_comment),
    };
    posts.push(compact(post) as RecentPost);
  }
  return posts.length ? posts : undefined;
}

function compact<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined && item !== "" && (!Array.isArray(item) || item.length > 0)) out[key] = item;
  }
  return out as T;
}

export default defineTool<Input, Output>(async (input, bf) => {
  const username = profileUsername(input);
  const url = profileUrl(username);
  const maxRecent = Math.min(input.max_recent_posts ?? 6, 12);
  const page = await bf.fetch({
    url: apiUrl(username),
    strategy: "browser",
    return_response_text: true,
    include_html: true,
    wait_until: "domcontentloaded",
    wait_ms: 1500,
    timeout_ms: 90_000,
    proxy: "auto",
    extra_headers: {
      accept: "*/*",
      "accept-language": "en-US,en;q=0.9",
      referer: url,
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36",
      "x-asbd-id": "129477",
      "x-ig-app-id": "936619743392459",
      "x-requested-with": "XMLHttpRequest",
    },
  });

  let json = page.json;
  const raw = page.body_text || page.html;
  if (!json && raw) {
    try {
      json = JSON.parse(raw);
    } catch {
      /* handled below */
    }
  }

  const data = objectValue(json)?.data;
  const user = objectValue(objectValue(data)?.user);
  if (!user) throw new Error("Instagram profile metadata was not found in the public web response");

  const output: Output = {
    profile_url: url,
    username: text(user.username) ?? username,
    full_name: text(user.full_name) ?? text(user.username) ?? username,
    user_id: text(user.id),
    biography: text(user.biography),
    external_url: text(user.external_url),
    profile_pic_url: text(user.profile_pic_url_hd) ?? text(user.profile_pic_url),
    category: text(user.category_name) ?? text(user.overall_category_name),
    business_category: text(user.business_category_name),
    verified: booleanValue(user.is_verified),
    private_account: booleanValue(user.is_private),
    business_account: booleanValue(user.is_business_account),
    professional_account: booleanValue(user.is_professional_account),
    follower_count: countFromEdge(user.edge_followed_by),
    following_count: countFromEdge(user.edge_follow),
    media_count: countFromEdge(user.edge_owner_to_timeline_media),
    bio_links: bioLinks(user.bio_links),
    recent_posts: recentPosts(user.edge_owner_to_timeline_media, maxRecent),
  };

  return compact(output);
});
