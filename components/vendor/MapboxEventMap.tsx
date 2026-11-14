"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import "./map.css";
import { PAN_BOUNDS, REGION_BOUNDS, type LatLng, type LocatedEvent } from "@/lib/vendor/geo";
import { formatFeeShort } from "@/lib/vendor/format";
import { popupContent } from "./mapPopup";

// Mapbox wants [lng, lat]; our geo helpers use [lat, lng].
const lngLat = ([lat, lng]: LatLng): [number, number] => [lng, lat];
const REGION: [[number, number], [number, number]] = [lngLat(REGION_BOUNDS[0]), lngLat(REGION_BOUNDS[1])];
// How far the visitor may pan: all of California, plus a small margin (degrees).
const PAN_MARGIN = 1.2;
const MAX_BOUNDS: [[number, number], [number, number]] = [
  [PAN_BOUNDS[0][1] - PAN_MARGIN, PAN_BOUNDS[0][0] - PAN_MARGIN],
  [PAN_BOUNDS[1][1] + PAN_MARGIN, PAN_BOUNDS[1][0] + PAN_MARGIN],
];
const STYLE = "mapbox://styles/mapbox/light-v11";
const FOCUS_ZOOM = 12;

type Pin = { marker: mapboxgl.Marker; item: LocatedEvent; hasFee: boolean };

/** Marker = a pill with the booth fee, or a dot when no fee is listed. */
function feeElement(item: LocatedEvent, label: string | null, onPick: () => void) {
  const root = document.createElement("div");
  root.className = "bf-marker";
  root.tabIndex = 0;
  root.setAttribute("role", "button");
  root.setAttribute("aria-label", item.event.name);
  root.title = item.event.name;
  const span = document.createElement("span");
  span.className = label ? "bf-fee" : "bf-fee bf-fee--none";
  if (label) span.textContent = label;
  root.append(span);
  root.addEventListener("click", onPick);
  root.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onPick();
    }
  });
  return root;
}

/**
 * Mapbox GL map of events. Same contract as the Leaflet EventMap:
 *  - `events` are the currently filtered, located events (markers follow filters)
 *  - `selectedId` highlights a marker, opens its preview, and flies to it
 *  - `onSelect` fires when a marker is clicked
 *  - `onError` fires if Mapbox can't start (bad token, no WebGL) so the parent
 *    can fall back to the Leaflet map
 * Load with next/dynamic and `ssr: false` (Mapbox needs `window`).
 */
export default function MapboxEventMap({
  token,
  events,
  selectedId,
  onSelect,
  onError,
}: {
  token: string;
  events: LocatedEvent[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onError?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const pinsRef = useRef(new Map<string, Pin>());
  const onSelectRef = useRef(onSelect);
  const onErrorRef = useRef(onError);
  const selectedRef = useRef(selectedId);
  const framedRef = useRef(false);
  useEffect(() => {
    onSelectRef.current = onSelect;
    onErrorRef.current = onError;
    selectedRef.current = selectedId;
  });

  // Create the map once.
  useEffect(() => {
    const pins = pinsRef.current;
    if (!mapboxgl.supported()) {
      onErrorRef.current?.();
      return;
    }
    let map: mapboxgl.Map;
    try {
      map = new mapboxgl.Map({
        accessToken: token,
        container: containerRef.current!,
        style: STYLE,
        bounds: REGION,
        fitBoundsOptions: { padding: 40 },
        maxBounds: MAX_BOUNDS,
        minZoom: 5,
        maxZoom: 17,
        dragRotate: false,
        pitchWithRotate: false,
        attributionControl: false,
      });
    } catch {
      onErrorRef.current?.();
      return;
    }
    map.touchZoomRotate.disableRotation();
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-left");
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-right");

    // A rejected token (401/403) means no tiles will ever load: hand over to the fallback.
    map.on("error", (e) => {
      const status = (e.error as { status?: number } | undefined)?.status;
      if (status === 401 || status === 403) onErrorRef.current?.();
    });

    // Clicking empty map clears the selection. Marker clicks bubble here too, so skip those.
    map.on("click", (e) => {
      const target = e.originalEvent.target as Element | null;
      if (target?.closest(".bf-marker")) return;
      if (selectedRef.current) onSelectRef.current(null);
    });

    const popup = new mapboxgl.Popup({ closeOnClick: false, maxWidth: "280px", focusAfterOpen: false });
    popup.on("close", () => {
      // Only the popup's own × reaches here with a selection still set.
      if (selectedRef.current) onSelectRef.current(null);
    });

    mapRef.current = map;
    popupRef.current = popup;
    return () => {
      selectedRef.current = null; // teardown must not report a deselection
      popup.remove();
      pins.forEach((p) => p.marker.remove());
      pins.clear();
      map.remove();
      mapRef.current = null;
      popupRef.current = null;
      framedRef.current = false;
    };
  }, [token]);

  // Rebuild pins whenever the filtered events change, and frame them.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const pins = pinsRef.current;
    pins.forEach((p) => p.marker.remove());
    pins.clear();

    for (const item of events) {
      const label = formatFeeShort(item.event);
      const element = feeElement(item, label, () => onSelectRef.current(item.event.id));
      const marker = new mapboxgl.Marker({ element, anchor: "center" })
        .setLngLat(lngLat(item.position))
        .addTo(map);
      pins.set(item.event.id, { marker, item, hasFee: Boolean(label) });
    }

    // First framing is instant; later ones (filter changes) animate.
    const animate = framedRef.current;
    framedRef.current = true;
    if (events.length > 0) {
      const bounds = new mapboxgl.LngLatBounds();
      events.forEach((e) => bounds.extend(lngLat(e.position)));
      map.fitBounds(bounds, { padding: 56, maxZoom: FOCUS_ZOOM, animate, duration: 600 });
    } else {
      map.fitBounds(REGION, { padding: 40, animate, duration: 600 });
    }
  }, [events]);

  // Reflect the selection: highlight, preview, and focus.
  useEffect(() => {
    const map = mapRef.current;
    const popup = popupRef.current;
    if (!map || !popup) return;
    pinsRef.current.forEach(({ marker }, id) => {
      const on = id === selectedId;
      const el = marker.getElement();
      el.classList.toggle("bf-marker--selected", on);
      el.style.zIndex = on ? "2" : "";
    });
    const pin = selectedId ? pinsRef.current.get(selectedId) : undefined;
    if (!pin) {
      popup.remove();
      return;
    }
    const target = pin.marker.getLngLat();
    if (!map.getBounds()?.contains(target) || map.getZoom() < FOCUS_ZOOM - 0.5) {
      map.flyTo({ center: target, zoom: Math.max(map.getZoom(), FOCUS_ZOOM), duration: 700 });
    }
    popup
      .setOffset(pin.hasFee ? 40 : 14)
      .setLngLat(target)
      .setDOMContent(popupContent(pin.item))
      .addTo(map);
  }, [selectedId, events]);

  return (
    <div
      ref={containerRef}
      className="bf-map h-full w-full"
      role="region"
      aria-label="Map of events in California"
    />
  );
}
