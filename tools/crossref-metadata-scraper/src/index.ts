import { defineTool, type Bf } from "@better-fetch/tools";

type Mode = "search" | "doi";
type Sort = "relevance" | "published" | "updated" | "deposited" | "is-referenced-by-count";
type Order = "desc" | "asc";

type Input = {
  mode?: Mode;
  doi?: string;
  query?: string;
  query_title?: string;
  query_author?: string;
  filter?: string;
  type?: string;
  from_pub_date?: string;
  until_pub_date?: string;
  max_results?: number;
  sort?: Sort;
  order?: Order;
  mailto?: string;
  include_abstract?: boolean;
  include_references?: boolean;
};

type DateParts = { "date-parts"?: unknown };
type DateTime = { "date-time"?: string };
type Author = { given?: string; family?: string; name?: string; ORCID?: string };
type Funder = { name?: string; DOI?: string; award?: string[] };
type License = { URL?: string; "content-version"?: string; "delay-in-days"?: number };
type Reference = { DOI?: string; doi?: string; key?: string; "article-title"?: string };

type CrossrefWork = {
  DOI?: string;
  title?: string[];
  subtitle?: string[];
  abstract?: string;
  URL?: string;
  type?: string;
  publisher?: string;
  prefix?: string;
  member?: string;
  score?: number;
  author?: Author[];
  "container-title"?: string[];
  "short-container-title"?: string[];
  volume?: string;
  issue?: string;
  page?: string;
  subject?: string[];
  ISSN?: string[];
  ISBN?: string[];
  published?: DateParts;
  "published-print"?: DateParts;
  "published-online"?: DateParts;
  issued?: DateParts;
  created?: DateParts;
  deposited?: DateTime;
  indexed?: DateTime;
  "is-referenced-by-count"?: number;
  "reference-count"?: number;
  funder?: Funder[];
  license?: License[];
  reference?: Reference[];
};

type CrossrefResponse = {
  status?: string;
  message?: {
    items?: CrossrefWork[];
    "total-results"?: number;
  } & CrossrefWork;
  message_type?: string;
  message_version?: string;
};

type WorkRecord = {
  rank: number;
  doi: string;
  doi_url: string;
  title?: string;
  subtitle?: string;
  work_url?: string;
  type?: string;
  publisher?: string;
  container_title?: string;
  short_container_title?: string;
  publication_date?: string;
  publication_year?: number;
  authors?: string;
  first_author?: string;
  last_author?: string;
  orcids?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  issn?: string;
  isbn?: string;
  subject?: string;
  citation_count?: number;
  reference_count?: number;
  funders?: string;
  licenses?: string;
  abstract?: string;
  reference_dois?: string;
  deposited_at?: string;
  indexed_at?: string;
  score?: number;
  member?: string;
  prefix?: string;
};

type Output = {
  mode: Mode;
  source_url: string;
  query?: string;
  doi?: string;
  count: number;
  total_matches?: number;
  works: WorkRecord[];
};

const BASE = "https://api.crossref.org";
const DEFAULT_MAILTO = "support@betterfetch.co";

function modeFrom(input: Input): Mode {
  if (input.mode === "doi" || input.doi) return "doi";
  return "search";
}

function limitFrom(value: number | undefined): number {
  return Math.min(Math.max(value ?? 10, 1), 20);
}

function sortFrom(value: Sort | undefined): Sort | undefined {
  return value && value !== "relevance" ? value : undefined;
}

function orderFrom(value: Order | undefined): Order {
  return value === "asc" ? "asc" : "desc";
}

function cleanText(value: string | undefined, field: string, max = 240): string | undefined {
  const clean = (value ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return undefined;
  if (clean.length < 2) throw new Error(`${field} must contain at least two characters`);
  return clean.slice(0, max);
}

function cleanMailto(value: string | undefined): string {
  const clean = (value ?? DEFAULT_MAILTO).trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) throw new Error("mailto must be a valid email address");
  return clean.slice(0, 160);
}

function cleanDate(value: string | undefined, field: string): string | undefined {
  const clean = (value ?? "").trim();
  if (!clean) return undefined;
  if (!/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(clean)) {
    throw new Error(`${field} must use YYYY, YYYY-MM, or YYYY-MM-DD format`);
  }
  return clean;
}

function cleanType(value: string | undefined): string | undefined {
  const clean = (value ?? "").trim().toLowerCase();
  if (!clean) return undefined;
  if (!/^[a-z][a-z0-9-]{1,60}$/.test(clean)) throw new Error("type must be a Crossref work type such as journal-article");
  return clean;
}

function cleanFilter(value: string | undefined): string | undefined {
  const clean = (value ?? "").replace(/\s+/g, "").trim();
  if (!clean) return undefined;
  if (!/^[A-Za-z0-9_.:,/@+-]{2,320}$/.test(clean)) {
    throw new Error("filter must use Crossref filter syntax, e.g. type:journal-article,from-pub-date:2024");
  }
  return clean;
}

function cleanDoi(value: string | undefined): string {
  const clean = (value ?? "")
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:/i, "")
    .trim();
  if (!/^10\.\d{4,9}\/\S{1,180}$/.test(clean)) {
    throw new Error("doi must be a DOI such as 10.1038/nature14539 or https://doi.org/10.1038/nature14539");
  }
  return clean;
}

function queryString(params: Record<string, string | number | undefined>): string {
  return Object.entries(params)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined && entry[1] !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
}

function buildFilter(input: Input): string | undefined {
  const parts: string[] = [];
  const raw = cleanFilter(input.filter);
  if (raw) parts.push(raw);
  const type = cleanType(input.type);
  if (type) parts.push(`type:${type}`);
  const fromDate = cleanDate(input.from_pub_date, "from_pub_date");
  if (fromDate) parts.push(`from-pub-date:${fromDate}`);
  const untilDate = cleanDate(input.until_pub_date, "until_pub_date");
  if (untilDate) parts.push(`until-pub-date:${untilDate}`);
  return parts.length ? parts.join(",") : undefined;
}

function buildUrl(input: Input, mode: Mode, mailto: string): { url: string; query?: string; doi?: string } {
  if (mode === "doi") {
    const doi = cleanDoi(input.doi);
    return {
      doi,
      url: `${BASE}/works/${encodeURIComponent(doi)}?${queryString({ mailto })}`,
    };
  }

  const query = cleanText(input.query, "query");
  const queryTitle = cleanText(input.query_title, "query_title");
  const queryAuthor = cleanText(input.query_author, "query_author");
  const filter = buildFilter(input);
  if (!query && !queryTitle && !queryAuthor && !filter) {
    throw new Error("search mode requires query, query_title, query_author, filter, or a date/type filter");
  }
  const label = [query, queryTitle, queryAuthor, filter].filter(Boolean).join(" | ");
  return {
    query: label,
    url: `${BASE}/works?${queryString({
      "query.bibliographic": query,
      "query.title": queryTitle,
      "query.author": queryAuthor,
      filter,
      rows: limitFrom(input.max_results),
      sort: sortFrom(input.sort),
      order: orderFrom(input.order),
      mailto,
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

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function first(values: string[] | undefined): string | undefined {
  return (values ?? []).find((value) => Boolean(value?.trim()))?.trim();
}

function joinList(values: (string | undefined)[] | undefined, limit = 30): string | undefined {
  const clean = (values ?? []).filter((value): value is string => Boolean(value?.trim()));
  return clean.length ? clean.slice(0, limit).join(", ") : undefined;
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

function stripTags(value: string | undefined): string | undefined {
  const clean = decodeEntities((value ?? "").replace(/<[^>]*>/g, " "))
    .replace(/\s{2,}/g, " ")
    .trim();
  return clean || undefined;
}

function dateFromParts(value: DateParts | undefined): string | undefined {
  const raw = value?.["date-parts"];
  if (!Array.isArray(raw) || !Array.isArray(raw[0])) return undefined;
  const parts = raw[0].filter((part): part is number => typeof part === "number" && Number.isFinite(part));
  if (!parts.length) return undefined;
  const [year, month, day] = parts;
  const date = [year, month, day]
    .filter((part): part is number => part !== undefined)
    .map((part, index) => (index === 0 ? String(part) : String(part).padStart(2, "0")))
    .join("-");
  return date || undefined;
}

function authorName(author: Author): string | undefined {
  const named = stringValue(author.name);
  if (named) return named;
  return [stringValue(author.given), stringValue(author.family)].filter(Boolean).join(" ").trim() || undefined;
}

function orcid(value: string | undefined): string | undefined {
  return stringValue(value)?.replace(/^https?:\/\/orcid\.org\//i, "");
}

function funderLabel(funder: Funder): string | undefined {
  const name = stringValue(funder.name);
  if (!name) return undefined;
  const awards = joinList(funder.award, 5);
  return awards ? `${name} (${awards})` : name;
}

function licenseLabel(license: License): string | undefined {
  const url = stringValue(license.URL);
  if (!url) return undefined;
  const version = stringValue(license["content-version"]);
  return version ? `${version}: ${url}` : url;
}

function referenceDoiList(references: Reference[] | undefined): string | undefined {
  const dois = (references ?? [])
    .map((reference) => stringValue(reference.DOI) ?? stringValue(reference.doi))
    .filter((doi): doi is string => Boolean(doi));
  return joinList(dois, 40);
}

function workRecord(work: CrossrefWork, rank: number, includeAbstract: boolean, includeReferences: boolean): WorkRecord | undefined {
  const doi = stringValue(work.DOI);
  if (!doi) return undefined;
  const authors = (work.author ?? []).map(authorName).filter((name): name is string => Boolean(name));
  const orcids = (work.author ?? []).map((author) => orcid(author.ORCID)).filter((id): id is string => Boolean(id));
  const publicationDate =
    dateFromParts(work.published) ??
    dateFromParts(work.issued) ??
    dateFromParts(work["published-online"]) ??
    dateFromParts(work["published-print"]);
  const publicationYear = publicationDate ? Number(publicationDate.slice(0, 4)) : undefined;
  return compact({
    rank,
    doi,
    doi_url: `https://doi.org/${doi}`,
    title: first(work.title),
    subtitle: first(work.subtitle),
    work_url: stringValue(work.URL),
    type: stringValue(work.type),
    publisher: stringValue(work.publisher),
    container_title: first(work["container-title"]),
    short_container_title: first(work["short-container-title"]),
    publication_date: publicationDate,
    publication_year: numberValue(publicationYear),
    authors: joinList(authors, 40),
    first_author: authors[0],
    last_author: authors.length > 1 ? authors[authors.length - 1] : undefined,
    orcids: joinList(orcids, 20),
    volume: stringValue(work.volume),
    issue: stringValue(work.issue),
    pages: stringValue(work.page),
    issn: joinList(work.ISSN),
    isbn: joinList(work.ISBN),
    subject: joinList(work.subject, 30),
    citation_count: numberValue(work["is-referenced-by-count"]),
    reference_count: numberValue(work["reference-count"]),
    funders: joinList((work.funder ?? []).map(funderLabel), 12),
    licenses: joinList((work.license ?? []).map(licenseLabel), 8),
    abstract: includeAbstract ? stripTags(work.abstract)?.slice(0, 5000) : undefined,
    reference_dois: includeReferences ? referenceDoiList(work.reference) : undefined,
    deposited_at: stringValue(work.deposited?.["date-time"]),
    indexed_at: stringValue(work.indexed?.["date-time"]),
    score: numberValue(work.score),
    member: stringValue(work.member),
    prefix: stringValue(work.prefix),
  });
}

async function fetchJson(bf: Bf, url: string, mailto: string): Promise<CrossrefResponse> {
  const response = await bf.fetch({
    url,
    strategy: "http",
    return_response_text: true,
    extra_headers: {
      accept: "application/json,*/*;q=0.5",
      "user-agent": `BetterFetchCrossrefMetadataScraper/0.1 (https://betterfetch.co/tools/crossref_metadata_scraper; mailto:${mailto})`,
    },
  });
  if (!response.ok || !response.body_text) {
    throw new Error(`Crossref request failed with status ${response.status ?? "unknown"}`);
  }
  try {
    return JSON.parse(response.body_text) as CrossrefResponse;
  } catch {
    throw new Error("Crossref returned invalid JSON");
  }
}

export default defineTool<Input, Output>(async (input, bf) => {
  const mode = modeFrom(input);
  const mailto = cleanMailto(input.mailto);
  const built = buildUrl(input, mode, mailto);
  const data = await fetchJson(bf, built.url, mailto);
  if (data.status && data.status !== "ok") throw new Error(`Crossref API status: ${data.status}`);
  const includeAbstract = input.include_abstract === true;
  const includeReferences = input.include_references === true;
  const works =
    mode === "doi"
      ? [data.message as CrossrefWork]
      : (data.message?.items ?? []);
  const records = works
    .map((work, index) => workRecord(work, index + 1, includeAbstract, includeReferences))
    .filter((work): work is WorkRecord => Boolean(work));
  return {
    mode,
    source_url: built.url,
    query: built.query,
    doi: built.doi,
    count: records.length,
    total_matches: mode === "search" ? numberValue(data.message?.["total-results"]) : undefined,
    works: records,
  };
});
