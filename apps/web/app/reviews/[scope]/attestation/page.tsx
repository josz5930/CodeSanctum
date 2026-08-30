import { cookies } from "next/headers";
import type {
  AppShellView,
  AttestationBuilderViewContract,
  AttestationFinalizationViewContract,
  StaticBundleGenerationViewContract,
  SupportingEvidenceMappingViewContract
} from "../../../../../../packages/ui/src/index.js";
import { AppShell } from "../../../../components/AppShell.js";
import { AttestationBuilder } from "../../../../components/AttestationBuilder.js";
import { AttestationFinalization } from "../../../../components/AttestationFinalization.js";
import { StaticBundleGeneration } from "../../../../components/StaticBundleGeneration.js";
import { SupportingEvidenceMapping } from "../../../../components/SupportingEvidenceMapping.js";
import { hostFetch, isSessionExpired } from "../../../../lib/host-fetch.js";
import { SessionExpiredPage } from "../../../session-expired/page.js";

type AttestationPageView = {
  shell: AppShellView;
  reviewScope: string;
  attestation: AttestationBuilderViewContract;
  finalization: AttestationFinalizationViewContract;
  supportingEvidenceMapping: SupportingEvidenceMappingViewContract | null;
  staticBundle: StaticBundleGenerationViewContract;
};

/**
 * Server Component: renders the attestation, finalization confirmation,
 * supporting-evidence mapping, and static-bundle surfaces for `[scope]`,
 * read-only (E-11).
 */
export default async function AttestationPage({ params }: { params: Promise<{ scope: string }> }) {
  const { scope } = await params;
  const cookieStore = await cookies();
  const result = await hostFetch({
    path: `/web/reviews/${encodeURIComponent(scope)}/attestation`,
    cookie: cookieStore.toString()
  });
  if (isSessionExpired(result) || result.status !== 200) {
    return <SessionExpiredPage />;
  }
  const data = JSON.parse(result.bodyText) as AttestationPageView;
  return (
    <AppShell view={data.shell}>
      <AttestationBuilder view={data.attestation} />
      <AttestationFinalization view={data.finalization} />
      {data.supportingEvidenceMapping === null ? null : (
        <SupportingEvidenceMapping view={data.supportingEvidenceMapping} />
      )}
      <StaticBundleGeneration view={data.staticBundle} />
    </AppShell>
  );
}
