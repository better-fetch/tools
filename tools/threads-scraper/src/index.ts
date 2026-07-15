import { defineTool } from "@better-fetch/tools";

type Mode = "profile" | "user_posts" | "post" | "search" | "search_users";
type Input = { mode: Mode; username?: string; post_url?: string; query?: string; max_results?: number };
type Profile = { username: string; display_name: string; url: string; bio?: string; followers_text?: string; thread_count?: number; avatar?: string };
type Post = { code: string; username: string; url: string; text?: string; published_at?: string; image?: string };
type User = { username: string; full_name?: string; profile_url: string; matched_from: "profile" | "post" };
type Output = { mode: Mode; source_url: string; count: number; profile?: Profile; posts: Post[]; users?: User[] };

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== "")) as T;
}

function decode(value: string): string {
  return value
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#064;|&#x40;/gi, "@")
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function meta(html: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`, "i"),
  ];
  for (const pattern of patterns) {
    const value = html.match(pattern)?.[1];
    if (value) return decode(value);
  }
  return undefined;
}

function username(raw: string | undefined): string {
  const value = raw?.trim().replace(/^@/, "").replace(/^https?:\/\/(?:www\.)?threads\.(?:com|net)\/@?/i, "").split(/[/?#]/)[0];
  if (!value || !/^[A-Za-z0-9._]{1,64}$/.test(value)) throw new Error("username must be a public Threads username or profile URL");
  return value.toLowerCase();
}

function postTarget(raw: string | undefined): { username: string; code: string; url: string } {
  const value = raw?.trim() ?? "";
  const match = value.match(/threads\.(?:com|net)\/@([^/?#]+)\/post\/([^/?#]+)/i);
  if (!match) throw new Error("post_url must be a public Threads post URL");
  return { username: match[1].toLowerCase(), code: match[2], url: `https://www.threads.com/@${match[1]}/post/${match[2]}` };
}

function stripHtml(value: string): string {
  return decode(value
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/div>|<\/p>|<\/span>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .split(/\n+/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n").trim();
}

function indexedUsers(html: string, limit: number): User[] {
  const users: User[] = [];
  const byUsername = new Map<string, number>();
  const links = /<a[^>]+href="(https?:\/\/[^\"]+)"[^>]*>(?:(?!<\/a>).)*?<h3[^>]*>((?:(?!<\/h3>).)*)<\/h3>/gs;
  let match: RegExpExecArray | null;
  while ((match = links.exec(html)) && users.length < limit) {
    let url = decode(match[1]);
    const redirect = url.match(/[?&]q=(https?[^&]+)/);
    if (redirect) url = decodeURIComponent(redirect[1]);
    const target = url.match(/^https?:\/\/(?:www\.)?threads\.(?:com|net)\/@([A-Za-z0-9._]+)(\/post\/[^/?#]+)?/i);
    if (!target) continue;
    const handle = target[1].toLowerCase();
    const title = stripHtml(match[2]);
    const titleMatch = title.match(/^(.*?)\s*\(@([A-Za-z0-9._]+)\)/);
    const fullName = titleMatch?.[2]?.toLowerCase() === handle ? titleMatch[1].trim() : undefined;
    const candidate: User = compact({
      username: handle,
      full_name: fullName,
      profile_url: `https://www.threads.com/@${handle}`,
      matched_from: target[2] ? "post" : "profile",
    });
    const existing = byUsername.get(handle);
    if (existing === undefined) {
      byUsername.set(handle, users.length);
      users.push(candidate);
    } else if (candidate.matched_from === "profile" || (!users[existing].full_name && candidate.full_name)) {
      users[existing] = candidate;
    }
  }
  return users;
}

function usersFromThreadsHtml(html: string, limit: number): User[] {
  const users: User[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<a\b[^>]*href=["'](?:https?:\/\/(?:www\.)?threads\.(?:com|net))?\/@([A-Za-z0-9._]+)(\/post\/[^?"'#]+)?[^"']*["'][^>]*>/gi)) {
    const handle = match[1].toLowerCase();
    if (seen.has(handle)) continue;
    seen.add(handle);
    users.push({
      username: handle,
      profile_url: `https://www.threads.com/@${handle}`,
      matched_from: match[2] ? "post" : "profile",
    });
    if (users.length >= limit) break;
  }
  return users;
}

function profileFrom(html: string, handle: string): Profile {
  const title = meta(html, "og:title")?.replace(/\s*\([^)]*\).*$/, "").trim() ?? handle;
  const description = meta(html, "og:description") ?? meta(html, "description");
  const followers = description?.match(/[\d,.]+\s*[KMB]?\s+Followers/i)?.[0];
  const threadCount = description?.match(/([\d,]+)\s+Threads/i)?.[1];
  const bio = description?.replace(/^.*?Followers\s*[•·]\s*[\d,]+\s+Threads\s*[•·]\s*/i, "").replace(/\s+See the latest conversations.*$/i, "").trim();
  return compact({
    username: handle,
    display_name: title,
    url: `https://www.threads.com/@${handle}`,
    bio,
    followers_text: followers,
    thread_count: threadCount ? Number(threadCount.replace(/,/g, "")) : undefined,
    avatar: meta(html, "og:image"),
  });
}

function postLinks(html: string, limit: number): Post[] {
  const pattern = /href=["'](?:https?:\/\/(?:www\.)?threads\.(?:com|net))?(\/@([^/"']+)\/post\/([^/"'?]+))["'][^>]*>/gi;
  const candidates: Array<{ index: number; path: string; username: string; code: string }> = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) && candidates.length < limit) {
    if (seen.has(match[3])) continue;
    seen.add(match[3]);
    candidates.push({ index: match.index, path: match[1], username: match[2], code: match[3] });
  }
  return candidates.map((candidate, index) => {
    const end = candidates[index + 1]?.index ?? Math.min(candidate.index + 30_000, html.length);
    const segment = html.slice(candidate.index, end);
    const published = segment.match(/<time[^>]+datetime=["']([^"']+)/i)?.[1];
    let text = stripHtml(segment);
    const lines = text.split("\n");
    while (lines.length && (/^(?:\d+(?:\.\d+)?[KMB]?|Like|Reply|Repost|Share)$/i.test(lines[lines.length - 1]) || lines[lines.length - 1] === candidate.username)) lines.pop();
    text = lines.filter((line) => line !== candidate.username && !/^\d+[mhd]$|^\d{1,2}\/\d{1,2}\/\d{4}$/.test(line)).join("\n").slice(0, 4000);
    return compact({ code: candidate.code, username: candidate.username, url: `https://www.threads.com${candidate.path}`, text, published_at: published });
  });
}

async function fetchPage(
  bf: Parameters<Parameters<typeof defineTool>[0]>[1],
  url: string,
  browser: boolean,
): Promise<{ html: string; finalUrl: string }> {
  const response = await bf.fetch(browser ? {
    url,
    strategy: "browser",
    json_mode: false,
    wait_until: "domcontentloaded",
    wait_ms: 6000,
    timeout_ms: 60000,
    include_html: true,
    locale: "en-US",
  } : {
    url,
    strategy: "http",
    return_response_text: true,
    include_html: true,
    extra_headers: { "user-agent": "Mozilla/5.0", "accept-language": "en-US,en;q=0.9" },
  });
  if (response.blocked) throw new Error(`Threads blocked the request (${response.block_reason ?? "unknown"})`);
  const raw = response.body_text ?? "";
  return { html: browser ? (response.html ?? raw) : (raw.includes("<html") ? raw : response.html ?? raw), finalUrl: response.final_url ?? url };
}

export default defineTool<Input, Output>(async (input, bf) => {
  const limit = Math.min(Math.max(input.max_results ?? 10, 1), 25);
  if (input.mode === "profile") {
    const handle = username(input.username);
    const source = `https://www.threads.com/@${handle}`;
    const page = await fetchPage(bf, source, false);
    return { mode: input.mode, source_url: page.finalUrl, count: 1, profile: profileFrom(page.html, handle), posts: [] };
  }
  if (input.mode === "post") {
    const target = postTarget(input.post_url);
    const page = await fetchPage(bf, target.url, false);
    const text = meta(page.html, "og:description") ?? meta(page.html, "description");
    if (!text) throw new Error("Threads public post metadata was not found");
    return { mode: input.mode, source_url: page.finalUrl, count: 1, posts: [compact({ ...target, text, image: meta(page.html, "og:image") })] };
  }
  if (input.mode === "search_users") {
    const phrase = input.query?.trim();
    if (!phrase) throw new Error("query is required for search_users mode");
    const source = `https://www.threads.com/search?q=${encodeURIComponent(phrase)}&serp_type=default`;
    const page = await fetchPage(bf, source, true);
    const users = usersFromThreadsHtml(page.html, limit);
    if (!users.length) throw new Error("Threads returned no public user matches");
    return { mode: input.mode, source_url: page.finalUrl, count: users.length, posts: [], users };
  }
  const source = input.mode === "search"
    ? `https://www.threads.com/search?q=${encodeURIComponent(input.query?.trim() || "")}&serp_type=default`
    : `https://www.threads.com/@${username(input.username)}`;
  if (input.mode === "search" && !input.query?.trim()) throw new Error("query is required for search mode");
  const page = await fetchPage(bf, source, true);
  const posts = postLinks(page.html, limit);
  if (!posts.length) throw new Error(`Threads returned no public posts for ${input.mode}`);
  return { mode: input.mode, source_url: page.finalUrl, count: posts.length, posts };
});
