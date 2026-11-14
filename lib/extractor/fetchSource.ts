import "server-only";

import { createHash } from "node:crypto";
import { htmlToText } from "./htmlText";
import { isAllowedByRobots } from "./robots";

/**
 * Fetches one public page or PDF and returns its text. Polite and defensive:
 * it identifies itself, obeys robots.txt, refuses private network addresses,
 * and caps size and time.
 */

export const CRAWLER_USER_AGENT =
  "BoothfinderBot/0.1 (student project; reads public vendor-application pages)";

const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 5;

export type FetchedDocument = {
  /** Final URL after redirects. */
  url: string;
  kind: "html" | "pdf";
  title: string | null;
  text: string;
  /** Absolute http(s) links found in an HTML page, with their link text. */
  links: { href: string; text: string }[];
  contentHash: string;
};

/** A fetch that was refused or failed for a reason worth recording, not a bug. */
export class SourceFetchError extends Error {}

/** Rejects anything that isn't a public http(s) address. */
export function assertPublicUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new SourceFetchError("Not a valid URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new SourceFetchError("Only http and https URLs can be read.");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const privateHost =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    !host.includes(".") ||
    host.includes(":") || // IPv6 literal
    /^(0|10|127)\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host);
  if (privateHost || url.username || url.password) {
    throw new SourceFetchError("That address isn't a public website.");
  }
  return url;
}

const robotsCache = new Map<string, Promise<string | null>>();

function robotsFor(origin: string): Promise<string | null> {
  let cached = robotsCache.get(origin);
  if (!cached) {
    cached = fetch(`${origin}/robots.txt`, {
      headers: { "User-Agent": CRAWLER_USER_AGENT },
      signal: AbortSignal.timeout(8_000),
    })
      .then((res) => (res.ok ? res.text() : null))
      .catch(() => null);
    robotsCache.set(origin, cached);
  }
  return cached;
}

async function readCapped(res: Response): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(await res.arrayBuffer());
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new SourceFetchError("The document is larger than 8 MB.");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export async function fetchDocument(input: string): Promise<FetchedDocument> {
  let url = assertPublicUrl(input);
  let res: Response | null = null;

  // Follow redirects by hand so every hop gets the same public-address and robots checks.
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const robots = await robotsFor(url.origin);
    if (robots && !isAllowedByRobots(robots, url.pathname + url.search, CRAWLER_USER_AGENT)) {
      throw new SourceFetchError("The site's robots.txt asks crawlers not to read this page.");
    }
    try {
      res = await fetch(url, {
        redirect: "manual",
        headers: {
          "User-Agent": CRAWLER_USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/pdf;q=0.9",
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new SourceFetchError("The site didn't respond.");
    }
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) break;
    url = assertPublicUrl(new URL(location, url).toString());
    res = null;
  }
  if (!res) throw new SourceFetchError("Too many redirects.");
  if (!res.ok) throw new SourceFetchError(`The site returned ${res.status}.`);

  const type = (res.headers.get("content-type") ?? "").toLowerCase();
  const bytes = await readCapped(res);
  const isPdf =
    type.includes("application/pdf") ||
    (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46); // "%PDF"

  let title: string | null = null;
  let text: string;
  const links: FetchedDocument["links"] = [];

  if (isPdf) {
    const { extractText, getDocumentProxy } = await import("unpdf");
    try {
      const pdf = await getDocumentProxy(bytes);
      text = (await extractText(pdf, { mergePages: true })).text;
    } catch {
      throw new SourceFetchError("The PDF couldn't be read.");
    }
    if (text.trim().length < 40) {
      throw new SourceFetchError("The PDF has no selectable text (it may be a scan).");
    }
  } else if (type.includes("html") || type.includes("text/plain") || type === "") {
    const page = htmlToText(new TextDecoder("utf-8").decode(bytes));
    title = page.title;
    text = page.text;
    const seen = new Set<string>();
    for (const link of page.links) {
      try {
        const abs = new URL(link.href, url);
        if (abs.protocol !== "http:" && abs.protocol !== "https:") continue;
        abs.hash = "";
        const href = abs.toString();
        if (seen.has(href)) continue;
        seen.add(href);
        links.push({ href, text: link.text });
      } catch {
        // Not a usable link.
      }
    }
  } else {
    throw new SourceFetchError(`Unsupported content type (${type.split(";")[0]}).`);
  }

  return {
    url: url.toString(),
    kind: isPdf ? "pdf" : "html",
    title,
    text,
    links,
    contentHash: createHash("sha256").update(text).digest("hex"),
  };
}
