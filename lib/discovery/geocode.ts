import "server-only";

import { CRAWLER_USER_AGENT } from "@/lib/extractor/fetchSource";

/**
 * Places an event on the map with OpenStreetMap's Nominatim geocoder (free, no
 * key, results may be stored under ODbL; credited in MASTER.md §9). Its usage
 * policy allows at most one request per second and requires a User-Agent, both
 * of which this file enforces. Only the event's public venue and city are sent.
 */

export type Geocoded = {
  latitude: number;
  longitude: number;
  precision: "venue" | "city";
  /** e.g. "San Luis Obispo" (no "County" suffix), when Nominatim reports one. */
  county: string | null;
  /** e.g. "California". */
  state: string | null;
};

let lastCall = 0;

async function lookup(query: string): Promise<Omit<Geocoded, "precision"> | null> {
  const wait = lastCall + 1100 - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastCall = Date.now();

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.search = new URLSearchParams({
    q: query,
    format: "jsonv2",
    addressdetails: "1",
    countrycodes: "us",
    limit: "1",
  }).toString();

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": CRAWLER_USER_AGENT, "Accept-Language": "en" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const [hit] = (await res.json()) as {
      lat?: string;
      lon?: string;
      address?: { county?: string; state?: string };
    }[];
    const latitude = Number(hit?.lat);
    const longitude = Number(hit?.lon);
    if (!hit || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return {
      latitude,
      longitude,
      county: hit.address?.county?.replace(/\s+County$/i, "") ?? null,
      state: hit.address?.state ?? null,
    };
  } catch {
    return null;
  }
}

/** Tries the venue first, then the city. Returns null when neither can be found. */
export async function geocodeEvent(place: {
  venue: string | null;
  city: string | null;
}): Promise<Geocoded | null> {
  if (!place.city) return null;
  if (place.venue) {
    const hit = await lookup(`${place.venue}, ${place.city}, California`);
    if (hit?.state === "California") return { ...hit, precision: "venue" };
  }
  const hit = await lookup(`${place.city}, California`);
  return hit ? { ...hit, precision: "city" } : null;
}
