import { defineTool } from "@better-fetch/tools";

type Input = {
  search_url?: string;
  keywords?: string;
  location?: string;
  date_posted?: "any" | "past_24h" | "past_week" | "past_month";
  company_id?: string;
  max_results?: number;
};

type Job = {
  job_id?: string;
  title: string;
  company?: string;
  company_url?: string;
  location?: string;
  url: string;
  logo?: string;
  listed_at?: string;
  listed_label?: string;
  benefit?: string;
  position?: number;
};

type Output = {
  search_url: string;
  query_title?: string;
  total_results_label?: string;
  jobs: Job[];
  count: number;
};

const DATE_FILTERS: Record<NonNullable<Input["date_posted"]>, string | undefined> = {
  any: undefined,
  past_24h: "r86400",
  past_week: "r604800",
  past_month: "r2592000",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function stripTags(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = stripTags(value);
  return clean || undefined;
}

function attr(tag: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const value = tag.match(new RegExp(`${escaped}=["']([^"']*)["']`, "i"))?.[1];
  return text(value);
}

function absoluteUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(decodeEntities(value), "https://www.linkedin.com").toString();
  } catch {
    return undefined;
  }
}

function canonicalJobUrl(value: string | undefined): string | undefined {
  const url = absoluteUrl(value);
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function cleanSearchUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("search_url must be a valid LinkedIn jobs search URL");
  }
  if (!/^(www\.)?linkedin\.com$/i.test(parsed.hostname) || !parsed.pathname.startsWith("/jobs/search")) {
    throw new Error("search_url must be a public LinkedIn jobs search URL");
  }
  return parsed.toString();
}

function buildSearchUrl(input: Input): string {
  if (input.search_url?.trim()) return cleanSearchUrl(input.search_url.trim());

  const keywords = input.keywords?.trim();
  if (!keywords) throw new Error("Provide search_url or keywords");
  const url = new URL("https://www.linkedin.com/jobs/search/");
  url.searchParams.set("keywords", keywords);
  if (input.location?.trim()) url.searchParams.set("location", input.location.trim());
  const filter = DATE_FILTERS[input.date_posted ?? "any"];
  if (filter) url.searchParams.set("f_TPR", filter);
  if (input.company_id?.trim()) url.searchParams.set("f_C", input.company_id.trim());
  return url.toString();
}

function firstMatch(segment: string, re: RegExp): string | undefined {
  return segment.match(re)?.[1];
}

function parseHeading(html: string): string | undefined {
  return (
    text(firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i)) ??
    text(firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i))
  );
}

function parseTotalLabel(html: string): string | undefined {
  return text(firstMatch(html, /class=["'][^"']*results-context-header__job-count[^"']*["'][^>]*>([\s\S]*?)<\/span>/i));
}

function parseCards(html: string, limit: number): Job[] {
  const cardRe = /<div\s+class=["'][^"']*\bbase-search-card\b[^"']*\bjob-search-card\b[^"']*["'][^>]*>/gi;
  const cards = [...html.matchAll(cardRe)];
  const jobs: Job[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < cards.length && jobs.length < limit; i++) {
    const cardTag = cards[i][0];
    const start = cards[i].index ?? 0;
    const end = cards[i + 1]?.index ?? html.indexOf("</ul>", start);
    const segment = html.slice(start, end > start ? end : start + 9000);

    const fullLinkTag = segment.match(/<a[^>]+class=["'][^"']*base-card__full-link[^"']*["'][^>]*>/i)?.[0] ?? "";
    const url = canonicalJobUrl(attr(fullLinkTag, "href"));
    const title = text(firstMatch(segment, /<h3[^>]*class=["'][^"']*base-search-card__title[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i));
    if (!url || !title) continue;

    const jobId =
      attr(cardTag, "data-entity-urn")?.match(/jobPosting:(\d+)/)?.[1] ??
      url.match(/-(\d+)\/?$/)?.[1] ??
      undefined;
    const key = jobId ?? url;
    if (seen.has(key)) continue;
    seen.add(key);

    const subtitle = firstMatch(segment, /<h4[^>]*class=["'][^"']*base-search-card__subtitle[^"']*["'][^>]*>([\s\S]*?)<\/h4>/i) ?? "";
    const companyLinkTag = subtitle.match(/<a[^>]*>/i)?.[0] ?? "";
    const company = text(subtitle);
    const timeTag = segment.match(/<time[^>]+class=["'][^"']*job-search-card__listdate[^"']*["'][^>]*>/i)?.[0] ?? "";
    const date = attr(timeTag, "datetime");
    const listedAt = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T00:00:00.000Z` : undefined;
    const imageTag = segment.match(/<img[^>]+class=["'][^"']*artdeco-entity-image[^"']*["'][^>]*>/i)?.[0] ?? "";

    jobs.push(
      compactJob({
        job_id: jobId,
        title,
        company,
        company_url: absoluteUrl(attr(companyLinkTag, "href")),
        location: text(firstMatch(segment, /class=["'][^"']*job-search-card__location[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)),
        url,
        logo: absoluteUrl(attr(imageTag, "data-delayed-url") ?? attr(imageTag, "src")),
        listed_at: listedAt,
        listed_label: text(firstMatch(segment, /<time[^>]+class=["'][^"']*job-search-card__listdate[^"']*["'][^>]*>([\s\S]*?)<\/time>/i)),
        benefit: text(firstMatch(segment, /class=["'][^"']*job-posting-benefits__text[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)),
        position: jobs.length + 1,
      }),
    );
  }

  return jobs;
}

function compactJob(job: Job): Job {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(job)) {
    if (value !== undefined && value !== "") out[key] = value;
  }
  return out as Job;
}

function compact(output: Output): Output {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(output)) {
    if (value !== undefined && value !== "" && (!Array.isArray(value) || value.length > 0)) out[key] = value;
  }
  return out as Output;
}

export default defineTool<Input, Output>(async (input, bf) => {
  const searchUrl = buildSearchUrl(input);
  const limit = Math.min(input.max_results ?? 10, 25);
  const request = {
    url: searchUrl,
    return_response_text: true,
    include_html: true,
    locale: "en-US",
    extra_headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36",
    },
  };

  let page = await bf.fetch({ ...request, strategy: "http" });
  let html = page.body_text ?? page.html ?? "";
  let jobs = parseCards(html, limit);

  if (!jobs.length) {
    page = await bf.fetch({ ...request, strategy: "browser", wait_until: "domcontentloaded", wait_ms: 750 });
    html = page.body_text ?? page.html ?? "";
    jobs = parseCards(html, limit);
  }

  if (!jobs.length) throw new Error("LinkedIn jobs result cards were not found in the public search page");

  return compact({
    search_url: page.final_url ?? searchUrl,
    query_title: parseHeading(html),
    total_results_label: parseTotalLabel(html),
    jobs,
    count: jobs.length,
  });
});
