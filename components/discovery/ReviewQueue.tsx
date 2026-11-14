"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ExternalLink } from "lucide-react";
import Notice from "@/components/ui/Notice";
import {
  OPPORTUNITY_STATUSES,
  type OpportunityStatus,
  type VendorOpportunityRow,
} from "@/lib/types";
import { EVENT_TYPE_LABELS, formatBoothFee, formatDateRange } from "@/lib/vendor/format";

type QueueData = {
  opportunities: VendorOpportunityRow[];
  counts: Record<OpportunityStatus, number>;
  lastRun: {
    started_at: string;
    finished_at: string | null;
    queries: string[];
    stats: { saved?: number; savedWithPricing?: number; pagesRead?: number; results?: number };
    error: string | null;
  } | null;
  configured: { search: boolean; ai: boolean };
};

const TOKEN_KEY = "boothfinder.discoveryToken";

/** Fields shown in the facts table, in reading order. */
const FIELD_LABELS: [field: string, label: string][] = [
  ["name", "Event"],
  ["organizer_name", "Organizer"],
  ["venue", "Venue"],
  ["city", "City"],
  ["county", "County"],
  ["start_date", "Starts"],
  ["end_date", "Ends"],
  ["schedule_notes", "Schedule"],
  ["application_deadline", "Apply by"],
  ["how_to_apply", "How to apply"],
  ["booth_fee_min", "Booth fee (low)"],
  ["booth_fee_max", "Booth fee (high)"],
  ["fee_pct_of_sales", "% of sales"],
  ["application_fee", "Application fee"],
  ["electricity_fee", "Electricity fee"],
  ["fee_notes", "Fee notes"],
  ["fee_info_year", "Fees are for"],
  ["booth_size", "Booth size"],
  ["expected_attendance", "Attendance"],
  ["attendance_source", "Attendance source"],
  ["vendor_spots", "Vendor spots"],
  ["similar_vendor_limit", "Vendor limits"],
  ["notes", "Requirements"],
];
const MONEY_FIELDS = new Set(["booth_fee_min", "booth_fee_max", "application_fee", "electricity_fee"]);
const labelFor = (field: string) => FIELD_LABELS.find(([f]) => f === field)?.[1] ?? field;

const button =
  "rounded-md px-3.5 py-2 text-sm font-semibold transition-colors disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400";
const primary = `${button} bg-emerald-400 text-neutral-950 hover:bg-emerald-300`;
const secondary = `${button} border border-neutral-700 text-neutral-100 hover:border-neutral-500`;
const input =
  "w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus-visible:outline-2 focus-visible:outline-emerald-400";
const link = "text-emerald-400 underline-offset-2 hover:underline";

function display(field: string, value: unknown): string {
  if (typeof value === "number") {
    if (MONEY_FIELDS.has(field)) {
      const cents = Number.isInteger(value) ? 0 : 2;
      return `$${value.toLocaleString("en-US", { minimumFractionDigits: cents })}`;
    }
    if (field === "fee_pct_of_sales") return `${value}%`;
    return field === "fee_info_year" ? String(value) : value.toLocaleString("en-US");
  }
  return String(value);
}

export default function ReviewQueue() {
  const [token, setToken] = useState<string | null>(null);
  const [tokenDraft, setTokenDraft] = useState("");
  const [status, setStatus] = useState<OpportunityStatus>("pending");
  const [data, setData] = useState<QueueData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [url, setUrl] = useState("");

  // The token is kept for this browser tab only.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(TOKEN_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reading browser storage after mount
      if (saved) setToken(saved);
    } catch {
      // Storage can be blocked; the page then asks for the token each visit.
    }
  }, []);

  const call = useCallback(
    async (path: string, init?: RequestInit) => {
      const res = await fetch(path, {
        ...init,
        headers: { "Content-Type": "application/json", "x-discovery-token": token ?? "" },
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) {
        try {
          sessionStorage.removeItem(TOKEN_KEY);
        } catch {}
        setToken(null);
      }
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status}).`);
      return body;
    },
    [token],
  );

  const load = useCallback(async () => {
    try {
      setData(await call(`/api/discovery/opportunities?status=${status}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [call, status]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetching the queue when the token or tab changes
    if (token) void load();
  }, [token, load]);

  async function act(key: string, work: () => Promise<string>) {
    setBusy(key);
    setMessage(null);
    setError(null);
    try {
      setMessage(await work());
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const review = (o: VendorOpportunityRow, action: "approve" | "reject") =>
    act(`${action}:${o.id}`, async () => {
      await call(`/api/discovery/opportunities/${o.id}`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      return action === "approve"
        ? `Approved. "${o.name}" is now an event on the vendor map.`
        : `Rejected "${o.name}".`;
    });

  const runNow = () =>
    act("run", async () => {
      const { stats } = await call("/api/discovery/run", { method: "POST", body: "{}" });
      return `Run finished: read ${stats.pagesRead} of ${stats.results} pages found, queued ${stats.saved} (${stats.savedWithPricing} with pricing).`;
    });

  const addUrl = (e: FormEvent) => {
    e.preventDefault();
    void act("url", async () => {
      const outcome = await call("/api/discovery/run", { method: "POST", body: JSON.stringify({ url }) });
      if (!outcome.saved) throw new Error(outcome.reason);
      setUrl("");
      return `Queued "${outcome.opportunity.name}" for review.`;
    });
  };

  if (!token) {
    return (
      <form
        className="max-w-sm space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const value = tokenDraft.trim();
          if (!value) return;
          try {
            sessionStorage.setItem(TOKEN_KEY, value);
          } catch {}
          setToken(value);
        }}
      >
        <label className="block text-sm font-medium" htmlFor="discovery-token">
          Team access token
        </label>
        <input
          id="discovery-token"
          type="password"
          autoComplete="off"
          value={tokenDraft}
          onChange={(e) => setTokenDraft(e.target.value)}
          className={input}
        />
        <button type="submit" className={primary}>
          Unlock
        </button>
        {error && <p className="text-sm text-red-300">{error}</p>}
        <p className="text-sm text-neutral-400">
          This is the server&apos;s <code className="font-mono">DISCOVERY_ADMIN_TOKEN</code>. Ask a
          teammate for it; it isn&apos;t in the repo.
        </p>
      </form>
    );
  }

  const missing = data && [!data.configured.search && "TAVILY_API_KEY", !data.configured.ai && "AI_API_KEY, AI_BASE_URL, AI_MODEL"].filter(Boolean);

  return (
    <div className="space-y-6">
      {error && (
        <Notice title="That didn't work" tone="error">
          <p>{error}</p>
        </Notice>
      )}
      {message && (
        <p role="status" className="rounded-md border border-emerald-400/30 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-200">
          {message}
        </p>
      )}
      {missing && missing.length > 0 && (
        <Notice title="Discovery can't run yet" tone="warning">
          <p>These server environment variables aren&apos;t set: {missing.join("; ")}. Reviewing still works.</p>
        </Notice>
      )}

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-neutral-800 bg-neutral-900/60 p-4">
        <button type="button" className={primary} disabled={busy !== null} onClick={runNow}>
          {busy === "run" ? "Searching and reading pages…" : "Run discovery now"}
        </button>
        <form onSubmit={addUrl} className="flex min-w-64 flex-1 items-end gap-2">
          <label className="flex-1 text-sm">
            <span className="mb-1 block text-neutral-400">Or read one organizer page</span>
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…/vendors"
              className={input}
            />
          </label>
          <button type="submit" className={secondary} disabled={busy !== null}>
            {busy === "url" ? "Reading…" : "Add"}
          </button>
        </form>
        {data?.lastRun && (
          <p className="w-full text-xs text-neutral-400">
            Last run {new Date(data.lastRun.started_at).toLocaleString()}:{" "}
            {data.lastRun.error
              ? `failed (${data.lastRun.error})`
              : data.lastRun.finished_at
                ? `queued ${data.lastRun.stats.saved ?? 0} from ${data.lastRun.stats.pagesRead ?? 0} pages read`
                : "still running"}
            . Searched: {data.lastRun.queries.join(" · ")}
          </p>
        )}
      </div>

      <div role="tablist" aria-label="Review status" className="flex gap-2">
        {OPPORTUNITY_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={s === status}
            onClick={() => setStatus(s)}
            className={`${button} capitalize ${s === status ? "bg-neutral-100 text-neutral-950" : "border border-neutral-800 text-neutral-300 hover:border-neutral-600"}`}
          >
            {s}
            {data && ` (${data.counts[s]})`}
          </button>
        ))}
      </div>

      {!data ? (
        !error && <p className="text-neutral-400">Loading…</p>
      ) : data.opportunities.length === 0 ? (
        <Notice title={`Nothing ${status}`}>
          <p>
            {status === "pending"
              ? "Run discovery, or add an organizer page above, to fill the queue."
              : `No opportunities have been ${status} yet.`}
          </p>
        </Notice>
      ) : (
        <ul className="space-y-5">
          {data.opportunities.map((o) => (
            <li key={o.id}>
              <OpportunityCard
                opportunity={o}
                busy={busy}
                onApprove={() => review(o, "approve")}
                onReject={() => review(o, "reject")}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OpportunityCard({
  opportunity: o,
  busy,
  onApprove,
  onReject,
}: {
  opportunity: VendorOpportunityRow;
  busy: string | null;
  onApprove: () => void;
  onReject: () => void;
}) {
  const e = o.extracted;
  const facts: Record<string, unknown> = { ...e, organizer_name: o.organizer_name };
  const fee = formatBoothFee({ booth_fee_min: e.booth_fee_min ?? null, booth_fee_max: e.booth_fee_max ?? null });
  const summary = [
    EVENT_TYPE_LABELS[e.event_type ?? "other"],
    formatDateRange(e.start_date ?? null, e.end_date ?? null),
    [e.city, e.county && `${e.county} County`].filter(Boolean).join(", "),
  ].filter(Boolean);

  return (
    <article className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{o.name}</h2>
          <p className="mt-0.5 text-sm text-neutral-400">{summary.join(" · ") || "Date and place not stated"}</p>
        </div>
        <div className="text-right">
          <p className={`text-lg font-semibold ${fee ? "" : "text-neutral-500"}`}>{fee ?? "No fee found"}</p>
          {!o.has_pricing && (
            <p className="text-xs text-amber-300">No booth pricing on the source</p>
          )}
        </div>
      </div>

      <p className="mt-3 text-sm">
        <a href={o.source_url} target="_blank" rel="noopener noreferrer" className={`${link} inline-flex items-center gap-1`}>
          {o.source_domain}
          <ExternalLink className="size-3" aria-hidden />
        </a>
        <span className="text-neutral-500">
          {" "}
          · found by {o.discovered_via === "manual" ? "a teammate" : "search"} on{" "}
          {new Date(o.fetched_at).toLocaleDateString()}
          {o.source_documents.length > 1 && ` · ${o.source_documents.length} documents read`}
        </span>
      </p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-neutral-500">
            <tr>
              <th scope="col" className="w-36 py-1 pr-4 font-medium">Fact</th>
              <th scope="col" className="w-1/4 py-1 pr-4 font-medium">Value</th>
              <th scope="col" className="py-1 font-medium">Where the source says it</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800">
            {FIELD_LABELS.filter(([field]) => facts[field] != null && facts[field] !== "").map(([field, label]) => {
              const proof = o.evidence[field];
              return (
                <tr key={field} className="align-top">
                  <th scope="row" className="py-2 pr-4 font-normal text-neutral-400">{label}</th>
                  <td className="py-2 pr-4 font-medium">{display(field, facts[field])}</td>
                  <td className="py-2 text-neutral-300">
                    {proof ? (
                      <>
                        <q className="italic">{proof.quote}</q>{" "}
                        <a href={proof.url} target="_blank" rel="noopener noreferrer" className={`${link} whitespace-nowrap text-xs`}>
                          {proof.url === o.source_url ? "page" : /\.pdf($|\?)/i.test(proof.url) ? "PDF" : "linked page"}
                        </a>
                      </>
                    ) : (
                      <span className="text-amber-300">No source quote recorded. Check the page before approving.</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {e.apply_url && (
        <p className="mt-3 text-sm">
          <span className="text-neutral-400">Application link: </span>
          <a href={e.apply_url} target="_blank" rel="noopener noreferrer" className={`${link} break-all`}>
            {e.apply_url}
          </a>
        </p>
      )}
      {o.dropped_fields.length > 0 && (
        <p className="mt-3 text-sm text-amber-300">
          Left out because the source text didn&apos;t back them up: {o.dropped_fields.map(labelFor).join(", ")}.
        </p>
      )}
      <p className="mt-3 text-xs text-neutral-500">
        {o.latitude != null
          ? `Map pin placed at the ${o.geo_precision === "venue" ? "venue" : "city"}.`
          : "No map position: it will be listed but not pinned unless its city is in the map's built-in table."}
      </p>

      {o.status === "pending" ? (
        <div className="mt-4 flex gap-2">
          <button type="button" className={primary} disabled={busy !== null} onClick={onApprove}>
            {busy === `approve:${o.id}` ? "Approving…" : "Approve and add to map"}
          </button>
          <button type="button" className={secondary} disabled={busy !== null} onClick={onReject}>
            {busy === `reject:${o.id}` ? "Rejecting…" : "Reject"}
          </button>
        </div>
      ) : (
        <p className="mt-4 text-sm capitalize text-neutral-400">
          {o.status}
          {o.reviewed_at && ` on ${new Date(o.reviewed_at).toLocaleDateString()}`}
        </p>
      )}
    </article>
  );
}
