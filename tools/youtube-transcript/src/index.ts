import { defineTool } from "@better-fetch/tools";

type Input = {
  url?: string;
  video_id?: string;
  lang?: string;
  max_segments?: number;
};

type Segment = {
  start: number;
  duration: number;
  text: string;
};

type Output = {
  video_id: string;
  url: string;
  title?: string;
  author?: string;
  lang?: string;
  is_generated?: boolean;
  duration_seconds?: number;
  segment_count: number;
  text: string;
  segments: Segment[];
};

function rec(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
const asStr = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;
const asNum = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const ID = /^[\w-]{11}$/;
const ID_PATTERNS = [
  /[?&]v=([\w-]{11})/,
  /youtu\.be\/([\w-]{11})/,
  /\/shorts\/([\w-]{11})/,
  /\/embed\/([\w-]{11})/,
  /\/live\/([\w-]{11})/,
  /\/v\/([\w-]{11})/,
];

function resolveVideoId(input: Input): string {
  const explicit = input.video_id?.trim();
  if (explicit) {
    if (ID.test(explicit)) return explicit;
    throw new Error("video_id must be an 11-character YouTube id");
  }
  const raw = input.url?.trim();
  if (!raw) throw new Error("Provide a YouTube url or video_id");
  if (ID.test(raw)) return raw;
  for (const pattern of ID_PATTERNS) {
    const match = raw.match(pattern);
    if (match) return match[1];
  }
  throw new Error("Could not find a YouTube video id in the url");
}

// Balanced-brace extraction of the JSON object that follows a marker such as
// `ytInitialPlayerResponse = {...}`, ignoring braces inside string literals.
function extractObjectAfter(html: string, marker: string): unknown | null {
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = html.indexOf("{", markerIndex);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

type Track = {
  baseUrl: string;
  lang?: string;
  kind?: string;
};

function captionTracks(playerResponse: unknown): Track[] {
  const captions = rec(rec(playerResponse)?.captions);
  const renderer = rec(captions?.playerCaptionsTracklistRenderer);
  return arr(renderer?.captionTracks)
    .map((t): Track | null => {
      const obj = rec(t);
      const baseUrl = asStr(obj?.baseUrl);
      if (!baseUrl) return null;
      return { baseUrl, lang: asStr(obj?.languageCode), kind: asStr(obj?.kind) };
    })
    .filter((t): t is Track => t !== null);
}

function pickTrack(tracks: Track[], wantLang: string | undefined): Track | null {
  if (!tracks.length) return null;
  const startsWith = (track: Track, lang: string) =>
    track.lang?.toLowerCase().startsWith(lang.toLowerCase()) ?? false;

  if (wantLang) {
    const exact = tracks.find((t) => startsWith(t, wantLang));
    if (exact) return exact;
  }
  const manualEnglish = tracks.find((t) => t.kind !== "asr" && startsWith(t, "en"));
  if (manualEnglish) return manualEnglish;
  const anyManual = tracks.find((t) => t.kind !== "asr");
  if (anyManual) return anyManual;
  const asrEnglish = tracks.find((t) => startsWith(t, "en"));
  if (asrEnglish) return asrEnglish;
  return tracks[0];
}

function parseJson3(json: unknown, limit: number): Segment[] {
  const segments: Segment[] = [];
  for (const event of arr(rec(json)?.events)) {
    if (segments.length >= limit) break;
    const ev = rec(event);
    if (!ev) continue;
    const text = arr(ev.segs)
      .map((s) => asStr(rec(s)?.utf8) ?? "")
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    segments.push({
      start: round2((asNum(ev.tStartMs) ?? 0) / 1000),
      duration: round2((asNum(ev.dDurationMs) ?? 0) / 1000),
      text,
    });
  }
  return segments;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

// Legacy XML (`<text start="..." dur="...">`) fallback for timedtext
// responses that are not json3.
function parseXmlCaptions(xml: string, limit: number): Segment[] {
  const segments: Segment[] = [];
  const re = /<text([^>]*)>([\s\S]*?)<\/text>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) && segments.length < limit) {
    const attrs = match[1];
    const start = Number((attrs.match(/start="([\d.]+)"/) ?? [])[1] ?? 0);
    const dur = Number((attrs.match(/dur="([\d.]+)"/) ?? [])[1] ?? 0);
    const text = decodeEntities(match[2].replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    segments.push({
      start: round2(Number.isFinite(start) ? start : 0),
      duration: round2(Number.isFinite(dur) ? dur : 0),
      text,
    });
  }
  return segments;
}

function parseTranscriptBody(json: unknown, text: string | undefined, limit: number): Segment[] {
  let parsed = json;
  if (parsed == null && text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  const segments = parseJson3(parsed, limit);
  if (segments.length) return segments;
  if (text && text.includes("<text")) return parseXmlCaptions(text, limit);
  return segments;
}

function getParam(url: string, name: string): string | undefined {
  const match = url.match(new RegExp(`[?&]${name}=([^&]*)`));
  return match ? match[1] : undefined;
}

// YouTube's timedtext endpoint now returns an empty 200 body unless the
// request carries a proof-of-origin token (`pot`) minted by the player's
// botguard at runtime. The player-issued caption request we capture from
// the watch page carries a valid `pot`; those params are not covered by
// `sparams`, so they can be grafted onto any other caption track URL of
// the same page load.
const POT_PARAMS = ["pot", "potc", "c", "cver", "cplatform", "cbr", "cbrver", "cos", "cosver"];

function timedTextUrl(baseUrl: string, capturedUrl: string | undefined): string {
  const clean = baseUrl.replace(/&fmt=[^&]*/g, "");
  let out = `${clean}${clean.includes("?") ? "&" : "?"}fmt=json3`;
  if (capturedUrl) {
    for (const key of POT_PARAMS) {
      if (getParam(out, key) !== undefined) continue;
      const value = getParam(capturedUrl, key);
      if (value !== undefined) out += `&${key}=${value}`;
    }
  }
  return out;
}

type CapturedTrack = {
  url: string;
  lang?: string;
  kind?: string;
  json: unknown;
  body_text?: string;
};

function capturedTimedText(network: unknown[]): CapturedTrack[] {
  const out: CapturedTrack[] = [];
  for (const entry of network) {
    const e = rec(entry);
    const url = asStr(e?.url);
    if (!url || !url.includes("/api/timedtext")) continue;
    if (e?.status !== 200) continue;
    const body = asStr(e?.body_text);
    if (e?.json == null && !body) continue;
    out.push({
      url,
      lang: getParam(url, "lang"),
      kind: getParam(url, "kind"),
      json: e?.json,
      body_text: body,
    });
  }
  return out;
}

export default defineTool<Input, Output>(async (input, bf) => {
  const videoId = resolveVideoId(input);
  const wantLang = input.lang?.trim();
  const limit = Math.max(1, Math.min(Math.round(input.max_segments ?? 3000), 5000));
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}&hl=en`;

  // One real browser navigation. `json_mode: false` is load-bearing: with
  // return_response_text set, the engine would otherwise auto-detect the
  // extensionless /watch path as an API and use in-page fetch() — no player,
  // no autoplay, and no caption traffic to capture. The muted autoplay makes
  // the player fetch its default caption track (with a valid `pot`), which
  // we capture off the wire.
  const page = await bf.fetch({
    url: watchUrl,
    strategy: "browser",
    json_mode: false,
    wait_until: "domcontentloaded",
    wait_ms: 8000,
    timeout_ms: 60000,
    return_response_text: true,
    include_html: true,
    capture_network: true,
    network_include_bodies: true,
    network_max_entries: 300,
    network_max_body_bytes: 1048576,
    locale: "en-US",
    proxy: "auto",
  });
  if (page.blocked) {
    throw new Error(`YouTube blocked the request (${page.block_reason ?? "unknown"}).`);
  }
  const raw = page.body_text ?? "";
  const html = raw.includes("ytInitialPlayerResponse") ? raw : page.html ?? raw;
  const playerResponse = extractObjectAfter(html, "ytInitialPlayerResponse");
  if (!playerResponse) {
    throw new Error("Could not read the YouTube player data — the video may be unavailable.");
  }

  const details = rec(rec(playerResponse)?.videoDetails);
  const tracks = captionTracks(playerResponse);
  const track = pickTrack(tracks, wantLang);
  if (!track) {
    throw new Error("This video has no captions or transcript available.");
  }

  const captured = capturedTimedText(arr(page.network));

  // Best case: the player already fetched the track we want.
  let segments: Segment[] = [];
  let usedTrack: Track = track;
  const capturedMatch = captured.find(
    (c) => c.lang?.toLowerCase() === track.lang?.toLowerCase() && (c.kind === "asr") === (track.kind === "asr"),
  );
  const capturedAny = capturedMatch ?? captured[0];
  if (capturedMatch) {
    segments = parseTranscriptBody(capturedMatch.json, capturedMatch.body_text, limit);
  }

  // Otherwise fetch the desired track directly, reusing the captured `pot`
  // when we have one (without it YouTube returns an empty 200).
  if (!segments.length) {
    const ttUrl = timedTextUrl(track.baseUrl, capturedAny?.url);
    const tt = await bf.fetch({ url: ttUrl, json_mode: true, proxy: "auto" });
    segments = parseTranscriptBody(tt.json, tt.body_text, limit);
  }

  // Last resort: any caption track the player loaded, even if it is not the
  // preferred language, beats failing outright when no language was forced.
  if (!segments.length && !wantLang && capturedAny) {
    segments = parseTranscriptBody(capturedAny.json, capturedAny.body_text, limit);
    if (segments.length) {
      usedTrack =
        tracks.find(
          (t) =>
            t.lang?.toLowerCase() === capturedAny.lang?.toLowerCase() &&
            (t.kind === "asr") === (capturedAny.kind === "asr"),
        ) ?? { baseUrl: capturedAny.url, lang: capturedAny.lang, kind: capturedAny.kind };
    }
  }

  if (!segments.length) {
    throw new Error(
      "The transcript track returned no readable text — YouTube now requires a playback proof token for captions and the player did not load this track during capture.",
    );
  }

  const text = segments.map((s) => s.text).join(" ");
  const out: Output = {
    video_id: videoId,
    url: watchUrl,
    title: asStr(details?.title),
    author: asStr(details?.author),
    lang: usedTrack.lang,
    is_generated: usedTrack.kind === "asr",
    duration_seconds: (() => {
      const secs = asStr(details?.lengthSeconds);
      const n = secs ? Number(secs) : NaN;
      return Number.isFinite(n) ? n : undefined;
    })(),
    segment_count: segments.length,
    text,
    segments,
  };

  const compact: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(out)) {
    if (value !== undefined) compact[key] = value;
  }
  return compact as unknown as Output;
});
