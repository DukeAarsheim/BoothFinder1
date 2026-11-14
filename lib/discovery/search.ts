import "server-only";

/**
 * Web search for discovery, via Tavily (https://docs.tavily.com). The key is
 * TAVILY_API_KEY, server only. Swap providers by replacing this one function;
 * the pipeline only needs { url, title }.
 */

export type SearchHit = { url: string; title: string | null };

export function isSearchConfigured() {
  return Boolean(process.env.TAVILY_API_KEY);
}

export async function searchWeb(
  query: string,
  maxResults: number,
  excludeDomains: string[],
): Promise<SearchHit[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("TAVILY_API_KEY is not set.");

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      query,
      max_results: maxResults,
      search_depth: "basic",
      exclude_domains: excludeDomains,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`Search provider error ${res.status}: ${detail.slice(0, 300)}`);
    throw new Error(`The search provider returned an error (${res.status}).`);
  }
  const data = (await res.json()) as { results?: { url?: unknown; title?: unknown }[] };
  return (data.results ?? [])
    .filter((r): r is { url: string; title?: unknown } => typeof r.url === "string")
    .map((r) => ({ url: r.url, title: typeof r.title === "string" ? r.title : null }));
}
