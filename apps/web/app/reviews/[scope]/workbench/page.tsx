import { cookies, headers } from "next/headers";
import type { AppShellView } from "../../../../../../packages/ui/src/index.js";
import { AppShell } from "../../../../components/AppShell.js";
import { ClassificationWorkbench, type WorkbenchDraftView } from "../../../../components/ClassificationWorkbench.js";
import { decodeRouteSegment, hostFetch, isSessionExpired } from "../../../../lib/host-fetch.js";
import { reviewerMessage } from "../../../../lib/reviewer.js";
import { SessionExpiredPage } from "../../../session-expired/page.js";

type DraftSetView = {
  submissionAttemptId: string;
  draftSetDigest: string;
  available: boolean;
  reason?: string;
  normalizationStatus?: string;
  noFindingsStatement?: string;
  limitations?: string[];
  drafts: WorkbenchDraftView[];
};

type WorkbenchResponse = {
  shell: AppShellView;
  reviewScope: string;
  draftSets: DraftSetView[];
  rejectedNormalizations: Array<{ submissionAttemptId: string; reason: string }>;
};

function readReasonCode(bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText) as { reason_code?: unknown };
    return typeof parsed.reason_code === "string" ? parsed.reason_code : "evidence_access_denied";
  } catch {
    return "evidence_access_denied";
  }
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Server Component: the reviewer workbench for `[scope]` (P3). Lists every
 * normalized draft set the worker stored for the review and renders each
 * draft through the classification-workbench contract with a form that
 * records a classification. A refused request shows why instead of a blank page.
 */
export default async function WorkbenchPage({
  params,
  searchParams
}: {
  params: Promise<{ scope: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const scope = decodeRouteSegment((await params).scope);
  const query = await searchParams;
  const cookieStore = await cookies();
  const headerStore = await headers();
  const result = await hostFetch({
    path: `/web/reviewer/reviews/${encodeURIComponent(scope)}/drafts`,
    cookie: cookieStore.toString(),
    forwardedFor: headerStore.get("x-forwarded-for")
  });
  if (isSessionExpired(result)) {
    return <SessionExpiredPage />;
  }
  if (result.status !== 200) {
    return (
      <main className="min-h-screen bg-surface-base text-ink-primary">
        <h1>Reviewer workbench</h1>
        <p role="alert">{reviewerMessage(readReasonCode(result.bodyText))}</p>
        <a href="/">Back to the dashboard</a>
      </main>
    );
  }
  const data = JSON.parse(result.bodyText) as WorkbenchResponse;
  const saved = firstValue(query.saved);
  const error = firstValue(query.error);
  return (
    <AppShell view={data.shell}>
      <div className="p-ca-4">
        <h1 className="text-2xl font-semibold">Reviewer workbench</h1>
        <p data-slot="review-scope" className="font-mono">{data.reviewScope}</p>
        {saved === undefined ? null : <p role="status" data-slot="workbench-saved">Classification recorded for {saved}.</p>}
        {error === undefined ? null : <p role="alert" data-slot="workbench-error">{reviewerMessage(error)}</p>}
        {data.draftSets.length === 0 && data.rejectedNormalizations.length === 0 ? (
          <p data-slot="workbench-empty">No submission for this review has been normalized yet.</p>
        ) : null}
        {data.rejectedNormalizations.length === 0 ? null : (
          <section data-slot="rejected-normalizations" className="mt-ca-4">
            <h2 className="text-xl font-semibold">Submissions that could not be normalized</h2>
            <ul>
              {data.rejectedNormalizations.map((rejected) => (
                <li key={rejected.submissionAttemptId}>
                  {rejected.submissionAttemptId}: {rejected.reason}
                </li>
              ))}
            </ul>
          </section>
        )}
        {data.draftSets.map((set) => (
          <section key={set.draftSetDigest} data-slot="draft-set" data-draft-set-digest={set.draftSetDigest} className="mt-ca-4">
            <h2 className="text-xl font-semibold">Submission {set.submissionAttemptId}</h2>
            {!set.available ? (
              <p role="alert">{reviewerMessage(set.reason ?? "evidence_unavailable")}</p>
            ) : (
              <>
                {set.noFindingsStatement === undefined ? null : <p>{set.noFindingsStatement}</p>}
                {(set.limitations ?? []).length === 0 ? null : (
                  <ul data-slot="normalization-limitations">
                    {(set.limitations ?? []).map((limitation, index) => (
                      <li key={index}>{limitation}</li>
                    ))}
                  </ul>
                )}
                {set.drafts.map((draft) => (
                  <ClassificationWorkbench key={draft.draftRef} view={draft} reviewScope={data.reviewScope} draftSetDigest={set.draftSetDigest} />
                ))}
              </>
            )}
          </section>
        ))}
      </div>
    </AppShell>
  );
}
