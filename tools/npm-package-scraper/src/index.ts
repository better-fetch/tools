import { defineTool, type Bf } from "@better-fetch/tools";

type Mode = "package" | "search";
type Sort = "best_match" | "popularity" | "quality" | "maintenance";
type DownloadPeriod = "last-day" | "last-week" | "last-month" | "last-year";

type Input = {
  mode?: Mode;
  package_name?: string;
  query?: string;
  sort?: Sort;
  include_downloads?: boolean;
  download_period?: DownloadPeriod;
  max_results?: number;
};

type Human = {
  name?: string;
  username?: string;
  email?: string;
  url?: string;
};

type Links = {
  npm?: string;
  homepage?: string;
  repository?: string;
  bugs?: string;
};

type SearchPackage = {
  name?: string;
  version?: string;
  description?: string;
  keywords?: string[];
  publisher?: Human;
  maintainers?: Human[];
  license?: string;
  date?: string;
  links?: Links;
};

type SearchObject = {
  package?: SearchPackage;
  downloads?: {
    weekly?: number;
    monthly?: number;
  };
  dependents?: number;
  searchScore?: number;
  score?: {
    final?: number;
    detail?: {
      popularity?: number;
      quality?: number;
      maintenance?: number;
    };
  };
};

type SearchResponse = {
  objects?: SearchObject[];
  total?: number;
  error?: string;
};

type Repository = string | { type?: string; url?: string };
type Bugs = string | { url?: string; email?: string };

type VersionMetadata = {
  version?: string;
  description?: string;
  license?: string;
  homepage?: string;
  repository?: Repository;
  bugs?: Bugs;
  author?: Human | string;
  maintainers?: Human[];
  keywords?: string[] | string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  deprecated?: string;
};

type PackageMetadata = {
  name?: string;
  description?: string;
  license?: string;
  homepage?: string;
  repository?: Repository;
  bugs?: Bugs;
  author?: Human | string;
  maintainers?: Human[];
  keywords?: string[] | string;
  "dist-tags"?: Record<string, string>;
  versions?: Record<string, VersionMetadata>;
  time?: Record<string, string>;
  error?: string;
};

type DownloadsResponse = {
  downloads?: number;
  start?: string;
  end?: string;
  package?: string;
  error?: string;
};

type PackageRecord = {
  type: "package" | "search_result";
  name: string;
  version?: string;
  description?: string;
  license?: string;
  keywords?: string;
  author_name?: string;
  publisher_name?: string;
  maintainers?: string;
  npm_url?: string;
  repository_url?: string;
  homepage_url?: string;
  bugs_url?: string;
  created_at?: string;
  modified_at?: string;
  published_at?: string;
  version_count?: number;
  latest_dependencies?: string;
  latest_dev_dependencies?: string;
  deprecated?: string;
  weekly_downloads?: number;
  monthly_downloads?: number;
  downloads?: number;
  download_period?: DownloadPeriod;
  downloads_start?: string;
  downloads_end?: string;
  dependents?: number;
  search_score?: number;
  score_final?: number;
  score_popularity?: number;
  score_quality?: number;
  score_maintenance?: number;
};

type Output = {
  mode: Mode;
  source_url: string;
  count: number;
  total_matches?: number;
  packages: PackageRecord[];
};

function cleanMode(value: Mode | undefined): Mode {
  return value === "search" ? "search" : "package";
}

function cleanSort(value: Sort | undefined): Sort {
  return value === "popularity" || value === "quality" || value === "maintenance"
    ? value
    : "best_match";
}

function cleanPeriod(value: DownloadPeriod | undefined): DownloadPeriod {
  if (value === "last-day" || value === "last-month" || value === "last-year") return value;
  return "last-week";
}

function limitFrom(value: number | undefined): number {
  return Math.min(Math.max(value ?? 10, 1), 25);
}

function cleanPackageName(value: string | undefined): string {
  let clean = (value ?? "").trim();
  const urlMatch = clean.match(/npmjs\.com\/package\/([^?#]+)(?:[?#].*)?$/i);
  if (urlMatch) clean = urlMatch[1];
  clean = decodeURIComponent(clean).replace(/^npm\s+(?:i|install)\s+/i, "").trim();
  clean = clean.replace(/^\/+|\/+$/g, "");
  const valid =
    /^[a-z0-9][a-z0-9._~-]{0,213}$/i.test(clean) ||
    /^@[a-z0-9][a-z0-9._~-]{0,100}\/[a-z0-9][a-z0-9._~-]{0,100}$/i.test(clean);
  if (!valid) {
    throw new Error("package_name must be an npm package name, scoped package, or npm package URL");
  }
  return clean;
}

function cleanQuery(value: string | undefined): string {
  const clean = (value ?? "").replace(/\s+/g, " ").trim();
  if (clean.length < 2) throw new Error("query must contain at least two characters in search mode");
  return clean.slice(0, 160);
}

function encodePackageName(name: string): string {
  if (name.startsWith("@")) return `@${encodeURIComponent(name.slice(1))}`;
  return encodeURIComponent(name);
}

function queryString(params: Record<string, string | number | undefined>): string {
  return Object.entries(params)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined && entry[1] !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function humanName(value: Human | string | undefined): string | undefined {
  if (typeof value === "string") return stringValue(value);
  return stringValue(value?.name) ?? stringValue(value?.username) ?? stringValue(value?.email);
}

function humanList(value: Human[] | undefined): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const names = value.map(humanName).filter((name): name is string => Boolean(name));
  return names.length ? names.slice(0, 20).join(", ") : undefined;
}

function keywords(value: string[] | string | undefined): string | undefined {
  if (Array.isArray(value)) {
    const list = value.filter((item) => typeof item === "string" && item.trim()).slice(0, 24);
    return list.length ? list.join(", ") : undefined;
  }
  return stringValue(value);
}

function dependencyList(value: Record<string, string> | undefined): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const names = Object.keys(value).slice(0, 30);
  return names.length ? names.join(", ") : undefined;
}

function normalizeUrl(value: string | undefined): string | undefined {
  let url = stringValue(value);
  if (!url) return undefined;
  url = url.replace(/^git\+/, "").replace(/^git:\/\//, "https://");
  url = url.replace(/\.git$/, "");
  return /^https?:\/\//i.test(url) ? url : undefined;
}

function repositoryUrl(value: Repository | undefined): string | undefined {
  if (typeof value === "string") return normalizeUrl(value);
  return normalizeUrl(value?.url);
}

function bugsUrl(value: Bugs | undefined): string | undefined {
  if (typeof value === "string") return normalizeUrl(value);
  return normalizeUrl(value?.url);
}

function compact(record: PackageRecord): PackageRecord {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined && value !== "") out[key] = value;
  }
  return out as PackageRecord;
}

function latestVersion(meta: PackageMetadata): VersionMetadata | undefined {
  const latest = meta["dist-tags"]?.latest;
  if (latest && meta.versions?.[latest]) return meta.versions[latest];
  const versions = meta.versions ? Object.keys(meta.versions) : [];
  return versions.length ? meta.versions?.[versions[versions.length - 1]] : undefined;
}

function packageRecord(meta: PackageMetadata, downloads?: DownloadsResponse, period?: DownloadPeriod): PackageRecord | undefined {
  const name = stringValue(meta.name);
  if (!name) return undefined;
  const latest = latestVersion(meta);
  const version = stringValue(latest?.version) ?? stringValue(meta["dist-tags"]?.latest);
  return compact({
    type: "package",
    name,
    version,
    description: stringValue(latest?.description) ?? stringValue(meta.description),
    license: stringValue(latest?.license) ?? stringValue(meta.license),
    keywords: keywords(latest?.keywords ?? meta.keywords),
    author_name: humanName(latest?.author ?? meta.author),
    maintainers: humanList(latest?.maintainers ?? meta.maintainers),
    npm_url: `https://www.npmjs.com/package/${name}`,
    repository_url: repositoryUrl(latest?.repository ?? meta.repository),
    homepage_url: normalizeUrl(latest?.homepage ?? meta.homepage),
    bugs_url: bugsUrl(latest?.bugs ?? meta.bugs),
    created_at: stringValue(meta.time?.created),
    modified_at: stringValue(meta.time?.modified),
    published_at: version ? stringValue(meta.time?.[version]) : undefined,
    version_count: meta.versions ? Object.keys(meta.versions).length : undefined,
    latest_dependencies: dependencyList(latest?.dependencies),
    latest_dev_dependencies: dependencyList(latest?.devDependencies),
    deprecated: stringValue(latest?.deprecated),
    downloads: numberValue(downloads?.downloads),
    download_period: downloads?.downloads !== undefined ? period : undefined,
    downloads_start: stringValue(downloads?.start),
    downloads_end: stringValue(downloads?.end),
  });
}

function searchRecord(item: SearchObject): PackageRecord | undefined {
  const pkg = item.package;
  const name = stringValue(pkg?.name);
  if (!pkg || !name) return undefined;
  return compact({
    type: "search_result",
    name,
    version: stringValue(pkg.version),
    description: stringValue(pkg.description),
    license: stringValue(pkg.license),
    keywords: keywords(pkg.keywords),
    publisher_name: humanName(pkg.publisher),
    maintainers: humanList(pkg.maintainers),
    npm_url: normalizeUrl(pkg.links?.npm) ?? `https://www.npmjs.com/package/${name}`,
    repository_url: normalizeUrl(pkg.links?.repository),
    homepage_url: normalizeUrl(pkg.links?.homepage),
    bugs_url: normalizeUrl(pkg.links?.bugs),
    published_at: stringValue(pkg.date),
    weekly_downloads: numberValue(item.downloads?.weekly),
    monthly_downloads: numberValue(item.downloads?.monthly),
    dependents: numberValue(item.dependents),
    search_score: numberValue(item.searchScore),
    score_final: numberValue(item.score?.final),
    score_popularity: numberValue(item.score?.detail?.popularity),
    score_quality: numberValue(item.score?.detail?.quality),
    score_maintenance: numberValue(item.score?.detail?.maintenance),
  });
}

async function fetchJson<T>(bf: Bf, url: string): Promise<T> {
  const response = await bf.fetch({
    url,
    strategy: "http",
    return_response_text: true,
    extra_headers: {
      accept: "application/json,*/*;q=0.5",
    },
  });
  if (!response.ok || !response.body_text) {
    throw new Error(`npm request failed with status ${response.status ?? "unknown"}`);
  }
  try {
    return JSON.parse(response.body_text) as T;
  } catch {
    throw new Error("npm returned invalid JSON");
  }
}

function searchWeights(sort: Sort): Record<string, string | undefined> {
  if (sort === "popularity") return { popularity: "1", quality: "0", maintenance: "0" };
  if (sort === "quality") return { popularity: "0", quality: "1", maintenance: "0" };
  if (sort === "maintenance") return { popularity: "0", quality: "0", maintenance: "1" };
  return {};
}

export default defineTool<Input, Output>(async (input, bf) => {
  const mode = cleanMode(input.mode);

  if (mode === "search") {
    const query = cleanQuery(input.query);
    const size = limitFrom(input.max_results);
    const sort = cleanSort(input.sort);
    const qs = queryString({
      text: query,
      size,
      ...searchWeights(sort),
    });
    const sourceUrl = `https://registry.npmjs.org/-/v1/search?${qs}`;
    const data = await fetchJson<SearchResponse>(bf, sourceUrl);
    if (data.error) throw new Error(data.error);
    const packages = (data.objects ?? []).map(searchRecord).filter((record): record is PackageRecord => Boolean(record));
    return {
      mode,
      source_url: sourceUrl,
      count: packages.length,
      total_matches: numberValue(data.total),
      packages,
    };
  }

  const name = cleanPackageName(input.package_name);
  const packageUrl = `https://registry.npmjs.org/${encodePackageName(name)}`;
  const meta = await fetchJson<PackageMetadata>(bf, packageUrl);
  if (meta.error) throw new Error(meta.error);

  let downloads: DownloadsResponse | undefined;
  const period = cleanPeriod(input.download_period);
  if (input.include_downloads !== false) {
    const downloadsUrl = `https://api.npmjs.org/downloads/point/${period}/${encodePackageName(name)}`;
    downloads = await fetchJson<DownloadsResponse>(bf, downloadsUrl);
  }

  const record = packageRecord(meta, downloads, period);
  return {
    mode,
    source_url: packageUrl,
    count: record ? 1 : 0,
    packages: record ? [record] : [],
  };
});
