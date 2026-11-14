/**
 * Source verification for extracted event facts. Pure: no network, no database.
 *
 * The model returns, for each field, a value plus a verbatim quote and which
 * document the quote is from. Nothing the model says is trusted on its own:
 *   1. the quote must actually appear in that document, and
 *   2. the value must be supported by the quote (the dollar figure, the day of
 *      the month, the words of the name are in it).
 * A field that fails either check is discarded and reported in `dropped`, so the
 * stored row holds only facts a reviewer can trace to the source (MASTER.md §6:
 * "Don't invent data").
 */
import type { EventType, EvidenceQuote, ExtractedEvent } from "@/lib/types";

/** A document as the verifier needs it. `links` are absolute URLs found in it. */
export type VerifiableDoc = { url: string; text: string; links: string[] };

/** One field as the model returns it. `doc` is 1-based, matching the prompt. */
export type RawField = { value?: unknown; quote?: unknown; doc?: unknown } | null | undefined;

export type RawExtraction = {
  is_vendor_opportunity?: unknown;
  reason?: unknown;
  fields?: Record<string, RawField>;
};

export type VerifiedExtraction = {
  /** Null when the event name could not be verified; the candidate is then unusable. */
  event: ExtractedEvent | null;
  organizerName: string | null;
  evidence: Record<string, EvidenceQuote>;
  dropped: string[];
  hasPricing: boolean;
};

type FieldKind =
  | "literal" // the value's words must appear in the quote
  | "summary" // a paraphrase; the quote must exist in the source
  | "date"
  | "money"
  | "percent"
  | "count"
  | "year";

/** Every field the model may return, and how each is checked. */
export const FIELD_KINDS = {
  name: "literal",
  organizer_name: "literal",
  venue: "literal",
  city: "literal",
  county: "literal",
  start_date: "date",
  end_date: "date",
  application_deadline: "date",
  schedule_notes: "summary",
  how_to_apply: "summary",
  booth_fee_min: "money",
  booth_fee_max: "money",
  application_fee: "money",
  electricity_fee: "money",
  fee_pct_of_sales: "percent",
  fee_notes: "summary",
  fee_info_year: "year",
  booth_size: "summary",
  expected_attendance: "count",
  attendance_source: "summary",
  vendor_spots: "count",
  similar_vendor_limit: "summary",
  notes: "summary",
} as const satisfies Record<string, FieldKind>;

type FieldName = keyof typeof FIELD_KINDS;

const EVENT_TYPE_VALUES = [
  "fair",
  "race",
  "market",
  "festival",
  "street_fair",
  "other",
] as const satisfies readonly EventType[];

const MAX_QUOTE_CHARS = 400;
const MIN_QUOTE_CHARS = 6;
const MAX_TEXT_CHARS = 600;

// ---------------------------------------------------------------------------
// Text matching
// ---------------------------------------------------------------------------

/** Lowercase, straighten quotes and dashes, collapse whitespace. */
export function normalize(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalized with all whitespace removed: PDFs and HTML break lines unpredictably. */
const squeeze = (s: string) => normalize(s).replace(/\s+/g, "");

const cleanQuote = (q: string) => q.replace(/^[\s.…"'“”]+|[\s.…"'“”]+$/g, "");

export function quoteInText(quote: string, text: string): boolean {
  const q = squeeze(cleanQuote(quote));
  return q.length >= MIN_QUOTE_CHARS && squeeze(text).includes(q);
}

/** Every number written in a piece of text: "1,250.50" → 1250.5, "10k" → 10000. */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  const re = /(\d[\d,]*(?:\.\d+)?)(\s*(?:k\b|thousand\b|million\b))?/gi;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const n = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    const unit = m[2]?.trim().toLowerCase();
    out.push(unit === "million" ? n * 1e6 : unit ? n * 1e3 : n);
  }
  return out;
}

const hasNumber = (text: string, value: number) =>
  numbersIn(text).some((n) => Math.abs(n - value) < 0.005);

const wordsOf = (s: string) => normalize(s).match(/[a-z0-9]+/g) ?? [];

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseIsoDate(value: unknown): { y: number; m: number; d: number } | null {
  if (typeof value !== "string") return null;
  const match = ISO_DATE.exec(value.trim());
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  const real = date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  return real && y >= 2000 && y <= 2100 ? { y, m, d } : null;
}

/**
 * A date is supported when the quote names its day and month, and its year is
 * either in the quote or at least printed somewhere in the sources (pages often
 * say "June 5" under a "2027 Vendor Application" heading).
 */
function dateSupported(date: { y: number; m: number; d: number }, quote: string, docs: VerifiableDoc[]) {
  const q = normalize(quote);
  const nums = numbersIn(q);
  if (!nums.includes(date.d)) return false;

  const month = MONTHS[date.m - 1];
  const monthNamed = new RegExp(`\\b${month.slice(0, 3)}[a-z]*\\b`).test(q);
  const monthNumeric = new RegExp(`\\b0?${date.m}[/.-]0?${date.d}\\b`).test(q);
  if (!monthNamed && !monthNumeric) return false;

  const yearsInQuote = nums.filter((n) => Number.isInteger(n) && n >= 2000 && n <= 2100);
  if (yearsInQuote.length) return yearsInQuote.includes(date.y);
  // "6/5/27" style.
  if (new RegExp(`[/.-]${String(date.y).slice(2)}\\b`).test(q)) return true;
  return docs.some((doc) => doc.text.includes(String(date.y)));
}

// ---------------------------------------------------------------------------
// Per-field checks. Each returns the cleaned value, or null to drop the field.
// ---------------------------------------------------------------------------

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const n = Number(value.replace(/[$,%\s]/g, ""));
  return value.trim() !== "" && Number.isFinite(n) ? n : null;
}

function checkValue(
  kind: FieldKind,
  value: unknown,
  quote: string,
  docs: VerifiableDoc[],
): string | number | null {
  switch (kind) {
    case "literal": {
      if (typeof value !== "string") return null;
      const text = value.trim().slice(0, MAX_TEXT_CHARS);
      const words = wordsOf(text);
      const quoteWords = new Set(wordsOf(quote));
      return words.length > 0 && words.every((w) => quoteWords.has(w)) ? text : null;
    }
    case "summary": {
      if (typeof value !== "string") return null;
      return value.trim().slice(0, MAX_TEXT_CHARS) || null;
    }
    case "date": {
      const date = parseIsoDate(value);
      return date && dateSupported(date, quote, docs) ? (value as string).trim() : null;
    }
    case "money": {
      const n = toNumber(value);
      if (n == null || n < 0 || n > 1_000_000) return null;
      // "free" / "no fee" back a zero; otherwise the figure itself must be quoted.
      if (n === 0) return /\b(free|no (booth |vendor |application )?(fee|charge|cost))\b/i.test(quote) ? 0 : null;
      return hasNumber(quote, n) ? Math.round(n * 100) / 100 : null;
    }
    case "percent": {
      const n = toNumber(value);
      if (n == null || n <= 0 || n > 100) return null;
      return hasNumber(quote, n) && /%|percent/i.test(quote) ? n : null;
    }
    case "count": {
      const n = toNumber(value);
      if (n == null || n < 0 || !Number.isInteger(n) || n > 50_000_000) return null;
      return hasNumber(quote, n) ? n : null;
    }
    case "year": {
      const n = toNumber(value);
      if (n == null || !Number.isInteger(n) || n < 2000 || n > 2100) return null;
      return hasNumber(quote, n) ? n : null;
    }
  }
}

/** weekday | weekend | mixed, computed from the verified dates rather than asked of the model. */
export function dayTypeFor(start: string | null, end: string | null): "weekday" | "weekend" | "mixed" | null {
  const from = parseIsoDate(start);
  if (!from) return null;
  const to = parseIsoDate(end) ?? from;
  const first = Date.UTC(from.y, from.m - 1, from.d);
  const last = Math.max(first, Date.UTC(to.y, to.m - 1, to.d));
  let weekend = 0;
  let weekday = 0;
  // Long seasons (a market that runs April to October) are both by definition.
  for (let t = first, i = 0; t <= last && i < 62; t += 86_400_000, i++) {
    const dow = new Date(t).getUTCDay();
    if (dow === 0 || dow === 6) weekend++;
    else weekday++;
  }
  if (weekend && weekday) return "mixed";
  return weekend ? "weekend" : "weekday";
}

// ---------------------------------------------------------------------------
// The whole extraction
// ---------------------------------------------------------------------------

export function verifyExtraction(raw: RawExtraction, docs: VerifiableDoc[]): VerifiedExtraction {
  const fields = raw.fields && typeof raw.fields === "object" ? raw.fields : {};
  const values: Partial<Record<FieldName, string | number>> = {};
  const evidence: Record<string, EvidenceQuote> = {};
  const dropped: string[] = [];

  for (const field of Object.keys(FIELD_KINDS) as FieldName[]) {
    const entry = fields[field];
    if (!entry || entry.value == null || entry.value === "") continue;

    const quote = typeof entry.quote === "string" ? cleanQuote(entry.quote).slice(0, MAX_QUOTE_CHARS) : "";
    const index = typeof entry.doc === "number" ? entry.doc - 1 : 0;
    // The model may misnumber the document; accept the quote from whichever one holds it.
    const doc = [docs[index], ...docs].find((d) => d && quoteInText(quote, d.text));
    const value = doc ? checkValue(FIELD_KINDS[field], entry.value, quote, docs) : null;

    if (!doc || value == null) {
      dropped.push(field);
      continue;
    }
    values[field] = value;
    evidence[field] = { quote, url: doc.url };
  }

  // A single fee fills both ends of the range (the events schema expects that).
  const copy = (to: FieldName, from: FieldName) => {
    if (values[to] == null && values[from] != null) {
      values[to] = values[from];
      evidence[to] = evidence[from];
    }
  };
  copy("booth_fee_max", "booth_fee_min");
  copy("booth_fee_min", "booth_fee_max");
  if ((values.booth_fee_min as number) > (values.booth_fee_max as number)) {
    [values.booth_fee_min, values.booth_fee_max] = [values.booth_fee_max, values.booth_fee_min];
    [evidence.booth_fee_min, evidence.booth_fee_max] = [evidence.booth_fee_max, evidence.booth_fee_min];
  }
  // Dates must be in order, or the events table rejects the row.
  if (values.start_date && values.end_date && values.end_date < values.start_date) {
    delete values.end_date;
    delete evidence.end_date;
    dropped.push("end_date");
  }
  if (values.end_date && !values.start_date) {
    delete values.end_date;
    delete evidence.end_date;
    dropped.push("end_date");
  }

  // apply_url is checked against the links actually present in the sources.
  let applyUrl: string | null = null;
  const rawApply = fields.apply_url?.value;
  if (typeof rawApply === "string" && rawApply.trim()) {
    const wanted = rawApply.trim().replace(/\/+$/, "");
    const known = docs.flatMap((d) => [d.url, ...d.links]);
    applyUrl = known.find((u) => u.replace(/\/+$/, "") === wanted) ?? null;
    if (!applyUrl) dropped.push("apply_url");
  }

  // event_type is a classification, not a quoted fact; an unknown value becomes "other".
  const rawType = fields.event_type?.value;
  const eventType = EVENT_TYPE_VALUES.find((t) => t === rawType) ?? "other";

  const str = (f: FieldName) => (values[f] as string | undefined) ?? null;
  const num = (f: FieldName) => (values[f] as number | undefined) ?? null;
  const name = str("name");

  const event: ExtractedEvent | null = name
    ? {
        name,
        event_type: eventType,
        start_date: str("start_date"),
        end_date: str("end_date"),
        day_type: dayTypeFor(str("start_date"), str("end_date")),
        schedule_notes: str("schedule_notes"),
        venue: str("venue"),
        city: str("city"),
        county: str("county"),
        source_url: docs[0]?.url ?? null,
        apply_url: applyUrl,
        how_to_apply: str("how_to_apply"),
        application_deadline: str("application_deadline"),
        booth_fee_min: num("booth_fee_min"),
        booth_fee_max: num("booth_fee_max"),
        fee_pct_of_sales: num("fee_pct_of_sales"),
        application_fee: num("application_fee"),
        electricity_fee: num("electricity_fee"),
        fee_notes: str("fee_notes"),
        fee_info_year: num("fee_info_year"),
        booth_size: str("booth_size"),
        expected_attendance: num("expected_attendance"),
        attendance_source: num("expected_attendance") != null ? str("attendance_source") : null,
        vendor_spots: num("vendor_spots"),
        similar_vendor_limit: str("similar_vendor_limit"),
        notes: str("notes"),
      }
    : null;

  return {
    event,
    organizerName: str("organizer_name"),
    evidence,
    dropped,
    hasPricing: num("booth_fee_min") != null || num("fee_pct_of_sales") != null,
  };
}
