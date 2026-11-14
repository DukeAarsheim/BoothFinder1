import "server-only";

import { authorize } from "./auth";
import { DiscoveryNotReadyError } from "./store";

const json = (body: unknown, status = 200) => Response.json(body, { status });

/**
 * Wraps a discovery route: checks the shared secret, runs the handler, and turns
 * failures into JSON errors without leaking internals.
 */
export async function guarded(
  request: Request,
  allow: ("admin" | "cron")[],
  handler: (caller: "admin" | "cron") => Promise<Response>,
): Promise<Response> {
  if (!process.env.DISCOVERY_ADMIN_TOKEN && !process.env.CRON_SECRET) {
    return json({ error: "Discovery is locked: DISCOVERY_ADMIN_TOKEN isn't set on the server." }, 503);
  }
  const caller = authorize(request);
  if (!caller || !allow.includes(caller)) return json({ error: "Wrong or missing access token." }, 401);

  try {
    return await handler(caller);
  } catch (error) {
    if (error instanceof DiscoveryNotReadyError) return json({ error: error.message }, 503);
    console.error("Discovery route failed:", error);
    const message = error instanceof Error ? error.message : "";
    // Our own setup messages are safe and useful to show; anything else stays generic.
    const safe = /must all be set|is not set|AI provider|search provider|no JSON object/.test(message);
    return json({ error: safe ? message : "Something went wrong on the server." }, 500);
  }
}

export { json };
