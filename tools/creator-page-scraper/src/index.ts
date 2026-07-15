import { defineTool } from "@better-fetch/tools";

type Platform = "komi" | "pillar";
type Input = { platform: Platform; url: string; max_results?: number };
type Social = { platform: string; url: string };
type Link = { id?: string; type?: string; title: string; url: string; thumbnail?: string; price?: number; currency?: string };
type Product = { id?: string; title: string; description?: string; url?: string; image?: string; price?: number; currency?: string };
type Profile = {
  id?: string; username: string; display_name: string; url: string; first_name?: string; last_name?: string;
  bio?: string; location?: string; email?: string; avatar?: string;
};
type Output = { platform: Platform; source_url: string; profile: Profile; socials: Social[]; links: Link[]; products: Product[]; count: number };

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== "")) as T;
}

function decode(value: string): string {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function strip(value: string): string {
  return decode(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function absolute(raw: string, base: string): string {
  try { return new URL(decode(raw), base).toString(); } catch { return decode(raw); }
}

function normalizedUrl(raw: string, platform: Platform): URL {
  let value = raw.trim();
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  const url = new URL(value);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (platform === "komi" && host !== "komi.io" && !host.endsWith(".komi.io")) throw new Error("url must be a public Komi page");
  if (platform === "pillar" && host !== "pillar.io" && !host.endsWith(".pillar.io")) throw new Error("url must be a public Pillar page");
  url.protocol = "https:";
  url.hash = "";
  return url;
}

function uniqueBy<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => { const id = key(value); if (!id || seen.has(id)) return false; seen.add(id); return true; });
}

async function fetchJson(bf: Parameters<Parameters<typeof defineTool>[0]>[1], url: string): Promise<any> {
  const response = await bf.fetch({
    url, strategy: "http", return_response_text: true, include_html: false,
    extra_headers: { "user-agent": "Mozilla/5.0", accept: "application/json", "accept-language": "en-US,en;q=0.9" },
  });
  if (response.blocked) throw new Error(`Upstream blocked the request (${response.block_reason ?? "unknown"})`);
  const raw = response.body_text ?? "";
  if (!raw) throw new Error("Upstream returned an empty response");
  try { return JSON.parse(raw); } catch { throw new Error("Upstream did not return valid JSON"); }
}

function komiUsername(url: URL): string {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const subdomain = host.endsWith(".komi.io") ? host.slice(0, -".komi.io".length) : "";
  const path = url.pathname.split("/").filter(Boolean)[0]?.replace(/^@/, "") ?? "";
  const username = subdomain && subdomain !== "app" ? subdomain : path;
  if (!username || !/^[a-z0-9._-]{2,64}$/i.test(username)) throw new Error("Could not resolve a Komi username from url");
  return username;
}

function flattenKomiModules(modules: any[], limit: number): { links: Link[]; products: Product[] } {
  const links: Link[] = [];
  const products: Product[] = [];
  const visit = (node: any, inheritedType?: string) => {
    if (!node || typeof node !== "object" || node.visible === false) return;
    const type = String(node.type ?? inheritedType ?? "LINK").toUpperCase();
    if (typeof node.url === "string" && node.url) {
      const base = compact({ id: node.id ? String(node.id) : undefined, type, title: String(node.title ?? node.name ?? type), url: node.url,
        thumbnail: node.thumbnail, price: typeof node.price === "number" ? node.price : undefined, currency: node.currency });
      if (type === "PRODUCT" || typeof node.price === "number") products.push(compact({ id: base.id, title: base.title, url: base.url, image: base.thumbnail, price: base.price, currency: base.currency }));
      else links.push(base);
    }
    if (Array.isArray(node.links)) for (const child of node.links) visit(child, child.type ?? type);
    if (Array.isArray(node.items)) for (const child of node.items) visit(child, node.type ?? type);
  };
  for (const module of modules) visit(module);
  return {
    links: uniqueBy(links, (item) => item.url).slice(0, limit),
    products: uniqueBy(products, (item) => item.url ?? item.title).slice(0, limit),
  };
}

async function scrapeKomi(bf: Parameters<Parameters<typeof defineTool>[0]>[1], url: URL, limit: number): Promise<Output> {
  const username = komiUsername(url);
  const talent = await fetchJson(bf, `https://api.komi.io/api/talent/usernames/${encodeURIComponent(username)}`);
  const detail = talent?.talentProfile;
  if (!detail?.id) throw new Error("Komi returned no public creator profile");
  const modules = await fetchJson(bf, `https://api.komi.io/api/talent-profiles/${encodeURIComponent(String(detail.id))}/modules`);
  const socials: Social[] = uniqueBy((detail.socialProfileLinks ?? []).flatMap((item: any) =>
    typeof item?.link === "string" && item.link ? [{ platform: String(item.type ?? "website").toLowerCase(), url: item.link }] : []), (item: Social) => item.url);
  const content = flattenKomiModules(Array.isArray(modules) ? modules : [], limit);
  const profile = compact({
    id: String(detail.id), username, display_name: String(detail.displayName ?? `${detail.firstName ?? ""} ${detail.lastName ?? ""}`).trim() || username,
    url: url.toString(), first_name: detail.firstName, last_name: detail.lastName, bio: detail.bio,
    avatar: detail.avatar ?? talent.avatar,
  });
  return { platform: "komi", source_url: url.toString(), profile, socials, ...content, count: 1 + socials.length + content.links.length + content.products.length };
}

function first(html: string, pattern: RegExp): string | undefined {
  const value = html.match(pattern)?.[1];
  return value ? strip(value) : undefined;
}

function pillarSocials(html: string, base: string): Social[] {
  const row = html.match(/<ul[^>]+class=["'][^"']*socials-row[^"']*["'][^>]*>([\s\S]*?)<\/ul>/i)?.[1] ?? "";
  const values: Social[] = [];
  for (const match of row.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>[\s\S]*?<i[^>]+class=["']([^"']+)["']/gi)) {
    const className = match[2];
    const platform = className.match(/\b(email|instagram|tiktok|youtube|twitter|facebook|linkedin|spotify|soundcloud|twitch|discord|patreon|snapchat|amazon|medium)\b/i)?.[1]?.toLowerCase() ?? "website";
    values.push({ platform, url: absolute(match[1], base) });
  }
  return uniqueBy(values, (item) => item.url);
}

function pillarLinks(html: string, base: string, limit: number): Link[] {
  const values: Link[] = [];
  for (const match of html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*class=["'][^"']*flex justify-between[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = absolute(match[1], base);
    const title = first(match[2], /<h4[^>]*>([\s\S]*?)<\/h4>/i) ?? strip(match[2]);
    if (title && !url.startsWith("mailto:")) values.push(compact({ title, url, type: "LINK", thumbnail: match[2].match(/<img[^>]+src=["']([^"']+)/i)?.[1] }));
  }
  return uniqueBy(values, (item) => item.url).slice(0, limit);
}

function pillarProducts(html: string, limit: number): Product[] {
  const values: Product[] = [];
  for (const match of html.matchAll(/<div[^>]+id=["']([0-9a-f-]{36})["'][^>]+class=["'][^"']*page-item[^"']*["'][^>]*>([\s\S]*?)(?=<div class=["']relative["']>|$)/gi)) {
    const segment = match[2];
    if (!/role=["']button["'][\s\S]*?class=["'][^"']*block-heading text-left/i.test(segment)) continue;
    const title = first(segment, /<h4[^>]+class=["'][^"']*block-heading text-left[^"']*["'][^>]*>([\s\S]*?)<\/h4>/i);
    if (!title) continue;
    const description = first(segment, /<p[^>]+class=["'][^"']*block-body[^"']*["'][^>]*>([\s\S]*?)<\/p>/i);
    const image = segment.match(/<img[^>]+src=["']([^"']+)/i)?.[1];
    values.push(compact({ id: match[1], title, description, image: image ? decode(image) : undefined }));
  }
  return uniqueBy(values, (item) => item.id ?? item.title).slice(0, limit);
}

async function scrapePillar(bf: Parameters<Parameters<typeof defineTool>[0]>[1], url: URL, limit: number): Promise<Output> {
  const response = await bf.fetch({
    url: url.toString(), strategy: "browser", json_mode: false, wait_until: "domcontentloaded", wait_ms: 5000,
    timeout_ms: 60000, include_html: true, locale: "en-US",
  });
  if (response.blocked) throw new Error(`Pillar blocked the request (${response.block_reason ?? "unknown"})`);
  const html = response.html ?? response.body_text ?? "";
  const displayName = first(html, /<h1[^>]+class=["'][^"']*page-header__name[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i);
  if (!displayName) throw new Error("Pillar returned no public creator profile");
  const username = url.pathname.split("/").filter(Boolean)[0] ?? displayName;
  const socials = pillarSocials(html, url.toString());
  const links = pillarLinks(html, url.toString(), limit);
  const products = pillarProducts(html, limit);
  const email = socials.find((item) => item.url.startsWith("mailto:"))?.url.replace(/^mailto:/, "");
  const profile = compact({
    username, display_name: displayName, url: response.final_url ?? url.toString(),
    bio: first(html, /<p[^>]+class=["'][^"']*page-header__tagline[^"']*["'][^>]*>([\s\S]*?)<\/p>/i),
    location: first(html, /<p[^>]+class=["'][^"']*page-header__location[^"']*["'][^>]*>([\s\S]*?)<\/p>/i), email,
    avatar: html.match(/class=["'][^"']*page-header__avatar[^"']*["'][^>]*>[\s\S]*?<img[^>]+src=["']([^"']+)/i)?.[1],
  });
  return { platform: "pillar", source_url: response.final_url ?? url.toString(), profile, socials, links, products, count: 1 + socials.length + links.length + products.length };
}

export default defineTool<Input, Output>(async (input, bf) => {
  const platform = input.platform;
  if (platform !== "komi" && platform !== "pillar") throw new Error("platform must be komi or pillar");
  const url = normalizedUrl(input.url, platform);
  const limit = Math.min(Math.max(input.max_results ?? 25, 1), 50);
  return platform === "komi" ? scrapeKomi(bf, url, limit) : scrapePillar(bf, url, limit);
});
