import { defineTool, type Bf } from "@better-fetch/tools";

type Mode =
  | "repo"
  | "profile"
  | "repositories"
  | "pull_requests"
  | "activity"
  | "followers"
  | "following"
  | "contributions"
  | "search"
  | "trending"
  | "trending_developers";

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
  topics?: string[];
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
  topics?: string;
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

type SocialRecord = {
  type: "pull_request" | "activity" | "user" | "contributions" | "trending_developer";
  url: string;
  name?: string;
  username?: string;
  owner?: string;
  avatar_url?: string;
  repository?: string;
  state?: string;
  event_type?: string;
  number?: number;
  comments?: number;
  contributions?: number;
  contribution_days?: number;
  max_contribution_level?: number;
  first_date?: string;
  last_date?: string;
  popular_repository?: string;
  popular_repository_url?: string;
  created_at?: string;
  updated_at?: string;
  closed_at?: string;
};

type Output = {
  mode: Mode;
  source_url: string;
  count: number;
  items: Array<RepoRecord | ProfileRecord | SocialRecord>;
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

function metaContent(html: string, key: string): string | undefined {
  for (const match of html.matchAll(/<meta\b([^>]*)>/gi)) {
    const attrs = match[1];
    const label = attr(attrs, "property") ?? attr(attrs, "name") ?? attr(attrs, "itemprop");
    if (label?.toLowerCase() === key.toLowerCase()) return attr(attrs, "content");
  }
  return undefined;
}

async function fetchHtml(url: string, bf: Bf): Promise<{ html: string; url: string }> {
  const response = await bf.fetch({
    url,
    strategy: "http",
    return_response_text: true,
    include_html: true,
    extra_headers: {
      accept: "text/html,application/xhtml+xml,application/atom+xml;q=0.9,*/*;q=0.5",
      "accept-language": "en-US,en;q=0.9",
      "user-agent": "BetterFetchGitHubScraper/0.2 (+https://betterfetch.co/tools/github_scraper)",
    },
  });
  if (response.status && response.status >= 400) {
    throw new Error(`GitHub page request failed with HTTP ${response.status}`);
  }
  return {
    html: response.body_text ?? response.html ?? "",
    url: response.final_url ?? url,
  };
}

function profileFromHtml(username: string, html: string): ProfileRecord {
  const resolvedUsername = metaContent(html, "profile:username") ?? username;
  const description = metaContent(html, "og:description");
  const publicRepos = description?.match(/([\d,]+) repositories/i)?.[1];
  const followerText = html.match(/href=["'][^"']*\?tab=followers["'][^>]*>([\s\S]*?)<\/a>/i)?.[1];
  const followingText = html.match(/href=["'][^"']*\?tab=following["'][^>]*>([\s\S]*?)<\/a>/i)?.[1];
  return compactProfile({
    type: "profile",
    username: resolvedUsername,
    name: metaContent(html, "og:title"),
    bio: description,
    followers: numberFromCompactText(followerText),
    following: numberFromCompactText(followingText),
    public_repos: publicRepos ? Number(publicRepos.replace(/,/g, "")) : undefined,
    avatar_url: metaContent(html, "og:image"),
    url: `https://github.com/${resolvedUsername}`,
  });
}

function repoFromHtml(slug: string, html: string): RepoRecord {
  const [owner, name] = slug.split("/", 2);
  const starText = html.match(new RegExp(`href=["']/${owner}/${name}/stargazers["'][^>]*>([\\s\\S]*?)<\\/a>`, "i"))?.[1];
  const forkText = html.match(new RegExp(`href=["']/${owner}/${name}/forks["'][^>]*>([\\s\\S]*?)<\\/a>`, "i"))?.[1];
  const language = stripTags(
    html.match(/itemprop=["']programmingLanguage["'][^>]*>([\s\S]*?)<\//i)?.[1] ?? "",
  );
  const topics = [...html.matchAll(/href=["']\/topics\/([^"']+)["']/gi)]
    .map((match) => decodeURIComponent(match[1]))
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 20);
  return compactRepo({
    type: "repository",
    name,
    full_name: slug,
    owner,
    url: `https://github.com/${slug}`,
    description: metaContent(html, "og:description"),
    language: language || undefined,
    stars: numberFromCompactText(starText),
    forks: numberFromCompactText(forkText),
    topics: topics.length ? topics.join(", ") : undefined,
  });
}

function repositoriesFromHtml(username: string, html: string, limit: number): RepoRecord[] {
  const out: RepoRecord[] = [];
  const seen = new Set<string>();
  const pattern = new RegExp(
    `<a\\b([^>]*)href=["']/${username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/([A-Za-z0-9_.-]+)["']([^>]*)itemprop=["']name codeRepository["'][^>]*>`,
    "gi",
  );
  for (const match of html.matchAll(pattern)) {
    const name = match[2];
    const slug = `${username}/${name}`;
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push({
      type: "repository",
      name,
      full_name: slug,
      owner: username,
      url: `https://github.com/${slug}`,
    });
    if (out.length >= limit) break;
  }
  return out;
}

function usersFromHtml(html: string, limit: number): SocialRecord[] {
  const out: SocialRecord[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<a\b([^>]*)data-hovercard-type=["']user["']([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = `${match[1]} ${match[2]}`;
    const path = attr(attrs, "href");
    const username = path?.match(/^\/([A-Za-z0-9-]{1,39})$/)?.[1];
    if (!username || seen.has(username)) continue;
    const avatar = match[3].match(/<img\b([^>]*)>/i)?.[1];
    seen.add(username);
    out.push(compactSocial({
      type: "user",
      username,
      name: stripTags(match[3]).replace(/^@/, "") || undefined,
      avatar_url: avatar ? attr(avatar, "src") : undefined,
      url: `https://github.com/${username}`,
    }));
    if (out.length >= limit) break;
  }
  return out;
}

function activityFromAtom(xml: string, limit: number): SocialRecord[] {
  const entries = xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? [];
  return entries.slice(0, limit).map((entry) => {
    const title = stripTags(entry.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "GitHub activity");
    const linkTag = entry.match(/<link\b[^>]*rel=["']alternate["'][^>]*>/i)?.[0]
      ?? entry.match(/<link\b[^>]*>/i)?.[0]
      ?? "";
    const url = attr(linkTag, "href") ?? "https://github.com";
    const repository = url.match(/github\.com\/([^/?#]+\/[^/?#]+)/i)?.[1];
    return compactSocial({
      type: "activity",
      url,
      name: title,
      event_type: title.split(" ")[0],
      repository,
      created_at: stripTags(entry.match(/<published\b[^>]*>([\s\S]*?)<\/published>/i)?.[1] ?? ""),
      updated_at: stripTags(entry.match(/<updated\b[^>]*>([\s\S]*?)<\/updated>/i)?.[1] ?? ""),
    });
  });
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

function compactSocial(record: SocialRecord): SocialRecord {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined && value !== "") out[key] = value;
  }
  return out as SocialRecord;
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

function userFromApi(value: unknown): SocialRecord | undefined {
  const user = value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
  const username = stringValue(user?.login);
  const url = stringValue(user?.html_url);
  if (!username || !url) return undefined;
  return compactSocial({
    type: "user",
    url,
    username,
    name: stringValue(user?.name),
    avatar_url: stringValue(user?.avatar_url),
  });
}

function pullRequestFromApi(value: unknown): SocialRecord | undefined {
  const item = value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
  const url = stringValue(item?.html_url);
  const name = stringValue(item?.title);
  if (!url || !name) return undefined;
  const user = item?.user && typeof item.user === "object" ? (item.user as Record<string, unknown>) : undefined;
  const repository = stringValue(item?.repository_url)?.replace("https://api.github.com/repos/", "");
  return compactSocial({
    type: "pull_request",
    url,
    name,
    username: stringValue(user?.login),
    repository,
    state: stringValue(item?.state),
    number: numberValue(item?.number),
    comments: numberValue(item?.comments),
    created_at: stringValue(item?.created_at),
    updated_at: stringValue(item?.updated_at),
    closed_at: stringValue(item?.closed_at),
  });
}

function activityFromApi(value: unknown): SocialRecord | undefined {
  const item = value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
  const actor = item?.actor && typeof item.actor === "object" ? (item.actor as Record<string, unknown>) : undefined;
  const repo = item?.repo && typeof item.repo === "object" ? (item.repo as Record<string, unknown>) : undefined;
  const repository = stringValue(repo?.name);
  const eventType = stringValue(item?.type);
  if (!repository || !eventType) return undefined;
  return compactSocial({
    type: "activity",
    url: `https://github.com/${repository}`,
    name: eventType,
    event_type: eventType,
    username: stringValue(actor?.login),
    repository,
    created_at: stringValue(item?.created_at),
  });
}

function contributionRecord(username: string, html: string): SocialRecord {
  const heading = stripTags(
    html.match(/<h2\b[^>]*>([\s\S]*?contributions?[\s\S]*?)<\/h2>/i)?.[1] ?? "",
  );
  const contributions = numberFromCompactText(heading);
  const days = [...html.matchAll(/<td\b[^>]*data-date=["']([^"']+)["'][^>]*data-level=["'](\d+)["'][^>]*>/gi)]
    .map((match) => ({ date: match[1], level: Number(match[2]) }))
    .filter((item) => item.date);
  return compactSocial({
    type: "contributions",
    url: `https://github.com/${username}`,
    username,
    contributions,
    contribution_days: days.filter((day) => day.level > 0).length,
    max_contribution_level: days.length ? Math.max(...days.map((day) => day.level)) : undefined,
    first_date: days[0]?.date,
    last_date: days.at(-1)?.date,
  });
}

function parseTrendingDevelopers(html: string, limit: number): SocialRecord[] {
  const articles = html.match(/<article\b[\s\S]*?<\/article>/gi) ?? [];
  const out: SocialRecord[] = [];
  for (const article of articles) {
    const profileLink = [...article.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]
      .map((match) => ({ attrs: match[1], text: stripTags(match[2]) }))
      .find((item) => /^\/[A-Za-z0-9-]{1,39}$/.test(attr(item.attrs, "href") ?? ""));
    const path = profileLink ? attr(profileLink.attrs, "href") : undefined;
    const username = path?.slice(1);
    if (!username) continue;
    const repoMatch = article.match(/href=["']\/(?:[^"']+)\/([^"']+)["'][^>]*data-hydro-click/iu)
      ?? article.match(/href=["']\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)["']/i);
    const repoSlug = repoMatch?.[1]?.includes("/") ? repoMatch[1] : undefined;
    out.push(compactSocial({
      type: "trending_developer",
      url: `https://github.com/${username}`,
      username,
      name: profileLink?.text || username,
      popular_repository: repoSlug?.split("/").pop(),
      popular_repository_url: repoSlug ? `https://github.com/${repoSlug}` : undefined,
    }));
    if (out.length >= limit) break;
  }
  return out;
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
    const url = `https://github.com/${slug}`;
    const page = await fetchHtml(url, bf);
    const repo = repoFromHtml(slug, page.html);
    return { mode, source_url: url, count: 1, items: [repo] };
  }

  if (mode === "profile") {
    const username = usernameFrom(input.username_or_url);
    const url = `https://github.com/${encodeURIComponent(username)}`;
    const page = await fetchHtml(url, bf);
    const profile = profileFromHtml(username, page.html);
    return { mode, source_url: url, count: 1, items: [profile] };
  }

  if (mode === "repositories") {
    const username = usernameFrom(input.username_or_url);
    const url = `https://github.com/${encodeURIComponent(username)}?tab=repositories`;
    const page = await fetchHtml(url, bf);
    const items = repositoriesFromHtml(username, page.html, limit);
    return { mode, source_url: url, count: items.length, items };
  }

  if (mode === "pull_requests") {
    const username = usernameFrom(input.username_or_url);
    const params = new URLSearchParams({
      q: `author:${username} is:pr`,
      sort: "updated",
      order: "desc",
      per_page: String(limit),
    });
    const url = `https://api.github.com/search/issues?${params}`;
    const payload = (await fetchJson(url, bf)) as { items?: unknown[] };
    const items = (payload.items ?? [])
      .map(pullRequestFromApi)
      .filter((item): item is SocialRecord => Boolean(item))
      .slice(0, limit);
    return { mode, source_url: url, count: items.length, items };
  }

  if (mode === "activity") {
    const username = usernameFrom(input.username_or_url);
    const url = `https://github.com/${encodeURIComponent(username)}.atom`;
    const page = await fetchHtml(url, bf);
    const items = activityFromAtom(page.html, limit);
    return { mode, source_url: url, count: items.length, items };
  }

  if (mode === "followers" || mode === "following") {
    const username = usernameFrom(input.username_or_url);
    const url = `https://github.com/${encodeURIComponent(username)}?tab=${mode}`;
    const page = await fetchHtml(url, bf);
    const items = usersFromHtml(page.html, limit);
    return { mode, source_url: url, count: items.length, items };
  }

  if (mode === "contributions") {
    const username = usernameFrom(input.username_or_url);
    const url = `https://github.com/users/${encodeURIComponent(username)}/contributions`;
    const response = await bf.fetch({
      url,
      strategy: "http",
      return_response_text: true,
      include_html: true,
      extra_headers: {
        accept: "text/html,*/*;q=0.5",
        "user-agent": "BetterFetchGitHubScraper/0.2 (+https://betterfetch.co/tools/github_scraper)",
      },
    });
    if (response.status && response.status >= 400) {
      throw new Error(`GitHub contributions request failed with HTTP ${response.status}`);
    }
    const item = contributionRecord(username, response.body_text ?? response.html ?? "");
    return { mode, source_url: response.final_url ?? url, count: 1, items: [item] };
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

  if (mode === "trending_developers") {
    const since = cleanSince(input.since);
    const url = `https://github.com/trending/developers?since=${since}`;
    const response = await bf.fetch({
      url,
      strategy: "http",
      return_response_text: true,
      include_html: true,
      extra_headers: {
        accept: "text/html,*/*;q=0.5",
        "accept-language": "en-US,en;q=0.9",
        "user-agent": "BetterFetchGitHubScraper/0.2 (+https://betterfetch.co/tools/github_scraper)",
      },
    });
    if (response.status && response.status >= 400) {
      throw new Error(`GitHub Trending Developers request failed with HTTP ${response.status}`);
    }
    const items = parseTrendingDevelopers(response.body_text ?? response.html ?? "", limit);
    if (!items.length) throw new Error("No GitHub Trending developers were found");
    return { mode, source_url: response.final_url ?? url, count: items.length, items };
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
