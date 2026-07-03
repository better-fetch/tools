import { defineTool, type Bf } from "@better-fetch/tools";

type Sort = "relevance" | "pub_date";
type DateType = "pdat" | "edat";

type Input = {
  query: string;
  max_results?: number;
  sort?: Sort;
  min_date?: string;
  max_date?: string;
  date_type?: DateType;
  article_type?: string;
  journal?: string;
  include_abstracts?: boolean;
  include_mesh_terms?: boolean;
};

type SearchResponse = {
  esearchresult?: {
    count?: string;
    idlist?: string[];
    querytranslation?: string;
    errorlist?: unknown;
  };
  error?: string;
};

type SummaryAuthor = { name?: string };
type ArticleId = { idtype?: string; value?: string };
type SummaryRecord = {
  uid?: string;
  title?: string;
  fulljournalname?: string;
  source?: string;
  pubdate?: string;
  epubdate?: string;
  authors?: SummaryAuthor[];
  articleids?: ArticleId[];
  pubtype?: string[];
  lang?: string[];
  volume?: string;
  issue?: string;
  pages?: string;
};

type SummaryResponse = {
  result?: {
    uids?: string[];
    [pmid: string]: SummaryRecord | string[] | undefined;
  };
  error?: string;
};

type DetailRecord = {
  abstract?: string;
  mesh_terms?: string;
  keywords?: string;
};

type ArticleRecord = {
  rank: number;
  pmid: string;
  title?: string;
  article_url: string;
  journal?: string;
  full_journal_name?: string;
  pub_date?: string;
  epub_date?: string;
  authors?: string;
  first_author?: string;
  last_author?: string;
  doi?: string;
  publication_types?: string;
  language?: string;
  source?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  abstract?: string;
  mesh_terms?: string;
  keywords?: string;
};

type Output = {
  query: string;
  source_url: string;
  count: number;
  total_matches?: number;
  articles: ArticleRecord[];
};

const BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const TOOL = "better_fetch_pubmed_scraper";
const EMAIL = "support@betterfetch.co";

function cleanQuery(value: string): string {
  const clean = (value ?? "").replace(/\s+/g, " ").trim();
  if (clean.length < 2) throw new Error("query must contain at least two characters");
  return clean.slice(0, 300);
}

function limitFrom(value: number | undefined): number {
  return Math.min(Math.max(value ?? 10, 1), 20);
}

function sortFrom(value: Sort | undefined): Sort {
  return value === "pub_date" ? "pub_date" : "relevance";
}

function dateTypeFrom(value: DateType | undefined): DateType {
  return value === "edat" ? "edat" : "pdat";
}

function cleanDate(value: string | undefined, field: string): string | undefined {
  const clean = (value ?? "").trim();
  if (!clean) return undefined;
  if (!/^\d{4}(?:\/\d{2}(?:\/\d{2})?)?$/.test(clean)) {
    throw new Error(`${field} must use YYYY, YYYY/MM, or YYYY/MM/DD format`);
  }
  return clean;
}

function cleanFilter(value: string | undefined, field: string): string | undefined {
  const clean = (value ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return undefined;
  if (!/^[A-Za-z0-9 .,:'()/-]{2,120}$/.test(clean)) {
    throw new Error(`${field} contains unsupported characters`);
  }
  return clean;
}

function queryString(params: Record<string, string | number | undefined>): string {
  return Object.entries(params)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined && entry[1] !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
}

function applyFilters(input: Input, query: string): string {
  const filters: string[] = [];
  const articleType = cleanFilter(input.article_type, "article_type");
  const journal = cleanFilter(input.journal, "journal");
  if (articleType) filters.push(`${articleType}[Publication Type]`);
  if (journal) filters.push(`${journal}[Journal]`);
  return filters.length ? `(${query}) AND ${filters.join(" AND ")}` : query;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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

function attr(attrs: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = attrs.match(new RegExp(`${escaped}=["']([^"']*)["']`, "i"));
  return match?.[1] ? decodeEntities(match[1]).trim() : undefined;
}

async function fetchText(bf: Bf, url: string): Promise<string> {
  const response = await bf.fetch({
    url,
    strategy: "http",
    return_response_text: true,
    extra_headers: {
      accept: "application/json,application/xml,text/xml,*/*;q=0.5",
    },
  });
  if (!response.ok || !response.body_text) {
    throw new Error(`NCBI request failed with status ${response.status ?? "unknown"}`);
  }
  return response.body_text;
}

async function fetchJson<T>(bf: Bf, url: string): Promise<T> {
  const text = await fetchText(bf, url);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("NCBI returned invalid JSON");
  }
}

function articleId(item: SummaryRecord | undefined, type: string): string | undefined {
  return item?.articleids?.find((id) => id.idtype === type)?.value;
}

function names(authors: SummaryAuthor[] | undefined): string[] {
  return (authors ?? []).map((author) => stringValue(author.name)).filter((name): name is string => Boolean(name));
}

function joinList(values: (string | undefined)[] | undefined, limit = 30): string | undefined {
  const clean = (values ?? []).filter((value): value is string => Boolean(value && value.trim()));
  return clean.length ? clean.slice(0, limit).join(", ") : undefined;
}

function splitArticles(xml: string): string[] {
  return [...xml.matchAll(/<PubmedArticle\b[\s\S]*?<\/PubmedArticle>/gi)].map((match) => match[0]);
}

function pmidFromXml(segment: string): string | undefined {
  return segment.match(/<PMID[^>]*>(\d+)<\/PMID>/i)?.[1];
}

function abstractFromXml(segment: string): string | undefined {
  const parts: string[] = [];
  for (const match of segment.matchAll(/<AbstractText([^>]*)>([\s\S]*?)<\/AbstractText>/gi)) {
    const label = attr(match[1], "Label");
    const text = stripTags(match[2]);
    if (!text) continue;
    parts.push(label ? `${label}: ${text}` : text);
  }
  return parts.length ? parts.join(" ") : undefined;
}

function meshFromXml(segment: string): string | undefined {
  const terms = new Set<string>();
  for (const match of segment.matchAll(/<DescriptorName[^>]*>([\s\S]*?)<\/DescriptorName>/gi)) {
    const term = stripTags(match[1]);
    if (term) terms.add(term);
  }
  return terms.size ? [...terms].slice(0, 40).join(", ") : undefined;
}

function keywordsFromXml(segment: string): string | undefined {
  const terms = new Set<string>();
  for (const match of segment.matchAll(/<Keyword[^>]*>([\s\S]*?)<\/Keyword>/gi)) {
    const term = stripTags(match[1]);
    if (term) terms.add(term);
  }
  return terms.size ? [...terms].slice(0, 40).join(", ") : undefined;
}

function parseDetails(xml: string, includeAbstracts: boolean, includeMeshTerms: boolean): Map<string, DetailRecord> {
  const details = new Map<string, DetailRecord>();
  for (const segment of splitArticles(xml)) {
    const pmid = pmidFromXml(segment);
    if (!pmid) continue;
    details.set(
      pmid,
      compact({
        abstract: includeAbstracts ? abstractFromXml(segment) : undefined,
        mesh_terms: includeMeshTerms ? meshFromXml(segment) : undefined,
        keywords: includeMeshTerms ? keywordsFromXml(segment) : undefined,
      }),
    );
  }
  return details;
}

function articleRecord(pmid: string, rank: number, item: SummaryRecord | undefined, detail?: DetailRecord): ArticleRecord {
  const authorNames = names(item?.authors);
  return compact({
    rank,
    pmid,
    title: stringValue(item?.title),
    article_url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
    journal: stringValue(item?.source),
    full_journal_name: stringValue(item?.fulljournalname),
    pub_date: stringValue(item?.pubdate),
    epub_date: stringValue(item?.epubdate),
    authors: joinList(authorNames, 40),
    first_author: authorNames[0],
    last_author: authorNames.length > 1 ? authorNames[authorNames.length - 1] : undefined,
    doi: articleId(item, "doi"),
    publication_types: joinList(item?.pubtype),
    language: joinList(item?.lang),
    source: "PubMed",
    volume: stringValue(item?.volume),
    issue: stringValue(item?.issue),
    pages: stringValue(item?.pages),
    abstract: detail?.abstract,
    mesh_terms: detail?.mesh_terms,
    keywords: detail?.keywords,
  });
}

export default defineTool<Input, Output>(async (input, bf) => {
  const query = cleanQuery(input.query);
  const filteredQuery = applyFilters(input, query);
  const maxResults = limitFrom(input.max_results);
  const minDate = cleanDate(input.min_date, "min_date");
  const maxDate = cleanDate(input.max_date, "max_date");
  const dateType = dateTypeFrom(input.date_type);
  const searchUrl = `${BASE}/esearch.fcgi?${queryString({
    db: "pubmed",
    term: filteredQuery,
    retmax: maxResults,
    sort: sortFrom(input.sort),
    retmode: "json",
    datetype: minDate || maxDate ? dateType : undefined,
    mindate: minDate,
    maxdate: maxDate,
    tool: TOOL,
    email: EMAIL,
  })}`;
  const search = await fetchJson<SearchResponse>(bf, searchUrl);
  if (search.error) throw new Error(search.error);
  const ids = search.esearchresult?.idlist ?? [];
  if (!ids.length) {
    return {
      query: filteredQuery,
      source_url: searchUrl,
      count: 0,
      total_matches: numberValue(search.esearchresult?.count),
      articles: [],
    };
  }

  const summaryUrl = `${BASE}/esummary.fcgi?${queryString({
    db: "pubmed",
    id: ids.join(","),
    retmode: "json",
    tool: TOOL,
    email: EMAIL,
  })}`;
  const summary = await fetchJson<SummaryResponse>(bf, summaryUrl);
  if (summary.error) throw new Error(summary.error);

  let details = new Map<string, DetailRecord>();
  const includeAbstracts = input.include_abstracts !== false;
  const includeMeshTerms = input.include_mesh_terms !== false;
  if (includeAbstracts || includeMeshTerms) {
    const fetchUrl = `${BASE}/efetch.fcgi?${queryString({
      db: "pubmed",
      id: ids.join(","),
      retmode: "xml",
      tool: TOOL,
      email: EMAIL,
    })}`;
    const xml = await fetchText(bf, fetchUrl);
    details = parseDetails(xml, includeAbstracts, includeMeshTerms);
  }

  const articles = ids.map((pmid, index) => {
    const raw = summary.result?.[pmid];
    const item = raw && !Array.isArray(raw) ? (raw as SummaryRecord) : undefined;
    return articleRecord(pmid, index + 1, item, details.get(pmid));
  });

  return {
    query: filteredQuery,
    source_url: searchUrl,
    count: articles.length,
    total_matches: numberValue(search.esearchresult?.count),
    articles,
  };
});
