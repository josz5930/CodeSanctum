import { cookies } from "next/headers";
import type {
  AppShellView,
  EvidenceCardView,
  ReceiptBannerView,
  RiskWarningView,
  StatusPillView,
  TimelineEventView
} from "../../../../../packages/ui/src/index.js";
import { AppShell } from "../../../components/AppShell.js";
import { EvidenceCard } from "../../../components/EvidenceCard.js";
import { ReceiptBanner } from "../../../components/ReceiptBanner.js";
import { RiskWarning } from "../../../components/RiskWarning.js";
import { StatusPill } from "../../../components/StatusPill.js";
import { TimelineEvent } from "../../../components/TimelineEvent.js";
import { hostFetch, isSessionExpired } from "../../../lib/host-fetch.js";
import { SessionExpiredPage } from "../../session-expired/page.js";

type ReviewDetailView = {
  shell: AppShellView;
  reviewScope: string;
  reviewState: StatusPillView;
  receipt: ReceiptBannerView | null;
  noReceipt: RiskWarningView | null;
  timeline: TimelineEventView[];
  evidence: EvidenceCardView[];
};

/**
 * Server Component: fetches the projected review detail for `[scope]` with the
 * session cookie forwarded, then renders it through the adapters. A 401 (or any
 * non-200 the actor cannot resolve) falls back to the session-expired state.
 */
export default async function ReviewDetailPage({ params }: { params: Promise<{ scope: string }> }) {
  const { scope } = await params;
  const cookieStore = await cookies();
  const result = await hostFetch({
    path: `/web/reviews/${encodeURIComponent(scope)}`,
    cookie: cookieStore.toString()
  });
  if (isSessionExpired(result) || result.status !== 200) {
    return <SessionExpiredPage />;
  }
  const data = JSON.parse(result.bodyText) as ReviewDetailView;
  return (
    <AppShell view={data.shell}>
      <StatusPill view={data.reviewState} />
      {data.receipt === null ? null : <ReceiptBanner view={data.receipt} />}
      {data.noReceipt === null ? null : <RiskWarning view={data.noReceipt} />}
      <ol>
        {data.timeline.map((event, index) => (
          <TimelineEvent key={index} view={event} />
        ))}
      </ol>
      <section>
        {data.evidence.map((card, index) => (
          <EvidenceCard key={index} view={card} />
        ))}
      </section>
    </AppShell>
  );
}
