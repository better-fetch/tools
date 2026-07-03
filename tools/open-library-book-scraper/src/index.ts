import { defineTool, type Bf } from "@better-fetch/tools";

type Mode = "books" | "authors";
type Sort = "relevance" | "new" | "old";
type JsonObject = Record<string, unknown>;

type Input = {
  mode?: Mode;
  query?: string;
  title?: string;
  author?: string;
  subject?: string;
  isbn?: string;
  ebooks_only?: boolean;
  page?: number;
  limit?: number;
  sort?: Sort;
};

type BookRecord = {
  rank: number;
  openlibrary_key: string;
  openlibrary_url: string;
  title?: string;
  authors?: string;
  author_keys?: string;
  first_publish_year?: number;
  edition_count?: number;
  first_isbn?: string;
  isbns?: string;
  publishers?: string;
  languages?: string;
  subjects?: string;
  cover_id?: number;
  cover_url?: string;
  ratings_average?: number;
  ratings_count?: number;
  ebook_access?: string;
  has_fulltext?: boolean;
  internet_archive_ids?: string;
  number_of_pages_median?: number;
};

type AuthorRecord = {
  rank: number;
  openlibrary_author_key: string;
  openlibrary_url: string;
  name?: string;
  alternate_names?: string;
  top_work?: string;
  work_count?: number;
  top_subjects?: string;
  birth_date?: string;
  death_date?: string;
};

type Output = {
  mode: Mode;
  source_url: string;
  query?: string;
  count: number;
  total_matches?: number;
  page?: number;
  books?: BookRecord[];
  authors?: AuthorRecord[];
};

const BASE = "https://openlibrary.org";
const USER_AGENT =
  "BetterFetchOpenLibraryBookScraper/0.1 (https://betterfetch.co/tools/open_library_book_scraper; support@betterfetch.co)";
const BOOK_FIELDS = [
  "key",
  "title",
  "author_name",
  "author_key",
  "first_publish_year",
  "edition_count",
  "isbn",
  "publisher",
  "language",
  "subject",
  "cover_i",
  "ratings_average",
  "ratings_count",
  "ebook_access",
  "has_fulltext",
  "ia",
  "number_of_pages_median",
].join(",");

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

function compact<T extends Record<string, unknown>>(record: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined && value !== "" && value !== null) out[key] = value;
  }
  return out as T;
}

function joinList(values: (string | undefined)[] | undefined, limit = 30): string | undefined {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values ?? []) {
    const clean = value?.replace(/\s+/g, " ").trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out.length ? out.slice(0, limit).join(", ") : undefined;
}

function stringList(value: unknown, limit = 30): string | undefined {
  return joinList(
    arrayValue(value).map((item) => {
      if (typeof item === "string") return item;
      if (typeof item === "number" && Number.isFinite(item)) return String(item);
      return undefined;
    }),
    limit,
  );
}

function cleanText(value: string | undefined, field: string, max = 240): string | undefined {
  const clean = (value ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return undefined;
  if (clean.length < 2) throw new Error(`${field} must contain at least two characters`);
  if (!/^[\p{L}\p{N} _.,:;'"()[\]\\/+*?!&|/@#%-]+$/u.test(clean)) {
    throw new Error(`${field} contains unsupported characters`);
  }
  return clean.slice(0, max);
}

function cleanIsbn(value: string | undefined): string | undefined {
  const clean = (value ?? "").replace(/^isbn:?/i, "").replace(/[-\s]/g, "").trim();
  if (!clean) return undefined;
  if (!/^(?:\d{9}[\dXx]|\d{13})$/.test(clean)) {
    throw new Error("isbn must be a valid ISBN-10 or ISBN-13 value");
  }
  return clean.toUpperCase();
}

function limit(value: number | undefined): number {
  return Math.min(Math.max(value ?? 10, 1), 20);
}

function page(value: number | undefined): number {
  return Math.min(Math.max(value ?? 1, 1), 100);
}

function queryString(params: Record<string, string | number | boolean | undefined>): string {
  return Object.entries(params)
    .filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined && entry[1] !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
}

function modeFrom(input: Input): Mode {
  if (input.mode === "authors") return "authors";
  return "books";
}

function buildUrl(input: Input, mode: Mode): { url: string; query?: string; page: number } {
  const currentPage = page(input.page);
  const currentLimit = limit(input.limit);

  if (mode === "authors") {
    const authorQuery = cleanText(input.query ?? input.author, "query", 180);
    if (!authorQuery) throw new Error("authors mode requires query or author");
    return {
      query: authorQuery,
      page: currentPage,
      url: `${BASE}/search/authors.json?${queryString({
        q: authorQuery,
        limit: currentLimit,
        offset: (currentPage - 1) * currentLimit,
      })}`,
    };
  }

  const query = cleanText(input.query, "query", 240);
  const title = cleanText(input.title, "title", 180);
  const author = cleanText(input.author, "author", 180);
  const subject = cleanText(input.subject, "subject", 180);
  const isbn = cleanIsbn(input.isbn);

  if (!query && !title && !author && !subject && !isbn) {
    throw new Error("books mode requires query, title, author, subject, or isbn");
  }

  const summary = [
    query && `query:${query}`,
    title && `title:${title}`,
    author && `author:${author}`,
    subject && `subject:${subject}`,
    isbn && `isbn:${isbn}`,
    input.ebooks_only && "ebooks_only:true",
  ]
    .filter(Boolean)
    .join(" | ");

  return {
    query: summary,
    page: currentPage,
    url: `${BASE}/search.json?${queryString({
      q: query,
      title,
      author,
      subject,
      isbn,
      has_fulltext: input.ebooks_only ? true : undefined,
      sort: input.sort && input.sort !== "relevance" ? input.sort : undefined,
      fields: BOOK_FIELDS,
      page: currentPage,
      limit: currentLimit,
    })}`,
  };
}

function openLibraryUrl(key: string): string {
  return `${BASE}${key.startsWith("/") ? key : `/${key}`}`;
}

function coverUrl(coverId: number | undefined): string | undefined {
  return coverId ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg` : undefined;
}

function bookRecord(doc: JsonObject, rank: number): BookRecord | undefined {
  const key = textValue(doc.key);
  if (!key) return undefined;
  const isbnValues = arrayValue(doc.isbn)
    .map((item) => textValue(item))
    .filter((item): item is string => Boolean(item));
  const coverId = numberValue(doc.cover_i);

  return compact({
    rank,
    openlibrary_key: key,
    openlibrary_url: openLibraryUrl(key),
    title: textValue(doc.title),
    authors: stringList(doc.author_name, 20),
    author_keys: stringList(doc.author_key, 20),
    first_publish_year: numberValue(doc.first_publish_year),
    edition_count: numberValue(doc.edition_count),
    first_isbn: isbnValues[0],
    isbns: joinList(isbnValues, 25),
    publishers: stringList(doc.publisher, 12),
    languages: stringList(doc.language, 20),
    subjects: stringList(doc.subject, 20),
    cover_id: coverId,
    cover_url: coverUrl(coverId),
    ratings_average: numberValue(doc.ratings_average),
    ratings_count: numberValue(doc.ratings_count),
    ebook_access: textValue(doc.ebook_access),
    has_fulltext: booleanValue(doc.has_fulltext),
    internet_archive_ids: stringList(doc.ia, 20),
    number_of_pages_median: numberValue(doc.number_of_pages_median),
  });
}

function authorRecord(doc: JsonObject, rank: number): AuthorRecord | undefined {
  const key = textValue(doc.key);
  if (!key) return undefined;
  const authorKey = key.replace(/^\/?authors\//, "");

  return compact({
    rank,
    openlibrary_author_key: authorKey,
    openlibrary_url: `${BASE}/authors/${authorKey}`,
    name: textValue(doc.name),
    alternate_names: stringList(doc.alternate_names, 20),
    top_work: textValue(doc.top_work),
    work_count: numberValue(doc.work_count),
    top_subjects: stringList(doc.top_subjects, 20),
    birth_date: textValue(doc.birth_date),
    death_date: textValue(doc.death_date),
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
    throw new Error(`Open Library request failed with status ${response.status ?? "unknown"}`);
  }
  try {
    const data = JSON.parse(response.body_text) as unknown;
    const obj = objectValue(data);
    if (!obj) throw new Error("not an object");
    return obj;
  } catch {
    throw new Error("Open Library returned invalid JSON");
  }
}

export default defineTool<Input, Output>(async (input, bf) => {
  const mode = modeFrom(input);
  const built = buildUrl(input, mode);
  const data = await fetchJson(bf, built.url);

  if (mode === "authors") {
    const authors = arrayValue(data.docs)
      .map((item, index) => {
        const obj = objectValue(item);
        return obj ? authorRecord(obj, index + 1) : undefined;
      })
      .filter((author): author is AuthorRecord => Boolean(author));
    return {
      mode,
      source_url: built.url,
      query: built.query,
      count: authors.length,
      total_matches: numberValue(data.numFound),
      page: built.page,
      authors,
    };
  }

  const books = arrayValue(data.docs)
    .map((item, index) => {
      const obj = objectValue(item);
      return obj ? bookRecord(obj, index + 1) : undefined;
    })
    .filter((book): book is BookRecord => Boolean(book));

  return {
    mode,
    source_url: built.url,
    query: built.query,
    count: books.length,
    total_matches: numberValue(data.numFound),
    page: built.page,
    books,
  };
});
