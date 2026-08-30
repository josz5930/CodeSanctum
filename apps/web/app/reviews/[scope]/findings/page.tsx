import { cookies } from "next/headers";
import type {
  AppShellView,
  CustomerFindingRecordViewContract,
  VerificationPassScopeViewContract
} from "../../../../../../packages/ui/src/index.js";
import { AppShell } from "../../../../components/AppShell.js";
import { CustomerFindingRecord } from "../../../../components/CustomerFindingRecord.js";
import { VerificationPassScope } from "../../../../components/VerificationPassScope.js";
import { hostFetch, isSessionExpired } from "../../../../lib/host-fetch.js";
import { SessionExpiredPage } from "../../../session-expired/page.js";

type FindingsView = {
  shell: AppShellView;
  reviewScope: string;
  findings: CustomerFindingRecordViewContract[];
  verificationScope: VerificationPassScopeViewContract | null;
};

/**
 * Server Component: renders the customer finding records and the verification
 * pass scope for `[scope]`, read-only (E-11).
 */
export default async function FindingsPage({ params }: { params: Promise<{ scope: string }> }) {
  const { scope } = await params;
  const cookieStore = await cookies();
  const result = await hostFetch({
    path: `/web/reviews/${encodeURIComponent(scope)}/findings`,
    cookie: cookieStore.toString()
  });
  if (isSessionExpired(result) || result.status !== 200) {
    return <SessionExpiredPage />;
  }
  const data = JSON.parse(result.bodyText) as FindingsView;
  return (
    <AppShell view={data.shell}>
      {data.verificationScope === null ? null : <VerificationPassScope view={data.verificationScope} />}
      <section>
        {data.findings.map((finding, index) => (
          <CustomerFindingRecord key={index} view={finding} />
        ))}
      </section>
    </AppShell>
  );
}
