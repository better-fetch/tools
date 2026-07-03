import { defineTool, type Bf } from "@better-fetch/tools";

type JsonObject = Record<string, unknown>;
type SortBy = "created" | "name" | "context_length" | "prompt_price" | "completion_price";

type Input = {
  query?: string;
  provider?: string;
  modality?: string;
  min_context_length?: number;
  max_prompt_price_per_million?: number;
  max_completion_price_per_million?: number;
  free_only?: boolean;
  sort_by?: SortBy;
  limit?: number;
};

type ModelRecord = {
  rank: number;
  id: string;
  canonical_slug?: string;
  name?: string;
  model_url: string;
  description?: string;
  provider?: string;
  created_at?: string;
  knowledge_cutoff?: string;
  context_length?: number;
  max_completion_tokens?: number;
  modality?: string;
  input_modalities?: string;
  output_modalities?: string;
  tokenizer?: string;
  prompt_price_per_million?: number;
  completion_price_per_million?: number;
  input_cache_read_price_per_million?: number;
  input_cache_write_price_per_million?: number;
  image_price_per_million?: number;
  web_search_price?: number;
  internal_reasoning_price_per_million?: number;
  is_moderated?: boolean;
  hugging_face_id?: string;
  supported_parameters?: string;
  details_url?: string;
  reasoning?: string;
};

type Output = {
  source_url: string;
  count: number;
  total_available: number;
  query?: string;
  provider?: string;
  modality?: string;
  models: ModelRecord[];
};

const SOURCE_URL = "https://openrouter.ai/api/v1/models";
const USER_AGENT =
  "BetterFetchOpenRouterModelsPricingScraper/0.1 (https://betterfetch.co/tools/openrouter_models_pricing_scraper; support@betterfetch.co)";

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

function cleanLimit(value: number | undefined): number {
  return Math.min(Math.max(value ?? 25, 1), 100);
}

function cleanQuery(value: string | undefined): string | undefined {
  const clean = (value ?? "").trim().toLowerCase();
  return clean ? clean.slice(0, 120) : undefined;
}

function cleanProvider(value: string | undefined): string | undefined {
  const clean = (value ?? "").trim().toLowerCase();
  if (!clean) return undefined;
  if (!/^[a-z0-9._-]{1,40}$/.test(clean)) throw new Error("provider must be an OpenRouter model id prefix such as anthropic, openai, google, or meta-llama");
  return clean;
}

function cleanModality(value: string | undefined): string | undefined {
  const clean = (value ?? "").trim().toLowerCase();
  if (!clean) return undefined;
  if (!/^[a-z+_-]+->[a-z+_-]+$/.test(clean)) throw new Error("modality must look like text->text or text+image->text");
  return clean;
}

function cleanSort(value: SortBy | undefined): SortBy {
  const allowed = new Set(["created", "name", "context_length", "prompt_price", "completion_price"]);
  return value && allowed.has(value) ? value : "created";
}

function pricePerMillion(value: unknown): number | undefined {
  const perToken = numberValue(value);
  if (perToken === undefined || perToken < 0) return undefined;
  return Number((perToken * 1_000_000).toFixed(6));
}

function joinStrings(value: unknown, max = 30): string | undefined {
  const values = arrayValue(value)
    .map((item) => textValue(item))
    .filter((item): item is string => Boolean(item))
    .slice(0, max);
  return values.length ? values.join(", ") : undefined;
}

function dateFromEpoch(value: unknown): string | undefined {
  const seconds = numberValue(value);
  if (!seconds) return undefined;
  return new Date(seconds * 1000).toISOString();
}

function providerFromId(id: string): string {
  return id.split("/")[0] ?? id;
}

function modelUrl(id: string): string {
  return `https://openrouter.ai/models/${id}`;
}

function reasoningFrom(value: unknown): string | undefined {
  const obj = objectValue(value);
  if (!obj) return undefined;
  const parts = [
    booleanValue(obj.mandatory) === true ? "mandatory" : undefined,
    booleanValue(obj.default_enabled) === true ? "default_enabled" : undefined,
    textValue(obj.default_effort) ? `default_effort:${textValue(obj.default_effort)}` : undefined,
    joinStrings(obj.supported_efforts, 10) ? `efforts:${joinStrings(obj.supported_efforts, 10)}` : undefined,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : undefined;
}

function recordFrom(value: unknown): ModelRecord | undefined {
  const obj = objectValue(value);
  if (!obj) return undefined;
  const id = textValue(obj.id);
  if (!id) return undefined;
  const architecture = objectValue(obj.architecture);
  const pricing = objectValue(obj.pricing);
  const topProvider = objectValue(obj.top_provider);
  const links = objectValue(obj.links);
  return compact({
    rank: 0,
    id,
    canonical_slug: textValue(obj.canonical_slug),
    name: textValue(obj.name),
    model_url: modelUrl(id),
    description: truncate(textValue(obj.description), 700),
    provider: providerFromId(id),
    created_at: dateFromEpoch(obj.created),
    knowledge_cutoff: textValue(obj.knowledge_cutoff),
    context_length: numberValue(obj.context_length),
    max_completion_tokens: numberValue(topProvider?.max_completion_tokens),
    modality: textValue(architecture?.modality),
    input_modalities: joinStrings(architecture?.input_modalities),
    output_modalities: joinStrings(architecture?.output_modalities),
    tokenizer: textValue(architecture?.tokenizer),
    prompt_price_per_million: pricePerMillion(pricing?.prompt),
    completion_price_per_million: pricePerMillion(pricing?.completion),
    input_cache_read_price_per_million: pricePerMillion(pricing?.input_cache_read),
    input_cache_write_price_per_million: pricePerMillion(pricing?.input_cache_write),
    image_price_per_million: pricePerMillion(pricing?.image),
    web_search_price: numberValue(pricing?.web_search),
    internal_reasoning_price_per_million: pricePerMillion(pricing?.internal_reasoning),
    is_moderated: booleanValue(topProvider?.is_moderated),
    hugging_face_id: textValue(obj.hugging_face_id),
    supported_parameters: joinStrings(obj.supported_parameters, 50),
    details_url: textValue(links?.details) ? `https://openrouter.ai${textValue(links?.details)}` : undefined,
    reasoning: reasoningFrom(obj.reasoning),
  });
}

function matches(record: ModelRecord, input: Input): boolean {
  const query = cleanQuery(input.query);
  const provider = cleanProvider(input.provider);
  const modality = cleanModality(input.modality);
  if (query) {
    const haystack = `${record.id} ${record.name ?? ""} ${record.description ?? ""} ${record.hugging_face_id ?? ""}`.toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  if (provider && record.provider !== provider) return false;
  if (modality && record.modality !== modality) return false;
  if (input.min_context_length !== undefined && (record.context_length ?? 0) < input.min_context_length) return false;
  if (input.max_prompt_price_per_million !== undefined && (record.prompt_price_per_million ?? Number.POSITIVE_INFINITY) > input.max_prompt_price_per_million) return false;
  if (input.max_completion_price_per_million !== undefined && (record.completion_price_per_million ?? Number.POSITIVE_INFINITY) > input.max_completion_price_per_million) return false;
  if (input.free_only && ((record.prompt_price_per_million ?? Number.POSITIVE_INFINITY) !== 0 || (record.completion_price_per_million ?? Number.POSITIVE_INFINITY) !== 0)) return false;
  return true;
}

function compareRecords(sortBy: SortBy): (a: ModelRecord, b: ModelRecord) => number {
  return (a, b) => {
    if (sortBy === "name") return (a.name ?? a.id).localeCompare(b.name ?? b.id);
    if (sortBy === "context_length") return (b.context_length ?? -1) - (a.context_length ?? -1);
    if (sortBy === "prompt_price") return (a.prompt_price_per_million ?? Number.POSITIVE_INFINITY) - (b.prompt_price_per_million ?? Number.POSITIVE_INFINITY);
    if (sortBy === "completion_price") return (a.completion_price_per_million ?? Number.POSITIVE_INFINITY) - (b.completion_price_per_million ?? Number.POSITIVE_INFINITY);
    return (Date.parse(b.created_at ?? "") || 0) - (Date.parse(a.created_at ?? "") || 0);
  };
}

async function fetchCatalog(bf: Bf): Promise<ModelRecord[]> {
  const response = await bf.fetch({
    url: SOURCE_URL,
    strategy: "http",
    return_response_text: true,
    extra_headers: {
      accept: "application/json,*/*;q=0.5",
      "user-agent": USER_AGENT,
    },
  });
  const status = response.status ?? 0;
  if (!response.ok || status >= 400 || !response.body_text) {
    throw new Error(`OpenRouter catalog request failed with status ${response.status ?? "unknown"}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body_text) as unknown;
  } catch {
    throw new Error("OpenRouter returned invalid JSON");
  }
  const rows = arrayValue(objectValue(parsed)?.data)
    .map(recordFrom)
    .filter((record): record is ModelRecord => record !== undefined);
  return rows;
}

export default defineTool<Input, Output>(async (input, bf) => {
  const allModels = await fetchCatalog(bf);
  const filtered = allModels
    .filter((record) => matches(record, input))
    .sort(compareRecords(cleanSort(input.sort_by)))
    .slice(0, cleanLimit(input.limit))
    .map((record, index) => ({ ...record, rank: index + 1 }));

  return compact({
    source_url: SOURCE_URL,
    count: filtered.length,
    total_available: allModels.length,
    query: cleanQuery(input.query),
    provider: cleanProvider(input.provider),
    modality: cleanModality(input.modality),
    models: filtered,
  });
});
