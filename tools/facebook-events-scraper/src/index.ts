import { defineTool } from "@better-fetch/tools";

type Mode = "search" | "events_url" | "details";
type Input = { mode: Mode; query?: string; url?: string; id?: string; time?: string; cursor?: string; max_results?: number };
type EventRecord = {
  id: string;
  url: string;
  title: string;
  description?: string;
  location?: string;
  organizer?: string;
  start_time_label?: string;
  image_url?: string;
};
type Output = { mode: Mode; source_url: string; query?: string; count: number; events: EventRecord[]; event?: EventRecord; next_cursor?: string };
type IndexedResult = { title: string; url: string; snippet?: string };

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

function metaContent(html: string, property: string): string | undefined {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tag = (html.match(/<meta\b[^>]*>/gi) ?? []).find((value) => new RegExp(`property=["']${escaped}["']`, "i").test(value));
  const content = tag?.match(/content=["']([^"']*)["']/i)?.[1];
  return content ? decodeEntities(content).trim() : undefined;
}

function eventTarget(value: string): { id: string; url: string } | undefined {
  let parsed: URL;
  try { parsed = new URL(value); } catch { return undefined; }
  if (!/(^|\.)facebook\.com$/i.test(parsed.hostname)) return undefined;
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts[0]?.toLowerCase() !== "events") return undefined;
  const id = [...parts].reverse().find((part) => /^\d{8,30}$/.test(part));
  if (!id) return undefined;
  return { id, url: `https://www.facebook.com${parsed.pathname.replace(/\/$/, "")}` };
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
    const target = eventTarget(url);
    if (!target || seen.has(target.id)) continue;
    seen.add(target.id);
    const tail = html.slice(match.index + match[0].length, match.index + match[0].length + 3500);
    const snippetMatch = tail.match(/<(?:div|span)[^>]*(?:data-sncf|class="[^"]*(?:VwiC3b|IsZvec)[^"]*")[^>]*>((?:(?!<\/(?:div|span)>).)*)/s);
    results.push({ title: stripTags(match[2]), url: target.url, snippet: snippetMatch ? stripTags(snippetMatch[1]).slice(0, 1000) : undefined });
  }
  return results;
}

function eventFromIndexed(result: IndexedResult): EventRecord | undefined {
  const target = eventTarget(result.url);
  if (!target) return undefined;
  const standard = result.snippet?.match(/Event in (.+?) by (.+?) on (.+?)(?:\.|$)/i);
  const hosted = result.snippet?.match(/Hosted by (.+?)(?:\s+[·|]|$)/i);
  const time = result.snippet?.match(/((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+[A-Z][a-z]+\s+\d{1,2}(?:,?\s+\d{4})?(?:\s+at\s+[^.·]+)?)/i)?.[1];
  return {
    id: target.id,
    url: target.url,
    title: result.title,
    description: result.snippet,
    location: standard?.[1]?.trim(),
    organizer: standard?.[2]?.trim() ?? hosted?.[1]?.trim(),
    start_time_label: standard?.[3]?.trim() ?? time,
  };
}

function searchPhrase(input: Input): string {
  if (input.mode === "search") {
    const query = input.query?.trim();
    if (!query) throw new Error("query is required for search mode");
    return query;
  }
  const raw = input.url?.trim();
  if (!raw) throw new Error("url is required for events_url mode");
  let parsed: URL;
  try { parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { throw new Error("url must be a public Facebook events URL"); }
  if (!/(^|\.)facebook\.com$/i.test(parsed.hostname)) throw new Error("url must be a public Facebook events URL");
  const query = parsed.searchParams.get("q")?.trim();
  if (query) return query;
  const parts = parsed.pathname.split("/").filter(Boolean);
  const page = parts[0]?.toLowerCase() === "events" ? undefined : parts[0];
  if (!page) throw new Error("events URL must include a search query or Page slug");
  return page;
}

export default defineTool<Input, Output>(async (input, bf) => {
  if (input.mode === "details") {
    const raw = input.url?.trim() ?? (input.id?.trim() ? `https://www.facebook.com/events/${input.id.trim()}` : "");
    const target = eventTarget(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!target) throw new Error("url or numeric Facebook event id is required for details mode");
    const response = await bf.fetch({ url: target.url, strategy: "browser", include_html: true, wait_until: "domcontentloaded", wait_ms: 1500, timeout_ms: 90_000, proxy: "auto" });
    const html = response.html ?? response.body_text ?? "";
    const title = metaContent(html, "og:title");
    if (!title) throw new Error("Facebook returned no public event metadata");
    const canonical = metaContent(html, "og:url") ?? target.url;
    const resolved = eventTarget(canonical) ?? target;
    const description = metaContent(html, "og:description");
    const indexed = eventFromIndexed({ title, url: resolved.url, snippet: description });
    const event: EventRecord = { ...indexed!, id: resolved.id, url: resolved.url, title, description, image_url: metaContent(html, "og:image") };
    return { mode: input.mode, source_url: response.final_url ?? target.url, count: 1, events: [event], event };
  }

  const phrase = searchPhrase(input);
  const limit = Math.min(Math.max(input.max_results ?? 10, 1), 20);
  const cursor = Number(input.cursor ?? "0");
  if (!Number.isInteger(cursor) || cursor < 0 || cursor > 90) throw new Error("cursor must be an offset from 0 to 90");
  const query = `site:facebook.com/events ${phrase}`;
  const sourceUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${Math.min(limit + 5, 30)}&start=${cursor}&hl=en`;
  let response = await bf.fetch({ url: sourceUrl, include_html: true, strategy: "browser", wait_until: "domcontentloaded", wait_ms: 1500, proxy: "auto" });
  let events = indexedResults(response.html ?? "", limit).map(eventFromIndexed).filter((event): event is EventRecord => Boolean(event));
  if (!events.length) {
    response = await bf.fetch({ url: `${sourceUrl}&filter=0`, include_html: true, strategy: "browser", wait_until: "domcontentloaded", wait_ms: 1500, proxy: "auto" });
    events = indexedResults(response.html ?? "", limit).map(eventFromIndexed).filter((event): event is EventRecord => Boolean(event));
  }
  if (!events.length) throw new Error("Google returned no indexed public Facebook events");
  return { mode: input.mode, source_url: response.final_url ?? sourceUrl, query: phrase, count: events.length, events, next_cursor: cursor < 90 ? String(cursor + 10) : undefined };
});
