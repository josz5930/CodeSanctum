import type { ReactNode } from "react";
import { APP_TITLE } from "../src/app-title.js";
import { RootLayout } from "../src/root-layout.js";
import "./globals.css";

export const metadata = {
  title: APP_TITLE,
  description: "CodeAttest review evidence and attestation records."
};

export default function Layout({ children }: { children: ReactNode }) {
  return <RootLayout>{children}</RootLayout>;
}
