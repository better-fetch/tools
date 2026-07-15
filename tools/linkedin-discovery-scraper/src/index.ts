import { defineTool } from "@better-fetch/tools";

type DatePosted = "last-hour" | "last-day" | "last-week" | "last-month" | "last-year";
type Mode = "search_posts" | "profile" | "post" | "transcript";
type Input = { mode: Mode; query?: string; url?: string; date_posted?: DatePosted; cursor?: string; max_results?: number; country?: string };
type Post = { title: string; url: string; description?: string; author_slug?: string; activity_id?: string; result_type: "post" | "article" };
type Profile = { url: string; slug: string; name: string; headline?: string; summary?: string; followers?: number; connections?: string };
type Output = { mode: Mode; query?: string; source_url: string; posts: Post[]; count: number; profile?: Profile; post?: Post; date_posted?: DatePosted; next_cursor?: string; transcript?: string; transcript_not_available?: boolean; caption_url?: string };
type IndexedResult = { title: string; url: string; snippet?: string };

const dateFilters: Record<DatePosted, string> = {
  "last-hour": "qdr:h",
  "last-day": "qdr:d",
  "last-week": "qdr:w",
  "last-month": "qdr:m",
  "last-year": "qdr:y",
};

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

function pageNumber(cursor: string | undefined): number {
  if (!cursor) return 1;
  const page = Number(cursor);
  if (!Number.isInteger(page) || page < 1 || page > 10) throw new Error("cursor must be a page number from 1 to 10");
  return page;
}

function indexedResults(html: string, limit: number): IndexedResult[] {
  const results: IndexedResult[] = [];
  const seen = new Set<string>();
  const links = /<a[^>]+href="(https?:\/\/[^\"]+)"[^>]*>(?:(?!<\/a>).)*?<h3[^>]*>((?:(?!<\/h3>).)*)<\/h3>/gs;
  let match: RegExpExecArray | null;
  while ((match = links.exec(html)) && results.length < limit) {
    let url = decodeEntities(match[1]);
    const redirect = url.match(/[?&]q=(https?[^&]+)/);
    if (redirect) url = decodeURIComponent(redirect[1]);
    const canonical = url.replace(/[?#].*$/, "").replace(/\/$/, "");
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    const tail = html.slice(match.index + match[0].length, match.index + match[0].length + 3500);
    const snippetMatch = tail.match(/<(?:div|span)[^>]*(?:data-sncf|class="[^"]*(?:VwiC3b|IsZvec)[^"]*")[^>]*>((?:(?!<\/(?:div|span)>).)*)/s);
    results.push({ title: stripTags(match[2]), url: canonical, snippet: snippetMatch ? stripTags(snippetMatch[1]).slice(0, 1000) : undefined });
  }
  return results;
}

function parseSerp(html: string, limit: number): Post[] {
  const posts: Post[] = [];
  for (const result of indexedResults(html, limit * 2)) {
    if (posts.length >= limit) break;
    const parts = result.url.match(/^https?:\/\/([^/?#]+)(\/[^?#]*)?/i);
    if (!parts || !/(^|\.)linkedin\.com$/i.test(parts[1])) continue;
    const pathname = parts[2] || "/";
    const isPost = /^\/posts\//i.test(pathname);
    const isArticle = /^\/(?:pulse|article)\//i.test(pathname);
    if (!isPost && !isArticle) continue;
    const pathSegments = pathname.split("/").filter(Boolean);
    const slug = isPost ? pathname.match(/^\/posts\/([^_/?#]+)/i)?.[1] : pathSegments[pathSegments.length - 1];
    const activityId = pathname.match(/activity-(\d+)/i)?.[1];
    posts.push({
      title: result.title,
      url: result.url,
      description: result.snippet,
      author_slug: slug,
      activity_id: activityId,
      result_type: isPost ? "post" : "article",
    });
  }
  return posts;
}

function compactNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = value.replace(/,/g, "").match(/([\d.]+)\s*([KMB])?/i);
  if (!match) return undefined;
  const multiplier = match[2]?.toUpperCase() === "K" ? 1_000 : match[2]?.toUpperCase() === "M" ? 1_000_000 : match[2]?.toUpperCase() === "B" ? 1_000_000_000 : 1;
  return Math.round(Number(match[1]) * multiplier);
}

function linkedInTarget(raw: string | undefined, kind: "profile" | "post"): { url: string; slug: string } {
  const value = raw?.trim();
  if (!value) throw new Error(`url is required for ${kind} mode`);
  const normalized = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const match = kind === "profile"
    ? normalized.match(/^https?:\/\/(?:[a-z]{2}\.)?(?:www\.)?linkedin\.com\/in\/([^/?#]+)/i)
    : normalized.match(/^https?:\/\/(?:[a-z]{2}\.)?(?:www\.)?linkedin\.com\/((?:posts|pulse|article)\/[^?#]+)/i);
  if (!match) throw new Error(`url must be a public LinkedIn ${kind} URL`);
  const path = kind === "profile" ? `in/${match[1]}` : match[1];
  return { url: `https://www.linkedin.com/${path}`, slug: match[1] };
}

function publicTranscript(html: string): { transcript?: string; captionUrl?: string } {
  let transcript: string | undefined;
  let captionUrl: string | undefined;
  const scripts = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(scripts)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(decodeEntities(match[1]));
    } catch {
      continue;
    }
    const stack: unknown[] = [parsed];
    while (stack.length) {
      const value = stack.pop();
      if (!value || typeof value !== "object") continue;
      if (Array.isArray(value)) {
        stack.push(...value);
        continue;
      }
      const record = value as Record<string, unknown>;
      if (!transcript && typeof record.transcript === "string" && record.transcript.trim()) {
        transcript = record.transcript.replace(/\s+/g, " ").trim();
      }
      const format = typeof record.encodingFormat === "string" ? record.encodingFormat : "";
      if (!captionUrl && /subrip|vtt|caption/i.test(format) && typeof record.contentUrl === "string") {
        captionUrl = record.contentUrl;
      }
      stack.push(...Object.values(record));
    }
  }
  return { transcript, captionUrl };
}

function srtTranscript(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .split(/\r?\n\r?\n/)
    .flatMap((block) => {
      const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const timing = lines.findIndex((line) => /-->/.test(line));
      return timing < 0 ? [] : [lines.slice(timing + 1).join(" ").replace(/<[^>]+>/g, " ")];
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export default defineTool<Input, Output>(async (input, bf) => {
  if (input.mode === "transcript") {
    const target = linkedInTarget(input.url, "post");
    let page = await bf.fetch({
      url: target.url,
      include_html: true,
      return_response_text: true,
      strategy: "http",
      proxy: "none",
      extra_headers: { accept: "text/html,application/xhtml+xml" },
    });
    let html = page.html ?? page.body_text ?? "";
    let extracted = publicTranscript(html);
    if (!extracted.transcript && !extracted.captionUrl) page = await bf.fetch({
      url: target.url,
      include_html: true,
      return_response_text: true,
      strategy: "browser",
      wait_until: "domcontentloaded",
      wait_ms: 1_500,
      timeout_ms: 90_000,
      proxy: "auto",
    });
    if (page.blocked) throw new Error(`LinkedIn blocked the public post (${page.block_reason ?? "unknown"})`);
    html = page.html ?? page.body_text ?? "";
    extracted = publicTranscript(html);
    let transcript = extracted.transcript;
    if (!transcript && extracted.captionUrl) {
      const captions = await bf.fetch({
        url: extracted.captionUrl,
        strategy: "http",
        return_response_text: true,
        include_html: false,
        proxy: "auto",
        extra_headers: { accept: "application/x-subrip,text/vtt,text/plain", referer: target.url },
      });
      transcript = captions.body_text ? srtTranscript(captions.body_text) : undefined;
    }
    return {
      mode: input.mode,
      source_url: page.final_url ?? target.url,
      posts: [],
      count: transcript ? 1 : 0,
      transcript,
      transcript_not_available: !transcript,
      caption_url: extracted.captionUrl,
    };
  }
  if (input.mode === "profile") {
    const target = linkedInTarget(input.url, "profile");
    const query = `site:linkedin.com/in/${target.slug}`;
    const sourceUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=10&hl=en`;
    const response = await bf.fetch({ url: sourceUrl, include_html: true, strategy: "browser", wait_until: "domcontentloaded", wait_ms: 1500, proxy: "auto" });
    const result = indexedResults(response.html ?? "", 10).find((item) => item.url.toLowerCase().includes(`/in/${target.slug.toLowerCase()}`));
    if (!result) throw new Error("Google returned no indexed public LinkedIn profile");
    const [name, ...headlineParts] = result.title.split(/\s+-\s+/);
    const followersText = result.snippet?.match(/([\d,.]+\s*[KMB]?)\s+followers/i)?.[1];
    const connections = result.snippet?.match(/([\d,.]+\+?)\s+connections/i)?.[1];
    const profile: Profile = {
      url: target.url,
      slug: target.slug,
      name: name.trim(),
      headline: headlineParts.join(" - ") || undefined,
      summary: result.snippet,
      followers: compactNumber(followersText),
      connections,
    };
    return { mode: input.mode, source_url: response.final_url ?? sourceUrl, posts: [], count: 1, profile };
  }
  if (input.mode === "post") {
    const target = linkedInTarget(input.url, "post");
    const query = `site:linkedin.com/${target.slug}`;
    const sourceUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=10&hl=en`;
    const response = await bf.fetch({ url: sourceUrl, include_html: true, strategy: "browser", wait_until: "domcontentloaded", wait_ms: 1500, proxy: "auto" });
    const post = parseSerp(response.html ?? "", 10).find((item) => item.url.toLowerCase().includes(target.slug.toLowerCase()));
    if (!post) throw new Error("Google returned no indexed public LinkedIn post or article");
    return { mode: input.mode, source_url: response.final_url ?? sourceUrl, posts: [post], post, count: 1 };
  }
  const phrase = input.query?.trim();
  if (!phrase) throw new Error("query is required");
  const limit = Math.min(Math.max(input.max_results ?? 10, 1), 20);
  const page = pageNumber(input.cursor);
  const query = `(site:linkedin.com/posts/ OR site:linkedin.com/pulse/ OR site:linkedin.com/article/) ${phrase}`;
  const recency = input.date_posted ? `&tbs=${dateFilters[input.date_posted]}` : "";
  const sourceUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${Math.min(limit + 5, 30)}&start=${(page - 1) * 10}&hl=en${recency}`;
  const response = await bf.fetch({
    url: sourceUrl,
    include_html: true,
    strategy: "browser",
    wait_until: "domcontentloaded",
    wait_ms: 1500,
    proxy: "auto",
    ...(input.country ? { country: input.country, geoip: true } : {}),
  });
  const posts = parseSerp(response.html ?? "", limit);
  if (!posts.length) throw new Error("Google returned no indexed public LinkedIn posts");
  return {
    mode: input.mode,
    query: phrase,
    source_url: response.final_url ?? sourceUrl,
    posts,
    count: posts.length,
    date_posted: input.date_posted,
    next_cursor: page < 10 ? String(page + 1) : undefined,
  };
});
