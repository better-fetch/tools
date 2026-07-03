import { defineTool, type Bf } from "@better-fetch/tools";

type Mode = "package" | "release" | "files";
type JsonObject = Record<string, unknown>;

type Input = {
  mode?: Mode;
  package?: string;
  package_name?: string;
  version?: string;
  limit?: number;
  max_description_chars?: number;
};

type PyPiFile = {
  filename?: string;
  url?: string;
  packagetype?: string;
  python_version?: string;
  requires_python?: string | null;
  size?: number;
  upload_time?: string;
  upload_time_iso_8601?: string;
  yanked?: boolean;
  yanked_reason?: string | null;
  digests?: Record<string, string>;
};

type PyPiInfo = {
  name?: string;
  version?: string;
  summary?: string;
  description?: string;
  author?: string;
  author_email?: string;
  maintainer?: string;
  maintainer_email?: string;
  license?: string;
  license_expression?: string | null;
  keywords?: string;
  requires_python?: string | null;
  requires_dist?: string[];
  classifiers?: string[];
  package_url?: string;
  project_url?: string;
  docs_url?: string | null;
  home_page?: string;
  project_urls?: Record<string, string>;
};

type ProjectJson = {
  info?: PyPiInfo;
  urls?: PyPiFile[];
  releases?: Record<string, PyPiFile[]>;
  vulnerabilities?: unknown[];
};

type SimpleFile = {
  filename?: string;
  url?: string;
  size?: number;
  hashes?: Record<string, string>;
  "requires-python"?: string | null;
  "upload-time"?: string;
  yanked?: boolean | string;
  "core-metadata"?: boolean | Record<string, string>;
  "data-dist-info-metadata"?: boolean | Record<string, string>;
  provenance?: string | null;
};

type SimpleJson = {
  meta?: JsonObject;
  name?: string;
  files?: SimpleFile[];
};

type ProjectRecord = {
  package_name: string;
  version?: string;
  package_url?: string;
  project_url?: string;
  summary?: string;
  author?: string;
  author_email?: string;
  maintainer?: string;
  maintainer_email?: string;
  license?: string;
  license_expression?: string;
  requires_python?: string;
  keywords?: string;
  classifiers?: string;
  requires_dist?: string;
  project_urls?: string;
  release_count?: number;
  latest_upload_time?: string;
  current_file_count?: number;
  vulnerability_count?: number;
  description?: string;
};

type ReleaseRecord = {
  rank: number;
  version: string;
  file_count: number;
  upload_time?: string;
  packagetypes?: string;
  python_versions?: string;
  requires_python?: string;
  yanked_count?: number;
};

type FileRecord = {
  rank: number;
  filename: string;
  url?: string;
  packagetype?: string;
  python_version?: string;
  requires_python?: string;
  size?: number;
  upload_time?: string;
  sha256?: string;
  blake2b_256?: string;
  yanked?: boolean;
  yanked_reason?: string;
  provenance_url?: string;
  has_core_metadata?: boolean;
};

type VulnerabilityRecord = {
  rank: number;
  id?: string;
  source?: string;
  summary?: string;
  details?: string;
  aliases?: string;
  fixed_in?: string;
  link?: string;
};

type Output = {
  mode: Mode;
  source_url: string;
  package_name: string;
  version?: string;
  count: number;
  total_releases?: number;
  total_files?: number;
  project?: ProjectRecord;
  releases?: ReleaseRecord[];
  files?: FileRecord[];
  vulnerabilities?: VulnerabilityRecord[];
};

const JSON_BASE = "https://pypi.org/pypi";
const SIMPLE_BASE = "https://pypi.org/simple";
const USER_AGENT =
  "BetterFetchPyPiPackageScraper/0.1 (https://betterfetch.co/tools/pypi_package_scraper; support@betterfetch.co)";

function objectValue(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : undefined;
}

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function boolValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function arrayText(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
}

function compact<T extends Record<string, unknown>>(record: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined && value !== "" && value !== null) out[key] = value;
  }
  return out as T;
}

function truncate(value: string | undefined, max: number): string | undefined {
  const clean = (value ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return undefined;
  return clean.length > max ? `${clean.slice(0, max - 3)}...` : clean;
}

function joinCsv(values: string[] | undefined, max = 24): string | undefined {
  const clean = (values ?? []).map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean);
  return clean.length ? clean.slice(0, max).join(", ") : undefined;
}

function cleanMode(input: Input): Mode {
  if (input.mode === "release" || input.version) return "release";
  if (input.mode === "files") return "files";
  return "package";
}

function cleanLimit(value: number | undefined): number {
  return Math.min(Math.max(value ?? 10, 1), 100);
}

function cleanDescriptionLimit(value: number | undefined): number {
  return Math.min(Math.max(value ?? 1200, 0), 5000);
}

function cleanPackage(value: string | undefined): string {
  let clean = (value ?? "").trim();
  const match = clean.match(/^https?:\/\/pypi\.org\/project\/([^/?#]+)/i);
  if (match?.[1]) clean = match[1];
  clean = clean.replace(/^\/+|\/+$/g, "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,213}$/.test(clean)) {
    throw new Error("package must be a PyPI project name or https://pypi.org/project/... URL");
  }
  return clean;
}

function cleanVersion(value: string | undefined): string {
  const clean = (value ?? "").trim();
  if (!/^[A-Za-z0-9!+._-]{1,100}$/.test(clean)) throw new Error("version must be a valid PyPI release version");
  return clean;
}

function packageName(input: Input): string {
  return cleanPackage(input.package_name ?? input.package);
}

function packageUrl(pkg: string): string {
  return `${JSON_BASE}/${encodeURIComponent(pkg)}/json`;
}

function releaseUrl(pkg: string, version: string): string {
  return `${JSON_BASE}/${encodeURIComponent(pkg)}/${encodeURIComponent(version)}/json`;
}

function simpleUrl(pkg: string): string {
  return `${SIMPLE_BASE}/${encodeURIComponent(pkg)}/`;
}

function parseTime(value: string | undefined): number {
  if (!value) return 0;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function latestTime(files: PyPiFile[] | SimpleFile[] | undefined): string | undefined {
  let latest = "";
  let latestMs = 0;
  for (const file of files ?? []) {
    const simple = file as SimpleFile;
    const project = file as PyPiFile;
    const iso =
      textValue(project.upload_time_iso_8601) ??
      textValue(project.upload_time) ??
      textValue(simple["upload-time"]);
    const ms = parseTime(iso);
    if (iso && ms >= latestMs) {
      latest = iso;
      latestMs = ms;
    }
  }
  return latest || undefined;
}

async function fetchJson<T>(bf: Bf, url: string, accept: string): Promise<T> {
  const response = await bf.fetch({
    url,
    strategy: "http",
    return_response_text: true,
    extra_headers: {
      accept,
      "user-agent": USER_AGENT,
    },
  });
  const status = response.status ?? 0;
  if (!response.ok || status >= 400 || !response.body_text) {
    throw new Error(`PyPI request failed with status ${response.status ?? "unknown"}`);
  }
  try {
    const parsed = JSON.parse(response.body_text) as unknown;
    if (!objectValue(parsed)) throw new Error("not an object");
    return parsed as T;
  } catch {
    throw new Error("PyPI returned invalid JSON");
  }
}

function projectUrls(value: Record<string, string> | undefined): string | undefined {
  const entries = Object.entries(value ?? {})
    .filter((entry): entry is [string, string] => Boolean(entry[0]) && typeof entry[1] === "string" && Boolean(entry[1].trim()))
    .map(([key, url]) => `${key}: ${url.trim()}`);
  return entries.length ? entries.slice(0, 12).join("; ") : undefined;
}

function projectRecord(data: ProjectJson, descriptionLimit: number): ProjectRecord | undefined {
  const info = data.info;
  const name = textValue(info?.name);
  if (!info || !name) return undefined;
  const releases = data.releases ?? {};
  return compact({
    package_name: name,
    version: textValue(info.version),
    package_url: textValue(info.package_url),
    project_url: textValue(info.project_url),
    summary: truncate(textValue(info.summary), 500),
    author: truncate(textValue(info.author), 180),
    author_email: truncate(textValue(info.author_email), 240),
    maintainer: truncate(textValue(info.maintainer), 180),
    maintainer_email: truncate(textValue(info.maintainer_email), 240),
    license: truncate(textValue(info.license), 500),
    license_expression: truncate(textValue(info.license_expression ?? undefined), 120),
    requires_python: textValue(info.requires_python ?? undefined),
    keywords: truncate(textValue(info.keywords), 300),
    classifiers: joinCsv(info.classifiers, 30),
    requires_dist: joinCsv(info.requires_dist, 30),
    project_urls: projectUrls(info.project_urls),
    release_count: Object.keys(releases).length,
    latest_upload_time: latestTime(data.urls),
    current_file_count: data.urls?.length,
    vulnerability_count: data.vulnerabilities?.length,
    description: descriptionLimit > 0 ? truncate(textValue(info.description), descriptionLimit) : undefined,
  });
}

function releaseRecord(version: string, files: PyPiFile[], rank: number): ReleaseRecord {
  const yanked = files.filter((file) => file.yanked === true).length;
  return compact({
    rank,
    version,
    file_count: files.length,
    upload_time: latestTime(files),
    packagetypes: joinCsv(files.map((file) => textValue(file.packagetype)).filter((item): item is string => item !== undefined), 10),
    python_versions: joinCsv(files.map((file) => textValue(file.python_version)).filter((item): item is string => item !== undefined), 10),
    requires_python: joinCsv(files.map((file) => textValue(file.requires_python ?? undefined)).filter((item): item is string => item !== undefined), 6),
    yanked_count: yanked || undefined,
  });
}

function recentReleases(releases: Record<string, PyPiFile[]> | undefined, limit: number): ReleaseRecord[] {
  return Object.entries(releases ?? {})
    .map(([version, files]) => ({ version, files, time: parseTime(latestTime(files)) }))
    .sort((a, b) => b.time - a.time)
    .slice(0, limit)
    .map((release, index) => releaseRecord(release.version, release.files, index + 1));
}

function pypiFileRecord(file: PyPiFile, rank: number): FileRecord | undefined {
  const filename = textValue(file.filename);
  if (!filename) return undefined;
  return compact({
    rank,
    filename,
    url: textValue(file.url),
    packagetype: textValue(file.packagetype),
    python_version: textValue(file.python_version),
    requires_python: textValue(file.requires_python ?? undefined),
    size: numberValue(file.size),
    upload_time: textValue(file.upload_time_iso_8601) ?? textValue(file.upload_time),
    sha256: textValue(file.digests?.sha256),
    blake2b_256: textValue(file.digests?.blake2b_256),
    yanked: boolValue(file.yanked),
    yanked_reason: truncate(textValue(file.yanked_reason ?? undefined), 300),
  });
}

function simpleFileRecord(file: SimpleFile, rank: number): FileRecord | undefined {
  const filename = textValue(file.filename);
  if (!filename) return undefined;
  return compact({
    rank,
    filename,
    url: textValue(file.url),
    requires_python: textValue(file["requires-python"] ?? undefined),
    size: numberValue(file.size),
    upload_time: textValue(file["upload-time"]),
    sha256: textValue(file.hashes?.sha256),
    yanked: boolValue(file.yanked),
    yanked_reason: typeof file.yanked === "string" ? truncate(file.yanked, 300) : undefined,
    provenance_url: textValue(file.provenance ?? undefined),
    has_core_metadata: typeof file["core-metadata"] === "boolean" ? file["core-metadata"] : Boolean(file["core-metadata"]),
  });
}

function vulnerabilityRecord(value: unknown, rank: number): VulnerabilityRecord | undefined {
  const obj = objectValue(value);
  if (!obj) return undefined;
  return compact({
    rank,
    id: textValue(obj.id),
    source: textValue(obj.source),
    summary: truncate(textValue(obj.summary), 400),
    details: truncate(textValue(obj.details), 700),
    aliases: joinCsv(arrayText(obj.aliases), 12),
    fixed_in: joinCsv(arrayText(obj.fixed_in), 12),
    link: textValue(obj.link),
  });
}

function sortSimpleFiles(files: SimpleFile[], limit: number): SimpleFile[] {
  return files
    .slice()
    .sort((a, b) => parseTime(textValue(b["upload-time"])) - parseTime(textValue(a["upload-time"])))
    .slice(0, limit);
}

export default defineTool<Input, Output>(async (input, bf) => {
  const mode = cleanMode(input);
  const pkg = packageName(input);
  const limit = cleanLimit(input.limit);
  const maxDescription = cleanDescriptionLimit(input.max_description_chars);

  if (mode === "files") {
    const url = simpleUrl(pkg);
    const data = await fetchJson<SimpleJson>(bf, url, "application/vnd.pypi.simple.v1+json,application/json;q=0.8");
    const files = sortSimpleFiles(data.files ?? [], limit)
      .map((file, index) => simpleFileRecord(file, index + 1))
      .filter((item): item is FileRecord => item !== undefined);
    return compact({
      mode,
      source_url: url,
      package_name: textValue(data.name) ?? pkg,
      count: files.length,
      total_files: data.files?.length,
      files,
    });
  }

  if (mode === "release") {
    const version = cleanVersion(input.version);
    const url = releaseUrl(pkg, version);
    const data = await fetchJson<ProjectJson>(bf, url, "application/json,*/*;q=0.5");
    const files = (data.urls ?? [])
      .slice(0, limit)
      .map((file, index) => pypiFileRecord(file, index + 1))
      .filter((item): item is FileRecord => item !== undefined);
    const vulnerabilities = (data.vulnerabilities ?? [])
      .map((item, index) => vulnerabilityRecord(item, index + 1))
      .filter((item): item is VulnerabilityRecord => item !== undefined);
    return compact({
      mode,
      source_url: url,
      package_name: textValue(data.info?.name) ?? pkg,
      version: textValue(data.info?.version) ?? version,
      count: files.length,
      total_files: data.urls?.length,
      project: projectRecord(data, maxDescription),
      files,
      vulnerabilities,
    });
  }

  const url = packageUrl(pkg);
  const data = await fetchJson<ProjectJson>(bf, url, "application/json,*/*;q=0.5");
  const releases = recentReleases(data.releases, limit);
  return compact({
    mode,
    source_url: url,
    package_name: textValue(data.info?.name) ?? pkg,
    version: textValue(data.info?.version),
    count: releases.length,
    total_releases: data.releases ? Object.keys(data.releases).length : undefined,
    total_files: data.urls?.length,
    project: projectRecord(data, maxDescription),
    releases,
  });
});
