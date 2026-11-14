import { guarded, json } from "@/lib/discovery/http";
import { ingestUrl, runDiscovery } from "@/lib/discovery/pipeline";

// A run searches, reads up to 18 pages, and calls the AI for each.
export const maxDuration = 300;

/**
 * POST {}            → run one discovery batch now.
 * POST { url }       → read one page a person submitted and queue it for review.
 * Header: x-discovery-token.
 */
export function POST(request: Request) {
  return guarded(request, ["admin"], async () => {
    const body = (await request.json().catch(() => ({}))) as { url?: unknown };
    if (typeof body.url === "string" && body.url.trim()) {
      const outcome = await ingestUrl(body.url.slice(0, 2000), {
        discovered_via: "manual",
        discovery_query: null,
      });
      return json(outcome);
    }
    return json({ stats: await runDiscovery("manual") });
  });
}

/** Vercel Cron calls this with "Authorization: Bearer $CRON_SECRET" (see vercel.json). */
export function GET(request: Request) {
  return guarded(request, ["cron"], async () => json({ stats: await runDiscovery("cron") }));
}
