import { APP_TITLE } from "./app-title.js";

export function RootPage() {
  return (
    <main className="min-h-screen bg-surface-base text-ink-primary">
      <h1 className="text-ink-primary">{APP_TITLE}</h1>
    </main>
  );
}
