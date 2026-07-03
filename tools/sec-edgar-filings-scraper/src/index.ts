import { defineTool, type Bf } from "@better-fetch/tools";

type Mode = "filings" | "company_concept";
type JsonObject = Record<string, unknown>;

type Input = {
  mode?: Mode;
  ticker?: string;
  cik?: string | number;
  forms?: string;
  include_amended?: boolean;
  taxonomy?: string;
  concept?: string;
  unit?: string;
  limit?: number;
};

type Company = {
  cik: string;
  ticker?: string;
  name?: string;
  entity_type?: string;
  sic?: string;
  sic_description?: string;
  fiscal_year_end?: string;
  state_of_incorporation?: string;
};

type Filing = {
  rank: number;
  accession_number: string;
  form?: string;
  filing_date?: string;
  report_date?: string;
  acceptance_datetime?: string;
  primary_document?: string;
  primary_doc_description?: string;
  filing_url?: string;
  filing_detail_url?: string;
  file_number?: string;
  film_number?: string;
  items?: string;
  size?: number;
  is_xbrl?: boolean;
  is_inline_xbrl?: boolean;
};

type ConceptFact = {
  rank: number;
  end_date?: string;
  value?: number;
  accession_number?: string;
  fiscal_year?: number;
  fiscal_period?: string;
  form?: string;
  filed_date?: string;
  frame?: string;
};

type Output = {
  mode: Mode;
  source_url: string;
  count: number;
  company: Company;
  forms?: string;
  filings?: Filing[];
  taxonomy?: string;
  concept?: string;
  unit?: string;
  facts?: ConceptFact[];
};

const SEC_DATA_BASE = "https://data.sec.gov";
const SEC_WWW_BASE = "https://www.sec.gov";
const USER_AGENT =
  "BetterFetchSecEdgarFilingsScraper/0.1 (https://betterfetch.co/tools/sec_edgar_filings_scraper; support@betterfetch.co)";

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
  if (typeof value === "boolean") return value;
  if (value === 0 || value === "0") return false;
  if (value === 1 || value === "1") return true;
  return undefined;
}

function compact<T extends Record<string, unknown>>(record: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined && value !== "" && value !== null) out[key] = value;
  }
  return out as T;
}

function cleanMode(input: Input): Mode {
  if (input.mode === "company_concept" || input.concept) return "company_concept";
  return "filings";
}

function cleanTicker(value: string | undefined): string | undefined {
  const clean = (value ?? "").trim().toUpperCase();
  if (!clean) return undefined;
  if (!/^[A-Z0-9.-]{1,12}$/.test(clean)) throw new Error("ticker must be a short public company ticker such as AAPL");
  return clean;
}

function cleanCik(value: string | number | undefined): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const raw = String(value).trim().replace(/^CIK/i, "");
  if (!/^\d{1,10}$/.test(raw)) throw new Error("cik must be 1 to 10 digits");
  return raw.padStart(10, "0");
}

function cleanLimit(value: number | undefined, max: number): number {
  return Math.min(Math.max(value ?? 10, 1), max);
}

function cleanForms(value: string | undefined): Set<string> | undefined {
  const forms = (value ?? "")
    .split(",")
    .map((part) => part.trim().toUpperCase())
    .filter(Boolean);
  if (!forms.length) return undefined;
  for (const form of forms) {
    if (!/^[A-Z0-9 -/]{1,20}$/.test(form)) throw new Error("forms must be comma-separated SEC form types such as 10-K,10-Q,8-K");
  }
  return new Set(forms);
}

function cleanTaxonomy(value: string | undefined): string {
  const clean = (value ?? "us-gaap").trim();
  if (!/^[A-Za-z0-9_-]{2,40}$/.test(clean)) throw new Error("taxonomy must look like us-gaap or dei");
  return clean;
}

function cleanConcept(value: string | undefined): string {
  const clean = (value ?? "").trim();
  if (!clean) throw new Error("concept is required for company_concept mode, e.g. Assets");
  if (!/^[A-Za-z][A-Za-z0-9_]{1,120}$/.test(clean)) throw new Error("concept must look like Assets or EntityCommonStockSharesOutstanding");
  return clean;
}

function cleanUnit(value: string | undefined): string | undefined {
  const clean = (value ?? "").trim();
  if (!clean) return undefined;
  if (!/^[A-Za-z0-9/_-]{1,40}$/.test(clean)) throw new Error("unit must look like USD, shares, or USD/shares");
  return clean;
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
    throw new Error(`SEC request failed with status ${response.status ?? "unknown"}`);
  }
  try {
    const parsed = JSON.parse(response.body_text) as unknown;
    const obj = objectValue(parsed);
    if (!obj) throw new Error("not an object");
    return obj;
  } catch {
    throw new Error("SEC returned invalid JSON");
  }
}

async function cikFromTicker(bf: Bf, ticker: string): Promise<{ cik: string; title?: string }> {
  const data = await fetchJson(bf, `${SEC_WWW_BASE}/files/company_tickers.json`);
  for (const value of Object.values(data)) {
    const row = objectValue(value);
    if (!row) continue;
    if (textValue(row.ticker)?.toUpperCase() === ticker) {
      const cik = numberValue(row.cik_str);
      if (!cik) break;
      return {
        cik: String(cik).padStart(10, "0"),
        title: textValue(row.title),
      };
    }
  }
  throw new Error(`SEC ticker lookup did not find ${ticker}`);
}

async function resolveCompanyId(input: Input, bf: Bf): Promise<{ cik: string; ticker?: string; title?: string }> {
  const ticker = cleanTicker(input.ticker);
  const cik = cleanCik(input.cik);
  if (cik) return { cik, ticker };
  if (ticker) return { ...(await cikFromTicker(bf, ticker)), ticker };
  throw new Error("ticker or cik is required");
}

function companyFrom(data: JsonObject, resolved: { cik: string; ticker?: string; title?: string }): Company {
  return compact({
    cik: resolved.cik,
    ticker: resolved.ticker,
    name: textValue(data.name) ?? resolved.title,
    entity_type: textValue(data.entityType),
    sic: textValue(data.sic),
    sic_description: textValue(data.sicDescription),
    fiscal_year_end: textValue(data.fiscalYearEnd),
    state_of_incorporation: textValue(data.stateOfIncorporation),
  });
}

function valueAt(record: JsonObject, key: string, index: number): unknown {
  return arrayValue(record[key])[index];
}

function filingUrl(cik: string, accession: string, primaryDocument: string | undefined): { filing?: string; detail?: string } {
  const cikPath = String(Number(cik));
  const accessionPath = accession.replace(/-/g, "");
  const base = `${SEC_WWW_BASE}/Archives/edgar/data/${cikPath}/${accessionPath}`;
  return {
    detail: `${base}/${accession}-index.html`,
    filing: primaryDocument ? `${base}/${primaryDocument}` : undefined,
  };
}

function filingsFrom(data: JsonObject, company: Company, forms: Set<string> | undefined, includeAmended: boolean, max: number): Filing[] {
  const recent = objectValue(objectValue(data.filings)?.recent);
  if (!recent) return [];
  const accessions = arrayValue(recent.accessionNumber);
  const filings: Filing[] = [];
  for (let index = 0; index < accessions.length && filings.length < max; index += 1) {
    const accession = textValue(accessions[index]);
    if (!accession) continue;
    const form = textValue(valueAt(recent, "form", index));
    if (forms && (!form || !forms.has(form.toUpperCase()))) continue;
    if (!includeAmended && form?.endsWith("/A")) continue;
    const primaryDocument = textValue(valueAt(recent, "primaryDocument", index));
    const urls = filingUrl(company.cik, accession, primaryDocument);
    filings.push(
      compact({
        rank: filings.length + 1,
        accession_number: accession,
        form,
        filing_date: textValue(valueAt(recent, "filingDate", index)),
        report_date: textValue(valueAt(recent, "reportDate", index)),
        acceptance_datetime: textValue(valueAt(recent, "acceptanceDateTime", index)),
        primary_document: primaryDocument,
        primary_doc_description: textValue(valueAt(recent, "primaryDocDescription", index)),
        filing_url: urls.filing,
        filing_detail_url: urls.detail,
        file_number: textValue(valueAt(recent, "fileNumber", index)),
        film_number: textValue(valueAt(recent, "filmNumber", index)),
        items: textValue(valueAt(recent, "items", index)),
        size: numberValue(valueAt(recent, "size", index)),
        is_xbrl: booleanValue(valueAt(recent, "isXBRL", index)),
        is_inline_xbrl: booleanValue(valueAt(recent, "isInlineXBRL", index)),
      }),
    );
  }
  return filings;
}

function factsFrom(data: JsonObject, requestedUnit: string | undefined, max: number): { unit: string; facts: ConceptFact[] } {
  const units = objectValue(data.units);
  if (!units) throw new Error("SEC company concept response did not include units");
  const unit = requestedUnit && Array.isArray(units[requestedUnit]) ? requestedUnit : Object.keys(units)[0];
  if (!unit) throw new Error("SEC company concept response did not include any unit rows");
  const rows = arrayValue(units[unit]).slice(-max).reverse();
  const facts = rows
    .map((row, index): ConceptFact | undefined => {
      const obj = objectValue(row);
      if (!obj) return undefined;
      return compact({
        rank: index + 1,
        end_date: textValue(obj.end),
        value: numberValue(obj.val),
        accession_number: textValue(obj.accn),
        fiscal_year: numberValue(obj.fy),
        fiscal_period: textValue(obj.fp),
        form: textValue(obj.form),
        filed_date: textValue(obj.filed),
        frame: textValue(obj.frame),
      });
    })
    .filter((fact): fact is ConceptFact => fact !== undefined);
  return { unit, facts };
}

export default defineTool<Input, Output>(async (input, bf) => {
  const mode = cleanMode(input);
  const resolved = await resolveCompanyId(input, bf);

  if (mode === "company_concept") {
    const taxonomy = cleanTaxonomy(input.taxonomy);
    const concept = cleanConcept(input.concept);
    const requestedUnit = cleanUnit(input.unit);
    const sourceUrl = `${SEC_DATA_BASE}/api/xbrl/companyconcept/CIK${resolved.cik}/${taxonomy}/${concept}.json`;
    const data = await fetchJson(bf, sourceUrl);
    const facts = factsFrom(data, requestedUnit, cleanLimit(input.limit, 50));
    const company = compact({
      cik: resolved.cik,
      ticker: resolved.ticker,
      name: textValue(data.entityName) ?? resolved.title,
    });
    return {
      mode,
      source_url: sourceUrl,
      count: facts.facts.length,
      company,
      taxonomy,
      concept,
      unit: facts.unit,
      facts: facts.facts,
    };
  }

  const sourceUrl = `${SEC_DATA_BASE}/submissions/CIK${resolved.cik}.json`;
  const data = await fetchJson(bf, sourceUrl);
  const company = companyFrom(data, resolved);
  const forms = cleanForms(input.forms);
  const filings = filingsFrom(data, company, forms, input.include_amended === true, cleanLimit(input.limit, 50));
  return compact({
    mode,
    source_url: sourceUrl,
    count: filings.length,
    company,
    forms: forms ? [...forms].join(",") : undefined,
    filings,
  });
});
