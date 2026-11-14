import "server-only";

import type { FetchedDocument } from "./fetchSource";
import { completeJson } from "./llm";
import { EXTRACTION_SYSTEM_PROMPT, buildExtractionPrompt, parseJsonReply } from "./prompt";
import { verifyExtraction, type RawExtraction, type VerifiedExtraction } from "./verify";

export type ExtractionResult = VerifiedExtraction & {
  /** The model's own judgement of whether the documents advertise a vendor opportunity. */
  isVendorOpportunity: boolean;
  reason: string | null;
};

/**
 * Extracts one event's facts from a page and its related documents (the first
 * document is the page itself). Every returned fact has passed source
 * verification; see ./verify.ts.
 */
export async function extractFromDocuments(docs: FetchedDocument[]): Promise<ExtractionResult> {
  const today = new Date().toISOString().slice(0, 10);
  const reply = await completeJson(EXTRACTION_SYSTEM_PROMPT, buildExtractionPrompt(docs, today));
  const raw = parseJsonReply(reply) as RawExtraction;

  const verified = verifyExtraction(
    raw,
    docs.map((d) => ({ url: d.url, text: d.text, links: d.links.map((l) => l.href) })),
  );
  return {
    ...verified,
    isVendorOpportunity: raw.is_vendor_opportunity === true,
    reason: typeof raw.reason === "string" ? raw.reason.slice(0, 300) : null,
  };
}
