import { defineTool, type Bf } from "@better-fetch/tools";

type Mode = "page" | "search";
type ExtractMode = "intro" | "full";

type Input = {
  mode?: Mode;
  page_title?: string;
  page_url?: string;
  query?: string;
  language?: string;
  max_results?: number;
  extract?: ExtractMode;
  max_extract_chars?: number;
  include_categories?: boolean;
  include_links?: boolean;
};

type WikiCategory = { title?: string };
type WikiLink = { title?: string };
type WikiImage = { source?: string };

type WikiPage = {
  index?: number;
  pageid?: number;
  ns?: number;
  title?: string;
  extract?: string;
  fullurl?: string;
  touched?: string;
  lastrevid?: number;
  length?: number;
  thumbnail?: WikiImage;
  original?: WikiImage;
  pageprops?: {
    wikibase_item?: string;
    "wikibase-shortdesc"?: string;
  };
  categories?: WikiCategory[];
  links?: WikiLink[];
  missing?: string;
};

type WikiResponse = {
  query?: {
    pages?: Record<string, WikiPage>;
  };
  error?: {
    code?: string;
    info?: string;
  };
};

type ArticleRecord = {
  rank: number;
  title: string;
  pageid: number;
  language: string;
  page_url: string;
  extract?: string;
  extract_truncated?: boolean;
  wikidata_id?: string;
  short_description?: string;
  thumbnail_url?: string;
  original_image_url?: string;
  categories?: string;
  links?: string;
  last_revision_id?: number;
  page_length?: number;
  touched_at?: string;
};

type Output = {
  mode: Mode;
  language: string;
  source_url: string;
  query?: string;
  count: number;
  articles: ArticleRecord[];
};

const USER_AGENT =
  "BetterFetchWikipediaArticleScraper/0.1 (https://betterfetch.co/tools/wikipedia_article_scraper; support@betterfetch.co)";

function modeFrom(value: Mode | undefined): Mode {
  return value === "search" ? "search" : "page";
}

function extractModeFrom(value: ExtractMode | undefined): ExtractMode {
  return value === "full" ? "full" : "intro";
}

function languageFrom(value: string | undefined): string {
  const clean = (value ?? "en").trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]{1,14}$/.test(clean)) {
    throw new Error("language must be a Wikipedia language subdomain such as en, de, fr, es, pt, or simple");
  }
  return clean;
}

function limitFrom(value: number | undefined): number {
  return Math.min(Math.max(value ?? 5, 1), 10);
}

function maxExtractCharsFrom(value: number | undefined): number {
  return Math.min(Math.max(value ?? 4000, 500), 12000);
}

function cleanSearchQuery(value: string | undefined): string {
  const clean = (value ?? "").replace(/\s+/g, " ").trim();
  if (clean.length < 2) throw new Error("query must contain at least two characters in search mode");
  return clean.slice(0, 180);
}

function cleanPageTitle(value: string | undefined): string {
  const clean = (value ?? "").replace(/_/g, " ").replace(/\s+/g, " ").trim();
  if (clean.length < 2) throw new Error("page_title or page_url is required in page mode");
  return clean.slice(0, 180);
}

function pageTitleFromUrl(value: string | undefined): { title?: string; language?: string } {
  const clean = (value ?? "").trim();
  if (!clean) return {};
  const match = clean.match(/^https?:\/\/([a-z][a-z0-9-]{1,14})\.wikipedia\.org\/wiki\/([^?#]+)(?:[?#].*)?$/i);
  if (!match) throw new Error("page_url must look like https://en.wikipedia.org/wiki/Web_scraping");
  return {
    language: match[1].toLowerCase(),
    title: decodeURIComponent(match[2]).replace(/_/g, " "),
  };
}

function queryString(params: Record<string, string | number | undefined>): string {
  return Object.entries(params)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined && entry[1] !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
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

function trimExtract(value: string | undefined, maxChars: number): { text?: string; truncated?: boolean } {
  const clean = stringValue(value)?.replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return {};
  if (clean.length <= maxChars) return { text: clean };
  return {
    text: `${clean.slice(0, maxChars).replace(/\s+\S*$/, "")}...`,
    truncated: true,
  };
}

function categoryList(value: WikiCategory[] | undefined): string | undefined {
  const names = (value ?? [])
    .map((category) => stringValue(category.title)?.replace(/^Category:/, ""))
    .filter((title): title is string => Boolean(title));
  return names.length ? names.slice(0, 30).join(", ") : undefined;
}

function linkList(value: WikiLink[] | undefined): string | undefined {
  const names = (value ?? []).map((link) => stringValue(link.title)).filter((title): title is string => Boolean(title));
  return names.length ? names.slice(0, 30).join(", ") : undefined;
}

function pagesFrom(data: WikiResponse): WikiPage[] {
  const pages = Object.values(data.query?.pages ?? {});
  return pages
    .filter((page) => !page.missing && numberValue(page.pageid) !== undefined && stringValue(page.title))
    .sort((a, b) => (numberValue(a.index) ?? 0) - (numberValue(b.index) ?? 0));
}

function articleRecord(page: WikiPage, rank: number, language: string, maxChars: number, includeCategories: boolean, includeLinks: boolean): ArticleRecord | undefined {
  const title = stringValue(page.title);
  const pageid = numberValue(page.pageid);
  const pageUrl = stringValue(page.fullurl);
  if (!title || pageid === undefined || !pageUrl) return undefined;
  const extract = trimExtract(page.extract, maxChars);
  return compact({
    rank,
    title,
    pageid,
    language,
    page_url: pageUrl,
    extract: extract.text,
    extract_truncated: extract.truncated,
    wikidata_id: stringValue(page.pageprops?.wikibase_item),
    short_description: stringValue(page.pageprops?.["wikibase-shortdesc"]),
    thumbnail_url: stringValue(page.thumbnail?.source),
    original_image_url: stringValue(page.original?.source),
    categories: includeCategories ? categoryList(page.categories) : undefined,
    links: includeLinks ? linkList(page.links) : undefined,
    last_revision_id: numberValue(page.lastrevid),
    page_length: numberValue(page.length),
    touched_at: stringValue(page.touched),
  });
}

function apiUrl(input: Input, mode: Mode, language: string): { url: string; query?: string } {
  const extractMode = extractModeFrom(input.extract);
  const includeCategories = input.include_categories !== false;
  const includeLinks = input.include_links === true;
  const prop = ["extracts", "info", "pageimages", "pageprops"];
  if (includeCategories) prop.push("categories");
  if (includeLinks) prop.push("links");
  const baseParams: Record<string, string | number | undefined> = {
    action: "query",
    format: "json",
    redirects: 1,
    origin: "*",
    prop: prop.join("|"),
    explaintext: 1,
    exintro: extractMode === "intro" ? 1 : undefined,
    inprop: "url",
    pithumbsize: 300,
    piprop: "thumbnail|original",
    cllimit: includeCategories ? 30 : undefined,
    pllimit: includeLinks ? 30 : undefined,
  };

  if (mode === "search") {
    const query = cleanSearchQuery(input.query);
    return {
      query,
      url: `https://${language}.wikipedia.org/w/api.php?${queryString({
        ...baseParams,
        generator: "search",
        gsrsearch: query,
        gsrlimit: limitFrom(input.max_results),
      })}`,
    };
  }

  const fromUrl = pageTitleFromUrl(input.page_url);
  const pageLanguage = fromUrl.language ?? language;
  const title = cleanPageTitle(fromUrl.title ?? input.page_title);
  return {
    query: title,
    url: `https://${pageLanguage}.wikipedia.org/w/api.php?${queryString({
      ...baseParams,
      titles: title,
    })}`,
  };
}

async function fetchJson<T>(bf: Bf, url: string): Promise<T> {
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
    throw new Error(`Wikipedia request failed with status ${response.status ?? "unknown"}`);
  }
  try {
    return JSON.parse(response.body_text) as T;
  } catch {
    throw new Error("Wikipedia returned invalid JSON");
  }
}

export default defineTool<Input, Output>(async (input, bf) => {
  const mode = modeFrom(input.mode);
  const urlLanguage = mode === "page" ? pageTitleFromUrl(input.page_url).language : undefined;
  const language = urlLanguage ?? languageFrom(input.language);
  const built = apiUrl(input, mode, language);
  const data = await fetchJson<WikiResponse>(bf, built.url);
  if (data.error) throw new Error(data.error.info ?? data.error.code ?? "Wikipedia API error");
  const maxChars = maxExtractCharsFrom(input.max_extract_chars);
  const includeCategories = input.include_categories !== false;
  const includeLinks = input.include_links === true;
  const articles = pagesFrom(data)
    .map((page, index) => articleRecord(page, index + 1, language, maxChars, includeCategories, includeLinks))
    .filter((article): article is ArticleRecord => Boolean(article));
  return {
    mode,
    language,
    source_url: built.url,
    query: built.query,
    count: articles.length,
    articles,
  };
});
