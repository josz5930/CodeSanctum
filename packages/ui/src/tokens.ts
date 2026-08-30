/**
 * C6-27: `as const` is a TypeScript-only guarantee; without an explicit
 * runtime freeze, any consumer could mutate these shared, module-singleton
 * design tokens (colors, spacing, accessibility, motion) and corrupt every
 * later view built from them. `deepFreeze` below freezes every nested object.
 */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

export const codeAttestDesignTokens = deepFreeze({
  colors: {
    surfaceBase: "#F7F8FA",
    surfaceRaised: "#FFFFFF",
    surfaceSubtle: "#EEF2F6",
    surfaceInset: "#E6EBF2",
    inkPrimary: "#111827",
    inkSecondary: "#374151",
    inkMuted: "#6B7280",
    inkDisabled: "#9CA3AF",
    borderHairline: "#D9E0EA",
    borderStrong: "#A8B3C5",
    primary: "#1E3A8A",
    primaryForeground: "#FFFFFF",
    verification: "#047857",
    verificationForeground: "#FFFFFF",
    review: "#0369A1",
    reviewForeground: "#FFFFFF",
    warning: "#B45309",
    warningSurface: "#FFF7ED",
    warningForeground: "#7C2D12",
    risk: "#B91C1C",
    riskSurface: "#FEF2F2",
    riskForeground: "#7F1D1D",
    neutralBadge: "#E5E7EB",
    neutralBadgeForeground: "#1F2937",
    codeSurface: "#111827",
    codeForeground: "#F9FAFB"
  },
  typography: {
    product: "Inter, ui-sans-serif, system-ui, sans-serif",
    mono: "JetBrains Mono, SFMono-Regular, Consolas, monospace"
  },
  spacingPx: {
    1: 4,
    2: 8,
    3: 12,
    4: 16,
    5: 20,
    6: 24,
    8: 32,
    10: 40,
    12: 48,
    gutterMobile: 16,
    gutterDesktop: 24,
    pageMax: 1180
  },
  radiiPx: {
    sm: 4,
    md: 6,
    lg: 8,
    full: 9999
  },
  components: {
    appShell: "app-shell",
    receiptBanner: "receipt-banner",
    riskWarning: "risk-warning",
    statusPill: "status-pill",
    evidenceCard: "evidence-card",
    timelineEvent: "timeline-event"
  },
  accessibility: {
    minimumTargetSizePx: 44,
    focusRingWidthPx: 2,
    focusRingColor: "#1E3A8A",
    focusRingContrastTarget: 3
  },
  motion: {
    prefersReducedMotionMediaQuery: "(prefers-reduced-motion: reduce)",
    nonessentialMotion: "disabled-or-replaced"
  }
} as const);

export type CodeAttestDesignTokens = typeof codeAttestDesignTokens;
export type CodeAttestColorRole = "neutral" | "primary" | "verification" | "review" | "warning" | "risk";

export function colorTokensForRole(role: CodeAttestColorRole): { foreground: string; background: string; border?: string } {
  switch (role) {
    case "neutral":
      return {
        foreground: codeAttestDesignTokens.colors.neutralBadgeForeground,
        background: codeAttestDesignTokens.colors.neutralBadge
      };
    case "primary":
      return {
        foreground: codeAttestDesignTokens.colors.primaryForeground,
        background: codeAttestDesignTokens.colors.primary
      };
    case "verification":
      return {
        foreground: codeAttestDesignTokens.colors.verificationForeground,
        background: codeAttestDesignTokens.colors.verification
      };
    case "review":
      return {
        foreground: codeAttestDesignTokens.colors.reviewForeground,
        background: codeAttestDesignTokens.colors.review
      };
    case "warning":
      return {
        foreground: codeAttestDesignTokens.colors.warningForeground,
        background: codeAttestDesignTokens.colors.warningSurface,
        border: codeAttestDesignTokens.colors.warning
      };
    case "risk":
      return {
        foreground: codeAttestDesignTokens.colors.riskForeground,
        background: codeAttestDesignTokens.colors.riskSurface,
        border: codeAttestDesignTokens.colors.risk
      };
    default:
      throw new Error(`Unknown CodeAttest color role: ${String(role)}`);
  }
}
