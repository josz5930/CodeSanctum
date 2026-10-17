import type { ReactNode } from "react";
import { codeAttestTokenCss, reducedMotionCss } from "./token-bridge.js";

/**
 * The design tokens are a `:root` rule in the one `<style>` element, not a
 * `style` attribute on `<html>`: the Content-Security-Policy allows inline
 * styles only by nonce, and a nonce cannot be put on a `style` attribute.
 */
export function RootLayout({ children, nonce }: { children: ReactNode; nonce?: string | undefined }) {
  return (
    <html lang="en">
      <body className="bg-surface-base text-ink-primary font-product">
        <style nonce={nonce}>{`${codeAttestTokenCss()}${reducedMotionCss()}`}</style>
        {children}
      </body>
    </html>
  );
}
