import { defineTool } from "@better-fetch/tools";

type Input = {
  query: string;
  num?: number;
  country?: string;
};

type SearchResult = { title: string; url: string; snippet?: string };

type Output = {
  query: string;
  results: SearchResult[];
  count: number;
};

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

const SKIP_HOSTS = /(^|\.)google\.[a-z.]+$|(^|\.)youtube\.com$|(^|\.)gstatic\.com$/;

// Organic results render as <a href="https://..."><h3>Title</h3></a> in the
// stealth browser's DOM (both desktop layouts). Snippets are best-effort:
// the text content of the result block after the link.
function parseSerp(html: string, limit: number): SearchResult[] {
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  const linkRe =
    /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>(?:(?!<\/a>).)*?<h3[^>]*>((?:(?!<\/h3>).)*)<\/h3>/gs;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) && results.length < limit) {
    let url = m[1];
    // Some layouts route through /url?q=<target>.
    const viaRedirect = url.match(/[?&]q=(https?[^&]+)/);
    if (viaRedirect) url = decodeURIComponent(viaRedirect[1]);
    // No `URL` global inside the hosted isolate — parse the host manually.
    const host = url.match(/^https?:\/\/([^/?#]+)/i)?.[1]?.toLowerCase();
    if (!host || SKIP_HOSTS.test(host)) continue;
    const canonical = url.replace(/[#?].*$/, "");
    if (seen.has(canonical)) continue;
    seen.add(canonical);

    // Best-effort snippet: the nearest text block following this match.
    const tail = html.slice(m.index + m[0].length, m.index + m[0].length + 3000);
    const snippetMatch = tail.match(
      /<(?:div|span)[^>]*(?:data-sncf|class="[^"]*(?:VwiC3b|IsZvec)[^"]*")[^>]*>((?:(?!<\/(?:div|span)>).)*)/s,
    );
    const snippet = snippetMatch ? stripTags(snippetMatch[1]).slice(0, 400) : undefined;

    results.push({
      title: stripTags(m[2]),
      url,
      ...(snippet ? { snippet } : {}),
    });
  }
  return results;
}

export default defineTool<Input, Output>(async (input, bf) => {
  const num = Math.min(input.num ?? 10, 20);
  const url =
    `https://www.google.com/search?q=${encodeURIComponent(input.query)}` +
    `&num=${Math.min(num + 5, 30)}&hl=en`;

  const page = await bf.fetch({
    url,
    include_html: true,
    strategy: "browser",
    wait_until: "domcontentloaded",
    wait_ms: 1500,
    // Google captchas datacenter IPs (a 200 → /sorry/ redirect the engine
    // classifies as blocked). "auto" runs the first attempt on the cheap
    // datacenter egress and only escalates to residential on that block —
    // so residential bandwidth is spent only when Google actually forces it.
    proxy: "auto",
    ...(input.country ? { country: input.country, geoip: true } : {}),
  });

  const results = parseSerp(page.html ?? "", num);
  return { query: input.query, results, count: results.length };
});
