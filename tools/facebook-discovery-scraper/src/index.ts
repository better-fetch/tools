import { defineTool } from "@better-fetch/tools";

type Mode = "profile_photos" | "profile_reels" | "post" | "post_comments" | "comment_replies" | "post_transcript";
type Input = {
  mode: Mode;
  page_url?: string;
  page_slug?: string;
  post_url?: string;
  comment_id?: string;
  language?: string;
  max_results?: number;
};
type IndexedResult = { title: string; url: string; snippet?: string };
type Photo = { photo_url: string; title: string; description?: string; photo_id?: string };
type Post = {
  post_url: string;
  title: string;
  text?: string;
  page_slug?: string;
  post_id?: string;
  media_type?: "post" | "reel";
  owner_name?: string;
  thumbnail_url?: string;
  view_count?: number;
  reaction_count?: number;
};
type Comment = {
  id: string;
  text: string;
  created_at?: string;
  reply_count: number;
  reaction_count: number;
  feedback_id?: string;
  expansion_token?: string;
  url?: string;
  author_id?: string;
  author_name: string;
  author_gender?: string;
  author_profile_picture?: string;
  author_profile_url?: string;
};
type Output = {
  mode: Mode;
  source_url: string;
  page_url?: string;
  count: number;
  photos: Photo[];
  posts: Post[];
  reels: Post[];
  post?: Post;
  comments?: Comment[];
  cursor?: string;
  has_next_page?: boolean;
  total_count?: number;
  parent_comment_id?: string;
  post_id?: string;
  language?: string;
  transcript?: string;
  transcript_not_available?: boolean;
  subtitle_source?: string;
  is_auto_generated?: boolean;
  segments?: Array<{ start: string; end: string; text: string }>;
};

type Obj = Record<string, unknown>;

function objectValue(value: unknown): Obj | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Obj : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function collectObjects(value: unknown): Obj[] {
  const objects: Obj[] = [];
  const stack: unknown[] = [value];
  const seen = new Set<object>();
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    const object = current as Obj;
    objects.push(object);
    stack.push(...Object.values(object));
  }
  return objects;
}

function capturedJson(network: unknown): unknown[] {
  if (!Array.isArray(network)) return [];
  const roots: unknown[] = [];
  for (const rawEntry of network) {
    const entry = objectValue(rawEntry);
    if (!entry || !stringValue(entry.url)?.includes("facebook.com/api/graphql")) continue;
    if (entry.json !== undefined && entry.json !== null) roots.push(entry.json);
    const body = stringValue(entry.body_text);
    if (!body) continue;
    for (const rawLine of body.split(/\n+/)) {
      const line = rawLine.replace(/^for \(;;\);/, "").trim();
      if (!line.startsWith("{")) continue;
      try { roots.push(JSON.parse(line)); } catch { /* ignore non-JSON capture fragments */ }
    }
  }
  return roots;
}

function embeddedJson(html: string): unknown[] {
  const roots: unknown[] = [];
  const scripts = /<script\b[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scripts.exec(html))) {
    const body = decodeEntities(match[1]).trim();
    if (!body.startsWith("{") && !body.startsWith("[")) continue;
    try { roots.push(JSON.parse(body)); } catch { /* ignore unrelated or truncated bootloader data */ }
  }
  return roots;
}

function commentFromObject(object: Obj): Comment | undefined {
  const id = stringValue(object.id);
  const body = objectValue(object.body);
  const text = stringValue(body?.text);
  const author = objectValue(object.author);
  const authorName = stringValue(author?.name);
  if (!id?.startsWith("Y29tbWVudD") || !text || !authorName) return undefined;

  const feedback = objectValue(object.feedback);
  const repliesFields = objectValue(feedback?.replies_fields);
  const repliesConnection = objectValue(feedback?.replies_connection);
  const reactors = objectValue(feedback?.reactors);
  const expansionInfo = objectValue(feedback?.expansion_info);
  const picture = objectValue(author?.profile_picture_depth_0)
    ?? objectValue(author?.profile_picture_depth_0_increased)
    ?? objectValue(author?.profile_picture_depth_1);
  const created = numberValue(object.created_time);

  return {
    id,
    text,
    created_at: created ? new Date(created * 1000).toISOString() : undefined,
    reply_count: numberValue(repliesFields?.total_count ?? repliesFields?.count)
      ?? (Array.isArray(repliesConnection?.edges) ? repliesConnection.edges.length : 0),
    reaction_count: numberValue(reactors?.count_reduced ?? reactors?.count) ?? 0,
    feedback_id: stringValue(feedback?.id),
    expansion_token: stringValue(expansionInfo?.expansion_token),
    url: stringValue(feedback?.url),
    author_id: stringValue(author?.id),
    author_name: authorName,
    author_gender: stringValue(author?.gender),
    author_profile_picture: stringValue(picture?.uri),
    author_profile_url: stringValue(author?.url),
  };
}

function publicComments(network: unknown, html: string, limit: number): {
  comments: Comment[];
  cursor?: string;
  hasNextPage: boolean;
  totalCount?: number;
} {
  const roots = [...capturedJson(network), ...embeddedJson(html)];
  const objects = roots.flatMap(collectObjects);
  const commentsById = new Map<string, Comment>();
  const completeness = (comment: Comment): number => [
    comment.created_at,
    comment.feedback_id,
    comment.expansion_token,
    comment.url,
    comment.author_id,
    comment.author_gender,
    comment.author_profile_picture,
    comment.author_profile_url,
  ].filter(Boolean).length + (comment.reply_count > 0 ? 1 : 0) + (comment.reaction_count > 0 ? 1 : 0);
  for (const object of objects) {
    const comment = commentFromObject(object);
    if (!comment) continue;
    const current = commentsById.get(comment.id);
    if (!current || completeness(comment) > completeness(current)) commentsById.set(comment.id, comment);
  }
  const comments = [...commentsById.values()].slice(0, limit);

  let cursor: string | undefined;
  let hasNextPage = false;
  let totalCount: number | undefined;
  for (const object of objects) {
    const edges = Array.isArray(object.edges) ? object.edges : [];
    const containsComments = edges.some((edge) => {
      const node = objectValue(objectValue(edge)?.node);
      return stringValue(node?.id)?.startsWith("Y29tbWVudD");
    });
    if (!containsComments) continue;
    const pageInfo = objectValue(object.page_info);
    cursor ??= stringValue(pageInfo?.end_cursor);
    hasNextPage ||= pageInfo?.has_next_page === true;
    const candidateTotal = numberValue(object.total_count ?? object.count);
    if (candidateTotal !== undefined) totalCount = Math.max(totalCount ?? 0, candidateTotal);
  }
  return { comments, cursor, hasNextPage, totalCount };
}

function publicReplies(network: unknown, html: string, parentId: string, limit: number): {
  comments: Comment[];
  totalCount?: number;
} {
  const roots = [...capturedJson(network), ...embeddedJson(html)];
  const objects = roots.flatMap(collectObjects);
  const replies = new Map<string, Comment>();
  let totalCount: number | undefined;
  const isParent = (comment: Comment): boolean => {
    if (comment.url?.includes(`comment_id=${parentId}`) && !comment.url.includes("reply_comment_id=")) return true;
    try { return atob(comment.id).endsWith(`_${parentId}`); } catch { return false; }
  };
  for (const object of objects) {
    const parent = commentFromObject(object);
    if (!parent || !isParent(parent)) continue;
    totalCount = Math.max(totalCount ?? 0, parent.reply_count);
    const feedback = objectValue(object.feedback);
    const connection = objectValue(feedback?.replies_connection);
    const edges = Array.isArray(connection?.edges) ? connection.edges : [];
    for (const edge of edges) {
      const reply = commentFromObject(objectValue(objectValue(edge)?.node) ?? {});
      if (reply && !isParent(reply)) replies.set(reply.id, reply);
    }
  }
  for (const object of objects) {
    const reply = commentFromObject(object);
    if (!reply || isParent(reply)) continue;
    if (reply.url?.includes(`comment_id=${parentId}`) && reply.url.includes("reply_comment_id=")) {
      replies.set(reply.id, reply);
    }
  }
  return { comments: [...replies.values()].slice(0, limit), totalCount };
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, number) => String.fromCodePoint(parseInt(number, 16)))
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)));
}

function stripTags(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function parseSrt(value: string): Array<{ start: string; end: string; text: string }> {
  const segments: Array<{ start: string; end: string; text: string }> = [];
  for (const block of value.replace(/\r/g, "").split(/\n{2,}/)) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const timingIndex = lines.findIndex((line) => line.includes(" --> "));
    if (timingIndex < 0) continue;
    const [start, end] = lines[timingIndex].split(/\s+-->\s+/, 2);
    const text = stripTags(lines.slice(timingIndex + 1).join(" ").replace(/\\N/gi, " "));
    if (!start || !end || !text) continue;
    segments.push({ start, end, text });
  }
  return segments;
}

function captionTrack(
  html: string,
  reelId: string,
  requestedLanguage: string,
): { url: string; language: string; autoGenerated?: boolean } | undefined {
  const objects = embeddedJson(html).flatMap(collectObjects);
  const video = objects.find((object) => (
    stringValue(object.id) === reelId
    && stringValue(object.permalink_url)?.includes(`/reel/${reelId}`)
  ));
  if (!video) return undefined;
  const locales = Array.isArray(video.video_available_captions_locales)
    ? video.video_available_captions_locales.map(objectValue).filter(Boolean) as Obj[]
    : [];
  const requested = requestedLanguage.replace("-", "_").toLowerCase();
  const selected = locales.find((track) => stringValue(track.locale)?.toLowerCase() === requested)
    ?? locales.find((track) => stringValue(track.locale)?.toLowerCase().startsWith(`${requested}_`))
    ?? locales.find((track) => stringValue(track.locale)?.toLowerCase().startsWith("en_"))
    ?? locales[0];
  const selectedUrl = stringValue(selected?.captions_url);
  if (selectedUrl) {
    const method = stringValue(selected?.localized_creation_method) ?? "";
    return {
      url: selectedUrl,
      language: stringValue(selected?.locale) ?? requestedLanguage,
      autoGenerated: /auto/i.test(method),
    };
  }
  const direct = stringValue(video.captions_url);
  return direct ? { url: direct, language: requestedLanguage } : undefined;
}

function metaContent(html: string, property: string): string | undefined {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  const tag = tags.find((value) => new RegExp(`property=["']${escaped}["']`, "i").test(value));
  const content = tag?.match(/content=["']([^"']*)["']/i)?.[1];
  return content ? decodeEntities(content).trim() : undefined;
}

function compactNumber(value: string | undefined): number | undefined {
  const match = value?.replace(/,/g, "").match(/([\d.]+)\s*([KMB])?/i);
  if (!match) return undefined;
  const factor = match[2]?.toUpperCase() === "K" ? 1_000 : match[2]?.toUpperCase() === "M" ? 1_000_000 : match[2]?.toUpperCase() === "B" ? 1_000_000_000 : 1;
  return Math.round(Number(match[1]) * factor);
}

function indexedResults(html: string, limit: number): IndexedResult[] {
  const results: IndexedResult[] = [];
  const seen = new Set<string>();
  const links = /<a[^>]+href="(https?:\/\/[^\"]+)"[^>]*>(?:(?!<\/a>).)*?<h3[^>]*>((?:(?!<\/h3>).)*)<\/h3>/gs;
  let match: RegExpExecArray | null;
  while ((match = links.exec(html)) && results.length < limit) {
    let url = decodeEntities(match[1]);
    const redirect = url.match(/[?&]q=(https?[^&]+)/);
    if (redirect) {
      try { url = decodeURIComponent(redirect[1]); } catch { url = redirect[1]; }
    }
    if (!/(^|\.)facebook\.com$/i.test(new URL(url).hostname)) continue;
    const canonical = url.replace(/[?#].*$/, "").replace(/\/$/, "");
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    const tail = html.slice(match.index + match[0].length, match.index + match[0].length + 3500);
    const snippetMatch = tail.match(/<(?:div|span)[^>]*(?:data-sncf|class="[^"]*(?:VwiC3b|IsZvec)[^"]*")[^>]*>((?:(?!<\/(?:div|span)>).)*)/s);
    results.push({
      title: stripTags(match[2]),
      url: canonical,
      snippet: snippetMatch ? stripTags(snippetMatch[1]).slice(0, 1000) : undefined,
    });
  }
  return results;
}

function pageTarget(input: Input): { slug: string; url: string } {
  const raw = (input.page_url ?? input.page_slug ?? "").trim();
  if (!raw) throw new Error("page_url or page_slug is required for profile_photos mode");
  let slug = raw;
  const match = raw.match(/facebook\.com\/([^/?#]+)/i);
  if (match) slug = match[1];
  slug = decodeURIComponent(slug).replace(/^\/+|\/+$/g, "");
  if (!/^[A-Za-z0-9_.-]{2,120}$/.test(slug)) throw new Error("page_url or page_slug must identify a public Facebook Page");
  return { slug, url: `https://www.facebook.com/${slug}` };
}

function postTarget(raw: string | undefined): { kind: "post" | "reel"; slug?: string; id: string; url: string } {
  const value = raw?.trim();
  if (!value) throw new Error("post_url is required for post, post_comments, and post_transcript modes");
  const normalized = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const post = normalized.match(/^https?:\/\/(?:www\.|m\.)?facebook\.com\/([^/?#]+)\/posts\/([^/?#]+)/i);
  if (post) return { kind: "post", slug: post[1], id: post[2], url: `https://www.facebook.com/${post[1]}/posts/${post[2]}` };
  const reel = normalized.match(/^https?:\/\/(?:www\.|m\.)?facebook\.com\/reel\/(\d+)/i);
  if (reel) return { kind: "reel", id: reel[1], url: `https://www.facebook.com/reel/${reel[1]}` };
  throw new Error("post_url must be a public Facebook Page post or reel URL");
}

function photoFrom(result: IndexedResult, slug: string): Photo | undefined {
  const url = new URL(result.url);
  const path = url.pathname.replace(/\/$/, "");
  const escaped = slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = path.match(new RegExp(`^/${escaped}/photos/(?:[^/]+/)?([^/]+)$`, "i"));
  if (!match) return undefined;
  return { photo_url: `https://www.facebook.com${path}`, title: result.title, description: result.snippet, photo_id: match[1] };
}

async function resolveReel(
  url: string,
  bf: Parameters<Parameters<typeof defineTool>[0]>[1],
): Promise<Post | undefined> {
  const target = postTarget(url);
  if (target.kind !== "reel") return undefined;
  const response = await bf.fetch({
    url: target.url,
    strategy: "browser",
    include_html: true,
    wait_until: "domcontentloaded",
    wait_ms: 1500,
    timeout_ms: 90_000,
    proxy: "auto",
  });
  const html = response.html ?? response.body_text ?? "";
  const title = metaContent(html, "og:title");
  const canonical = metaContent(html, "og:url");
  if (!title || !canonical) return undefined;
  const owner = canonical.match(/^https?:\/\/(?:www\.)?facebook\.com\/([^/?#]+)\/videos\//i)?.[1];
  const titleParts = title.split(/\s+\|\s+/);
  const ownerName = titleParts.length >= 3 ? titleParts.at(-1)?.trim() : undefined;
  return {
    post_url: target.url,
    title,
    text: metaContent(html, "og:description"),
    page_slug: owner,
    post_id: target.id,
    media_type: "reel",
    owner_name: ownerName && ownerName !== title ? ownerName : undefined,
    thumbnail_url: metaContent(html, "og:image"),
    view_count: compactNumber(title.match(/([\d,.]+\s*[KMB]?)\s+views?/i)?.[1]),
    reaction_count: compactNumber(title.match(/([\d,.]+\s*[KMB]?)\s+reactions?/i)?.[1]),
  };
}

export default defineTool<Input, Output>(async (input, bf) => {
  if (input.mode === "post_transcript") {
    const target = postTarget(input.post_url);
    if (target.kind !== "reel") throw new Error("post_transcript requires a public Facebook reel URL");
    const language = input.language?.trim().toLowerCase() || "en";
    if (!/^[a-z]{2,3}(?:[-_][a-z]{2})?$/.test(language)) {
      throw new Error("language must be a 2 or 3 letter language code");
    }
    const response = await bf.fetch({
      url: target.url,
      strategy: "browser",
      include_html: true,
      wait_until: "domcontentloaded",
      wait_ms: 2_500,
      timeout_ms: 90_000,
      proxy: "auto",
    });
    if (response.blocked) {
      throw new Error(`Facebook blocked the public transcript request (${response.block_reason ?? "unknown"})`);
    }
    const html = response.html ?? response.body_text ?? "";
    const track = captionTrack(html, target.id, language);
    if (!track) {
      return {
        mode: input.mode,
        source_url: response.final_url ?? target.url,
        count: 0,
        photos: [],
        posts: [],
        reels: [],
        post_id: target.id,
        language,
        transcript_not_available: true,
      };
    }
    const captions = await bf.fetch({
      url: track.url,
      strategy: "http",
      return_response_text: true,
      include_html: false,
      extra_headers: { accept: "application/x-subrip,text/plain", referer: target.url },
    });
    const segments = parseSrt(captions.body_text ?? "");
    if (!segments.length) {
      return {
        mode: input.mode,
        source_url: response.final_url ?? target.url,
        count: 0,
        photos: [],
        posts: [],
        reels: [],
        post_id: target.id,
        language: track.language,
        subtitle_source: track.url,
        transcript_not_available: true,
      };
    }
    return {
      mode: input.mode,
      source_url: response.final_url ?? target.url,
      count: segments.length,
      photos: [],
      posts: [],
      reels: [],
      post_id: target.id,
      language: track.language,
      transcript: segments.map((segment) => segment.text).join(" "),
      transcript_not_available: false,
      subtitle_source: track.url,
      is_auto_generated: track.autoGenerated,
      segments,
    };
  }

  if (input.mode === "post_comments" || input.mode === "comment_replies") {
    const target = postTarget(input.post_url);
    const limit = Math.min(Math.max(input.max_results ?? 10, 1), 20);
    const commentId = input.comment_id?.trim();
    if (input.mode === "comment_replies" && (!commentId || !/^\d{5,30}$/.test(commentId))) {
      throw new Error("comment_id is required for comment_replies mode");
    }
    const sourceUrl = commentId ? `${target.url}?comment_id=${encodeURIComponent(commentId)}` : target.url;
    const response = await bf.fetch({
      url: sourceUrl,
      strategy: "browser",
      include_html: true,
      wait_until: "domcontentloaded",
      wait_ms: 3_000,
      timeout_ms: 90_000,
      proxy: "auto",
      capture_network: true,
      network_resource_types: ["xhr", "fetch"],
      network_include_bodies: true,
      network_max_entries: 80,
      network_max_body_bytes: 1_048_576,
    });
    if (input.mode === "comment_replies") {
      const result = publicReplies(response.network, response.html ?? response.body_text ?? "", commentId as string, limit);
      if (!result.comments.length) throw new Error("Facebook returned no structured public replies for this comment");
      return {
        mode: input.mode,
        source_url: response.final_url ?? sourceUrl,
        count: result.comments.length,
        photos: [],
        posts: [],
        reels: [],
        comments: result.comments,
        parent_comment_id: commentId,
        total_count: result.totalCount,
      };
    }
    const result = publicComments(response.network, response.html ?? response.body_text ?? "", limit);
    if (!result.comments.length) throw new Error("Facebook returned no structured public comments for this post");
    return {
      mode: input.mode,
      source_url: response.final_url ?? target.url,
      count: result.comments.length,
      photos: [],
      posts: [],
      reels: [],
      comments: result.comments,
      cursor: result.cursor,
      has_next_page: result.hasNextPage,
      total_count: result.totalCount,
    };
  }

  if (input.mode === "post") {
    const target = postTarget(input.post_url);
    if (target.kind === "reel") {
      const post = await resolveReel(target.url, bf);
      if (!post) throw new Error("Facebook returned no public reel metadata");
      return { mode: input.mode, source_url: target.url, count: 1, photos: [], posts: [post], reels: [post], post };
    }
    const slug = target.slug as string;
    // Google often suppresses an exact site-path query even when the post is
    // present in the Page's indexed post results, so resolve against that
    // bounded Page corpus and require the same Page plus post identifier below.
    const query = `site:facebook.com/${slug}/posts`;
    const sourceUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=30&hl=en`;
    const response = await bf.fetch({ url: sourceUrl, include_html: true, strategy: "browser", wait_until: "domcontentloaded", wait_ms: 1500, proxy: "auto" });
    const result = indexedResults(response.html ?? "", 30).find((item) => {
      try {
        const candidate = postTarget(item.url);
        return candidate.kind === "post"
          && candidate.slug?.toLowerCase() === slug.toLowerCase()
          && candidate.id === target.id;
      } catch {
        return false;
      }
    });
    if (!result) throw new Error("Google returned no indexed public Facebook post");
    const post: Post = { post_url: target.url, title: result.title, text: result.snippet, page_slug: slug, post_id: target.id, media_type: "post" };
    return { mode: input.mode, source_url: response.final_url ?? sourceUrl, count: 1, photos: [], posts: [post], reels: [], post };
  }

  const target = pageTarget(input);
  const limit = Math.min(Math.max(input.max_results ?? 10, 1), 20);
  if (input.mode === "profile_reels") {
    const boundedLimit = Math.min(limit, 5);
    const query = `site:facebook.com/reel ${target.slug}`;
    const sourceUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${Math.min(boundedLimit + 8, 15)}&hl=en`;
    const response = await bf.fetch({ url: sourceUrl, include_html: true, strategy: "browser", wait_until: "domcontentloaded", wait_ms: 1500, proxy: "auto" });
    const candidates = indexedResults(response.html ?? "", boundedLimit + 8)
      .map((result) => result.url.match(/^https?:\/\/(?:www\.|m\.)?facebook\.com\/reel\/(\d+)/i)?.[1])
      .filter((id): id is string => Boolean(id))
      .map((id) => `https://www.facebook.com/reel/${id}`);
    const resolved = await Promise.all(candidates.map((url) => resolveReel(url, bf)));
    const reels = resolved
      .filter((reel): reel is Post => Boolean(reel))
      .filter((reel) => reel.page_slug?.toLowerCase() === target.slug.toLowerCase())
      .slice(0, boundedLimit);
    if (!reels.length) throw new Error("Facebook returned no owner-verified public Page reels");
    return { mode: input.mode, source_url: response.final_url ?? sourceUrl, page_url: target.url, count: reels.length, photos: [], posts: reels, reels };
  }
  const query = `site:facebook.com/${target.slug}/photos`;
  const sourceUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${Math.min(limit + 10, 30)}&hl=en`;
  const response = await bf.fetch({ url: sourceUrl, include_html: true, strategy: "browser", wait_until: "domcontentloaded", wait_ms: 1500, proxy: "auto" });
  const photos = indexedResults(response.html ?? "", limit * 2)
    .map((result) => photoFrom(result, target.slug))
    .filter((photo): photo is Photo => Boolean(photo))
    .slice(0, limit);
  if (!photos.length) throw new Error("Google returned no indexed public Facebook Page photos");
  return { mode: input.mode, source_url: response.final_url ?? sourceUrl, page_url: target.url, count: photos.length, photos, posts: [], reels: [] };
});
