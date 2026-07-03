import { defineTool, type Bf } from "@better-fetch/tools";

type Mode = "search" | "work";
type Sort = "relevance_score" | "cited_by_count:desc" | "publication_date:desc" | "publication_year:desc";
type JsonObject = Record<string, unknown>;

type Input = {
  mode?: Mode;
  work_id?: string;
  query?: string;
  filter?: string;
  from_publication_date?: string;
  to_publication_date?: string;
  publication_year?: number;
  type?: string;
  is_open_access?: boolean;
  per_page?: number;
  page?: number;
  sort?: Sort;
  include_abstract?: boolean;
};

type WorkRecord = {
  rank: number;
  openalex_id: string;
  openalex_work_id?: string;
  doi?: string;
  title?: string;
  publication_year?: number;
  publication_date?: string;
  type?: string;
  cited_by_count?: number;
  referenced_works_count?: number;
  authors?: string;
  first_author?: string;
  last_author?: string;
  orcid_ids?: string;
  institutions?: string;
  countries?: string;
  source?: string;
  publisher?: string;
  landing_page_url?: string;
  pdf_url?: string;
  is_open_access?: boolean;
  oa_status?: string;
  oa_url?: string;
  concepts?: string;
  topics?: string;
  abstract?: string;
};

type Output = {
  mode: Mode;
  source_url: string;
  query?: string;
  work_id?: string;
  count: number;
  total_matches?: number;
  works: WorkRecord[];
};

const BASE = "https://api.openalex.org";
const SELECT = [
  "id",
  "doi",
  "title",
  "display_name",
  "publication_year",
  "publication_date",
  "type",
  "type_crossref",
  "cited_by_count",
  "referenced_works_count",
  "authorships",
  "primary_location",
  "open_access",
  "concepts",
  "topics",
  "abstract_inverted_index",
].join(",");
const USER_AGENT =
  "BetterFetchOpenAlexWorksScraper/0.1 (https://betterfetch.co/tools/openalex_works_scraper; support@betterfetch.co)";

function modeFrom(input: Input): Mode {
  if (input.mode === "work" || input.work_id) return "work";
  return "search";
}

function compact<T extends Record<string, unknown>>(record: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined && value !== "" && value !== null) out[key] = value;
  }
  return out as T;
}

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
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function joinList(values: (string | undefined)[] | undefined, limit = 30): string | undefined {
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const value of values ?? []) {
    const item = value?.replace(/\s+/g, " ").trim();
    if (!item || seen.has(item)) continue;
    seen.add(item);
    clean.push(item);
  }
  return clean.length ? clean.slice(0, limit).join(", ") : undefined;
}

function cleanText(value: string | undefined, field: string, max = 240): string | undefined {
  const clean = (value ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return undefined;
  if (clean.length < 2) throw new Error(`${field} must contain at least two characters`);
  if (!/^[\p{L}\p{N} _.,:;'"()[\]\\/+*?!&|/-]+$/u.test(clean)) {
    throw new Error(`${field} contains unsupported characters`);
  }
  return clean.slice(0, max);
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
  if (!/^[a-z][a-z0-9-]{1,70}$/.test(clean)) {
    throw new Error("type must be an OpenAlex work type such as article, preprint, book-chapter, or dataset");
  }
  return clean;
}

function cleanFilter(value: string | undefined): string | undefined {
  const clean = (value ?? "").replace(/\s+/g, "").trim();
  if (!clean) return undefined;
  if (!/^[A-Za-z0-9_.:,/@+%-]{2,400}$/.test(clean)) {
    throw new Error("filter must use OpenAlex filter syntax, e.g. type:article,from_publication_date:2024-01-01");
  }
  return clean;
}

function cleanWorkId(value: string | undefined): string {
  const clean = (value ?? "")
    .trim()
    .replace(/^https?:\/\/openalex\.org\//i, "")
    .replace(/^openalex:/i, "")
    .replace(/^doi:/i, "")
    .trim();
  if (/^W\d{6,20}$/i.test(clean)) return `https://openalex.org/${clean.toUpperCase()}`;
  if (/^10\.\d{4,9}\/\S{1,180}$/i.test(clean)) return `https://doi.org/${clean}`;
  if (/^https?:\/\/doi\.org\/10\.\d{4,9}\/\S{1,180}$/i.test(clean)) return clean;
  if (/^https?:\/\/openalex\.org\/W\d{6,20}$/i.test(value ?? "")) return value!.trim();
  throw new Error("work_id must be an OpenAlex work ID or DOI such as W2919115771 or 10.1038/nature14539");
}

function perPage(value: number | undefined): number {
  return Math.min(Math.max(value ?? 10, 1), 20);
}

function page(value: number | undefined): number {
  return Math.min(Math.max(value ?? 1, 1), 100);
}

function sort(value: Sort | undefined): Sort | undefined {
  return value && value !== "relevance_score" ? value : undefined;
}

function queryString(params: Record<string, string | number | undefined>): string {
  return Object.entries(params)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined && entry[1] !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
}

function filters(input: Input): string | undefined {
  const parts: string[] = [];
  const raw = cleanFilter(input.filter);
  if (raw) parts.push(raw);
  const fromDate = cleanDate(input.from_publication_date, "from_publication_date");
  if (fromDate) parts.push(`from_publication_date:${fromDate}`);
  const toDate = cleanDate(input.to_publication_date, "to_publication_date");
  if (toDate) parts.push(`to_publication_date:${toDate}`);
  if (input.publication_year !== undefined) {
    if (!Number.isInteger(input.publication_year) || input.publication_year < 1800 || input.publication_year > 2100) {
      throw new Error("publication_year must be an integer from 1800 to 2100");
    }
    parts.push(`publication_year:${input.publication_year}`);
  }
  const type = cleanType(input.type);
  if (type) parts.push(`type:${type}`);
  if (input.is_open_access !== undefined) parts.push(`is_oa:${input.is_open_access ? "true" : "false"}`);
  return parts.length ? parts.join(",") : undefined;
}

function buildUrl(input: Input, mode: Mode): { url: string; query?: string; workId?: string } {
  if (mode === "work") {
    const workId = cleanWorkId(input.work_id);
    return {
      workId,
      url: `${BASE}/works/${encodeURIComponent(workId)}?${queryString({ select: SELECT })}`,
    };
  }

  const query = cleanText(input.query, "query", 300);
  const filter = filters(input);
  if (!query && !filter) throw new Error("search mode requires query, filter, date/year/type/open-access filter, or work_id");
  return {
    query: [query, filter].filter(Boolean).join(" | "),
    url: `${BASE}/works?${queryString({
      search: query,
      filter,
      "per-page": perPage(input.per_page),
      page: page(input.page),
      sort: sort(input.sort),
      select: SELECT,
    })}`,
  };
}

function reconstructAbstract(index: unknown): string | undefined {
  const obj = objectValue(index);
  if (!obj) return undefined;
  const words: { word: string; position: number }[] = [];
  for (const [word, positions] of Object.entries(obj)) {
    for (const position of arrayValue(positions)) {
      const n = numberValue(position);
      if (n !== undefined) words.push({ word, position: n });
    }
  }
  if (!words.length) return undefined;
  return words
    .sort((a, b) => a.position - b.position)
    .map((entry) => entry.word)
    .join(" ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .slice(0, 5000);
}

function shortOpenAlexId(value: string | undefined): string | undefined {
  return value?.match(/\/(W\d+)$/i)?.[1]?.toUpperCase();
}

function authorNames(authorships: unknown[]): string[] {
  return authorships
    .map((item) => textValue(objectValue(objectValue(item)?.author)?.display_name) ?? textValue(objectValue(item)?.raw_author_name))
    .filter((name): name is string => Boolean(name));
}

function authorOrcids(authorships: unknown[]): string[] {
  return authorships
    .flatMap((item) => [
      textValue(objectValue(objectValue(item)?.author)?.orcid),
      textValue(objectValue(item)?.raw_orcid),
    ])
    .map((value) => value?.replace(/^https?:\/\/orcid\.org\//i, ""))
    .filter((value): value is string => Boolean(value));
}

function institutions(authorships: unknown[]): string[] {
  return authorships.flatMap((item) =>
    arrayValue(objectValue(item)?.institutions)
      .map((institution) => textValue(objectValue(institution)?.display_name))
      .filter((name): name is string => Boolean(name)),
  );
}

function countries(authorships: unknown[]): string[] {
  return authorships.flatMap((item) =>
    arrayValue(objectValue(item)?.countries)
      .map((country) => textValue(country))
      .filter((country): country is string => Boolean(country)),
  );
}

function labelsFrom(value: unknown, limit = 12): string | undefined {
  return joinList(
    arrayValue(value)
      .map((item) => textValue(objectValue(item)?.display_name))
      .filter((label): label is string => Boolean(label)),
    limit,
  );
}

function workRecord(work: JsonObject, rank: number, includeAbstract: boolean): WorkRecord | undefined {
  const id = textValue(work.id);
  if (!id) return undefined;
  const authorships = arrayValue(work.authorships);
  const authors = authorNames(authorships);
  const primaryLocation = objectValue(work.primary_location);
  const source = objectValue(primaryLocation?.source);
  const openAccess = objectValue(work.open_access);
  return compact({
    rank,
    openalex_id: id,
    openalex_work_id: shortOpenAlexId(id),
    doi: textValue(work.doi),
    title: textValue(work.title) ?? textValue(work.display_name),
    publication_year: numberValue(work.publication_year),
    publication_date: textValue(work.publication_date),
    type: textValue(work.type) ?? textValue(work.type_crossref),
    cited_by_count: numberValue(work.cited_by_count),
    referenced_works_count: numberValue(work.referenced_works_count),
    authors: joinList(authors, 40),
    first_author: authors[0],
    last_author: authors.length > 1 ? authors[authors.length - 1] : undefined,
    orcid_ids: joinList(authorOrcids(authorships), 30),
    institutions: joinList(institutions(authorships), 30),
    countries: joinList(countries(authorships), 30),
    source: textValue(source?.display_name) ?? textValue(primaryLocation?.raw_source_name),
    publisher: textValue(source?.host_organization_name),
    landing_page_url: textValue(primaryLocation?.landing_page_url),
    pdf_url: textValue(primaryLocation?.pdf_url),
    is_open_access: booleanValue(openAccess?.is_oa),
    oa_status: textValue(openAccess?.oa_status),
    oa_url: textValue(openAccess?.oa_url),
    concepts: labelsFrom(work.concepts, 12),
    topics: labelsFrom(work.topics, 12),
    abstract: includeAbstract ? reconstructAbstract(work.abstract_inverted_index) : undefined,
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
  if (!response.ok || !response.body_text) {
    throw new Error(`OpenAlex request failed with status ${response.status ?? "unknown"}`);
  }
  try {
    const data = JSON.parse(response.body_text) as unknown;
    const obj = objectValue(data);
    if (!obj) throw new Error("not an object");
    return obj;
  } catch {
    throw new Error("OpenAlex returned invalid JSON");
  }
}

export default defineTool<Input, Output>(async (input, bf) => {
  const mode = modeFrom(input);
  const built = buildUrl(input, mode);
  const data = await fetchJson(bf, built.url);
  const includeAbstract = input.include_abstract !== false;
  const rawWorks = mode === "work" ? [data] : arrayValue(data.results);
  const works = rawWorks
    .map((item, index) => {
      const obj = objectValue(item);
      return obj ? workRecord(obj, index + 1, includeAbstract) : undefined;
    })
    .filter((work): work is WorkRecord => Boolean(work));
  const meta = objectValue(data.meta);
  return {
    mode,
    source_url: built.url,
    query: built.query,
    work_id: built.workId,
    count: works.length,
    total_matches: mode === "search" ? numberValue(meta?.count) : undefined,
    works,
  };
});
