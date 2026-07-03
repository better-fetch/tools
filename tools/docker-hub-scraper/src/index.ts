import { defineTool, type Bf } from "@better-fetch/tools";

type Mode = "search" | "repository" | "tags";
type JsonObject = Record<string, unknown>;

type Input = {
  mode?: Mode;
  query?: string;
  repository?: string;
  namespace?: string;
  name?: string;
  limit?: number;
};

type RepositoryRecord = {
  rank: number;
  repo_name: string;
  namespace?: string;
  name?: string;
  repository_url: string;
  short_description?: string;
  description?: string;
  pull_count?: number;
  star_count?: number;
  is_official?: boolean;
  is_automated?: boolean;
  is_private?: boolean;
  repository_type?: string;
  status?: number;
  status_description?: string;
  date_registered?: string;
  last_updated?: string;
  last_modified?: string;
  affiliation?: string;
};

type TagRecord = {
  rank: number;
  name: string;
  tag_url?: string;
  digest?: string;
  full_size?: number;
  last_updated?: string;
  last_updater_username?: string;
  architecture?: string;
  os?: string;
  os_version?: string;
  variant?: string;
  image_digest?: string;
  image_status?: string;
};

type Output = {
  mode: Mode;
  source_url: string;
  count: number;
  query?: string;
  repository?: string;
  repositories?: RepositoryRecord[];
  repository_record?: RepositoryRecord;
  tags?: TagRecord[];
  next_url?: string;
};

const BASE = "https://hub.docker.com/v2";
const USER_AGENT =
  "BetterFetchDockerHubScraper/0.1 (https://betterfetch.co/tools/docker_hub_scraper; support@betterfetch.co)";

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
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return undefined;
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

function truncate(value: string | undefined, max: number): string | undefined {
  const clean = (value ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return undefined;
  return clean.length > max ? `${clean.slice(0, max - 3)}...` : clean;
}

function cleanMode(input: Input): Mode {
  if (input.mode === "repository" || input.mode === "tags" || input.mode === "search") return input.mode;
  return input.repository || input.namespace || input.name ? "repository" : "search";
}

function cleanLimit(value: number | undefined): number {
  return Math.min(Math.max(value ?? 10, 1), 100);
}

function cleanQuery(value: string | undefined): string {
  const clean = (value ?? "").trim();
  if (!clean) throw new Error("query is required for search mode");
  return clean.slice(0, 120);
}

function cleanPart(value: string | undefined, field: string): string {
  const clean = (value ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,254}$/.test(clean)) throw new Error(`${field} must be a Docker Hub namespace or repository name`);
  return clean;
}

function repoParts(input: Input): { namespace: string; name: string; repository: string } {
  let raw = (input.repository ?? "").trim();
  if (raw) {
    const url = raw.match(/hub\.docker\.com\/r\/([^/?#]+)(?:\/([^/?#]+))?/i);
    if (url) raw = url[2] ? `${url[1]}/${url[2]}` : url[1];
    raw = raw.replace(/^docker\.io\//i, "").replace(/^\/+|\/+$/g, "");
  }
  const parts = raw ? raw.split("/") : [];
  const namespace = cleanPart(input.namespace ?? (parts.length > 1 ? parts[0] : parts.length === 1 ? "library" : undefined), "namespace");
  const name = cleanPart(input.name ?? (parts.length > 1 ? parts[1] : parts[0]), "name");
  return { namespace, name, repository: `${namespace}/${name}` };
}

function searchUrl(query: string, limit: number): string {
  return `${BASE}/search/repositories/?query=${encodeURIComponent(query)}&page_size=${limit}`;
}

function repositoryUrl(namespace: string, name: string): string {
  return `${BASE}/repositories/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/`;
}

function tagsUrl(namespace: string, name: string, limit: number): string {
  return `${BASE}/repositories/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/tags/?page_size=${limit}&ordering=last_updated`;
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
    throw new Error(`Docker Hub request failed with status ${response.status ?? "unknown"}`);
  }
  try {
    const parsed = JSON.parse(response.body_text) as unknown;
    const obj = objectValue(parsed);
    if (!obj) throw new Error("not an object");
    return obj;
  } catch {
    throw new Error("Docker Hub returned invalid JSON");
  }
}

function repoName(namespace: string | undefined, name: string | undefined, fallback: string | undefined): string | undefined {
  if (namespace && name) return `${namespace}/${name}`;
  if (fallback?.includes("/")) return fallback;
  if (fallback) return `library/${fallback}`;
  return undefined;
}

function repositoryRecord(value: unknown, rank: number): RepositoryRecord | undefined {
  const obj = objectValue(value);
  if (!obj) return undefined;
  const namespace = textValue(obj.namespace) ?? textValue(obj.user);
  const name = textValue(obj.name) ?? textValue(obj.repo_name);
  const full = repoName(namespace, name, textValue(obj.repo_name));
  if (!full) return undefined;
  const [ns, repo] = full.split("/");
  return compact({
    rank,
    repo_name: full,
    namespace: ns,
    name: repo,
    repository_url: `https://hub.docker.com/r/${full}`,
    short_description: truncate(textValue(obj.short_description) ?? textValue(obj.description), 400),
    description: truncate(textValue(obj.full_description) ?? textValue(obj.description), 1000),
    pull_count: numberValue(obj.pull_count),
    star_count: numberValue(obj.star_count),
    is_official: booleanValue(obj.is_official) ?? full.startsWith("library/"),
    is_automated: booleanValue(obj.is_automated),
    is_private: booleanValue(obj.is_private),
    repository_type: textValue(obj.repository_type),
    status: numberValue(obj.status),
    status_description: textValue(obj.status_description),
    date_registered: textValue(obj.date_registered),
    last_updated: textValue(obj.last_updated),
    last_modified: textValue(obj.last_modified),
    affiliation: textValue(obj.affiliation),
  });
}

function tagRecord(value: unknown, repo: string, rank: number): TagRecord | undefined {
  const obj = objectValue(value);
  if (!obj) return undefined;
  const name = textValue(obj.name);
  if (!name) return undefined;
  const image = objectValue(arrayValue(obj.images)[0]);
  return compact({
    rank,
    name,
    tag_url: `https://hub.docker.com/r/${repo}/tags?name=${encodeURIComponent(name)}`,
    digest: textValue(obj.digest),
    full_size: numberValue(obj.full_size),
    last_updated: textValue(obj.last_updated),
    last_updater_username: textValue(obj.last_updater_username),
    architecture: textValue(image?.architecture),
    os: textValue(image?.os),
    os_version: textValue(image?.os_version),
    variant: textValue(image?.variant),
    image_digest: textValue(image?.digest),
    image_status: textValue(image?.status),
  });
}

export default defineTool<Input, Output>(async (input, bf) => {
  const mode = cleanMode(input);
  const limit = cleanLimit(input.limit);

  if (mode === "search") {
    const query = cleanQuery(input.query);
    const url = searchUrl(query, limit);
    const data = await fetchJson(bf, url);
    const repositories = arrayValue(data.results)
      .map((item, index) => repositoryRecord(item, index + 1))
      .filter((item): item is RepositoryRecord => item !== undefined)
      .slice(0, limit);
    return compact({
      mode,
      source_url: url,
      count: repositories.length,
      query,
      repositories,
      next_url: textValue(data.next),
    });
  }

  const repo = repoParts(input);
  if (mode === "tags") {
    const url = tagsUrl(repo.namespace, repo.name, limit);
    const data = await fetchJson(bf, url);
    const tags = arrayValue(data.results)
      .map((item, index) => tagRecord(item, repo.repository, index + 1))
      .filter((item): item is TagRecord => item !== undefined)
      .slice(0, limit);
    return compact({
      mode,
      source_url: url,
      count: tags.length,
      repository: repo.repository,
      tags,
      next_url: textValue(data.next),
    });
  }

  const url = repositoryUrl(repo.namespace, repo.name);
  const data = await fetchJson(bf, url);
  const record = repositoryRecord(data, 1);
  if (!record) throw new Error(`Docker Hub repository ${repo.repository} did not return public metadata`);
  return {
    mode,
    source_url: url,
    count: 1,
    repository: repo.repository,
    repository_record: record,
  };
});
