import { guarded, json } from "@/lib/discovery/http";
import { isSearchConfigured } from "@/lib/discovery/search";
import { countOpportunities, lastRun, listOpportunities } from "@/lib/discovery/store";
import { isAiConfigured } from "@/lib/extractor/llm";
import { OPPORTUNITY_STATUSES, type OpportunityStatus } from "@/lib/types";

/** GET ?status=pending|approved|rejected → the review queue plus setup and last-run info. */
export function GET(request: Request) {
  return guarded(request, ["admin"], async () => {
    const wanted = new URL(request.url).searchParams.get("status");
    const status: OpportunityStatus =
      OPPORTUNITY_STATUSES.find((s) => s === wanted) ?? "pending";

    const [opportunities, counts, run] = await Promise.all([
      listOpportunities(status),
      countOpportunities(),
      lastRun(),
    ]);
    return json({
      status,
      opportunities,
      counts,
      lastRun: run,
      configured: { search: isSearchConfigured(), ai: isAiConfigured() },
    });
  });
}
