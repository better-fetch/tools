import { defineTool, type Bf } from "@better-fetch/tools";

type Server = "biorxiv" | "medrxiv";
type Mode = "date_range" | "doi";
type JsonObject = Record<string, unknown>;

type Input = {
  mode?: Mode;
  server?: Server;
  doi?: string;
  date_from?: string;
  date_to?: string;
  cursor?: number;
  limit?: number;
  category?: string;
  include_abstract?: boolean;
};

type PreprintRecord = {
  rank: number;
  doi: string;
  server?: string;
  title?: string;
  authors?: string;
  date?: string;
  version?: string;
  type?: string;
  license?: string;
  category?: string;
  abstract?: string;
  author_corresponding?: string;
  author_corresponding_institution?: string;
  funder?: string;
  published_doi?: string;
  preprint_url?: string;
  pdf_url?: string;
  jatsxml_url?: string;
};

type Output = {
  mode: Mode;
  source_url: string;
  server: Server;
  doi?: string;
  date_from?: string;
  date_to?: string;
  cursor?: number;
  count: number;
  total_matches?: number;
  new_papers_count?: number;
  status?: string;
  preprints: PreprintRecord[];
};

const BASE = "https://api.biorxiv.org";
const USER_AGENT =
  "BetterFetchBiorxivMedrxivPreprintsScraper/0.1 (https://betterfetch.co/tools/biorxiv_medrxiv_preprints_scraper; support@betterfetch.co)";

function objectValue(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : undefined;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return undefined;
}

function compact<T extends Record<string, unknown>>(record: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined && value !== "" && value !== null && value !== "NA") out[key] = value;
  }
  return out as T;
}

function truncate(value: string | undefined, max: number): string | undefined {
  const clean = (value ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return undefined;
  return clean.length > max ? `${clean.slice(0, max - 1)}...` : clean;
}

function modeFrom(input: Input): Mode {
  if (input.mode === "doi" || input.doi) return "doi";
  return "date_range";
}

function serverFrom(value: Server | undefined): Server {
  return value === "medrxiv" ? "medrxiv" : "biorxiv";
}

function cleanDate(value: string | undefined, field: string): string | undefined {
  const clean = (value ?? "").trim();
  if (!clean) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) throw new Error(`${field} must use YYYY-MM-DD format`);
  const parsed = new Date(`${clean}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || clean !== parsed.toISOString().slice(0, 10)) {
    throw new Error(`${field} must be a valid calendar date`);
  }
  return clean;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function defaultDateRange(): { from: string; to: string } {
  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  const from = addDays(today, -7).toISOString().slice(0, 10);
  return { from, to };
}

function dateRange(input: Input): { from: string; to: string } {
  const fallback = defaultDateRange();
  const from = cleanDate(input.date_from, "date_from") ?? fallback.from;
  const to = cleanDate(input.date_to, "date_to") ?? fallback.to;
  if (from > to) throw new Error("date_from must be less than or equal to date_to");
  return { from, to };
}

function cleanDoi(value: string | undefined): string {
  const clean = (value ?? "")
    .trim()
    .replace(/^https?:\/\/doi\.org\//i, "")
    .replace(/^doi:/i, "");
  if (!/^10\.\d{4,9}\/[A-Za-z0-9._;()/:+-]+$/.test(clean)) {
    throw new Error("doi must look like 10.1101/2024.05.28.596311");
  }
  return clean;
}

function cleanCategory(value: string | undefined): string | undefined {
  const clean = (value ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  if (!clean) return undefined;
  if (!/^[a-z][a-z0-9_-]{1,80}$/.test(clean)) {
    throw new Error("category must be a bioRxiv/medRxiv category such as neuroscience, cell_biology, or sports_medicine");
  }
  return clean;
}

function cursor(value: number | undefined): number {
  return Math.min(Math.max(value ?? 0, 0), 100000);
}

function limit(value: number | undefined): number {
  return Math.min(Math.max(value ?? 10, 1), 30);
}

function queryString(params: Record<string, string | undefined>): string {
  return Object.entries(params)
    .filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

function buildUrl(input: Input, mode: Mode): { url: string; server: Server; doi?: string; from?: string; to?: string; cursor?: number } {
  const server = serverFrom(input.server);
  if (mode === "doi") {
    const doi = cleanDoi(input.doi);
    return {
      server,
      doi,
      url: `${BASE}/details/${server}/${doi}/na/json`,
    };
  }
  const range = dateRange(input);
  const start = cursor(input.cursor);
  const qs = queryString({ category: cleanCategory(input.category) });
  return {
    server,
    from: range.from,
    to: range.to,
    cursor: start,
    url: `${BASE}/details/${server}/${range.from}/${range.to}/${start}/json${qs ? `?${qs}` : ""}`,
  };
}

function hostFor(server: string | undefined): string {
  return server?.toLowerCase() === "medrxiv" ? "www.medrxiv.org" : "www.biorxiv.org";
}

function preprintUrl(item: JsonObject): string | undefined {
  const doi = textValue(item.doi);
  if (!doi) return undefined;
  const version = textValue(item.version);
  return `https://${hostFor(textValue(item.server))}/content/${doi}${version ? `v${version}` : ""}`;
}

function recordFrom(item: JsonObject, rank: number, includeAbstract: boolean): PreprintRecord | undefined {
  const doi = textValue(item.doi);
  if (!doi) return undefined;
  const url = preprintUrl(item);
  return compact({
    rank,
    doi,
    server: textValue(item.server),
    title: textValue(item.title),
    authors: textValue(item.authors),
    date: textValue(item.date),
    version: textValue(item.version),
    type: textValue(item.type),
    license: textValue(item.license),
    category: textValue(item.category),
    abstract: includeAbstract ? truncate(textValue(item.abstract), 2500) : undefined,
    author_corresponding: textValue(item.author_corresponding),
    author_corresponding_institution: textValue(item.author_corresponding_institution),
    funder: textValue(item.funder),
    published_doi: textValue(item.published),
    preprint_url: url,
    pdf_url: url ? `${url}.full.pdf` : undefined,
    jatsxml_url: textValue(item.jatsxml),
  });
}

async function fetchJson(bf: Bf, url: string): Promise<JsonObject> {
  const response = await bf.fetch({
    url,
    strategy: "http",
    return_response_text: true,
    extra_headers: {
      accept: "application/json,*/*;q=0.5",
      "user-agent": USER_AGENT,
    },
  });
  const status = response.status ?? 0;
  if (!response.ok || status >= 400 || !response.body_text) {
    throw new Error(`bioRxiv API request failed with status ${response.status ?? "unknown"}`);
  }
  try {
    const data = JSON.parse(response.body_text) as unknown;
    const obj = objectValue(data);
    if (!obj) throw new Error("not an object");
    return obj;
  } catch {
    throw new Error("bioRxiv API returned invalid JSON");
  }
}

export default defineTool<Input, Output>(async (input, bf) => {
  const mode = modeFrom(input);
  const built = buildUrl(input, mode);
  const data = await fetchJson(bf, built.url);
  const message = objectValue(arrayValue(data.messages)[0]);
  const includeAbstract = input.include_abstract !== false;
  const preprints = arrayValue(data.collection)
    .slice(0, limit(input.limit))
    .map((item, index) => {
      const obj = objectValue(item);
      return obj ? recordFrom(obj, index + 1, includeAbstract) : undefined;
    })
    .filter((item): item is PreprintRecord => Boolean(item));

  return {
    mode,
    source_url: built.url,
    server: built.server,
    doi: built.doi,
    date_from: built.from,
    date_to: built.to,
    cursor: built.cursor,
    count: preprints.length,
    total_matches: numberValue(message?.total),
    new_papers_count: numberValue(message?.count_new_papers),
    status: textValue(message?.status),
    preprints,
  };
});
