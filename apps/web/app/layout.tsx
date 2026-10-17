import type { ReactNode } from "react";
import { headers } from "next/headers";
import { APP_TITLE } from "../src/app-title.js";
import { RootLayout } from "../src/root-layout.js";
import "./globals.css";

export const metadata = {
  title: APP_TITLE,
  description: "CodeAttest review evidence and attestation records."
};

// Reading request headers makes every page render per request, which the
// per-request CSP nonce from proxy.ts needs.
export default async function Layout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return <RootLayout nonce={nonce}>{children}</RootLayout>;
}
