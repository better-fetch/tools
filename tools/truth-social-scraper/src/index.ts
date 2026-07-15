import { defineTool } from "@better-fetch/tools";

type Input = {
  mode?: "profile" | "posts" | "post";
  handle?: string;
  user_id?: string;
  post_url?: string;
  max_results?: number;
  next_max_id?: string;
};

type Profile = {
  id: string;
  username: string;
  display_name?: string;
  url?: string;
  bio?: string;
  avatar?: string;
  header?: string;
  followers_count?: number;
  following_count?: number;
  statuses_count?: number;
  created_at?: string;
  last_status_at?: string;
  verified?: boolean;
  website?: string;
  locked?: boolean;
  bot?: boolean;
};

type Post = {
  id: string;
  url?: string;
  text?: string;
  content_html?: string;
  created_at?: string;
  language?: string;
  visibility?: string;
  sensitive?: boolean;
  replies_count?: number;
  reblogs_count?: number;
  favourites_count?: number;
  author_id?: string;
  author_username?: string;
  author_name?: string;
  author_avatar?: string;
  media_urls?: string;
  media_types?: string;
};

type Output = {
  mode: "profile" | "posts" | "post";
  source_url: string;
  count: number;
  profile?: Profile;
  posts?: Post[];
  post?: Post;
  next_max_id?: string;
};

type Bf = Parameters<Parameters<typeof defineTool>[0]>[1];

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) ? Math.trunc(number) : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function plainText(value: unknown): string | undefined {
  const html = stringValue(value);
  if (!html) return undefined;
  const clean = decodeEntities(html.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
  return clean || undefined;
}

function normalizeHandle(value: string | undefined): string {
  const raw = value?.trim();
  if (!raw) throw new Error("handle is required for Truth Social profile mode");
  const fromUrl = raw.match(/^https?:\/\/(?:www\.)?truthsocial\.com\/@([^/?#]+)/i)?.[1];
  const handle = (fromUrl ?? raw).replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{2,64}$/.test(handle)) throw new Error("handle must be a Truth Social username or public profile URL");
  return handle;
}

function postIdFrom(value: string | undefined): string {
  const raw = value?.trim();
  if (!raw) throw new Error("post_url is required for post mode");
  const id = raw.match(/(?:^|\/)(\d{12,})(?:[/?#]|$)/)?.[1];
  if (!id) throw new Error("post_url must be a public Truth Social post URL or numeric post id");
  return id;
}

function parseJson(body: string | undefined): unknown {
  if (!body) return undefined;
  const trimmed = body.trim().replace(/^<pre[^>]*>/i, "").replace(/<\/pre>$/i, "");
  try { return JSON.parse(decodeEntities(trimmed)); } catch { return undefined; }
}

async function fetchJson(url: string, bf: Bf): Promise<unknown> {
  const direct = await bf.fetch({
    url,
    strategy: "http",
    return_response_text: true,
    include_html: false,
    extra_headers: { accept: "application/json" },
  });
  const directJson = direct.json ?? parseJson(direct.body_text);
  if (!direct.blocked && directJson) return directJson;

  const browser = await bf.fetch({
    url,
    strategy: "browser",
    return_response_text: true,
    include_html: true,
    wait_until: "domcontentloaded",
    wait_ms: 1500,
    timeout_ms: 90_000,
    extra_headers: { accept: "application/json,text/plain,*/*" },
  });
  const browserJson = browser.json ?? parseJson(browser.body_text) ?? parseJson(browser.html);
  if (browser.blocked || !browserJson) {
    throw new Error(`Truth Social did not return public JSON (${browser.block_reason ?? direct.block_reason ?? "blocked or unavailable"})`);
  }
  return browserJson;
}

async function indexedPostIds(handle: string, limit: number, bf: Bf): Promise<{ sourceUrl: string; ids: string[] }> {
  const query = `site:truthsocial.com/@${handle}/`;
  const sourceUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${Math.min(limit + 5, 20)}&hl=en`;
  const response = await bf.fetch({
    url: sourceUrl,
    include_html: true,
    strategy: "browser",
    wait_until: "domcontentloaded",
    wait_ms: 1500,
    proxy: "auto",
  });
  const html = response.html ?? "";
  const ids: string[] = [];
  const seen = new Set<string>();
  const links = /<a[^>]+href="(https?:\/\/[^\"]+)"[^>]*>(?:(?!<\/a>).)*?<h3[^>]*>((?:(?!<\/h3>).)*)<\/h3>/gs;
  let match: RegExpExecArray | null;
  while ((match = links.exec(html)) && ids.length < limit) {
    let url = decodeEntities(match[1]);
    const redirect = url.match(/[?&]q=(https?[^&]+)/);
    if (redirect) url = decodeURIComponent(redirect[1]);
    const target = url.match(/^https?:\/\/(?:www\.)?truthsocial\.com\/@([^/?#]+)\/(\d{12,})/i);
    if (!target || target[1].toLowerCase() !== handle.toLowerCase() || seen.has(target[2])) continue;
    seen.add(target[2]);
    ids.push(target[2]);
  }
  if (!ids.length) throw new Error("Google returned no indexed public Truth Social posts for this handle");
  return { sourceUrl: response.final_url ?? sourceUrl, ids };
}

function profileFrom(value: unknown): Profile | undefined {
  const account = objectValue(value);
  const id = stringValue(account?.id);
  const username = stringValue(account?.username ?? account?.acct);
  if (!account || !id || !username) return undefined;
  const fields = arrayValue(account.fields).map(objectValue).filter(Boolean) as Record<string, unknown>[];
  const websiteField = fields.find((field) => /website|url/i.test(stringValue(field.name) ?? ""));
  return {
    id,
    username,
    display_name: stringValue(account.display_name),
    url: stringValue(account.url),
    bio: plainText(account.note),
    avatar: stringValue(account.avatar_static ?? account.avatar),
    header: stringValue(account.header_static ?? account.header),
    followers_count: numberValue(account.followers_count),
    following_count: numberValue(account.following_count),
    statuses_count: numberValue(account.statuses_count),
    created_at: stringValue(account.created_at),
    last_status_at: stringValue(account.last_status_at),
    verified: booleanValue(account.verified),
    website: plainText(account.website) ?? plainText(websiteField?.value),
    locked: booleanValue(account.locked),
    bot: booleanValue(account.bot),
  };
}

function postFrom(value: unknown): Post | undefined {
  const status = objectValue(value);
  const id = stringValue(status?.id);
  if (!status || !id) return undefined;
  const media = arrayValue(status.media_attachments).flatMap((item) => {
    const attachment = objectValue(item);
    if (!attachment) return [];
    const url = stringValue(attachment.url);
    if (!url) return [];
    return [{ url, type: stringValue(attachment.type) }];
  });
  const content = stringValue(status.content);
  const fullAccount = profileFrom(status.account);
  return {
    id,
    url: stringValue(status.url ?? status.uri),
    text: plainText(content),
    content_html: content,
    created_at: stringValue(status.created_at),
    language: stringValue(status.language),
    visibility: stringValue(status.visibility),
    sensitive: booleanValue(status.sensitive),
    replies_count: numberValue(status.replies_count),
    reblogs_count: numberValue(status.reblogs_count),
    favourites_count: numberValue(status.favourites_count),
    author_id: fullAccount?.id,
    author_username: fullAccount?.username,
    author_name: fullAccount?.display_name,
    author_avatar: fullAccount?.avatar,
    media_urls: media.map((item) => item.url).join("\n") || undefined,
    media_types: media.map((item) => item.type).filter(Boolean).join(",") || undefined,
  };
}

export default defineTool<Input, Output>(async (input, bf) => {
  const mode = input.mode ?? (input.post_url ? "post" : "profile");
  if (mode === "post") {
    const id = postIdFrom(input.post_url);
    const sourceUrl = `https://truthsocial.com/api/v1/statuses/${id}`;
    const post = postFrom(await fetchJson(sourceUrl, bf));
    if (!post) throw new Error("Truth Social post was not found in the public response");
    return { mode, source_url: sourceUrl, count: 1, post };
  }

  if (input.handle?.trim()) {
    const handle = normalizeHandle(input.handle);
    const maxResults = mode === "profile" ? 1 : Math.min(Math.max(input.max_results ?? 5, 1), 10);
    const indexed = await indexedPostIds(handle, maxResults, bf);
    const posts: Post[] = [];
    let profile: Profile | undefined;
    for (const id of indexed.ids) {
      try {
        const status = await fetchJson(`https://truthsocial.com/api/v1/statuses/${id}`, bf);
        const statusObject = objectValue(status);
        profile ??= profileFrom(statusObject?.account);
        const post = postFrom(status);
        if (post) posts.push(post);
      } catch {
        /* Keep other indexed public posts when one result is removed or blocked. */
      }
      if (mode === "profile" && profile) break;
    }
    if (mode === "profile") {
      if (!profile) throw new Error("Truth Social profile metadata was not found through an indexed public post");
      return { mode, source_url: indexed.sourceUrl, count: 1, profile };
    }
    if (!posts.length) throw new Error("Truth Social returned no retrievable indexed public posts");
    return { mode: "posts", source_url: indexed.sourceUrl, count: posts.length, profile, posts, next_max_id: posts.at(-1)?.id };
  }

  let userId = input.user_id?.trim();
  let profile: Profile | undefined;
  if (!userId) {
    const handle = normalizeHandle(input.handle);
    const profileUrl = `https://truthsocial.com/api/v1/accounts/lookup?acct=${encodeURIComponent(handle)}`;
    profile = profileFrom(await fetchJson(profileUrl, bf));
    if (!profile) throw new Error("Truth Social profile was not found in the public response");
    userId = profile.id;
    if (mode === "profile") return { mode, source_url: profileUrl, count: 1, profile };
  } else if (!/^\d{12,}$/.test(userId)) {
    throw new Error("user_id must be a numeric Truth Social account id");
  }

  if (mode === "profile") throw new Error("handle is required for profile mode");
  const maxResults = Math.min(Math.max(input.max_results ?? 10, 1), 40);
  const params = new URLSearchParams({ limit: String(maxResults), exclude_replies: "true" });
  if (input.next_max_id?.trim()) params.set("max_id", input.next_max_id.trim());
  const sourceUrl = `https://truthsocial.com/api/v1/accounts/${userId}/statuses?${params}`;
  const posts = arrayValue(await fetchJson(sourceUrl, bf)).map(postFrom).filter((post): post is Post => Boolean(post)).slice(0, maxResults);
  if (!posts.length) throw new Error("Truth Social returned no public posts");
  return { mode: "posts", source_url: sourceUrl, count: posts.length, profile, posts, next_max_id: posts.at(-1)?.id };
});
