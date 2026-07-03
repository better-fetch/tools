import { defineTool, type Bf } from "@better-fetch/tools";

type Mode = "search" | "versions";
type JsonObject = Record<string, unknown>;

type Input = {
  mode?: Mode;
  query?: string;
  group_id?: string;
  artifact_id?: string;
  packaging?: string;
  classifier?: string;
  sha1?: string;
  limit?: number;
};

type SolrDoc = {
  id?: string;
  g?: string;
  a?: string;
  v?: string;
  latestVersion?: string;
  repositoryId?: string;
  p?: string;
  timestamp?: number;
  versionCount?: number;
  ec?: string[];
  tags?: string[];
};

type SolrResponse = {
  response?: {
    numFound?: number;
    docs?: SolrDoc[];
  };
};

type ArtifactRecord = {
  rank: number;
  group_id: string;
  artifact_id: string;
  coordinate: string;
  artifact_url: string;
  latest_version?: string;
  packaging?: string;
  version_count?: number;
  repository_id?: string;
  last_updated?: string;
  file_extensions?: string;
  tags?: string;
};

type VersionRecord = {
  rank: number;
  group_id: string;
  artifact_id: string;
  version: string;
  coordinate: string;
  artifact_url: string;
  pom_url?: string;
  jar_url?: string;
  packaging?: string;
  repository_id?: string;
  last_updated?: string;
  file_extensions?: string;
  tags?: string;
};

type Output = {
  mode: Mode;
  source_url: string;
  count: number;
  total_matches?: number;
  query?: string;
  group_id?: string;
  artifact_id?: string;
  artifacts?: ArtifactRecord[];
  versions?: VersionRecord[];
};

const BASE = "https://search.maven.org/solrsearch/select";
const REPO_BASE = "https://repo1.maven.org/maven2";
const USER_AGENT =
  "BetterFetchMavenCentralScraper/0.1 (https://betterfetch.co/tools/maven_central_scraper; support@betterfetch.co)";

function objectValue(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : undefined;
}

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function arrayText(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function compact<T extends Record<string, unknown>>(record: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined && value !== "" && value !== null) out[key] = value;
  }
  return out as T;
}

function cleanMode(value: Mode | undefined): Mode {
  return value === "versions" ? "versions" : "search";
}

function cleanLimit(value: number | undefined): number {
  return Math.min(Math.max(value ?? 10, 1), 100);
}

function cleanFreeText(value: string | undefined): string | undefined {
  const clean = (value ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return undefined;
  if (clean.length < 2) throw new Error("query must contain at least two characters");
  if (!/^[A-Za-z0-9 ._:+#/@-]{2,180}$/.test(clean)) {
    throw new Error("query contains unsupported Maven Central search characters");
  }
  return clean.slice(0, 180);
}

function cleanToken(value: string | undefined, field: string): string | undefined {
  const clean = (value ?? "").trim();
  if (!clean) return undefined;
  if (!/^[A-Za-z0-9_.-]{1,180}$/.test(clean)) {
    throw new Error(`${field} must contain only letters, numbers, dots, underscores, or hyphens`);
  }
  return clean;
}

function cleanSha1(value: string | undefined): string | undefined {
  const clean = (value ?? "").trim().toLowerCase();
  if (!clean) return undefined;
  if (!/^[a-f0-9]{40}$/.test(clean)) throw new Error("sha1 must be a 40-character lowercase or uppercase hex digest");
  return clean;
}

function joinCsv(values: string[] | undefined): string | undefined {
  const clean = (values ?? []).map((value) => value.trim()).filter(Boolean);
  return clean.length ? clean.slice(0, 24).join(", ") : undefined;
}

function isoFromMs(value: unknown): string | undefined {
  const ms = numberValue(value);
  if (ms === undefined) return undefined;
  const date = new Date(ms);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function queryString(params: Record<string, string | number | undefined>): string {
  return Object.entries(params)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined && entry[1] !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
}

function buildSearchQuery(input: Input): { query: string; group?: string; artifact?: string } {
  const sha1 = cleanSha1(input.sha1);
  if (sha1) return { query: `1:${sha1}` };

  const query = cleanFreeText(input.query);
  const group = cleanToken(input.group_id, "group_id");
  const artifact = cleanToken(input.artifact_id, "artifact_id");
  const packaging = cleanToken(input.packaging, "packaging");
  const classifier = cleanToken(input.classifier, "classifier");
  const parts: string[] = [];
  if (query) parts.push(query);
  if (group) parts.push(`g:${group}`);
  if (artifact) parts.push(`a:${artifact}`);
  if (packaging) parts.push(`p:${packaging}`);
  if (classifier) parts.push(`l:${classifier}`);
  return {
    query: parts.length ? parts.join(" AND ") : "*:*",
    group,
    artifact,
  };
}

function searchUrl(query: string, limit: number): string {
  return `${BASE}?${queryString({ q: query, rows: limit, wt: "json" })}`;
}

function versionsUrl(group: string, artifact: string, limit: number): string {
  return `${BASE}?${queryString({
    q: `g:${group} AND a:${artifact}`,
    core: "gav",
    rows: limit,
    wt: "json",
    sort: "timestamp desc",
  })}`;
}

async function fetchSolr(bf: Bf, url: string): Promise<SolrResponse> {
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
    throw new Error(`Maven Central request failed with status ${response.status ?? "unknown"}`);
  }
  try {
    const parsed = JSON.parse(response.body_text) as unknown;
    if (!objectValue(parsed)) throw new Error("not an object");
    return parsed as SolrResponse;
  } catch {
    throw new Error("Maven Central returned invalid JSON");
  }
}

function artifactUrl(group: string, artifact: string, version?: string, packaging?: string): string {
  if (version) {
    return `https://search.maven.org/artifact/${group}/${artifact}/${version}/${packaging ?? "jar"}`;
  }
  return `https://search.maven.org/artifact/${group}/${artifact}`;
}

function repoFileUrl(group: string, artifact: string, version: string, suffix: string): string {
  const path = group.replace(/\./g, "/");
  return `${REPO_BASE}/${path}/${artifact}/${version}/${artifact}-${version}${suffix}`;
}

function artifactRecord(doc: SolrDoc, rank: number): ArtifactRecord | undefined {
  const group = textValue(doc.g);
  const artifact = textValue(doc.a);
  if (!group || !artifact) return undefined;
  const version = textValue(doc.latestVersion);
  return compact({
    rank,
    group_id: group,
    artifact_id: artifact,
    coordinate: `${group}:${artifact}`,
    artifact_url: artifactUrl(group, artifact),
    latest_version: version,
    packaging: textValue(doc.p),
    version_count: numberValue(doc.versionCount),
    repository_id: textValue(doc.repositoryId),
    last_updated: isoFromMs(doc.timestamp),
    file_extensions: joinCsv(arrayText(doc.ec)),
    tags: joinCsv(arrayText(doc.tags)),
  });
}

function versionRecord(doc: SolrDoc, rank: number): VersionRecord | undefined {
  const group = textValue(doc.g);
  const artifact = textValue(doc.a);
  const version = textValue(doc.v);
  if (!group || !artifact || !version) return undefined;
  const packaging = textValue(doc.p);
  return compact({
    rank,
    group_id: group,
    artifact_id: artifact,
    version,
    coordinate: `${group}:${artifact}:${version}`,
    artifact_url: artifactUrl(group, artifact, version, packaging),
    pom_url: repoFileUrl(group, artifact, version, ".pom"),
    jar_url: packaging === "jar" || !packaging ? repoFileUrl(group, artifact, version, ".jar") : undefined,
    packaging,
    repository_id: textValue(doc.repositoryId),
    last_updated: isoFromMs(doc.timestamp),
    file_extensions: joinCsv(arrayText(doc.ec)),
    tags: joinCsv(arrayText(doc.tags)),
  });
}

export default defineTool<Input, Output>(async (input, bf) => {
  const mode = cleanMode(input.mode);
  const limit = cleanLimit(input.limit);

  if (mode === "versions") {
    const group = cleanToken(input.group_id, "group_id");
    const artifact = cleanToken(input.artifact_id, "artifact_id");
    if (!group || !artifact) throw new Error("versions mode requires group_id and artifact_id");
    const url = versionsUrl(group, artifact, limit);
    const data = await fetchSolr(bf, url);
    const docs = data.response?.docs ?? [];
    const versions = docs
      .map((doc, index) => versionRecord(doc, index + 1))
      .filter((item): item is VersionRecord => item !== undefined)
      .slice(0, limit);
    return compact({
      mode,
      source_url: url,
      count: versions.length,
      total_matches: numberValue(data.response?.numFound),
      query: `g:${group} AND a:${artifact}`,
      group_id: group,
      artifact_id: artifact,
      versions,
    });
  }

  const built = buildSearchQuery(input);
  const url = searchUrl(built.query, limit);
  const data = await fetchSolr(bf, url);
  const docs = data.response?.docs ?? [];
  const artifacts = docs
    .map((doc, index) => artifactRecord(doc, index + 1))
    .filter((item): item is ArtifactRecord => item !== undefined)
    .slice(0, limit);
  return compact({
    mode,
    source_url: url,
    count: artifacts.length,
    total_matches: numberValue(data.response?.numFound),
    query: built.query,
    group_id: built.group,
    artifact_id: built.artifact,
    artifacts,
  });
});
