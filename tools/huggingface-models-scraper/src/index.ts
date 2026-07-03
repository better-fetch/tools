import { defineTool, type Bf } from "@better-fetch/tools";

type Mode = "search" | "details";
type JsonObject = Record<string, unknown>;

type Input = {
  mode?: Mode;
  query?: string;
  model_id?: string;
  sort?: string;
  direction?: string;
  limit?: number;
};

type ModelRecord = {
  rank: number;
  id: string;
  author?: string;
  model_url: string;
  pipeline_tag?: string;
  library_name?: string;
  license?: string;
  downloads?: number;
  likes?: number;
  private?: boolean;
  gated?: string;
  tags?: string;
  created_at?: string;
  last_modified?: string;
  siblings?: string;
};

type Output = {
  mode: Mode;
  source_url: string;
  count: number;
  query?: string;
  model_id?: string;
  models?: ModelRecord[];
  model?: ModelRecord;
};

const API_BASE = "https://huggingface.co/api";
const USER_AGENT =
  "BetterFetchHuggingFaceModelsScraper/0.1 (https://betterfetch.co/tools/huggingface_models_scraper; support@betterfetch.co)";

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

function cleanMode(input: Input): Mode {
  if (input.mode === "details" || input.model_id) return "details";
  return "search";
}

function cleanQuery(value: string | undefined): string {
  const clean = (value ?? "").trim();
  if (!clean) throw new Error("query is required for search mode");
  return clean.slice(0, 120);
}

function cleanModelId(value: string | undefined): string {
  const clean = (value ?? "")
    .trim()
    .replace(/^https?:\/\/huggingface\.co\//i, "")
    .replace(/^models\//i, "")
    .replace(/\/+$/g, "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)?$/.test(clean)) {
    throw new Error("model_id must look like bert-base-uncased or meta-llama/Llama-3.1-8B-Instruct");
  }
  return clean;
}

function cleanSort(value: string | undefined): string {
  const clean = (value ?? "downloads").trim();
  const allowed = new Set(["downloads", "likes", "lastModified", "createdAt", "trendingScore"]);
  if (!allowed.has(clean)) throw new Error("sort must be downloads, likes, lastModified, createdAt, or trendingScore");
  return clean;
}

function cleanDirection(value: string | undefined): string {
  const clean = (value ?? "-1").trim();
  if (clean === "asc" || clean === "1") return "1";
  if (clean === "desc" || clean === "-1") return "-1";
  throw new Error("direction must be desc, asc, -1, or 1");
}

function cleanLimit(value: number | undefined): number {
  return Math.min(Math.max(value ?? 10, 1), 50);
}

function queryString(params: Record<string, string | number | boolean | undefined>): string {
  return Object.entries(params)
    .filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined && entry[1] !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
}

async function fetchJson(bf: Bf, url: string): Promise<unknown> {
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
    throw new Error(`Hugging Face request failed with status ${response.status ?? "unknown"}`);
  }
  try {
    return JSON.parse(response.body_text) as unknown;
  } catch {
    throw new Error("Hugging Face returned invalid JSON");
  }
}

function joinStrings(values: unknown[], max: number): string | undefined {
  const clean = values
    .map((value) => textValue(value))
    .filter((value): value is string => Boolean(value))
    .slice(0, max);
  return clean.length ? clean.join(", ") : undefined;
}

function licenseFrom(tags: unknown[]): string | undefined {
  const license = tags
    .map((tag) => textValue(tag))
    .find((tag) => tag?.startsWith("license:"));
  return license?.replace(/^license:/, "");
}

function siblingsFrom(value: unknown): string | undefined {
  const siblings = arrayValue(value)
    .map((item) => textValue(objectValue(item)?.rfilename) ?? textValue(item))
    .filter((item): item is string => Boolean(item))
    .slice(0, 20);
  return siblings.length ? siblings.join(", ") : undefined;
}

function modelFrom(value: unknown, rank: number): ModelRecord | undefined {
  const obj = objectValue(value);
  if (!obj) return undefined;
  const id = textValue(obj.id) ?? textValue(obj.modelId);
  if (!id) return undefined;
  const tags = arrayValue(obj.tags);
  return compact({
    rank,
    id,
    author: textValue(obj.author) ?? id.split("/")[0],
    model_url: `https://huggingface.co/${id}`,
    pipeline_tag: textValue(obj.pipeline_tag),
    library_name: textValue(obj.library_name),
    license: licenseFrom(tags),
    downloads: numberValue(obj.downloads),
    likes: numberValue(obj.likes),
    private: booleanValue(obj.private),
    gated: textValue(obj.gated) ?? (booleanValue(obj.gated) ? "true" : undefined),
    tags: joinStrings(tags, 30),
    created_at: textValue(obj.createdAt),
    last_modified: textValue(obj.lastModified),
    siblings: siblingsFrom(obj.siblings),
  });
}

export default defineTool<Input, Output>(async (input, bf) => {
  const mode = cleanMode(input);

  if (mode === "details") {
    const modelId = cleanModelId(input.model_id);
    const sourceUrl = `${API_BASE}/models/${encodeURIComponent(modelId)}`;
    const data = await fetchJson(bf, sourceUrl);
    const model = modelFrom(data, 1);
    if (!model) throw new Error(`Hugging Face model ${modelId} did not return public metadata`);
    return {
      mode,
      source_url: sourceUrl,
      count: 1,
      model_id: modelId,
      model,
    };
  }

  const query = cleanQuery(input.query);
  const max = cleanLimit(input.limit);
  const sourceUrl = `${API_BASE}/models?${queryString({
    search: query,
    sort: cleanSort(input.sort),
    direction: cleanDirection(input.direction),
    limit: max,
    full: true,
  })}`;
  const data = await fetchJson(bf, sourceUrl);
  const models = arrayValue(data)
    .map((item, index) => modelFrom(item, index + 1))
    .filter((item): item is ModelRecord => item !== undefined)
    .slice(0, max);
  return {
    mode,
    source_url: sourceUrl,
    count: models.length,
    query,
    models,
  };
});
