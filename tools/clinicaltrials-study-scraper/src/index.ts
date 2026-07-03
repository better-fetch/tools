import { defineTool, type Bf } from "@better-fetch/tools";

type Mode = "search" | "study";
type Sort =
  | "@relevance"
  | "LastUpdatePostDate:desc"
  | "StudyFirstPostDate:desc"
  | "StartDate:desc"
  | "EnrollmentCount:desc";
type JsonObject = Record<string, unknown>;

type Input = {
  mode?: Mode;
  nct_id?: string;
  query?: string;
  condition?: string;
  intervention?: string;
  sponsor?: string;
  location?: string;
  status?: string;
  agg_filters?: string;
  page_size?: number;
  page_token?: string;
  sort?: Sort;
  include_eligibility?: boolean;
  include_locations?: boolean;
};

type StudyRecord = {
  rank: number;
  nct_id: string;
  url: string;
  brief_title?: string;
  official_title?: string;
  status?: string;
  has_results?: boolean;
  conditions?: string;
  interventions?: string;
  intervention_types?: string;
  phases?: string;
  study_type?: string;
  enrollment?: number;
  enrollment_type?: string;
  lead_sponsor?: string;
  collaborators?: string;
  start_date?: string;
  primary_completion_date?: string;
  completion_date?: string;
  first_posted_date?: string;
  last_update_posted_date?: string;
  minimum_age?: string;
  maximum_age?: string;
  sex?: string;
  healthy_volunteers?: boolean;
  countries?: string;
  locations?: string;
  primary_outcomes?: string;
  secondary_outcomes?: string;
  brief_summary?: string;
  eligibility_criteria?: string;
};

type Output = {
  mode: Mode;
  source_url: string;
  query?: string;
  nct_id?: string;
  count: number;
  total_matches?: number;
  next_page_token?: string;
  studies: StudyRecord[];
};

const BASE = "https://clinicaltrials.gov";
const USER_AGENT =
  "BetterFetchClinicalTrialsStudyScraper/0.1 (https://betterfetch.co/tools/clinicaltrials_study_scraper; support@betterfetch.co)";
const STATUSES = new Set([
  "RECRUITING",
  "ACTIVE_NOT_RECRUITING",
  "NOT_YET_RECRUITING",
  "ENROLLING_BY_INVITATION",
  "COMPLETED",
  "SUSPENDED",
  "TERMINATED",
  "WITHDRAWN",
  "UNKNOWN",
]);

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
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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
  return clean.length > max ? `${clean.slice(0, max - 1)}...` : clean;
}

function joinList(values: (string | undefined)[] | undefined, limit = 30): string | undefined {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values ?? []) {
    const clean = value?.replace(/\s+/g, " ").trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out.length ? out.slice(0, limit).join(", ") : undefined;
}

function cleanText(value: string | undefined, field: string, max = 200): string | undefined {
  const clean = (value ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return undefined;
  if (clean.length < 2) throw new Error(`${field} must contain at least two characters`);
  if (!/^[\p{L}\p{N} _.,:;'"()[\]\\/+*?!&|/@#%-]+$/u.test(clean)) {
    throw new Error(`${field} contains unsupported characters`);
  }
  return clean.slice(0, max);
}

function cleanNct(value: string | undefined): string {
  const clean = (value ?? "").trim().toUpperCase();
  if (!/^NCT\d{8}$/.test(clean)) throw new Error("nct_id must look like NCT04280705");
  return clean;
}

function cleanStatus(value: string | undefined): string | undefined {
  const raw = (value ?? "").trim();
  if (!raw) return undefined;
  const parts = raw
    .split(/[,\|]/)
    .map((part) => part.trim().toUpperCase().replace(/\s+/g, "_"))
    .filter(Boolean);
  if (!parts.length) return undefined;
  for (const part of parts) {
    if (!STATUSES.has(part)) {
      throw new Error(`status must use ClinicalTrials.gov status enum values; unsupported value: ${part}`);
    }
  }
  return parts.join(",");
}

function cleanAggFilters(value: string | undefined): string | undefined {
  const clean = (value ?? "").replace(/\s+/g, "").trim();
  if (!clean) return undefined;
  if (!/^[A-Za-z0-9_:,|.-]{2,240}$/.test(clean)) {
    throw new Error("agg_filters must use ClinicalTrials.gov aggregate filter syntax, e.g. phase:3");
  }
  return clean;
}

function pageSize(value: number | undefined): number {
  return Math.min(Math.max(value ?? 10, 1), 20);
}

function cleanPageToken(value: string | undefined): string | undefined {
  const clean = (value ?? "").trim();
  if (!clean) return undefined;
  if (!/^[A-Za-z0-9_.~-]{4,300}$/.test(clean)) throw new Error("page_token contains unsupported characters");
  return clean;
}

function queryString(params: Record<string, string | number | boolean | undefined>): string {
  return Object.entries(params)
    .filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined && entry[1] !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
}

function modeFrom(input: Input): Mode {
  if (input.mode === "study" || input.nct_id) return "study";
  return "search";
}

function buildUrl(input: Input, mode: Mode): { url: string; query?: string; nctId?: string } {
  if (mode === "study") {
    const nctId = cleanNct(input.nct_id);
    return { nctId, url: `${BASE}/api/v2/studies/${nctId}?format=json` };
  }

  const query = cleanText(input.query, "query", 240);
  const condition = cleanText(input.condition, "condition", 160);
  const intervention = cleanText(input.intervention, "intervention", 160);
  const sponsor = cleanText(input.sponsor, "sponsor", 160);
  const location = cleanText(input.location, "location", 160);
  const status = cleanStatus(input.status);
  const aggFilters = cleanAggFilters(input.agg_filters);
  if (!query && !condition && !intervention && !sponsor && !location && !status && !aggFilters) {
    throw new Error("search mode requires query, condition, intervention, sponsor, location, status, agg_filters, or nct_id");
  }

  const summary = [
    query && `term:${query}`,
    condition && `condition:${condition}`,
    intervention && `intervention:${intervention}`,
    sponsor && `sponsor:${sponsor}`,
    location && `location:${location}`,
    status && `status:${status}`,
    aggFilters && `agg:${aggFilters}`,
  ]
    .filter(Boolean)
    .join(" | ");

  return {
    query: summary,
    url: `${BASE}/api/v2/studies?${queryString({
      format: "json",
      countTotal: true,
      pageSize: pageSize(input.page_size),
      pageToken: cleanPageToken(input.page_token),
      sort: input.sort && input.sort !== "@relevance" ? input.sort : undefined,
      "query.term": query,
      "query.cond": condition,
      "query.intr": intervention,
      "query.spons": sponsor,
      "query.locn": location,
      "filter.overallStatus": status,
      aggFilters,
    })}`,
  };
}

function dateFrom(value: unknown): string | undefined {
  const obj = objectValue(value);
  return textValue(obj?.date);
}

function namesFrom(values: unknown[], key = "name"): string[] {
  return values
    .map((value) => textValue(objectValue(value)?.[key]))
    .filter((value): value is string => Boolean(value));
}

function outcomeMeasures(value: unknown, limit = 8): string | undefined {
  return joinList(
    arrayValue(value)
      .map((item) => textValue(objectValue(item)?.measure))
      .filter((item): item is string => Boolean(item)),
    limit,
  );
}

function locationStrings(value: unknown, limit = 14): { locations?: string; countries?: string } {
  const locations = arrayValue(value).map((item) => {
    const obj = objectValue(item);
    if (!obj) return undefined;
    return [textValue(obj.facility), textValue(obj.city), textValue(obj.state), textValue(obj.country)]
      .filter(Boolean)
      .join(", ");
  });
  const countries = arrayValue(value)
    .map((item) => textValue(objectValue(item)?.country))
    .filter((item): item is string => Boolean(item));
  return { locations: joinList(locations, limit), countries: joinList(countries, 40) };
}

function studyRecord(study: JsonObject, rank: number, input: Input): StudyRecord | undefined {
  const protocol = objectValue(study.protocolSection);
  if (!protocol) return undefined;
  const idModule = objectValue(protocol.identificationModule);
  const nctId = textValue(idModule?.nctId);
  if (!nctId) return undefined;

  const statusModule = objectValue(protocol.statusModule);
  const sponsorModule = objectValue(protocol.sponsorCollaboratorsModule);
  const designModule = objectValue(protocol.designModule);
  const conditionsModule = objectValue(protocol.conditionsModule);
  const interventionsModule = objectValue(protocol.armsInterventionsModule);
  const outcomesModule = objectValue(protocol.outcomesModule);
  const eligibilityModule = objectValue(protocol.eligibilityModule);
  const descriptionModule = objectValue(protocol.descriptionModule);
  const contactsModule = objectValue(protocol.contactsLocationsModule);
  const enrollment = objectValue(designModule?.enrollmentInfo);
  const locations = input.include_locations === false ? {} : locationStrings(contactsModule?.locations);
  const interventions = arrayValue(interventionsModule?.interventions);

  return compact({
    rank,
    nct_id: nctId,
    url: `${BASE}/study/${nctId}`,
    brief_title: textValue(idModule?.briefTitle),
    official_title: textValue(idModule?.officialTitle),
    status: textValue(statusModule?.overallStatus),
    has_results: booleanValue(study.hasResults),
    conditions: joinList(arrayValue(conditionsModule?.conditions).map((item) => textValue(item)), 30),
    interventions: joinList(namesFrom(interventions), 30),
    intervention_types: joinList(interventions.map((item) => textValue(objectValue(item)?.type)), 20),
    phases: joinList(arrayValue(designModule?.phases).map((item) => textValue(item)), 10),
    study_type: textValue(designModule?.studyType),
    enrollment: numberValue(enrollment?.count),
    enrollment_type: textValue(enrollment?.type),
    lead_sponsor: textValue(objectValue(sponsorModule?.leadSponsor)?.name),
    collaborators: joinList(namesFrom(arrayValue(sponsorModule?.collaborators)), 20),
    start_date: dateFrom(statusModule?.startDateStruct),
    primary_completion_date: dateFrom(statusModule?.primaryCompletionDateStruct),
    completion_date: dateFrom(statusModule?.completionDateStruct),
    first_posted_date: dateFrom(statusModule?.studyFirstPostDateStruct),
    last_update_posted_date: dateFrom(statusModule?.lastUpdatePostDateStruct),
    minimum_age: textValue(eligibilityModule?.minimumAge),
    maximum_age: textValue(eligibilityModule?.maximumAge),
    sex: textValue(eligibilityModule?.sex),
    healthy_volunteers: booleanValue(eligibilityModule?.healthyVolunteers),
    countries: locations.countries,
    locations: locations.locations,
    primary_outcomes: outcomeMeasures(outcomesModule?.primaryOutcomes),
    secondary_outcomes: outcomeMeasures(outcomesModule?.secondaryOutcomes),
    brief_summary: truncate(textValue(descriptionModule?.briefSummary), 1200),
    eligibility_criteria:
      input.include_eligibility === true
        ? truncate(textValue(eligibilityModule?.eligibilityCriteria), 2000)
        : undefined,
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
    throw new Error(`ClinicalTrials.gov request failed with status ${response.status ?? "unknown"}`);
  }
  try {
    const data = JSON.parse(response.body_text) as unknown;
    const obj = objectValue(data);
    if (!obj) throw new Error("not an object");
    return obj;
  } catch {
    throw new Error("ClinicalTrials.gov returned invalid JSON");
  }
}

export default defineTool<Input, Output>(async (input, bf) => {
  const mode = modeFrom(input);
  const built = buildUrl(input, mode);
  const data = await fetchJson(bf, built.url);
  const rawStudies = mode === "study" ? [data] : arrayValue(data.studies);
  const studies = rawStudies
    .map((item, index) => {
      const obj = objectValue(item);
      return obj ? studyRecord(obj, index + 1, input) : undefined;
    })
    .filter((study): study is StudyRecord => Boolean(study));

  return {
    mode,
    source_url: built.url,
    query: built.query,
    nct_id: built.nctId,
    count: studies.length,
    total_matches: mode === "search" ? numberValue(data.totalCount) : undefined,
    next_page_token: mode === "search" ? textValue(data.nextPageToken) : undefined,
    studies,
  };
});
