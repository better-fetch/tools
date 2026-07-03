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

function textOfName(node: unknown): string | undefined {
  const obj = rec(node);
  if (!obj) return undefined;
  if (typeof obj.simpleText === "string") return obj.simpleText;
  const runs = arr(obj.runs);
  const joined = runs
    .map((r) => asStr(rec(r)?.text) ?? "")
    .join("");
  return joined || undefined;
}

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

function timedTextUrl(baseUrl: string): string {
  const clean = baseUrl.replace(/&fmt=[^&]*/g, "");
  return `${clean}${clean.includes("?") ? "&" : "?"}fmt=json3`;
}

export default defineTool<Input, Output>(async (input, bf) => {
  const videoId = resolveVideoId(input);
  const limit = Math.max(1, Math.min(Math.round(input.max_segments ?? 3000), 5000));
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}&hl=en`;

  const page = await bf.fetch({
    url: watchUrl,
    strategy: "browser",
    return_response_text: true,
    include_html: true,
    wait_until: "domcontentloaded",
    wait_ms: 500,
    locale: "en-US",
    proxy: "auto",
  });
  const raw = page.body_text ?? "";
  const html = raw.includes("ytInitialPlayerResponse") ? raw : page.html ?? raw;
  const playerResponse = extractObjectAfter(html, "ytInitialPlayerResponse");
  if (!playerResponse) {
    throw new Error("Could not read the YouTube player data — the video may be unavailable.");
  }

  const details = rec(rec(playerResponse)?.videoDetails);
  const tracks = captionTracks(playerResponse);
  const track = pickTrack(tracks, input.lang?.trim());
  if (!track) {
    throw new Error("This video has no captions or transcript available.");
  }

  const ttUrl = timedTextUrl(track.baseUrl);
  const tt = await bf.fetch({ url: ttUrl, json_mode: true, proxy: "auto" });
  let json = tt.json;
  if (json == null && tt.body_text) {
    try {
      json = JSON.parse(tt.body_text);
    } catch {
      json = null;
    }
  }
  const segments = parseJson3(json, limit);
  if (!segments.length) {
    throw new Error("The transcript track returned no readable text.");
  }

  const text = segments.map((s) => s.text).join(" ");
  const out: Output = {
    video_id: videoId,
    url: watchUrl,
    title: asStr(details?.title),
    author: asStr(details?.author),
    lang: track.lang,
    is_generated: track.kind === "asr",
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
