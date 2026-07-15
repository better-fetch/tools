import { defineTool } from "@better-fetch/tools";

type Mode = "profile" | "user_videos" | "user_schedule" | "clip";
type Input = { mode: Mode; handle?: string; clip_url?: string; max_results?: number };
type Obj = Record<string, unknown>;

type Profile = {
  id?: string;
  login: string;
  display_name: string;
  url: string;
  description?: string;
  avatar?: string;
  followers_text?: string;
  is_live?: boolean;
};
type Video = {
  video_id: string;
  title: string;
  url: string;
  published_at?: string;
  duration_seconds?: number;
  views?: number;
  thumbnail?: string;
};
type ScheduleItem = { id?: string; title: string; starts_at: string; ends_at?: string; category?: string };
type Clip = {
  slug: string;
  title: string;
  url: string;
  broadcaster?: string;
  creator?: string;
  created_at?: string;
  duration_seconds?: number;
  views?: number;
  thumbnail?: string;
};
type Output = {
  mode: Mode;
  source_url: string;
  count: number;
  profile?: Profile;
  videos: Video[];
  schedule: ScheduleItem[];
  clip?: Clip;
};

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== "")) as T;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nestedString(object: Obj, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = str(object[key]);
    if (value) return value;
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
      for (const item of current) stack.push(item);
      continue;
    }
    const object = current as Obj;
    objects.push(object);
    for (const item of Object.values(object)) stack.push(item);
  }
  return objects;
}

function networkObjects(network: unknown): Obj[] {
  if (!Array.isArray(network)) return [];
  const roots: unknown[] = [];
  for (const entry of network) {
    if (!entry || typeof entry !== "object") continue;
    const object = entry as Obj;
    if (object.json !== undefined && object.json !== null) roots.push(object.json);
    else if (typeof object.body_text === "string") {
      try { roots.push(JSON.parse(object.body_text)); } catch { /* not JSON */ }
    }
  }
  return roots.flatMap(collectObjects);
}

function decode(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function meta(html: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern)?.[1];
    if (match) return decode(match);
  }
  return undefined;
}

function cleanHandle(raw: string | undefined): string {
  const handle = raw?.trim().replace(/^@/, "").replace(/^https?:\/\/(?:www\.)?twitch\.tv\//i, "").split(/[/?#]/)[0];
  if (!handle || !/^[A-Za-z0-9_]{3,25}$/.test(handle)) throw new Error("handle must be a public Twitch username or channel URL");
  return handle.toLowerCase();
}

function clipSlug(raw: string | undefined): string {
  const value = raw?.trim() ?? "";
  const slug = value.match(/(?:clips\.twitch\.tv\/|\/clip\/)([A-Za-z0-9_-]+)/i)?.[1] ?? (/^[A-Za-z0-9_-]+$/.test(value) ? value : undefined);
  if (!slug) throw new Error("clip_url must be a public Twitch clip URL or slug");
  return slug;
}

function imageFrom(object: Obj): string | undefined {
  return nestedString(object, ["profileImageURL", "profileImageUrl", "thumbnailURL", "thumbnailUrl", "previewThumbnailURL", "previewThumbnailUrl"]);
}

function profileFrom(objects: Obj[], handle: string, html: string, body: string): Profile {
  const object = objects.find((item) => str(item.login)?.toLowerCase() === handle && (str(item.displayName) || str(item.description)));
  const displayName = str(object?.displayName) ?? meta(html, "og:title")?.replace(/\s+-\s+Twitch$/, "") ?? handle;
  const followers = body.match(/([\d,.]+\s*[KMB]?)\s+followers/i)?.[0];
  return compact({
    id: str(object?.id),
    login: handle,
    display_name: displayName,
    url: `https://www.twitch.tv/${handle}`,
    description: str(object?.description) ?? meta(html, "description") ?? meta(html, "og:description"),
    avatar: imageFrom(object ?? {}) ?? meta(html, "og:image"),
    followers_text: followers,
    is_live: object?.stream !== null && typeof object?.stream === "object" ? true : undefined,
  });
}

function videosFrom(objects: Obj[], limit: number): Video[] {
  const videos: Video[] = [];
  const seen = new Set<string>();
  for (const object of objects) {
    const id = str(object.id);
    const title = str(object.title);
    const published = nestedString(object, ["publishedAt", "createdAt", "recordedAt"]);
    const thumbnail = imageFrom(object);
    if (!id || !/^\d{5,}$/.test(id) || !title || (!published && !thumbnail)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    videos.push(compact({
      video_id: id,
      title,
      url: `https://www.twitch.tv/videos/${id}`,
      published_at: published,
      duration_seconds: num(object.lengthSeconds) ?? num(object.durationSeconds),
      views: num(object.viewCount) ?? num(object.views),
      thumbnail,
    }));
    if (videos.length >= limit) break;
  }
  return videos;
}

function scheduleFrom(objects: Obj[], limit: number): ScheduleItem[] {
  const items: ScheduleItem[] = [];
  const seen = new Set<string>();
  for (const object of objects) {
    const startsAt = nestedString(object, ["startAt", "startsAt", "startTime"]);
    const title = str(object.title);
    if (!startsAt || !title) continue;
    const key = `${startsAt}:${title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const categoryObject = object.category && typeof object.category === "object" ? object.category as Obj : undefined;
    items.push(compact({
      id: str(object.id),
      title,
      starts_at: startsAt,
      ends_at: nestedString(object, ["endAt", "endsAt", "endTime"]),
      category: str(categoryObject?.name),
    }));
    if (items.length >= limit) break;
  }
  return items;
}

function clipFrom(objects: Obj[], slug: string): Clip | undefined {
  const object = objects.find((item) => str(item.slug)?.toLowerCase() === slug.toLowerCase() && str(item.title));
  if (!object) return undefined;
  const broadcaster = object.broadcaster && typeof object.broadcaster === "object" ? object.broadcaster as Obj : undefined;
  const curator = object.curator && typeof object.curator === "object" ? object.curator as Obj : undefined;
  return compact({
    slug,
    title: str(object.title)!,
    url: `https://clips.twitch.tv/${slug}`,
    broadcaster: str(broadcaster?.displayName) ?? str(broadcaster?.login),
    creator: str(curator?.displayName) ?? str(curator?.login),
    created_at: nestedString(object, ["createdAt", "publishedAt"]),
    duration_seconds: num(object.durationSeconds) ?? num(object.duration),
    views: num(object.viewCount) ?? num(object.views),
    thumbnail: imageFrom(object),
  });
}

export default defineTool<Input, Output>(async (input, bf) => {
  const limit = Math.min(Math.max(input.max_results ?? 10, 1), 25);
  const handle = input.mode === "clip" ? undefined : cleanHandle(input.handle);
  const slug = input.mode === "clip" ? clipSlug(input.clip_url) : undefined;
  const sourceUrl = input.mode === "profile" ? `https://www.twitch.tv/${handle}`
    : input.mode === "user_videos" ? `https://www.twitch.tv/${handle}/videos?filter=all&sort=time`
      : input.mode === "user_schedule" ? `https://www.twitch.tv/${handle}/schedule`
        : `https://clips.twitch.tv/${slug}`;

  const page = await bf.fetch({
    url: sourceUrl,
    strategy: "browser",
    json_mode: false,
    wait_until: "domcontentloaded",
    wait_ms: 7000,
    timeout_ms: 60000,
    return_response_text: true,
    include_html: true,
    capture_network: true,
    network_resource_types: ["xhr", "fetch"],
    network_include_bodies: true,
    network_max_entries: 120,
    network_max_body_bytes: 1048576,
    locale: "en-US",
  });
  if (page.blocked) throw new Error(`Twitch blocked the request (${page.block_reason ?? "unknown"})`);
  const html = page.html ?? "";
  const body = page.body_text ?? "";
  const objects = networkObjects(page.network);
  const profile = input.mode === "profile" ? profileFrom(objects, handle!, html, body) : undefined;
  const videos = input.mode === "user_videos" ? videosFrom(objects, limit) : [];
  const schedule = input.mode === "user_schedule" ? scheduleFrom(objects, limit) : [];
  const clip = input.mode === "clip" ? clipFrom(objects, slug!) : undefined;
  const count = profile || clip ? 1 : input.mode === "user_videos" ? videos.length : schedule.length;
  if (!count) throw new Error(`Twitch returned no public data for ${input.mode}`);
  return compact({ mode: input.mode, source_url: page.final_url ?? sourceUrl, count, profile, videos, schedule, clip });
});
