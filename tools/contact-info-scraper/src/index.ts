import { defineTool } from "@better-fetch/tools";

type Input = {
  url?: string;
  urls?: string[];
  max_pages_per_site?: number;
  max_total_pages?: number;
  max_emails?: number;
  max_phones?: number;
  include_social_profiles?: boolean;
  wait_ms?: number;
};

type ParsedUrl = {
  origin: string;
  path: string;
  href: string;
};

type PageFinding = {
  url: string;
  title?: string;
  emails?: string[];
  phones?: string[];
  social_profiles?: Record<string, string[]>;
};

type SiteResult = {
  start_url: string;
  origin: string;
  pages_scanned: number;
  source_urls: string[];
  contact_pages?: string[];
  emails?: string[];
  phones?: string[];
  social_profiles?: Record<string, string[]>;
  page_findings?: PageFinding[];
};

type Output = {
  count: number;
  total_pages_scanned: number;
  sites: SiteResult[];
};

const CONTACT_PATH_HINTS = [
  "contact",
  "about",
  "team",
  "staff",
  "support",
  "customer-service",
  "help",
  "impressum",
  "legal",
  "press",
  "media",
];

const SOCIAL_HOSTS: Record<string, string[]> = {
  facebook: ["facebook.com"],
  instagram: ["instagram.com"],
  linkedin: ["linkedin.com"],
  twitter: ["twitter.com", "x.com"],
  youtube: ["youtube.com", "youtu.be"],
  tiktok: ["tiktok.com"],
  threads: ["threads.net"],
  snapchat: ["snapchat.com"],
  telegram: ["t.me", "telegram.me", "telegram.org"],
};

function clamp(raw: number | undefined, fallback: number, min: number, max: number): number {
  const n = Number.isFinite(raw) ? Math.round(raw as number) : fallback;
  return Math.max(min, Math.min(max, n));
}

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

function parseUrl(raw: string): ParsedUrl | null {
  const match = raw.trim().match(/^(https?:\/\/[^/?#]+)([^?#]*)?(?:[?#].*)?$/i);
  if (!match) return null;
  const origin = match[1].replace(/\/$/, "");
  const path = match[2]?.startsWith("/") ? match[2] : "/";
  return { origin, path, href: `${origin}${path}` };
}

function absoluteUrl(value: string | undefined, base: ParsedUrl): string | undefined {
  if (!value) return undefined;
  const clean = decodeEntities(value).trim();
  if (!clean || /^(mailto|tel|javascript):/i.test(clean)) return undefined;
  if (clean.startsWith("//")) return parseUrl(`https:${clean}`)?.href;
  if (/^https?:\/\//i.test(clean)) return parseUrl(clean)?.href;
  if (clean.startsWith("/")) return parseUrl(`${base.origin}${clean}`)?.href;
  const dir = base.path.endsWith("/") ? base.path : base.path.replace(/\/[^/]*$/, "/");
  return parseUrl(`${base.origin}${dir}${clean}`)?.href;
}

function attr(tag: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const raw = tag.match(new RegExp(`${escaped}=["']([^"']*)["']`, "i"))?.[1];
  return raw ? decodeEntities(raw.trim()) : undefined;
}

function titleFrom(html: string, fallback: string): string {
  const raw =
    html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i)?.[1] ??
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ??
    fallback;
  return stripTags(raw);
}

function addLimited(target: Set<string>, values: string[], max: number): void {
  for (const value of values) {
    if (target.size >= max) return;
    target.add(value);
  }
}

function uniq(values: string[], max: number): string[] {
  return [...new Set(values)].slice(0, max);
}

function emailsFrom(text: string, max: number): string[] {
  const emails = new Set<string>();
  const re = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) && emails.size < max) {
    const email = match[0].replace(/[),.;:!?]+$/g, "").toLowerCase();
    if (/\.(png|jpe?g|gif|webp|svg|css|js)$/i.test(email)) continue;
    if (email.includes("example.com")) continue;
    emails.add(email);
  }
  return [...emails];
}

function phonesFrom(text: string, max: number): string[] {
  const phones = new Set<string>();
  const re = /(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?){2,5}\d{2,5}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) && phones.size < max) {
    const raw = match[0].replace(/\s+/g, " ").trim();
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 16) continue;
    if (/^(19|20)\d{6,}$/.test(digits)) continue;
    phones.add(raw);
  }
  return [...phones];
}

function socialPlatform(url: string): string | undefined {
  const host = url.match(/^https?:\/\/([^/]+)/i)?.[1]?.replace(/^www\./i, "").toLowerCase();
  if (!host) return undefined;
  for (const [platform, hosts] of Object.entries(SOCIAL_HOSTS)) {
    if (hosts.some((candidate) => host === candidate || host.endsWith(`.${candidate}`))) {
      return platform;
    }
  }
  return undefined;
}

function addSocial(socials: Record<string, Set<string>>, url: string): void {
  const platform = socialPlatform(url);
  if (!platform) return;
  const clean = url.replace(/\/$/, "");
  socials[platform] ??= new Set<string>();
  if (socials[platform].size < 20) socials[platform].add(clean);
}

function socialOutput(socials: Record<string, Set<string>>): Record<string, string[]> | undefined {
  const out: Record<string, string[]> = {};
  for (const [platform, values] of Object.entries(socials)) {
    if (values.size) out[platform] = [...values];
  }
  return Object.keys(out).length ? out : undefined;
}

function linksFrom(html: string, base: ParsedUrl): { url: string; text: string }[] {
  const links: { url: string; text: string }[] = [];
  const seen = new Set<string>();
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const href = decodeEntities(match[1]);
    const url =
      href.toLowerCase().startsWith("mailto:")
        ? `mailto:${href.slice(7).split("?")[0]}`
        : href.toLowerCase().startsWith("tel:")
          ? `tel:${href.slice(4).split("?")[0]}`
          : absoluteUrl(href, base);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    links.push({ url, text: stripTags(match[2]) });
  }
  return links;
}

function isContactCandidate(link: { url: string; text: string }, origin: string): boolean {
  if (link.url.startsWith("mailto:") || link.url.startsWith("tel:")) return false;
  const parsed = parseUrl(link.url);
  if (!parsed || parsed.origin !== origin) return false;
  const haystack = `${parsed.path} ${link.text}`.toLowerCase();
  return CONTACT_PATH_HINTS.some((hint) => haystack.includes(hint));
}

function compact<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== "" && !(Array.isArray(value) && value.length === 0)) {
      out[key] = value;
    }
  }
  return out as T;
}

async function scanSite(
  start: ParsedUrl,
  input: Required<Pick<Input, "include_social_profiles">> & {
    maxPagesPerSite: number;
    maxTotalPages: number;
    maxEmails: number;
    maxPhones: number;
    waitMs: number;
  },
  bf: Parameters<Parameters<typeof defineTool>[0]>[1],
  remainingBudget: () => number,
): Promise<SiteResult> {
  const queue = [start.href];
  const seen = new Set<string>();
  const sourceUrls: string[] = [];
  const contactPages = new Set<string>();
  const siteEmails = new Set<string>();
  const sitePhones = new Set<string>();
  const siteSocials: Record<string, Set<string>> = {};
  const pageFindings: PageFinding[] = [];

  while (queue.length && seen.size < input.maxPagesPerSite && remainingBudget() > 0) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);

    const page = await bf.fetch({
      url,
      include_html: true,
      return_response_text: true,
      strategy: "browser",
      wait_until: "domcontentloaded",
      wait_ms: input.waitMs,
      proxy: "auto",
    });
    const finalParsed = parseUrl(page.final_url ?? url) ?? parseUrl(url)!;
    const html = page.html ?? page.body_text ?? "";
    const text = `${html}\n${stripTags(html)}`;
    sourceUrls.push(finalParsed.href);

    const links = linksFrom(html, finalParsed);
    for (const link of links) {
      if (link.url.startsWith("mailto:")) {
        addLimited(siteEmails, emailsFrom(link.url.slice(7), input.maxEmails), input.maxEmails);
        continue;
      }
      if (link.url.startsWith("tel:")) {
        addLimited(sitePhones, phonesFrom(link.url.slice(4), input.maxPhones), input.maxPhones);
        continue;
      }
      if (input.include_social_profiles) addSocial(siteSocials, link.url);
      if (isContactCandidate(link, start.origin)) {
        contactPages.add(link.url);
        if (!seen.has(link.url) && !queue.includes(link.url)) queue.push(link.url);
      }
    }

    const pageEmails = emailsFrom(text, input.maxEmails);
    const pagePhones = phonesFrom(text, input.maxPhones);
    addLimited(siteEmails, pageEmails, input.maxEmails);
    addLimited(sitePhones, pagePhones, input.maxPhones);

    const pageSocials: Record<string, Set<string>> = {};
    if (input.include_social_profiles) {
      for (const link of links) addSocial(pageSocials, link.url);
    }
    const finding = compact({
      url: finalParsed.href,
      title: titleFrom(html, finalParsed.href),
      emails: pageEmails,
      phones: pagePhones,
      social_profiles: socialOutput(pageSocials),
    }) as PageFinding;
    if (finding.emails || finding.phones || finding.social_profiles) pageFindings.push(finding);
  }

  return compact({
    start_url: start.href,
    origin: start.origin,
    pages_scanned: seen.size,
    source_urls: sourceUrls,
    contact_pages: [...contactPages].slice(0, input.maxPagesPerSite),
    emails: [...siteEmails],
    phones: [...sitePhones],
    social_profiles: socialOutput(siteSocials),
    page_findings: pageFindings,
  }) as SiteResult;
}

export default defineTool<Input, Output>(async (input, bf) => {
  const starts = uniq(
    [
      ...(input.url ? [input.url] : []),
      ...(Array.isArray(input.urls) ? input.urls : []),
    ],
    10,
  )
    .map(parseUrl)
    .filter((url): url is ParsedUrl => url !== null);

  if (!starts.length) throw new Error("Provide url or urls with at least one valid http(s) URL");

  const maxPagesPerSite = clamp(input.max_pages_per_site, 4, 1, 10);
  const maxTotalPages = clamp(input.max_total_pages, Math.min(10, starts.length * maxPagesPerSite), 1, 30);
  const options = {
    include_social_profiles: input.include_social_profiles ?? true,
    maxPagesPerSite,
    maxTotalPages,
    maxEmails: clamp(input.max_emails, 50, 1, 200),
    maxPhones: clamp(input.max_phones, 30, 1, 100),
    waitMs: clamp(input.wait_ms, 500, 0, 5_000),
  };

  let scanned = 0;
  const sites: SiteResult[] = [];
  for (const start of starts) {
    if (scanned >= maxTotalPages) break;
    const site = await scanSite(
      start,
      options,
      bf,
      () => Math.max(0, maxTotalPages - scanned),
    );
    scanned += site.pages_scanned;
    sites.push(site);
  }

  return {
    count: sites.length,
    total_pages_scanned: scanned,
    sites,
  };
});
