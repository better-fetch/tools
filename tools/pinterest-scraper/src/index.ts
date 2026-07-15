import { defineTool } from "@better-fetch/tools";

type Mode = "pin" | "search" | "user_boards" | "board";
type Input = {
  mode?: Mode;
  pin_url?: string;
  url?: string;
  query?: string;
  handle?: string;
  max_results?: number;
};

type Pin = { id: string; title: string; url: string; thumbnail_url?: string };
type Board = { title: string; url: string; thumbnail_url?: string };
type Output = {
  mode: Mode;
  source_url: string;
  title?: string;
  handle?: string;
  pin_url?: string;
  author_name?: string;
  author_url?: string;
  thumbnail_url?: string;
  thumbnail_width?: number;
  thumbnail_height?: number;
  embed_html?: string;
  width?: number;
  height?: number;
  pin_count?: number;
  count?: number;
  pins?: Pin[];
  boards?: Board[];
};

function rec(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
const number = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

function limit(value: number | undefined): number {
  return Number.isInteger(value) && (value as number) > 0 ? Math.min(value as number, 100) : 25;
}

function decode(value: string): string {
  return value
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .trim();
}

function pinUrl(value: string | undefined): string {
  const match = value?.trim().match(
    /^https?:\/\/(?:www\.)?(?:pinterest\.[a-z.]+|pin\.it)\/pin\/([0-9]+)(?:[/?#]|$)/i,
  );
  if (!match) throw new Error("Provide a public Pinterest /pin/{id}/ URL");
  return `https://www.pinterest.com/pin/${match[1]}/`;
}

function profile(input: Input): { handle: string; url: string } {
  const fromUrl = input.url?.trim().match(/^https?:\/\/(?:www\.)?pinterest\.[a-z.]+\/([^/?#]+)(?:[/?#]|$)/i)?.[1];
  const handle = fromUrl ?? input.handle?.trim().replace(/^@/, "");
  if (!handle || !/^[A-Za-z0-9_.-]{1,80}$/.test(handle)) throw new Error("Provide a Pinterest profile handle or URL");
  return { handle, url: `https://www.pinterest.com/${handle}/` };
}

function boardUrl(value: string | undefined): string {
  const match = value?.trim().match(/^https?:\/\/(?:www\.)?pinterest\.[a-z.]+\/([^/?#]+)\/([^/?#]+)(?:[/?#]|$)/i);
  if (!match || match[2].toLowerCase() === "pin") throw new Error("url must be a public Pinterest board URL");
  return `https://www.pinterest.com/${match[1]}/${match[2]}/`;
}

function parsePins(html: string, maxResults: number): Pin[] {
  const pins: Pin[] = [];
  const anchors = /<a\b[^>]*aria-label=["']([^"']+)["'][^>]*href=["']\/pin\/([0-9]+)\/["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchors)) {
    const id = match[2];
    if (pins.some((pin) => pin.id === id)) continue;
    const image = match[3].match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1];
    pins.push({
      id,
      title: decode(match[1]),
      url: `https://www.pinterest.com/pin/${id}/`,
      thumbnail_url: image ? decode(image) : undefined,
    });
    if (pins.length >= maxResults) break;
  }
  return pins;
}

function parseBoards(html: string, maxResults: number): Board[] {
  const boards: Board[] = [];
  const anchors = /<a\b[^>]*data-test-id=["']board-rep-tap-area-link["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchors)) {
    const title = match[2].match(/data-test-id=["']boardCard-([^"']+)["']/i)?.[1];
    if (!title) continue;
    const path = decode(match[1]).split(/[?#]/, 1)[0];
    const url = `https://www.pinterest.com${path}`;
    if (boards.some((board) => board.url === url)) continue;
    const image = match[2].match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1];
    boards.push({ title: decode(title), url, thumbnail_url: image ? decode(image) : undefined });
    if (boards.length >= maxResults) break;
  }
  return boards;
}

function pageTitle(html: string): string | undefined {
  const board = html.match(/data-test-id=["']board-title["'][^>]*>[\s\S]*?<h1\b[^>]*>([^<]+)/i)?.[1];
  const title = board ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return title ? decode(title.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")) : undefined;
}

export default defineTool<Input, Output>(async (input, bf) => {
  const mode: Mode = input.mode ?? "pin";
  if (mode === "pin") {
    const target = pinUrl(input.pin_url ?? input.url);
    const sourceUrl = `https://www.pinterest.com/oembed.json?url=${encodeURIComponent(target)}`;
    const response = await bf.fetch({
      url: sourceUrl,
      strategy: "http",
      return_response_text: true,
      include_html: false,
      extra_headers: { accept: "application/json" },
    });
    let data = rec(response.json);
    if (!data && response.body_text) {
      try { data = rec(JSON.parse(response.body_text)); } catch { /* handled below */ }
    }
    if (!data) throw new Error("Pinterest did not return public pin metadata");
    return {
      mode,
      pin_url: target,
      source_url: sourceUrl,
      title: text(data.title),
      author_name: text(data.author_name),
      author_url: text(data.author_url),
      thumbnail_url: text(data.thumbnail_url),
      thumbnail_width: number(data.thumbnail_width),
      thumbnail_height: number(data.thumbnail_height),
      embed_html: text(data.html),
      width: number(data.width),
      height: number(data.height),
    };
  }

  if (mode === "search") {
    const query = input.query?.trim();
    if (!query) throw new Error("query is required for search mode");
    const sourceUrl = `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}`;
    const response = await bf.fetch({
      url: sourceUrl,
      strategy: "browser",
      include_html: true,
      wait_until: "domcontentloaded",
      wait_selector: '[data-test-id="pin"]',
      wait_ms: 1000,
      timeout_ms: 90_000,
    });
    const pins = parsePins(response.html ?? response.body_text ?? "", limit(input.max_results));
    if (!pins.length) throw new Error("Pinterest returned no public search results");
    return { mode, source_url: sourceUrl, title: query, count: pins.length, pins };
  }

  if (mode === "user_boards") {
    const item = profile(input);
    const response = await bf.fetch({ url: item.url, strategy: "http", return_response_text: true, include_html: false });
    const html = response.body_text ?? "";
    const boards = parseBoards(html, limit(input.max_results));
    if (!boards.length) throw new Error("Pinterest returned no public user boards");
    return { mode, source_url: item.url, title: pageTitle(html), handle: item.handle, count: boards.length, boards };
  }

  const sourceUrl = boardUrl(input.url);
  const response = await bf.fetch({ url: sourceUrl, strategy: "http", return_response_text: true, include_html: false });
  const html = response.body_text ?? "";
  const pins = parsePins(html, limit(input.max_results));
  if (!pins.length) throw new Error("Pinterest returned no public board pins");
  const pinCount = html.match(/data-test-id=["']pin-count["'][^>]*>([0-9,.]+)[^<]*Pins/i)?.[1];
  return {
    mode,
    source_url: sourceUrl,
    title: pageTitle(html),
    pin_count: pinCount ? Number(pinCount.replace(/,/g, "")) : undefined,
    count: pins.length,
    pins,
  };
});
