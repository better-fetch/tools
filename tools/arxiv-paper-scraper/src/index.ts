import { defineTool, type Bf } from "@better-fetch/tools";

type Mode = "search" | "id";
type SortBy = "relevance" | "lastUpdatedDate" | "submittedDate";
type SortOrder = "ascending" | "descending";

type Input = {
  mode?: Mode;
  arxiv_id?: string;
  query?: string;
  title?: string;
  author?: string;
  abstract?: string;
  category?: string;
  max_results?: number;
  start?: number;
  sort_by?: SortBy;
  sort_order?: SortOrder;
  include_abstract?: boolean;
};

type PaperRecord = {
  rank: number;
  arxiv_id: string;
  version?: string;
  title?: string;
  abstract?: string;
  authors?: string;
  first_author?: string;
  last_author?: string;
  affiliations?: string;
  primary_category?: string;
  categories?: string;
  published_at?: string;
  updated_at?: string;
  abs_url: string;
  pdf_url?: string;
  doi?: string;
  journal_ref?: string;
  comment?: string;
};

type Output = {
  mode: Mode;
  source_url: string;
  query?: string;
  arxiv_id?: string;
  count: number;
  total_matches?: number;
  start_index?: number;
  items_per_page?: number;
  papers: PaperRecord[];
  acknowledgement: string;
};

const BASE = "https://export.arxiv.org/api/query";
const USER_AGENT =
  "BetterFetchArxivPaperScraper/0.1 (https://betterfetch.co/tools/arxiv_paper_scraper; support@betterfetch.co)";
const ACKNOWLEDGEMENT =
  "Thank you to arXiv for use of its open access interoperability. This tool was not reviewed or approved by, nor does it necessarily express or reflect the policies or opinions of, arXiv.";

function modeFrom(input: Input): Mode {
  if (input.mode === "id" || input.arxiv_id) return "id";
  return "search";
}

function limitFrom(value: number | undefined): number {
  return Math.min(Math.max(value ?? 10, 1), 20);
}

function startFrom(value: number | undefined): number {
  return Math.min(Math.max(value ?? 0, 0), 5000);
}

function sortByFrom(value: SortBy | undefined): SortBy {
  return value ?? "relevance";
}

function sortOrderFrom(value: SortOrder | undefined): SortOrder {
  return value === "ascending" ? "ascending" : "descending";
}

function cleanText(value: string | undefined, field: string, max = 260): string | undefined {
  const clean = (value ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return undefined;
  if (clean.length < 2) throw new Error(`${field} must contain at least two characters`);
  if (!/^[A-Za-z0-9 _.,:;'"()\\/+*?!&|-]+$/.test(clean)) {
    throw new Error(`${field} contains unsupported characters`);
  }
  return clean.slice(0, max);
}

function cleanFieldValue(value: string | undefined, field: string): string | undefined {
  const clean = cleanText(value, field, 160);
  if (!clean) return undefined;
  return `"${clean.replace(/"/g, "")}"`;
}

function cleanCategory(value: string | undefined): string | undefined {
  const clean = (value ?? "").trim();
  if (!clean) return undefined;
  if (!/^[a-z]+(?:-[a-z]+)?(?:\.[A-Za-z0-9-]+)?$/.test(clean)) {
    throw new Error("category must be an arXiv category such as cs.CL, cs.LG, stat.ML, quant-ph, or hep-th");
  }
  return clean;
}

function cleanArxivId(value: string | undefined): string {
  const clean = (value ?? "")
    .trim()
    .replace(/^https?:\/\/arxiv\.org\/(?:abs|pdf)\//i, "")
    .replace(/\.pdf$/i, "");
  if (!/^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?$/i.test(clean)) {
    throw new Error("arxiv_id must look like 2303.08774, 2303.08774v6, or hep-th/9901001");
  }
  return clean;
}

function queryString(params: Record<string, string | number | undefined>): string {
  return Object.entries(params)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined && entry[1] !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
}

function buildSearchQuery(input: Input): string {
  const raw = cleanText(input.query, "query", 300);
  const parts: string[] = [];
  if (raw) parts.push(raw);
  const title = cleanFieldValue(input.title, "title");
  if (title) parts.push(`ti:${title}`);
  const author = cleanFieldValue(input.author, "author");
  if (author) parts.push(`au:${author}`);
  const abstract = cleanFieldValue(input.abstract, "abstract");
  if (abstract) parts.push(`abs:${abstract}`);
  const category = cleanCategory(input.category);
  if (category) parts.push(`cat:${category}`);
  if (!parts.length) throw new Error("search mode requires query, title, author, abstract, category, or arxiv_id");
  // arXiv's query parser groups right-to-left, so an unparenthesized join like
  // `all:large language models AND cat:cs.CL` parses as
  // `all:large OR (all:language OR (all:models AND cat:cs.CL))` — the added
  // fields stop constraining the query. Group each part explicitly.
  if (parts.length === 1) return parts[0];
  return parts.map((part) => `(${part})`).join(" AND ");
}

function buildUrl(input: Input, mode: Mode): { url: string; query?: string; arxivId?: string } {
  if (mode === "id") {
    const arxivId = cleanArxivId(input.arxiv_id);
    return {
      arxivId,
      url: `${BASE}?${queryString({
        id_list: arxivId,
        max_results: 1,
      })}`,
    };
  }

  const query = buildSearchQuery(input);
  return {
    query,
    url: `${BASE}?${queryString({
      search_query: query,
      start: startFrom(input.start),
      max_results: limitFrom(input.max_results),
      sortBy: sortByFrom(input.sort_by),
      sortOrder: sortOrderFrom(input.sort_order),
    })}`,
  };
}

function compact<T extends Record<string, unknown>>(record: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined && value !== "" && value !== null) out[key] = value;
  }
  return out as T;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function stripTags(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/g, " "))
    .replace(/\s{2,}/g, " ")
    .trim();
}

function tag(segment: string, name: string): string | undefined {
  const match = segment.match(new RegExp(`<(?:[a-z]+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-z]+:)?${name}>`, "i"));
  const clean = match?.[1] ? stripTags(match[1]) : undefined;
  return clean || undefined;
}

function attr(attrs: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = attrs.match(new RegExp(`${escaped}=["']([^"']*)["']`, "i"));
  return match?.[1] ? decodeEntities(match[1]).trim() : undefined;
}

function numberTag(feed: string, name: string): number | undefined {
  const value = tag(feed, name);
  return value && /^\d+$/.test(value) ? Number(value) : undefined;
}

function splitEntries(xml: string): string[] {
  return [...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map((match) => match[0]);
}

function entryLinks(segment: string): { absUrl?: string; pdfUrl?: string } {
  let absUrl: string | undefined;
  let pdfUrl: string | undefined;
  for (const match of segment.matchAll(/<link\b([^>]*)\/?>/gi)) {
    const href = attr(match[1], "href");
    const type = attr(match[1], "type");
    const title = attr(match[1], "title");
    const rel = attr(match[1], "rel");
    if (!href) continue;
    if (title === "pdf" || type === "application/pdf" || href.includes("/pdf/")) pdfUrl = href;
    if (rel === "alternate" || type === "text/html" || href.includes("/abs/")) absUrl = href;
  }
  return { absUrl, pdfUrl };
}

function categories(segment: string): string[] {
  const values: string[] = [];
  for (const match of segment.matchAll(/<category\b([^>]*)\/?>/gi)) {
    const term = attr(match[1], "term");
    if (term) values.push(term);
  }
  return [...new Set(values)];
}

function primaryCategory(segment: string): string | undefined {
  const match = segment.match(/<arxiv:primary_category\b([^>]*)\/?>/i);
  return match ? attr(match[1], "term") : undefined;
}

function authorRecords(segment: string): { names: string[]; affiliations: string[] } {
  const names: string[] = [];
  const affiliations: string[] = [];
  for (const match of segment.matchAll(/<author\b[^>]*>([\s\S]*?)<\/author>/gi)) {
    const author = match[1];
    const name = tag(author, "name")?.replace(/\s+/g, " ").trim();
    if (name) names.push(name);
    const affiliation = tag(author, "affiliation")?.replace(/\s+/g, " ").trim();
    if (affiliation) affiliations.push(affiliation);
  }
  return { names, affiliations: [...new Set(affiliations)] };
}

function arxivIdFromUrl(value: string | undefined): { arxivId?: string; version?: string; absUrl?: string } {
  const clean = value?.trim();
  if (!clean) return {};
  const arxivId = clean.replace(/^https?:\/\/arxiv\.org\/abs\//i, "");
  const version = arxivId.match(/v\d+$/i)?.[0];
  return { arxivId, version, absUrl: `https://arxiv.org/abs/${arxivId}` };
}

function joinList(values: string[], limit = 40): string | undefined {
  const clean = values.filter((value) => Boolean(value.trim()));
  return clean.length ? clean.slice(0, limit).join(", ") : undefined;
}

function paperRecord(segment: string, rank: number, includeAbstract: boolean): PaperRecord | undefined {
  const title = tag(segment, "title");
  if (title === "Error") {
    const message = tag(segment, "summary") ?? "arXiv API error";
    throw new Error(message);
  }
  const id = arxivIdFromUrl(tag(segment, "id"));
  if (!id.arxivId) return undefined;
  const links = entryLinks(segment);
  const cats = categories(segment);
  const authors = authorRecords(segment);
  return compact({
    rank,
    arxiv_id: id.arxivId,
    version: id.version,
    title,
    abstract: includeAbstract ? tag(segment, "summary") : undefined,
    authors: joinList(authors.names),
    first_author: authors.names[0],
    last_author: authors.names.length > 1 ? authors.names[authors.names.length - 1] : undefined,
    affiliations: joinList(authors.affiliations, 20),
    primary_category: primaryCategory(segment),
    categories: joinList(cats, 30),
    published_at: tag(segment, "published"),
    updated_at: tag(segment, "updated"),
    abs_url: links.absUrl ?? id.absUrl ?? `https://arxiv.org/abs/${id.arxivId}`,
    pdf_url: links.pdfUrl ?? `https://arxiv.org/pdf/${id.arxivId}`,
    doi: tag(segment, "doi"),
    journal_ref: tag(segment, "journal_ref"),
    comment: tag(segment, "comment"),
  });
}

async function fetchAtom(bf: Bf, url: string): Promise<string> {
  const response = await bf.fetch({
    url,
    strategy: "http",
    return_response_text: true,
    extra_headers: {
      accept: "application/atom+xml,application/xml,text/xml,*/*;q=0.5",
      "user-agent": USER_AGENT,
    },
  });
  if (!response.ok || !response.body_text) {
    throw new Error(`arXiv request failed with status ${response.status ?? "unknown"}`);
  }
  return response.body_text;
}

const MAX_ATTEMPTS = 3;

// The arXiv API intermittently returns an empty feed for valid queries due to
// load balancing (arXiv's API docs recommend retrying). Retry when the feed has
// zero entries but the OpenSearch metadata does not confirm an empty result set.
async function fetchFeed(bf: Bf, url: string): Promise<{ xml: string; entries: string[] }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let xml: string;
    try {
      xml = await fetchAtom(bf, url);
    } catch (error) {
      lastError = error;
      continue;
    }
    const entries = splitEntries(xml);
    if (entries.length || numberTag(xml, "totalResults") === 0) return { xml, entries };
    lastError = new Error("arXiv returned an empty feed for a non-empty result set");
  }
  throw lastError instanceof Error ? lastError : new Error("arXiv request failed");
}

export default defineTool<Input, Output>(async (input, bf) => {
  const mode = modeFrom(input);
  const built = buildUrl(input, mode);
  const { xml, entries } = await fetchFeed(bf, built.url);
  const includeAbstract = input.include_abstract !== false;
  const papers = entries
    .map((entry, index) => paperRecord(entry, index + 1, includeAbstract))
    .filter((paper): paper is PaperRecord => Boolean(paper));
  return {
    mode,
    source_url: built.url,
    query: built.query,
    arxiv_id: built.arxivId,
    count: papers.length,
    total_matches: numberTag(xml, "totalResults"),
    start_index: numberTag(xml, "startIndex"),
    items_per_page: numberTag(xml, "itemsPerPage"),
    papers,
    acknowledgement: ACKNOWLEDGEMENT,
  };
});
