import { cookies } from "next/headers";
import type { StatusPillView, AppShellView } from "../../../../packages/ui/src/index.js";
import { AppShell } from "../../components/AppShell.js";
import { StatusPill } from "../../components/StatusPill.js";
import { hostFetch, isSessionExpired } from "../../lib/host-fetch.js";
import { SessionExpiredPage } from "../session-expired/page.js";

type ReviewListView = { shell: AppShellView; reviews: StatusPillView[] };

/**
 * Server Component: fetches the projected review list from the host `web` route
 * with the incoming session cookie forwarded, then renders it through the
 * adapters. A 401 renders the session-expired state (E-5, E-7).
 */
export default async function DashboardPage() {
  const cookieStore = await cookies();
  const result = await hostFetch({ path: "/web/reviews", cookie: cookieStore.toString() });
  if (isSessionExpired(result)) {
    return <SessionExpiredPage />;
  }
  const data = JSON.parse(result.bodyText) as ReviewListView;
  return (
    <AppShell view={data.shell}>
      <ul>
        {data.reviews.map((pill, index) => (
          <li key={index}>
            <StatusPill view={pill} />
          </li>
        ))}
      </ul>
    </AppShell>
  );
}
