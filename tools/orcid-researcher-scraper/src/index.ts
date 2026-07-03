import { defineTool, type Bf } from "@better-fetch/tools";

type Mode = "search" | "record";
type JsonObject = Record<string, unknown>;

type Input = {
  mode?: Mode;
  orcid_id?: string;
  query?: string;
  given_names?: string;
  family_name?: string;
  affiliation?: string;
  keyword?: string;
  rows?: number;
  start?: number;
  include_biography?: boolean;
};

type ResearcherRecord = {
  rank: number;
  orcid_id: string;
  orcid_url: string;
  host?: string;
  given_names?: string;
  family_name?: string;
  credit_name?: string;
  display_name?: string;
  other_names?: string;
  biography?: string;
  keywords?: string;
  researcher_urls?: string;
  external_identifiers?: string;
  employments?: string;
  educations?: string;
  works_count?: number;
  funding_count?: number;
  peer_review_count?: number;
  claimed?: boolean;
  created_at?: string;
  last_modified_at?: string;
};

type Output = {
  mode: Mode;
  source_url: string;
  query?: string;
  orcid_id?: string;
  count: number;
  total_matches?: number;
  researchers: ResearcherRecord[];
  acknowledgement: string;
};

const BASE = "https://pub.orcid.org/v3.0";
const USER_AGENT =
  "BetterFetchOrcidResearcherScraper/0.1 (https://betterfetch.co/tools/orcid_researcher_scraper; support@betterfetch.co)";
const ACKNOWLEDGEMENT =
  "ORCID and the ORCID iD icon are trademarks of ORCID, Inc. This tool uses the ORCID Public API for public registry data and is not endorsed by or affiliated with ORCID.";

function modeFrom(input: Input): Mode {
  if (input.mode === "record" || input.orcid_id) return "record";
  return "search";
}

function rowsFrom(value: number | undefined): number {
  return Math.min(Math.max(value ?? 10, 1), 20);
}

function startFrom(value: number | undefined): number {
  return Math.min(Math.max(value ?? 0, 0), 5000);
}

function compact<T extends Record<string, unknown>>(record: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined && value !== "" && value !== null) out[key] = value;
  }
  return out as T;
}

function objectValue(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : undefined;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function textValue(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  const obj = objectValue(value);
  if (!obj) return undefined;
  return textValue(obj.value ?? obj.content ?? obj.path ?? obj.uri);
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function msDate(value: unknown): string | undefined {
  const ms = textValue(value);
  if (!ms || !/^\d+$/.test(ms)) return undefined;
  const date = new Date(Number(ms));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function orcidDate(value: unknown): string | undefined {
  const obj = objectValue(value);
  const year = textValue(objectValue(obj?.year)?.value);
  if (!year) return undefined;
  const month = textValue(objectValue(obj?.month)?.value);
  const day = textValue(objectValue(obj?.day)?.value);
  return [year, month?.padStart(2, "0"), day?.padStart(2, "0")].filter(Boolean).join("-");
}

function joinList(values: (string | undefined)[] | undefined, limit = 30): string | undefined {
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const value of values ?? []) {
    const item = value?.replace(/\s+/g, " ").trim();
    if (!item || seen.has(item)) continue;
    seen.add(item);
    clean.push(item);
  }
  return clean.length ? clean.slice(0, limit).join(", ") : undefined;
}

function cleanText(value: string | undefined, field: string, max = 240): string | undefined {
  const clean = (value ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return undefined;
  if (clean.length < 2) throw new Error(`${field} must contain at least two characters`);
  if (!/^[\p{L}\p{N} _.,:;'"()[\]\\/+*?!&|-]+$/u.test(clean)) {
    throw new Error(`${field} contains unsupported characters`);
  }
  return clean.slice(0, max);
}

function quotedField(value: string | undefined, field: string, max = 160): string | undefined {
  const clean = cleanText(value, field, max);
  if (!clean) return undefined;
  return `"${clean.replace(/"/g, "")}"`;
}

function cleanOrcidId(value: string | undefined): string {
  const clean = (value ?? "")
    .trim()
    .replace(/^https?:\/\/orcid\.org\//i, "")
    .replace(/^orcid:/i, "")
    .trim()
    .toUpperCase();
  if (!/^\d{4}-\d{4}-\d{4}-[\dX]{4}$/.test(clean)) {
    throw new Error("orcid_id must look like 0000-0002-1825-0097 or https://orcid.org/0000-0002-1825-0097");
  }
  return clean;
}

function queryString(params: Record<string, string | number | undefined>): string {
  return Object.entries(params)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined && entry[1] !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
}

function buildSearchQuery(input: Input): string {
  const raw = cleanText(input.query, "query", 300);
  const parts: string[] = [];
  if (raw) parts.push(raw);
  const givenNames = quotedField(input.given_names, "given_names", 120);
  if (givenNames) parts.push(`given-names:${givenNames}`);
  const familyName = quotedField(input.family_name, "family_name", 120);
  if (familyName) parts.push(`family-name:${familyName}`);
  const affiliation = quotedField(input.affiliation, "affiliation", 180);
  if (affiliation) parts.push(`affiliation-org-name:${affiliation}`);
  const keyword = quotedField(input.keyword, "keyword", 120);
  if (keyword) parts.push(`keyword:${keyword}`);
  if (!parts.length) throw new Error("search mode requires query, given_names, family_name, affiliation, keyword, or orcid_id");
  return parts.join(" AND ");
}

function buildUrl(input: Input, mode: Mode): { url: string; query?: string; orcidId?: string } {
  if (mode === "record") {
    const orcidId = cleanOrcidId(input.orcid_id);
    return {
      orcidId,
      url: `${BASE}/${encodeURIComponent(orcidId)}/record`,
    };
  }

  const query = buildSearchQuery(input);
  return {
    query,
    url: `${BASE}/search/?${queryString({
      q: query,
      rows: rowsFrom(input.rows),
      start: startFrom(input.start),
    })}`,
  };
}

function orcidIdentifier(record: JsonObject): { orcidId?: string; orcidUrl?: string; host?: string } {
  const identifier = objectValue(record["orcid-identifier"]);
  const orcidId = textValue(identifier?.path);
  return {
    orcidId,
    orcidUrl: textValue(identifier?.uri) ?? (orcidId ? `https://orcid.org/${orcidId}` : undefined),
    host: textValue(identifier?.host),
  };
}

function searchRecord(value: unknown, rank: number): ResearcherRecord | undefined {
  const obj = objectValue(value);
  if (!obj) return undefined;
  const id = orcidIdentifier(obj);
  if (!id.orcidId || !id.orcidUrl) return undefined;
  return compact({
    rank,
    orcid_id: id.orcidId,
    orcid_url: id.orcidUrl,
    host: id.host,
  });
}

function personName(person: JsonObject | undefined): {
  givenNames?: string;
  familyName?: string;
  creditName?: string;
  displayName?: string;
} {
  const name = objectValue(person?.name);
  const givenNames = textValue(objectValue(name?.["given-names"])?.value);
  const familyName = textValue(objectValue(name?.["family-name"])?.value);
  const creditName = textValue(objectValue(name?.["credit-name"])?.value);
  const displayName = creditName ?? ([givenNames, familyName].filter(Boolean).join(" ").trim() || undefined);
  return { givenNames, familyName, creditName, displayName };
}

function otherNames(person: JsonObject | undefined): string | undefined {
  const node = objectValue(person?.["other-names"]);
  return joinList(arrayValue(node?.["other-name"]).map((item) => textValue(item)));
}

function keywords(person: JsonObject | undefined): string | undefined {
  const node = objectValue(person?.keywords);
  return joinList(arrayValue(node?.keyword).map((item) => textValue(item)));
}

function researcherUrls(person: JsonObject | undefined): string | undefined {
  const node = objectValue(person?.["researcher-urls"]);
  return joinList(
    arrayValue(node?.["researcher-url"]).map((item) => {
      const obj = objectValue(item);
      const label = textValue(obj?.["url-name"]);
      const url = textValue(objectValue(obj?.url)?.value);
      if (!url) return undefined;
      return label ? `${label}: ${url}` : url;
    }),
    20,
  );
}

function externalIdentifiers(person: JsonObject | undefined): string | undefined {
  const node = objectValue(person?.["external-identifiers"]);
  return joinList(
    arrayValue(node?.["external-identifier"]).map((item) => {
      const obj = objectValue(item);
      const type = textValue(obj?.["external-id-type"]);
      const value = textValue(obj?.["external-id-value"]);
      const url = textValue(objectValue(obj?.["external-id-url"])?.value);
      if (!value) return undefined;
      const label = type ? `${type}:${value}` : value;
      return url ? `${label} (${url})` : label;
    }),
    30,
  );
}

function affiliationLabel(summary: JsonObject): string | undefined {
  const organization = objectValue(summary.organization);
  const orgName = textValue(organization?.name);
  if (!orgName) return undefined;
  const role = textValue(summary["role-title"]);
  const department = textValue(summary["department-name"]);
  const start = orcidDate(summary["start-date"]);
  const end = orcidDate(summary["end-date"]);
  const address = objectValue(organization?.address);
  const place = joinList([textValue(address?.city), textValue(address?.region), textValue(address?.country)], 3);
  const title = [role, department, orgName].filter(Boolean).join(", ");
  const dates = start || end ? ` (${start ?? "unknown"}-${end ?? "present"})` : "";
  const suffix = place ? ` - ${place}` : "";
  return `${title}${dates}${suffix}`;
}

function activitySummaries(activities: JsonObject | undefined, key: "employments" | "educations"): string | undefined {
  const node = objectValue(activities?.[key]);
  const labels: string[] = [];
  for (const group of arrayValue(node?.["affiliation-group"])) {
    const groupObj = objectValue(group);
    for (const summaryNode of arrayValue(groupObj?.summaries)) {
      const summaryObj = objectValue(summaryNode);
      const summary = objectValue(summaryObj?.["employment-summary"]) ?? objectValue(summaryObj?.["education-summary"]);
      const label = summary ? affiliationLabel(summary) : undefined;
      if (label) labels.push(label);
    }
  }
  return joinList(labels, 20);
}

function groupCount(activities: JsonObject | undefined, key: string): number | undefined {
  const node = objectValue(activities?.[key]);
  const count = arrayValue(node?.group).length;
  return count || undefined;
}

function recordResearcher(data: JsonObject, rank: number, includeBiography: boolean): ResearcherRecord | undefined {
  const id = orcidIdentifier(data);
  if (!id.orcidId || !id.orcidUrl) return undefined;
  const person = objectValue(data.person);
  const history = objectValue(data.history);
  const activities = objectValue(data["activities-summary"]);
  const name = personName(person);
  return compact({
    rank,
    orcid_id: id.orcidId,
    orcid_url: id.orcidUrl,
    host: id.host,
    given_names: name.givenNames,
    family_name: name.familyName,
    credit_name: name.creditName,
    display_name: name.displayName,
    other_names: otherNames(person),
    biography: includeBiography ? textValue(objectValue(person?.biography)?.content)?.slice(0, 5000) : undefined,
    keywords: keywords(person),
    researcher_urls: researcherUrls(person),
    external_identifiers: externalIdentifiers(person),
    employments: activitySummaries(activities, "employments"),
    educations: activitySummaries(activities, "educations"),
    works_count: groupCount(activities, "works"),
    funding_count: groupCount(activities, "fundings"),
    peer_review_count: groupCount(activities, "peer-reviews"),
    claimed: booleanValue(history?.claimed),
    created_at: msDate(objectValue(history?.["submission-date"])?.value),
    last_modified_at: msDate(objectValue(history?.["last-modified-date"])?.value),
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
    throw new Error(`ORCID request failed with status ${response.status ?? "unknown"}`);
  }
  try {
    const data = JSON.parse(response.body_text) as unknown;
    const obj = objectValue(data);
    if (!obj) throw new Error("not an object");
    return obj;
  } catch {
    throw new Error("ORCID returned invalid JSON");
  }
}

export default defineTool<Input, Output>(async (input, bf) => {
  const mode = modeFrom(input);
  const built = buildUrl(input, mode);
  const data = await fetchJson(bf, built.url);
  const researchers =
    mode === "record"
      ? [recordResearcher(data, 1, input.include_biography !== false)].filter(
          (researcher): researcher is ResearcherRecord => Boolean(researcher),
        )
      : arrayValue(data.result)
          .map((item, index) => searchRecord(item, index + 1))
          .filter((researcher): researcher is ResearcherRecord => Boolean(researcher));
  return {
    mode,
    source_url: built.url,
    query: built.query,
    orcid_id: built.orcidId,
    count: researchers.length,
    total_matches: mode === "search" ? numberValue(data["num-found"]) : undefined,
    researchers,
    acknowledgement: ACKNOWLEDGEMENT,
  };
});
