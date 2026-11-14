import type { Metadata } from "next";
import PageContainer from "@/components/ui/PageContainer";
import ReviewQueue from "@/components/discovery/ReviewQueue";

export const metadata: Metadata = { title: "Discovery review", robots: { index: false } };

// Team-only page: review vendor opportunities the discovery pipeline found before
// they become events. Everything behind it needs the DISCOVERY_ADMIN_TOKEN.
export default function DiscoveryReviewPage() {
  return (
    <PageContainer>
      <h1 className="text-3xl font-bold tracking-tight">Discovery review</h1>
      <p className="mt-2 max-w-prose text-neutral-300">
        Vendor opportunities found on California organizer sites. Each fact is shown with
        the words it came from. Approve one to add it to the vendor map; nothing is
        published without a review.
      </p>
      <div className="mt-8">
        <ReviewQueue />
      </div>
    </PageContainer>
  );
}
