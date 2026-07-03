import { defineTool, type Bf } from "@better-fetch/tools";

type Mode = "search" | "item" | "user";

type Input = {
  mode?: Mode;
  query?: string;
  tags?: string;
  sort?: "relevance" | "date";
  item_id?: number;
  username?: string;
  max_results?: number;
  max_comments?: number;
};

type AlgoliaHit = {
  objectID?: string;
  title?: string;
  story_title?: string;
  url?: string;
  story_url?: string;
  author?: string;
  points?: number;
  num_comments?: number;
  created_at?: string;
  created_at_i?: number;
  _tags?: string[];
  story_id?: number;
  parent_id?: number;
  comment_text?: string;
  story_text?: string;
};

type AlgoliaSearchResponse = {
  hits?: AlgoliaHit[];
  nbHits?: number;
  page?: number;
  hitsPerPage?: number;
  message?: string;
};

type AlgoliaItem = {
  id?: number;
  type?: string;
  title?: string;
  url?: string;
  author?: string;
  points?: number;
  text?: string;
  created_at?: string;
  children?: AlgoliaItem[];
};

type FirebaseUser = {
  id?: string;
  created?: number;
  karma?: number;
  about?: string;
  submitted?: number[];
};

type HnRecord = {
  type: "story" | "comment" | "item";
  object_id: string;
  title?: string;
  url?: string;
  hn_url?: string;
  author?: string;
  points?: number;
  num_comments?: number;
  created_at?: string;
  tags?: string;
  story_id?: number;
  parent_id?: number;
  text?: string;
};

type HnComment = {
  type: "comment";
  object_id: string;
  parent_id?: number;
  author?: string;
  created_at?: string;
  level?: number;
  text?: string;
};

type HnUser = {
  type: "user";
  username: string;
  karma?: number;
  created_at?: string;
  about_text?: string;
  submitted_count?: number;
  recent_submitted_ids?: string;
};

type Output = {
  mode: Mode;
  source_url: string;
  count: number;
  total_matches?: number;
  records?: HnRecord[];
  comments?: HnComment[];
  user?: HnUser;
};

function limitFrom(value: number | undefined, fallback: number, max: number): number {
  return Math.min(Math.max(value ?? fallback, 1), max);
}

function cleanMode(value: Mode | undefined): Mode {
  return value === "item" || value === "user" ? value : "search";
}

function cleanSort(value: Input["sort"]): "relevance" | "date" {
  return value === "date" ? "date" : "relevance";
}

function cleanTags(value: string | undefined): string {
  const clean = (value ?? "story")
    .split(/[,\s;]+/)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => /^[a-z0-9_()]+$/.test(part))
    .slice(0, 6)
    .join(",");
  return clean || "story";
}

function cleanUsername(value: string | undefined): string {
  const clean = value?.trim();
  if (!clean || !/^[A-Za-z0-9_-]{1,32}$/.test(clean)) {
    throw new Error("username must be a public Hacker News username");
  }
  return clean;
}

function cleanItemId(value: number | undefined): number {
  if (!Number.isInteger(value) || (value ?? 0) <= 0) {
    throw new Error("item_id must be a positive Hacker News item id");
  }
  return value!;
}

function queryString(params: Record<string, string | undefined>): string {
  return Object.entries(params)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
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

function htmlToText(value: string | undefined): string | undefined {
  const clean = decodeEntities((value ?? "").replace(/<p>/gi, " ").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  return clean || undefined;
}

function intValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : undefined;
}

function isoFromUnix(value: number | undefined): string | undefined {
  return typeof value === "number" && Number.isFinite(value) ? new Date(value * 1000).toISOString() : undefined;
}

function compact<T extends Record<string, unknown>>(record: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined && value !== "") out[key] = value;
  }
  return out as T;
}

function recordFromHit(hit: AlgoliaHit): HnRecord | undefined {
  const objectId = hit.objectID;
  if (!objectId) return undefined;
  const title = htmlToText(hit.title ?? hit.story_title);
  const text = htmlToText(hit.comment_text ?? hit.story_text);
  const storyId = intValue(hit.story_id);
  const type = hit.comment_text ? "comment" : "story";
  return compact({
    type,
    object_id: objectId,
    title,
    url: hit.url ?? hit.story_url,
    hn_url: `https://news.ycombinator.com/item?id=${storyId ?? objectId}`,
    author: hit.author,
    points: intValue(hit.points),
    num_comments: intValue(hit.num_comments),
    created_at: hit.created_at,
    tags: hit._tags?.join(", "),
    story_id: storyId,
    parent_id: intValue(hit.parent_id),
    text,
  });
}

function recordFromItem(item: AlgoliaItem): HnRecord | undefined {
  const id = intValue(item.id);
  if (!id) return undefined;
  return compact({
    type: item.type === "comment" ? "comment" : item.type === "story" ? "story" : "item",
    object_id: String(id),
    title: htmlToText(item.title),
    url: item.url,
    hn_url: `https://news.ycombinator.com/item?id=${id}`,
    author: item.author,
    points: intValue(item.points),
    created_at: item.created_at,
    text: htmlToText(item.text),
  });
}

function flattenComments(children: AlgoliaItem[] | undefined, limit: number): HnComment[] {
  const out: HnComment[] = [];
  function visit(nodes: AlgoliaItem[] | undefined, level: number, parentId?: number) {
    if (!nodes || out.length >= limit) return;
    for (const node of nodes) {
      if (out.length >= limit) return;
      const id = intValue(node.id);
      if (id && node.type === "comment") {
        out.push(
          compact({
            type: "comment",
            object_id: String(id),
            parent_id: parentId,
            author: node.author,
            created_at: node.created_at,
            level,
            text: htmlToText(node.text),
          }),
        );
      }
      visit(node.children, level + 1, id ?? parentId);
    }
  }
  visit(children, 0);
  return out;
}

async function fetchJson<T>(bf: Bf, url: string): Promise<T> {
  const response = await bf.fetch({
    url,
    strategy: "http",
    return_response_text: true,
    extra_headers: {
      accept: "application/json,*/*;q=0.5",
      "user-agent": "BetterFetchHackerNewsScraper/0.1 (+https://betterfetch.co/tools/hacker_news_scraper)",
    },
  });
  if (response.status && response.status >= 400) {
    throw new Error(`Hacker News API request failed with HTTP ${response.status}`);
  }
  try {
    return JSON.parse(response.body_text ?? "") as T;
  } catch {
    throw new Error("Hacker News API returned invalid JSON");
  }
}

export default defineTool<Input, Output>(async (input, bf) => {
  const mode = cleanMode(input.mode);

  if (mode === "item") {
    const itemId = cleanItemId(input.item_id);
    const maxComments = Math.min(Math.max(input.max_comments ?? 10, 0), 50);
    const url = `https://hn.algolia.com/api/v1/items/${itemId}`;
    const item = await fetchJson<AlgoliaItem>(bf, url);
    const record = recordFromItem(item);
    if (!record) throw new Error("No Hacker News item was found for this id");
    const comments = maxComments > 0 ? flattenComments(item.children, maxComments) : [];
    return compact({
      mode,
      source_url: url,
      count: 1,
      records: [record],
      comments: comments.length ? comments : undefined,
    });
  }

  if (mode === "user") {
    const username = cleanUsername(input.username);
    const url = `https://hacker-news.firebaseio.com/v0/user/${encodeURIComponent(username)}.json`;
    const user = await fetchJson<FirebaseUser | null>(bf, url);
    if (!user?.id) throw new Error("No public Hacker News user metadata was found");
    const submitted = Array.isArray(user.submitted) ? user.submitted : [];
    return {
      mode,
      source_url: url,
      count: 1,
      user: compact({
        type: "user",
        username: user.id,
        karma: intValue(user.karma),
        created_at: isoFromUnix(user.created),
        about_text: htmlToText(user.about),
        submitted_count: submitted.length,
        recent_submitted_ids: submitted.slice(0, 25).join(", "),
      }),
    };
  }

  const limit = limitFrom(input.max_results, 10, 50);
  const sort = cleanSort(input.sort);
  const query = input.query?.trim();
  const tags = cleanTags(input.tags);
  const path = sort === "date" ? "search_by_date" : "search";
  const qs = queryString({
    query,
    tags,
    hitsPerPage: String(limit),
  });
  const url = `https://hn.algolia.com/api/v1/${path}?${qs}`;
  const payload = await fetchJson<AlgoliaSearchResponse>(bf, url);
  if (payload.message) throw new Error(payload.message);
  const records = (payload.hits ?? []).map(recordFromHit).filter((record): record is HnRecord => Boolean(record)).slice(0, limit);
  if (!records.length) throw new Error("No Hacker News records were found for this search");
  return {
    mode,
    source_url: url,
    count: records.length,
    total_matches: intValue(payload.nbHits),
    records,
  };
});
