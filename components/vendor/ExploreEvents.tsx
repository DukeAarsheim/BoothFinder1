"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Search, X } from "lucide-react";
import { EVENT_TYPES, type EventRow } from "@/lib/types";
import { EVENT_TYPE_LABELS } from "@/lib/vendor/format";
import { locateEvents } from "@/lib/vendor/geo";
import { useSavedEvents } from "@/lib/vendor/storage";
import EventCard from "./EventCard";
import VendorNotice from "./VendorNotice";

const mapLoading = () => (
  <div className="grid h-full place-items-center bg-neutral-100 text-sm text-neutral-500">Loading map…</div>
);
// Mapbox when the page passes a token (see lib/vendor/mapboxToken); otherwise the keyless Leaflet map.
const MapboxEventMap = dynamic(() => import("./MapboxEventMap"), { ssr: false, loading: mapLoading });
const EventMap = dynamic(() => import("./EventMap"), { ssr: false, loading: mapLoading });

// The launch counties are always offered; others appear once an event there exists.
const LAUNCH_COUNTIES = ["San Luis Obispo", "Santa Barbara"];
const countyName = (county: string) => county.replace(/\s+county$/i, "").trim();
const inCounty = (e: EventRow, county: string) =>
  (e.county ?? "").toLowerCase().replace(/\s+county$/, "").trim() === county.toLowerCase();

const pill =
  "h-10 rounded-full border border-neutral-300 bg-white text-sm text-neutral-900 transition-colors hover:border-neutral-950 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-emerald-700";

/**
 * The Explore page: map (left, ~58%) and results (right), kept in sync.
 * Search and filters narrow BOTH the pins and the cards; clicking either side
 * selects the same event on the other.
 */
export default function ExploreEvents({
  events,
  isSampleData,
  mapboxToken,
}: {
  events: EventRow[];
  isSampleData: boolean;
  mapboxToken?: string | null;
}) {
  const [query, setQuery] = useState("");
  const [county, setCounty] = useState("");
  const [type, setType] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mapboxFailed, setMapboxFailed] = useState(false);
  const { isSaved, toggle } = useSavedEvents();
  const listRef = useRef<HTMLDivElement>(null);

  const counties = useMemo(() => {
    const others = new Set<string>();
    for (const e of events) {
      const name = e.county && countyName(e.county);
      if (name && !LAUNCH_COUNTIES.some((c) => c.toLowerCase() === name.toLowerCase())) others.add(name);
    }
    return [...LAUNCH_COUNTIES, ...[...others].sort()];
  }, [events]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return events.filter(
      (e) =>
        (!county || inCounty(e, county)) &&
        (!type || e.event_type === type) &&
        (!q ||
          [e.name, e.city, e.county, e.venue].some((v) => v?.toLowerCase().includes(q))),
    );
  }, [events, query, county, type]);

  const located = useMemo(() => locateEvents(filtered), [filtered]);
  const onMapIds = useMemo(() => new Set(located.map((l) => l.event.id)), [located]);

  // A selection that the filters removed is no longer a selection.
  const activeId = selectedId && filtered.some((e) => e.id === selectedId) ? selectedId : null;

  // Bring the selected card into view (e.g. after a pin click).
  useEffect(() => {
    if (!activeId) return;
    listRef.current
      ?.querySelector(`[data-event-id="${CSS.escape(activeId)}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeId]);

  const hasFilters = Boolean(query || county || type);
  const clear = () => {
    setQuery("");
    setCounty("");
    setType("");
  };

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <section aria-label="Event map" className="relative h-[42dvh] shrink-0 lg:h-auto lg:flex-[58]">
        {mapboxToken && !mapboxFailed ? (
          <MapboxEventMap
            token={mapboxToken}
            events={located}
            selectedId={activeId}
            onSelect={setSelectedId}
            onError={() => setMapboxFailed(true)}
          />
        ) : (
          <EventMap events={located} selectedId={activeId} onSelect={setSelectedId} />
        )}
      </section>

      <section
        aria-label="Event results"
        className="flex min-h-0 flex-1 flex-col border-t border-neutral-200 lg:flex-[42] lg:border-t-0 lg:border-l"
      >
        <div className="border-b border-neutral-200 px-5 pt-5 pb-3">
          <h1 className="text-xl font-semibold tracking-tight text-neutral-950">
            Events in California
          </h1>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-neutral-500" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by event, city, or venue"
              aria-label="Search events"
              className={`${pill} h-11 w-full pr-4 pl-10 placeholder:text-neutral-500`}
            />
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <select
              value={county}
              onChange={(e) => setCounty(e.target.value)}
              aria-label="Filter by county"
              className={`${pill} px-3.5 ${county ? "border-neutral-950 font-medium" : ""}`}
            >
              <option value="">All counties</option>
              {counties.map((c) => (
                <option key={c} value={c}>
                  {c} County
                </option>
              ))}
            </select>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              aria-label="Filter by event type"
              className={`${pill} px-3.5 ${type ? "border-neutral-950 font-medium" : ""}`}
            >
              <option value="">All types</option>
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {EVENT_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            {hasFilters && (
              <button
                type="button"
                onClick={clear}
                className="inline-flex h-10 items-center gap-1 rounded-full px-2.5 text-sm font-medium text-neutral-600 hover:text-neutral-950 focus-visible:outline-2 focus-visible:outline-emerald-700"
              >
                <X className="size-4" aria-hidden />
                Clear
              </button>
            )}
          </div>
          <p className="mt-3 text-[13px] text-neutral-500" aria-live="polite">
            {filtered.length === events.length
              ? `${events.length} ${events.length === 1 ? "event" : "events"}`
              : `${filtered.length} of ${events.length} events`}
            {filtered.length > located.length &&
              ` · ${filtered.length - located.length} without a map location`}
          </p>
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
          {isSampleData && (
            <p className="border-b border-amber-200 bg-amber-50 px-5 py-2.5 text-[13px] text-amber-900">
              <span className="font-semibold">Sample data.</span> The database isn&apos;t
              connected on this machine, so these events are made up. Add the Supabase
              values to <code className="font-mono text-xs">.env.local</code> to see real ones.
            </p>
          )}
          {events.length === 0 ? (
            <div className="p-5">
              <VendorNotice title="No events yet">
                <p>The events table is empty. Events appear here as soon as they are added.</p>
              </VendorNotice>
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-5">
              <VendorNotice title="No events match">
                <p>Try a different search, or clear the filters.</p>
              </VendorNotice>
            </div>
          ) : (
            <ul className="divide-y divide-neutral-200 border-b border-neutral-200">
              {filtered.map((event) => (
                <li key={event.id}>
                  <EventCard
                    event={event}
                    selected={event.id === activeId}
                    saved={isSaved(event.id)}
                    onMap={onMapIds.has(event.id)}
                    onSelect={setSelectedId}
                    onToggleSave={toggle}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
