import { defineTool } from "@better-fetch/tools";

type Input = { url: string };

type Party = {
  id?: number;
  username?: string;
  slug?: string;
  profile_picture?: string;
};

type Category = {
  id?: number;
  name?: string;
  slug?: string;
  banner?: string;
  parent_category?: string;
};

type Output = {
  id: string;
  url: string;
  title?: string;
  video_url?: string;
  thumbnail_url?: string;
  view_count?: number;
  likes_count?: number;
  duration?: number;
  privacy?: string;
  is_mature?: boolean;
  started_at?: string;
  created_at?: string;
  category?: Category;
  creator?: Party;
  channel?: Party;
};

function clipId(value: string): { id: string; url: string } {
  const raw = value.trim();
  const direct = raw.match(/^clip_[A-Za-z0-9]+$/)?.[0];
  if (direct) return { id: direct, url: `https://kick.com/clips/${direct}` };
  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new Error("url must be a Kick clip URL or clip id");
  }
  if (!/(^|\.)kick\.com$/i.test(parsed.hostname)) throw new Error("url must be on kick.com");
  const id = parsed.pathname.match(/\/(clip_[A-Za-z0-9]+)(?:\/|$)/)?.[1];
  if (!id) throw new Error("url must contain a Kick clip id");
  return { id, url: parsed.toString() };
}

function bodyFrom(response: { body_text?: string; html?: string }): string {
  return response.body_text ?? response.html ?? "";
}

function parseJson(body: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    return parsed;
  } catch {
    return undefined;
  }
}

function numberValue(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function party(value: unknown): Party | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  const output: Party = {
    id: numberValue(item.id),
    username: typeof item.username === "string" ? item.username : undefined,
    slug: typeof item.slug === "string" ? item.slug : undefined,
    profile_picture: typeof item.profile_picture === "string" ? item.profile_picture : undefined,
  };
  return Object.values(output).some((entry) => entry !== undefined) ? output : undefined;
}

function category(value: unknown): Category | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  const output: Category = {
    id: numberValue(item.id),
    name: typeof item.name === "string" ? item.name : undefined,
    slug: typeof item.slug === "string" ? item.slug : undefined,
    banner: typeof item.banner === "string" ? item.banner : typeof item.responsive === "string" ? item.responsive : undefined,
    parent_category: typeof item.parent_category === "string" ? item.parent_category : undefined,
  };
  return Object.values(output).some((entry) => entry !== undefined) ? output : undefined;
}

export default defineTool<Input, Output>(async (input, bf) => {
  const clip = clipId(input.url);
  const apiUrl = `https://kick.com/api/v2/clips/${clip.id}`;
  const request = {
    url: apiUrl,
    return_response_text: true,
    include_html: true,
    extra_headers: {
      accept: "application/json",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/136.0.0.0 Safari/537.36",
    },
  } as const;
  let response = await bf.fetch({ ...request, strategy: "auto" });
  let parsed = parseJson(bodyFrom(response));
  if (!parsed?.clip) {
    response = await bf.fetch({ ...request, strategy: "browser", wait_until: "domcontentloaded", wait_ms: 1000 });
    parsed = parseJson(bodyFrom(response));
  }
  if (!parsed?.clip || typeof parsed.clip !== "object") {
    throw new Error(`Kick clip API did not return public clip data${response.status ? ` (HTTP ${response.status})` : ""}`);
  }
  const item = parsed.clip as Record<string, unknown>;
  return {
    id: typeof item.id === "string" ? item.id : clip.id,
    url: clip.url,
    title: typeof item.title === "string" ? item.title : undefined,
    video_url: typeof item.video_url === "string" ? item.video_url : typeof item.clip_url === "string" ? item.clip_url : undefined,
    thumbnail_url: typeof item.thumbnail_url === "string" ? item.thumbnail_url : undefined,
    view_count: numberValue(item.view_count ?? item.views),
    likes_count: numberValue(item.likes_count ?? item.likes),
    duration: numberValue(item.duration),
    privacy: typeof item.privacy === "string" ? item.privacy : undefined,
    is_mature: typeof item.is_mature === "boolean" ? item.is_mature : undefined,
    started_at: typeof item.started_at === "string" ? item.started_at : undefined,
    created_at: typeof item.created_at === "string" ? item.created_at : undefined,
    category: category(item.category),
    creator: party(item.creator),
    channel: party(item.channel),
  };
});
