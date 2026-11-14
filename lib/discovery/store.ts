import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { EventInsert, OpportunityStatus, VendorOpportunityRow } from "@/lib/types";

/**
 * All database access for discovery. Server only: it uses the service-role key.
 *
 * The client is used untyped here because `vendor_opportunities`,
 * `discovery_runs`, and `events.latitude/longitude` come from migration
 * 20261114230000, which lib/supabase/database.types.ts (a generated file) doesn't
 * know about until Duke applies it and regenerates types. Row shapes are in
 * lib/types.ts.
 */

/** The database can't be used yet; the message says what to do about it. */
export class DiscoveryNotReadyError extends Error {}

function db(): SupabaseClient {
  const admin = getSupabaseAdmin();
  if (!admin) {
    // Say exactly which one this deployment lacks; an empty value counts as missing.
    const missing = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].filter(
      (name) => !process.env[name]?.trim(),
    );
    throw new DiscoveryNotReadyError(
      `The database isn't connected for writing. This deployment has no value for ${missing.join(" and ")}. ` +
        "Check the exact name and that it's enabled for this environment, then redeploy.",
    );
  }
  return admin as unknown as SupabaseClient;
}

function fail(error: { code?: string; message: string }): never {
  // 42P01 / PGRST205 = table missing, 42703 / PGRST204 = column missing.
  if (["42P01", "PGRST205", "42703", "PGRST204"].includes(error.code ?? "")) {
    throw new DiscoveryNotReadyError(
      "The discovery tables don't exist yet. Migration 20261114230000_add_vendor_opportunity_discovery needs to be applied (MASTER.md §5b).",
    );
  }
  throw new Error(`Database error: ${error.message}`);
}

export function isDatabaseConfigured() {
  return getSupabaseAdmin() !== null;
}

export type OpportunityInsert = Omit<
  VendorOpportunityRow,
  "id" | "status" | "fetched_at" | "event_id" | "reviewed_at" | "review_note" | "created_at" | "updated_at"
>;

export type DiscoveryRunRow = {
  id: string;
  trigger: "manual" | "cron";
  started_at: string;
  finished_at: string | null;
  query_offset: number;
  queries: string[];
  stats: Record<string, unknown>;
  error: string | null;
};

/** Which of these URLs are already in the review queue or already an event's source. */
export async function knownSourceUrls(urls: string[]): Promise<Set<string>> {
  if (urls.length === 0) return new Set();
  const [queue, events] = await Promise.all([
    db().from("vendor_opportunities").select("source_url").in("source_url", urls),
    db().from("events").select("source_url").in("source_url", urls),
  ]);
  if (queue.error) fail(queue.error);
  if (events.error) fail(events.error);
  return new Set([...queue.data, ...events.data].map((r) => r.source_url as string));
}

/** Returns null when another run saved the same page first. */
export async function insertOpportunity(row: OpportunityInsert): Promise<VendorOpportunityRow | null> {
  const { data, error } = await db().from("vendor_opportunities").insert(row).select("*").single();
  if (error?.code === "23505") return null;
  if (error) fail(error);
  return data as VendorOpportunityRow;
}

export async function listOpportunities(status: OpportunityStatus): Promise<VendorOpportunityRow[]> {
  const { data, error } = await db()
    .from("vendor_opportunities")
    .select("*")
    .eq("status", status)
    .order("has_pricing", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) fail(error);
  return data as VendorOpportunityRow[];
}

export async function countOpportunities(): Promise<Record<OpportunityStatus, number>> {
  const count = async (status: OpportunityStatus) => {
    const { count, error } = await db()
      .from("vendor_opportunities")
      .select("id", { count: "exact", head: true })
      .eq("status", status);
    if (error) fail(error);
    return count ?? 0;
  };
  const [pending, approved, rejected] = await Promise.all([
    count("pending"),
    count("approved"),
    count("rejected"),
  ]);
  return { pending, approved, rejected };
}

export async function getOpportunity(id: string): Promise<VendorOpportunityRow | null> {
  const { data, error } = await db().from("vendor_opportunities").select("*").eq("id", id).maybeSingle();
  if (error) fail(error);
  return data as VendorOpportunityRow | null;
}

/**
 * Marks a pending opportunity reviewed. The `status = pending` guard means two
 * reviewers clicking at once can't both win; returns false for the loser.
 */
export async function reviewOpportunity(
  id: string,
  patch: { status: "approved" | "rejected"; event_id?: string; review_note?: string | null },
): Promise<boolean> {
  const { data, error } = await db()
    .from("vendor_opportunities")
    .update({ ...patch, reviewed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending")
    .select("id");
  if (error) fail(error);
  return data.length === 1;
}

export async function findEventBySourceUrl(sourceUrl: string): Promise<string | null> {
  const { data, error } = await db().from("events").select("id").eq("source_url", sourceUrl).limit(1);
  if (error) fail(error);
  return (data[0]?.id as string | undefined) ?? null;
}

export async function insertEvent(
  event: EventInsert & { latitude?: number | null; longitude?: number | null },
): Promise<string> {
  const { data, error } = await db().from("events").insert(event).select("id").single();
  if (error) fail(error);
  return data.id as string;
}

export async function deleteEvent(id: string): Promise<void> {
  const { error } = await db().from("events").delete().eq("id", id);
  if (error) fail(error);
}

export async function lastRun(): Promise<DiscoveryRunRow | null> {
  const { data, error } = await db()
    .from("discovery_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(1);
  if (error) fail(error);
  return (data[0] as DiscoveryRunRow | undefined) ?? null;
}

export async function startRun(run: Pick<DiscoveryRunRow, "trigger" | "query_offset" | "queries">): Promise<string> {
  const { data, error } = await db().from("discovery_runs").insert(run).select("id").single();
  if (error) fail(error);
  return data.id as string;
}

export async function finishRun(id: string, stats: Record<string, unknown>, error: string | null) {
  const res = await db()
    .from("discovery_runs")
    .update({ finished_at: new Date().toISOString(), stats, error })
    .eq("id", id);
  if (res.error) fail(res.error);
}
