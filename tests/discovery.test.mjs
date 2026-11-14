// Run with `npm test` (Node 22.18+ runs the TypeScript sources directly).
import assert from "node:assert/strict";
import { test } from "node:test";

import { htmlToText } from "../lib/extractor/htmlText.ts";
import { isAllowedByRobots } from "../lib/extractor/robots.ts";
import { dayTypeFor, numbersIn, quoteInText, verifyExtraction } from "../lib/extractor/verify.ts";
import {
  CA_COUNTIES,
  OPPORTUNITY_KINDS,
  QUERY_COUNT,
  canonicalUrl,
  hostMatches,
  queryAt,
  seasonYear,
} from "../lib/discovery/queries.ts";

// A made-up page, used only as a test fixture. It is not event data.
const PAGE = {
  url: "https://example.org/vendors",
  links: ["https://example.org/files/vendor-app.pdf", "https://example.org/contact"],
  text: `2027 Example Harvest Festival
Vendor Applications Now Open
Saturday, October 9 and Sunday, October 10, 2027 at Example Park, 100 Main Street, Exampleville, CA
Food vendor booth (10x10): $350 for the weekend. Non-food booths are $1,250.50.
Electricity is an additional $40.
Applications are due August 1, 2027. A $25 non-refundable jury fee applies.
The festival keeps 10% of gross food sales.
Last year more than 12,000 people attended.`,
};
const PDF = {
  url: "https://example.org/files/vendor-app.pdf",
  links: [],
  text: "Vendor Application\nBooth  space  is limited to\n60 vendors. Only two vendors per beverage category.",
};
const field = (value, quote, doc = 1) => ({ value, quote, doc });

test("keeps facts whose quotes are in the source", () => {
  const out = verifyExtraction(
    {
      is_vendor_opportunity: true,
      fields: {
        name: field("Example Harvest Festival", "2027 Example Harvest Festival"),
        event_type: { value: "festival" },
        city: field("Exampleville", "at Example Park, 100 Main Street, Exampleville, CA"),
        venue: field("Example Park", "at Example Park, 100 Main Street, Exampleville, CA"),
        start_date: field("2027-10-09", "Saturday, October 9 and Sunday, October 10, 2027"),
        end_date: field("2027-10-10", "Saturday, October 9 and Sunday, October 10, 2027"),
        application_deadline: field("2027-08-01", "Applications are due August 1, 2027."),
        booth_fee_min: field(350, "Food vendor booth (10x10): $350 for the weekend."),
        booth_fee_max: field(1250.5, "Non-food booths are $1,250.50."),
        electricity_fee: field(40, "Electricity is an additional $40."),
        application_fee: field(25, "A $25 non-refundable jury fee applies."),
        fee_pct_of_sales: field(10, "The festival keeps 10% of gross food sales."),
        expected_attendance: field(12000, "Last year more than 12,000 people attended."),
        vendor_spots: field(60, "Booth space is limited to 60 vendors.", 2),
        similar_vendor_limit: field("Two vendors per beverage category", "Only two vendors per beverage category.", 2),
        apply_url: { value: "https://example.org/files/vendor-app.pdf" },
      },
    },
    [PAGE, PDF],
  );
  assert.deepEqual(out.dropped, []);
  assert.equal(out.event.name, "Example Harvest Festival");
  assert.equal(out.event.event_type, "festival");
  assert.equal(out.event.booth_fee_min, 350);
  assert.equal(out.event.booth_fee_max, 1250.5);
  assert.equal(out.event.fee_pct_of_sales, 10);
  assert.equal(out.event.expected_attendance, 12000);
  assert.equal(out.event.vendor_spots, 60);
  assert.equal(out.event.day_type, "weekend");
  assert.equal(out.event.apply_url, PDF.url);
  assert.equal(out.event.source_url, PAGE.url);
  assert.equal(out.evidence.vendor_spots.url, PDF.url); // quote wrapped across lines in the PDF
  assert.equal(out.hasPricing, true);
});

test("drops anything the source doesn't back up", () => {
  const out = verifyExtraction(
    {
      fields: {
        name: field("Example Harvest Festival", "2027 Example Harvest Festival"),
        // Quote isn't on the page.
        booth_fee_min: field(200, "Booths are $200 each."),
        // Quote is real, but the figure isn't in it.
        electricity_fee: field(75, "Electricity is an additional $40."),
        // Real quote, wrong day.
        application_deadline: field("2027-08-15", "Applications are due August 1, 2027."),
        // Real quote, wrong year.
        start_date: field("2028-10-09", "Saturday, October 9 and Sunday, October 10, 2027"),
        // Value's words aren't in the quote.
        city: field("Springfield", "at Example Park, 100 Main Street, Exampleville, CA"),
        // No quote at all.
        expected_attendance: { value: 50000 },
        // A link that isn't in any document.
        apply_url: { value: "https://evil.example/apply" },
        event_type: { value: "carnival" },
      },
    },
    [PAGE, PDF],
  );
  assert.deepEqual(out.dropped.sort(), [
    "application_deadline", "apply_url", "booth_fee_min", "city",
    "electricity_fee", "expected_attendance", "start_date",
  ]);
  assert.equal(out.event.booth_fee_min, null);
  assert.equal(out.event.booth_fee_max, null);
  assert.equal(out.event.city, null);
  assert.equal(out.event.apply_url, null);
  assert.equal(out.event.event_type, "other");
  assert.equal(out.event.day_type, null);
  assert.equal(out.hasPricing, false);
});

test("an unverified name makes the candidate unusable", () => {
  const out = verifyExtraction({ fields: { name: field("Totally Different Fair", "Totally Different Fair") } }, [PAGE]);
  assert.equal(out.event, null);
});

test("a single fee fills both ends; a zero fee needs the source to say free", () => {
  const one = verifyExtraction(
    { fields: { name: field("Example Harvest Festival", "2027 Example Harvest Festival"), booth_fee_max: field(350, "Food vendor booth (10x10): $350 for the weekend.") } },
    [PAGE],
  );
  assert.equal(one.event.booth_fee_min, 350);
  assert.equal(one.evidence.booth_fee_min.quote, one.evidence.booth_fee_max.quote);

  const zero = verifyExtraction(
    { fields: { name: field("Example Harvest Festival", "2027 Example Harvest Festival"), booth_fee_min: field(0, "Electricity is an additional $40.") } },
    [PAGE],
  );
  assert.equal(zero.event.booth_fee_min, null);
});

test("survives malformed model output", () => {
  for (const raw of [{}, { fields: null }, { fields: { name: null, city: "x", booth_fee_min: { value: "abc", quote: 5 } } }]) {
    assert.equal(verifyExtraction(raw, [PAGE]).event, null);
  }
});

test("text helpers", () => {
  assert.deepEqual(numbersIn("$1,250.50 or 10k, 2 million"), [1250.5, 10000, 2000000]);
  assert.equal(quoteInText("“Vendor   applications now OPEN”", PAGE.text), true);
  assert.equal(quoteInText("$40", PAGE.text), false); // too short to prove anything
  assert.equal(dayTypeFor("2027-10-09", "2027-10-10"), "weekend");
  assert.equal(dayTypeFor("2027-10-06", null), "weekday");
  assert.equal(dayTypeFor("2027-10-08", "2027-10-10"), "mixed");
  assert.equal(dayTypeFor(null, null), null);
});

test("htmlToText keeps text and links, drops scripts", () => {
  const { title, text, links } = htmlToText(
    `<html><head><title>Vendors &amp; Exhibitors</title><style>p{}</style></head><body>
     <script>var fee = "$999";</script><h1>Booth fees</h1><p>10&#215;10 space: &#36;150&nbsp;per day</p>
     <table><tr><td>Food</td><td>$300</td></tr></table>
     <a href="/apply.pdf">Vendor <b>application</b></a></body></html>`,
  );
  assert.equal(title, "Vendors & Exhibitors");
  assert.match(text, /10×10 space: \$150 per day/);
  assert.match(text, /Food \| \$300/);
  assert.doesNotMatch(text, /999/);
  assert.deepEqual(links, [{ href: "/apply.pdf", text: "Vendor application" }]);
});

test("robots.txt rules", () => {
  const robots = `User-agent: *\nDisallow: /private/\nAllow: /private/vendors\nDisallow: /*.pdf$\n\nUser-agent: BoothfinderBot\nDisallow: /no-bots/`;
  const ua = "BoothfinderBot/0.1";
  assert.equal(isAllowedByRobots(robots, "/vendors", ua), true);
  assert.equal(isAllowedByRobots(robots, "/no-bots/x", ua), false);
  assert.equal(isAllowedByRobots(robots, "/private/x", ua), true); // our own group replaces *
  assert.equal(isAllowedByRobots(robots, "/private/x", "OtherBot"), false);
  assert.equal(isAllowedByRobots(robots, "/private/vendors", "OtherBot"), true);
  assert.equal(isAllowedByRobots(robots, "/files/app.pdf", "OtherBot"), false);
  assert.equal(isAllowedByRobots("", "/anything", ua), true);
});

test("queries cover every county and kind once per cycle", () => {
  assert.equal(CA_COUNTIES.length, 58);
  assert.equal(new Set(CA_COUNTIES).size, 58);
  assert.equal(QUERY_COUNT, 58 * OPPORTUNITY_KINDS.length);
  const all = new Set(Array.from({ length: QUERY_COUNT }, (_, i) => queryAt(i, 2027)));
  assert.equal(all.size, QUERY_COUNT);
  assert.equal(queryAt(QUERY_COUNT, 2027), queryAt(0, 2027));
  assert.match(queryAt(0, 2027), /^San Luis Obispo County, California 2027 county fair /);
  assert.equal(seasonYear(new Date("2026-11-14T00:00:00Z")), 2027);
  assert.equal(seasonYear(new Date("2027-03-01T00:00:00Z")), 2027);
});

test("url helpers", () => {
  assert.equal(canonicalUrl("https://a.org/v?utm_source=x&year=2027&fbclid=1#top"), "https://a.org/v?year=2027");
  assert.equal(canonicalUrl("mailto:a@b.org"), null);
  assert.equal(hostMatches("www.facebook.com", "facebook.com"), true);
  assert.equal(hostMatches("notfacebook.com", "facebook.com"), false);
});
