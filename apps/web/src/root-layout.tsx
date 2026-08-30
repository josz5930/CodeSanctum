import type { ReactNode } from "react";
import { codeAttestTokenStyle, reducedMotionCss } from "./token-bridge.js";

export function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" style={codeAttestTokenStyle()}>
      <body className="bg-surface-base text-ink-primary font-product">
        <style>{reducedMotionCss()}</style>
        {children}
      </body>
    </html>
  );
}
