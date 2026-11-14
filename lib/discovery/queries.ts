/**
 * The search queries discovery rotates through. Pure (no imports), so it is easy
 * to test and to tune. One query = one kind of event in one California county.
 */

/** Launch market first (MASTER.md §1), then the rest of the state A to Z. */
export const CA_COUNTIES = [
  "San Luis Obispo", "Santa Barbara",
  "Alameda", "Alpine", "Amador", "Butte", "Calaveras", "Colusa", "Contra Costa",
  "Del Norte", "El Dorado", "Fresno", "Glenn", "Humboldt", "Imperial", "Inyo",
  "Kern", "Kings", "Lake", "Lassen", "Los Angeles", "Madera", "Marin", "Mariposa",
  "Mendocino", "Merced", "Modoc", "Mono", "Monterey", "Napa", "Nevada", "Orange",
  "Placer", "Plumas", "Riverside", "Sacramento", "San Benito", "San Bernardino",
  "San Diego", "San Francisco", "San Joaquin", "San Mateo", "Santa Clara",
  "Santa Cruz", "Shasta", "Sierra", "Siskiyou", "Solano", "Sonoma", "Stanislaus",
  "Sutter", "Tehama", "Trinity", "Tulare", "Tuolumne", "Ventura", "Yolo", "Yuba",
] as const;

/** What we look for, phrased the way organizers phrase their vendor calls. */
export const OPPORTUNITY_KINDS = [
  { id: "fair", terms: 'county fair "commercial exhibitor" OR "vendor application" booth fees' },
  { id: "festival", terms: 'festival "food vendor" OR "vendor application" booth fee' },
  { id: "farmers_market", terms: 'farmers market "become a vendor" OR "vendor application" stall fees' },
  { id: "holiday_market", terms: 'holiday market OR craft fair "vendor application" booth fee' },
  { id: "organizer", terms: 'events "call for vendors" OR "vendors wanted" apply booth space' },
] as const;

/** Total distinct queries: every kind in every county. */
export const QUERY_COUNT = CA_COUNTIES.length * OPPORTUNITY_KINDS.length;

/**
 * The season to search for. Applications open months ahead (fairs take summer
 * vendors in winter), so from September on we look for next year's.
 */
export function seasonYear(now: Date): number {
  return now.getUTCFullYear() + (now.getUTCMonth() >= 8 ? 1 : 0);
}

/**
 * Query number `index` (any non-negative integer; it wraps). County and kind
 * both advance each step, and because 58 and 5 share no factor the sequence
 * visits every county × kind pair once before repeating, while consecutive
 * queries cover different counties and kinds.
 */
export function queryAt(index: number, year: number): string {
  const i = ((index % QUERY_COUNT) + QUERY_COUNT) % QUERY_COUNT;
  const county = CA_COUNTIES[i % CA_COUNTIES.length];
  const kind = OPPORTUNITY_KINDS[i % OPPORTUNITY_KINDS.length];
  return `${county} County, California ${year} ${kind.terms}`;
}

export function queriesForRun(offset: number, count: number, year: number): string[] {
  return Array.from({ length: count }, (_, k) => queryAt(offset + k, year));
}

/** Strips tracking parameters and the fragment so one page isn't stored twice. */
export function canonicalUrl(input: string): string | null {
  try {
    const url = new URL(input.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return null;
  }
}

/** True when `host` is `domain` or a subdomain of it. */
export function hostMatches(host: string, domain: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  return h === domain || h.endsWith(`.${domain}`);
}
