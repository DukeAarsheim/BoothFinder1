/**
 * Turns an HTML page into plain text plus its links. Pure: no network, no DOM.
 * Good enough for reading event pages; it is not a full HTML parser.
 */

export type PageLink = { href: string; text: string };

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  hellip: "…",
  dollar: "$",
  percnt: "%",
  frac12: "½",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (match, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

const stripTags = (s: string) => s.replace(/<[^>]*>/g, " ");
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

export function htmlToText(html: string): {
  title: string | null;
  text: string;
  links: PageLink[];
} {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? squash(decodeEntities(stripTags(titleMatch[1]))) || null : null;

  const body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|head)\b[\s\S]*?<\/\1\s*>/gi, " ");

  const links: PageLink[] = [];
  const anchor = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a\s*>/gi;
  for (let m = anchor.exec(body); m; m = anchor.exec(body)) {
    const href = decodeEntities(m[1] ?? m[2] ?? "").trim();
    if (href) links.push({ href, text: squash(decodeEntities(stripTags(m[3]))) });
  }

  const text = decodeEntities(
    stripTags(
      body
        // Block-level boundaries become line breaks so facts stay on their own lines.
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|li|tr|h[1-6]|section|article|table|ul|ol|dd|dt|header|footer)\s*>/gi, "\n")
        .replace(/<\/(td|th)\s*>/gi, " | "),
    ),
  )
    .split("\n")
    .map(squash)
    .filter(Boolean)
    .join("\n");

  return { title, text, links };
}
