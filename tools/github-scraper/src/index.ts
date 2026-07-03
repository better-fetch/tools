import { defineTool, type Bf } from "@better-fetch/tools";

type Mode = "repo" | "profile" | "search" | "trending";

type Input = {
  mode?: Mode;
  repo_or_url?: string;
  username_or_url?: string;
  query?: string;
  language?: string;
  since?: "daily" | "weekly" | "monthly";
  sort?: "stars" | "forks" | "updated";
  order?: "desc" | "asc";
  max_results?: number;
};

type GithubOwner = {
  login?: string;
  html_url?: string;
  avatar_url?: string;
};

type GithubLicense = {
  spdx_id?: string;
  name?: string;
};

type GithubRepo = {
  name?: string;
  full_name?: string;
  owner?: GithubOwner;
  html_url?: string;
  description?: string | null;
  homepage?: string | null;
  language?: string | null;
  stargazers_count?: number;
  forks_count?: number;
  watchers_count?: number;
  open_issues_count?: number;
  topics?: string;
  license?: GithubLicense | null;
  archived?: boolean;
  fork?: boolean;
  default_branch?: string;
  created_at?: string;
  updated_at?: string;
  pushed_at?: string;
  size?: number;
};

type GithubUser = {
  login?: string;
  name?: string | null;
  bio?: string | null;
  company?: string | null;
  location?: string | null;
  blog?: string | null;
  twitter_username?: string | null;
  followers?: number;
  following?: number;
  public_repos?: number;
  avatar_url?: string;
  html_url?: string;
  created_at?: string;
  updated_at?: string;
};

type RepoRecord = {
  type: "repository" | "trending_repository";
  name: string;
  full_name: string;
  owner?: string;
  url: string;
  description?: string;
  homepage_url?: string;
  language?: string;
  stars?: number;
  stars_today?: number;
  forks?: number;
  watchers?: number;
  open_issues?: number;
  topics?: string[];
  license?: string;
  is_archived?: boolean;
  is_fork?: boolean;
  default_branch?: string;
  created_at?: string;
  updated_at?: string;
  pushed_at?: string;
  size_kb?: number;
};

type ProfileRecord = {
  type: "profile";
  username: string;
  name?: string;
  bio?: string;
  company?: string;
  location?: string;
  blog?: string;
  twitter_username?: string;
  followers?: number;
  following?: number;
  public_repos?: number;
  avatar_url?: string;
  url: string;
  created_at?: string;
  updated_at?: string;
};

type Output = {
  mode: Mode;
  source_url: string;
  count: number;
  items: Array<RepoRecord | ProfileRecord>;
};

function cleanMode(value: Mode | undefined): Mode {
  return value ?? "repo";
}

function limitFrom(value: number | undefined): number {
  return Math.min(Math.max(value ?? 10, 1), 25);
}

function cleanLanguage(value: string | undefined): string | undefined {
  const clean = value?.trim().toLowerCase().replace(/\s+/g, "-");
  return clean && /^[a-z0-9#+._-]{1,40}$/.test(clean) ? clean : undefined;
}

function cleanSince(value: Input["since"]): "daily" | "weekly" | "monthly" {
  return value === "weekly" || value === "monthly" ? value : "daily";
}

function cleanSort(value: Input["sort"]): "stars" | "forks" | "updated" {
  return value === "forks" || value === "updated" ? value : "stars";
}

function cleanOrder(value: Input["order"]): "desc" | "asc" {
  return value === "asc" ? "asc" : "desc";
}

function repoSlugFrom(value: string | undefined): string {
  const clean = value?.trim() ?? "";
  const match = clean.match(/(?:github\.com\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:[/?#].*)?$/);
  if (!match) throw new Error("repo_or_url must be an owner/repo slug or public GitHub repository URL");
  return `${match[1]}/${match[2].replace(/\.git$/, "")}`;
}

function usernameFrom(value: string | undefined): string {
  const clean = value?.trim() ?? "";
  const match = clean.match(/(?:github\.com\/)?([A-Za-z0-9-]{1,39})(?:[/?#].*)?$/);
  if (!match) throw new Error("username_or_url must be a GitHub username or public profile URL");
  return match[1];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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
  return decodeEntities(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function attr(attrs: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = attrs.match(new RegExp(`${escaped}=["']([^"']*)["']`, "i"));
  return match?.[1] ? decodeEntities(match[1]).trim() : undefined;
}

function compactRepo(record: RepoRecord): RepoRecord {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined && value !== "" && (!Array.isArray(value) || value.length)) out[key] = value;
  }
  return out as RepoRecord;
}

function compactProfile(record: ProfileRecord): ProfileRecord {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined && value !== "") out[key] = value;
  }
  return out as ProfileRecord;
}

function repoFromApi(repo: GithubRepo): RepoRecord | undefined {
  const fullName = stringValue(repo.full_name);
  const url = stringValue(repo.html_url);
  const name = stringValue(repo.name);
  if (!fullName || !url || !name) return undefined;
  return compactRepo({
    type: "repository",
    name,
    full_name: fullName,
    owner: stringValue(repo.owner?.login),
    url,
    description: stringValue(repo.description),
    homepage_url: stringValue(repo.homepage),
    language: stringValue(repo.language),
    stars: numberValue(repo.stargazers_count),
    forks: numberValue(repo.forks_count),
    watchers: numberValue(repo.watchers_count),
    open_issues: numberValue(repo.open_issues_count),
    topics: Array.isArray(repo.topics) ? repo.topics.filter((topic) => typeof topic === "string").join(", ") : undefined,
    license: stringValue(repo.license?.spdx_id) ?? stringValue(repo.license?.name),
    is_archived: typeof repo.archived === "boolean" ? repo.archived : undefined,
    is_fork: typeof repo.fork === "boolean" ? repo.fork : undefined,
    default_branch: stringValue(repo.default_branch),
    created_at: stringValue(repo.created_at),
    updated_at: stringValue(repo.updated_at),
    pushed_at: stringValue(repo.pushed_at),
    size_kb: numberValue(repo.size),
  });
}

function profileFromApi(user: GithubUser): ProfileRecord | undefined {
  const username = stringValue(user.login);
  const url = stringValue(user.html_url);
  if (!username || !url) return undefined;
  return compactProfile({
    type: "profile",
    username,
    name: stringValue(user.name),
    bio: stringValue(user.bio),
    company: stringValue(user.company),
    location: stringValue(user.location),
    blog: stringValue(user.blog),
    twitter_username: stringValue(user.twitter_username),
    followers: numberValue(user.followers),
    following: numberValue(user.following),
    public_repos: numberValue(user.public_repos),
    avatar_url: stringValue(user.avatar_url),
    url,
    created_at: stringValue(user.created_at),
    updated_at: stringValue(user.updated_at),
  });
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("GitHub returned invalid JSON");
  }
}

function apiHeaders() {
  return {
    accept: "application/vnd.github+json,application/json;q=0.9,*/*;q=0.5",
    "user-agent": "BetterFetchGitHubScraper/0.1 (+https://betterfetch.co/tools/github_scraper)",
    "x-github-api-version": "2022-11-28",
  };
}

async function fetchJson(url: string, bf: Bf): Promise<unknown> {
  const response = await bf.fetch({
    url,
    strategy: "http",
    return_response_text: true,
    extra_headers: apiHeaders(),
  });
  if (response.status && response.status >= 400) {
    throw new Error(`GitHub request failed with HTTP ${response.status}`);
  }
  return parseJson(response.body_text ?? "");
}

function trendingRepoFromArticle(article: string): RepoRecord | undefined {
  const repoLinkMatch = article.match(/<h2\b[\s\S]*?<a\s+([^>]*)>([\s\S]*?)<\/a>/i);
  const href = attr(repoLinkMatch?.[1] ?? "", "href");
  const text = repoLinkMatch?.[2] ? stripTags(repoLinkMatch[2]) : undefined;
  const slug = href?.replace(/^\/+/, "") || text?.replace(/\s+/g, "");
  if (!slug || !slug.includes("/")) return undefined;
  const [owner, name] = slug.split("/", 2);
  if (!owner || !name) return undefined;

  const description = stripTags(article.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "");
  const language = stripTags(article.match(/<span[^>]*itemprop=["']programmingLanguage["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? "");
  const stars = numberFromCompactText(article.match(/href=["']\/[^"']+\/stargazers["'][^>]*>([\s\S]*?)<\/a>/i)?.[1]);
  const forks = numberFromCompactText(article.match(/href=["']\/[^"']+\/forks["'][^>]*>([\s\S]*?)<\/a>/i)?.[1]);
  const starsToday = numberFromCompactText(article.match(/([0-9,.]+[kKmM]?)\s+stars?\s+today/i)?.[1]);

  return compactRepo({
    type: "trending_repository",
    name,
    full_name: `${owner}/${name}`,
    owner,
    url: `https://github.com/${owner}/${name}`,
    description,
    language,
    stars,
    forks,
    stars_today: starsToday,
  });
}

function numberFromCompactText(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const clean = stripTags(value).replace(/,/g, "").trim().toLowerCase();
  const match = clean.match(/([0-9]+(?:\.[0-9]+)?)([km])?/);
  if (!match) return undefined;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return undefined;
  const multiplier = match[2] === "m" ? 1_000_000 : match[2] === "k" ? 1_000 : 1;
  return Math.round(base * multiplier);
}

function parseTrending(html: string, limit: number): RepoRecord[] {
  const articles = html.match(/<article\b[\s\S]*?<\/article>/gi) ?? [];
  return articles.map(trendingRepoFromArticle).filter((repo): repo is RepoRecord => Boolean(repo)).slice(0, limit);
}

export default defineTool<Input, Output>(async (input, bf) => {
  const mode = cleanMode(input.mode);
  const limit = limitFrom(input.max_results);

  if (mode === "repo") {
    const slug = repoSlugFrom(input.repo_or_url);
    const url = `https://api.github.com/repos/${slug}`;
    const repo = repoFromApi((await fetchJson(url, bf)) as GithubRepo);
    if (!repo) throw new Error("No public GitHub repository metadata was found");
    return { mode, source_url: url, count: 1, items: [repo] };
  }

  if (mode === "profile") {
    const username = usernameFrom(input.username_or_url);
    const url = `https://api.github.com/users/${encodeURIComponent(username)}`;
    const profile = profileFromApi((await fetchJson(url, bf)) as GithubUser);
    if (!profile) throw new Error("No public GitHub profile metadata was found");
    return { mode, source_url: url, count: 1, items: [profile] };
  }

  if (mode === "search") {
    const query = input.query?.trim();
    if (!query) throw new Error("query is required for search mode");
    const params = new URLSearchParams({
      q: query,
      sort: cleanSort(input.sort),
      order: cleanOrder(input.order),
      per_page: String(limit),
    });
    const url = `https://api.github.com/search/repositories?${params}`;
    const payload = (await fetchJson(url, bf)) as { items?: GithubRepo[] };
    const items = (payload.items ?? []).map(repoFromApi).filter((repo): repo is RepoRecord => Boolean(repo)).slice(0, limit);
    if (!items.length) throw new Error("No public GitHub repositories were found for this search");
    return { mode, source_url: url, count: items.length, items };
  }

  const language = cleanLanguage(input.language);
  const since = cleanSince(input.since);
  const path = language ? `/${encodeURIComponent(language)}` : "";
  const url = `https://github.com/trending${path}?since=${since}`;
  const response = await bf.fetch({
    url,
    return_response_text: true,
    extra_headers: {
      accept: "text/html,*/*;q=0.5",
      "accept-language": "en-US,en;q=0.9",
      "user-agent": "BetterFetchGitHubScraper/0.1 (+https://betterfetch.co/tools/github_scraper)",
    },
  });
  if (response.status && response.status >= 400) {
    throw new Error(`GitHub Trending request failed with HTTP ${response.status}`);
  }
  const items = parseTrending(response.body_text ?? "", limit);
  if (!items.length) throw new Error("No GitHub Trending repositories were found");
  return { mode, source_url: response.final_url ?? url, count: items.length, items };
});
