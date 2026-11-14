/**
 * Tuning for the discovery pipeline. Change limits, blocked sites, and keyword
 * signals here. The search queries themselves live in ./queries.ts.
 */

export const DISCOVERY_LIMITS = {
  /** Search queries per run. 290 queries exist, so a daily run covers the state in ~7 weeks. */
  queriesPerRun: 6,
  resultsPerQuery: 6,
  /** Pages sent to the AI per run. This is the cost ceiling for one run. */
  maxPagesPerRun: 18,
  /** Linked vendor applications or fee sheets read alongside each page. */
  relatedDocsPerPage: 3,
  /** Stop starting new pages after this long, to finish inside the function limit. */
  maxRunMs: 230_000,
};

/**
 * Sites we don't read. Social networks and review sites aren't organizer
 * sources; paid vendor-listing databases sell this data and their terms don't
 * allow copying it. We store facts from the organizer's own pages and link back
 * (MASTER.md §8).
 */
export const BLOCKED_DOMAINS = [
  "facebook.com", "instagram.com", "x.com", "twitter.com", "tiktok.com", "youtube.com",
  "linkedin.com", "pinterest.com", "reddit.com", "nextdoor.com", "yelp.com",
  "tripadvisor.com", "craigslist.org", "wikipedia.org", "eventbrite.com", "meetup.com",
  "festivalnet.com", "fairsandfestivals.net", "eventlister.com",
  "indeed.com", "glassdoor.com", "amazon.com", "etsy.com", "google.com",
];

/** A page must mention vendors AND something about applying or paying, or it isn't sent to the AI. */
export const VENDOR_SIGNAL = /\b(vendors?|exhibitors?|booths?|concession(aire)?s?|stalls?)\b/i;
export const APPLY_SIGNAL = /\b(appl(y|ication|ications)|fees?|deadline|register|registration|space rental)\b|\$\s?\d/i;

/** Links worth following from a page: the vendor application, handbook, packet, or fee sheet. */
export const RELATED_LINK_SIGNAL =
  /vendor|exhibitor|booth|concession|commercial|application|apply|handbook|packet|guidelines|rules|fees?\b|rates|pricing/i;
/** Of those, the ones most likely to hold the actual prices are read first. */
export const PRICING_LINK_SIGNAL = /handbook|packet|fees?\b|rates|pricing|guidelines|rules|info/i;
/** Links that match the words above but are for someone other than vendors. */
export const NOT_VENDOR_LINK = /entertain|performer|musician|sponsor|volunteer|donat|ticket|parking|map\b/i;
