import { defineTool } from "@better-fetch/tools";

type Input = {
  handle?: string;
  profile_url?: string;
};

type JsonObject = Record<string, unknown>;

type Output = {
  profile_url: string;
  handle: string;
  display_name: string;
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

export default defineTool<Input, Output>(async (input, bf) => {
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
