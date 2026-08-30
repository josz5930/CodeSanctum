import type { CSSProperties } from "react";
import { codeAttestDesignTokens } from "../../../packages/ui/src/index.js";

export function codeAttestTokenStyle(): CSSProperties {
  const colors = codeAttestDesignTokens.colors;
  const spacing = codeAttestDesignTokens.spacingPx;
  const radii = codeAttestDesignTokens.radiiPx;
  const accessibility = codeAttestDesignTokens.accessibility;
  return {
    "--ca-surface-base": colors.surfaceBase,
    "--ca-surface-raised": colors.surfaceRaised,
    "--ca-surface-subtle": colors.surfaceSubtle,
    "--ca-surface-inset": colors.surfaceInset,
    "--ca-ink-primary": colors.inkPrimary,
    "--ca-ink-secondary": colors.inkSecondary,
    "--ca-ink-muted": colors.inkMuted,
    "--ca-ink-disabled": colors.inkDisabled,
    "--ca-border-hairline": colors.borderHairline,
    "--ca-border-strong": colors.borderStrong,
    "--ca-primary": colors.primary,
    "--ca-primary-foreground": colors.primaryForeground,
    "--ca-verification": colors.verification,
    "--ca-verification-foreground": colors.verificationForeground,
    "--ca-review": colors.review,
    "--ca-review-foreground": colors.reviewForeground,
    "--ca-warning": colors.warning,
    "--ca-warning-surface": colors.warningSurface,
    "--ca-warning-foreground": colors.warningForeground,
    "--ca-risk": colors.risk,
    "--ca-risk-surface": colors.riskSurface,
    "--ca-risk-foreground": colors.riskForeground,
    "--ca-neutral-badge": colors.neutralBadge,
    "--ca-neutral-badge-foreground": colors.neutralBadgeForeground,
    "--ca-code-surface": colors.codeSurface,
    "--ca-code-foreground": colors.codeForeground,
    "--ca-font-product": codeAttestDesignTokens.typography.product,
    "--ca-font-mono": codeAttestDesignTokens.typography.mono,
    "--ca-spacing-1": `${spacing[1]}px`,
    "--ca-spacing-2": `${spacing[2]}px`,
    "--ca-spacing-3": `${spacing[3]}px`,
    "--ca-spacing-4": `${spacing[4]}px`,
    "--ca-spacing-5": `${spacing[5]}px`,
    "--ca-spacing-6": `${spacing[6]}px`,
    "--ca-spacing-8": `${spacing[8]}px`,
    "--ca-spacing-10": `${spacing[10]}px`,
    "--ca-spacing-12": `${spacing[12]}px`,
    "--ca-gutter-mobile": `${spacing.gutterMobile}px`,
    "--ca-gutter-desktop": `${spacing.gutterDesktop}px`,
    "--ca-page-max": `${spacing.pageMax}px`,
    "--ca-radius-sm": `${radii.sm}px`,
    "--ca-radius-md": `${radii.md}px`,
    "--ca-radius-lg": `${radii.lg}px`,
    "--ca-radius-full": `${radii.full}px`,
    "--ca-min-target": `${accessibility.minimumTargetSizePx}px`,
    "--ca-focus-ring-width": `${accessibility.focusRingWidthPx}px`,
    "--ca-focus-ring": accessibility.focusRingColor
  } as CSSProperties;
}

export function reducedMotionCss(): string {
  return `@media ${codeAttestDesignTokens.motion.prefersReducedMotionMediaQuery}{*,*::before,*::after{animation-duration:0.01ms!important;animation-iteration-count:1!important;transition-duration:0.01ms!important;scroll-behavior:auto!important}}`;
}
