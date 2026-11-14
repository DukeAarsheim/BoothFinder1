/**
 * Shared app types.
 *
 * PROTECTED FILE (MASTER.md §6): add fields freely, but announce in the group
 * chat before renaming or removing anything, because that breaks teammates' code.
 *
 * Database row types come from lib/supabase/database.types.ts, which is generated
 * from the live schema. After a migration is applied, regenerate that file, then
 * update the value lists below if a check constraint changed.
 */
import type {
  Tables,
  TablesInsert,
  TablesUpdate,
} from "@/lib/supabase/database.types";

// ---------------------------------------------------------------------------
// Values the database accepts. Keep in sync with the check constraints in
// supabase/migrations. The generated row types show these columns as `string`.
// ---------------------------------------------------------------------------

export const EVENT_TYPES = [
  "fair",
  "race",
  "market",
  "festival",
  "street_fair",
  "other",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const DAY_TYPES = ["weekday", "weekend", "mixed"] as const;
export type DayType = (typeof DAY_TYPES)[number];

export const VENDOR_CATEGORIES = ["food", "drink", "other"] as const;
export type VendorCategory = (typeof VENDOR_CATEGORIES)[number];

export const CREATED_VIA = ["manual", "extractor"] as const;
export type CreatedVia = (typeof CREATED_VIA)[number];

// ---------------------------------------------------------------------------
// Table rows
// ---------------------------------------------------------------------------

/**
 * One event. Every fact field can be null. Null means "the source didn't say".
 * It never means zero, and nothing fills it with a guess.
 */
export type EventRow = Tables<"events">;
export type EventInsert = TablesInsert<"events">;
export type EventUpdate = TablesUpdate<"events">;

/** One vendor at one event in one year. */
export type EventVendorRow = Tables<"event_vendor_lists">;
export type EventVendorInsert = TablesInsert<"event_vendor_lists">;

/** One vendor's report on one event. Server-side only (see lib/supabase/admin.ts). */
export type RatingRow = Tables<"ratings">;
export type RatingInsert = TablesInsert<"ratings">;

// ---------------------------------------------------------------------------
// Shapes shared between cards
// ---------------------------------------------------------------------------

/**
 * What the extractor returns and the extract screen edits before saving:
 * an event's fact fields, without the columns the database fills in.
 * `name` is required; leave everything the source doesn't state as null.
 */
export type ExtractedEvent = Omit<
  EventInsert,
  "id" | "created_at" | "updated_at" | "created_via" | "is_sample"
>;

/**
 * The brand's numbers for the Fit score. NOT stored in the database: it lives in
 * client state for the demo (MASTER.md §5). Symbols match the formulas in §4.
 */
export interface BrandProfile {
  /** T: average ticket, in dollars. */
  price: number;
  /** m: gross margin, from 0 to 1. */
  margin: number;
  /**
   * p: share of attendees who buy in this CATEGORY across all competing vendors,
   * from 0 to 1. The projection divides it among competitors (lib/scoring).
   */
  purchaseRate: number;
  /** C: other costs in dollars (travel, staff, supplies). */
  otherCosts: number;
  /** Drives the weather adjustment. */
  productType: "hot" | "cold";
  /** U: transactions the booth can serve per hour. Optional; lib/scoring has a default. */
  transactionsPerHour?: number;
  /** Selling hours per event day (H = days × this). Optional; lib/scoring has a default. */
  sellingHoursPerDay?: number;
  /** N: direct competitors expected per event. Optional; lib/scoring has a default. */
  competitors?: number;
}

// ---------------------------------------------------------------------------
// Vendor-opportunity discovery (lib/discovery, lib/extractor)
// ---------------------------------------------------------------------------

export const OPPORTUNITY_STATUSES = ["pending", "approved", "rejected"] as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

/** Verbatim text from a source document that backs one extracted field. */
export interface EvidenceQuote {
  quote: string;
  /** The document the quote was read from. */
  url: string;
}

/** A document the extractor read: the page itself, or a linked application or fee sheet. */
export interface SourceDocument {
  url: string;
  kind: "html" | "pdf";
  title: string | null;
  content_hash: string;
}

/**
 * One discovered vendor opportunity in the review queue (table
 * `vendor_opportunities`). Server-side only. Approving it creates an `events` row.
 */
export interface VendorOpportunityRow {
  id: string;
  status: OpportunityStatus;
  source_url: string;
  source_domain: string;
  source_title: string | null;
  source_documents: SourceDocument[];
  discovered_via: "search" | "manual";
  discovery_query: string | null;
  fetched_at: string;
  content_hash: string | null;
  name: string;
  organizer_name: string | null;
  /** Only values backed by a quote in `evidence`. */
  extracted: ExtractedEvent;
  /** Keyed by field name. */
  evidence: Record<string, EvidenceQuote>;
  /** Fields the model returned that failed source verification and were discarded. */
  dropped_fields: string[];
  has_pricing: boolean;
  latitude: number | null;
  longitude: number | null;
  geo_precision: "venue" | "city" | null;
  event_id: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
}
