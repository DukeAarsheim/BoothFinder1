import "server-only";

import {
  deleteEvent,
  findEventBySourceUrl,
  getOpportunity,
  insertEvent,
  reviewOpportunity,
} from "./store";

/**
 * Review actions. Approving is the ONLY path from the discovery queue into
 * `events`, the table the vendor map and the Fit score read.
 */

export type ReviewResult = { ok: true; eventId?: string } | { ok: false; error: string; status: 404 | 409 };

export async function approveOpportunity(id: string, note: string | null): Promise<ReviewResult> {
  const opportunity = await getOpportunity(id);
  if (!opportunity) return { ok: false, error: "Opportunity not found.", status: 404 };
  if (opportunity.status !== "pending") {
    return { ok: false, error: `Already ${opportunity.status}.`, status: 409 };
  }

  // The same page may already be an event (added by hand or by the extractor screen).
  const existing = await findEventBySourceUrl(opportunity.source_url);
  const eventId =
    existing ??
    (await insertEvent({
      ...opportunity.extracted,
      name: opportunity.name,
      source_url: opportunity.source_url,
      latitude: opportunity.latitude,
      longitude: opportunity.longitude,
      created_via: "extractor",
      is_sample: false,
    }));

  const won = await reviewOpportunity(id, { status: "approved", event_id: eventId, review_note: note });
  if (!won) {
    // Someone else reviewed it between our read and write; don't leave a duplicate event.
    if (!existing) await deleteEvent(eventId);
    return { ok: false, error: "Someone else just reviewed this one.", status: 409 };
  }
  return { ok: true, eventId };
}

export async function rejectOpportunity(id: string, note: string | null): Promise<ReviewResult> {
  const won = await reviewOpportunity(id, { status: "rejected", review_note: note });
  return won ? { ok: true } : { ok: false, error: "Not found, or already reviewed.", status: 409 };
}
