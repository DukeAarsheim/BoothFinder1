import { approveOpportunity, rejectOpportunity } from "@/lib/discovery/approve";
import { guarded, json } from "@/lib/discovery/http";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** POST { action: "approve" | "reject", note? }. Approving creates the `events` row. */
export function POST(request: Request, ctx: RouteContext<"/api/discovery/opportunities/[id]">) {
  return guarded(request, ["admin"], async () => {
    const { id } = await ctx.params;
    if (!UUID.test(id)) return json({ error: "Opportunity not found." }, 404);

    const body = (await request.json().catch(() => ({}))) as { action?: unknown; note?: unknown };
    const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null;

    if (body.action !== "approve" && body.action !== "reject") {
      return json({ error: 'action must be "approve" or "reject".' }, 400);
    }
    const result =
      body.action === "approve" ? await approveOpportunity(id, note) : await rejectOpportunity(id, note);
    return result.ok ? json(result) : json({ error: result.error }, result.status);
  });
}
