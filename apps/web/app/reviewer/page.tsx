import { cookies, headers } from "next/headers";
import type { AppShellView } from "../../../../packages/ui/src/index.js";
import { AppShell } from "../../components/AppShell.js";
import { hostFetch, isSessionExpired } from "../../lib/host-fetch.js";
import { reviewerMessage, workbenchPath } from "../../lib/reviewer.js";
import { SessionExpiredPage } from "../session-expired/page.js";

type QueueView = {
  shell: AppShellView;
  reviews: Array<{ reviewScope: string; normalized: number; rejected: number }>;
};

function readReasonCode(bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText) as { reason_code?: unknown };
    return typeof parsed.reason_code === "string" ? parsed.reason_code : "evidence_access_denied";
  } catch {
    return "evidence_access_denied";
  }
}

/**
 * Server Component: the reviewer's work queue (P3). Lists the reviews of the
 * reviewer's tenant that have normalized submissions, each linking to its
 * workbench.
 */
export default async function ReviewerQueuePage() {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const result = await hostFetch({
    path: "/web/reviewer/queue",
    cookie: cookieStore.toString(),
    forwardedFor: headerStore.get("x-forwarded-for")
  });
  if (isSessionExpired(result)) {
    return <SessionExpiredPage />;
  }
  if (result.status !== 200) {
    return (
      <main className="min-h-screen bg-surface-base text-ink-primary">
        <h1>Reviewer queue</h1>
        <p role="alert">{reviewerMessage(readReasonCode(result.bodyText))}</p>
        <a href="/">Back to the dashboard</a>
      </main>
    );
  }
  const data = JSON.parse(result.bodyText) as QueueView;
  return (
    <AppShell view={data.shell}>
      <h1>Reviewer queue</h1>
      {data.reviews.length === 0 ? (
        <p data-slot="queue-empty">No review has a normalized submission yet.</p>
      ) : (
        <ul data-slot="reviewer-queue">
          {data.reviews.map((review) => (
            <li key={review.reviewScope}>
              <a href={workbenchPath(review.reviewScope)}>{review.reviewScope}</a>
              {` (${review.normalized} normalized, ${review.rejected} not normalized)`}
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
