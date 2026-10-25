/**
 * DOM attributes every actionable adapter element carries, so the render tests
 * can assert the 44px target, focus-ring hook, and reduced-motion honoring at
 * the boundary — the same guarantees `packages/ui` bakes into its contracts.
 * `hoverOnly` is always surfaced as a string so a hover-only action is visible
 * (and forbidden) in the static markup; positive `tabIndex` is never emitted.
 *
 * The minimum size is applied by `app/globals.css` through the
 * `data-min-target-size-px` attribute. It is not a `style` attribute: a style
 * attribute cannot carry the CSP nonce, so the browser would ignore it.
 */
export function actionableAttributes(input: { minTargetSizePx: number; hoverOnly?: boolean }): {
  "data-min-target-size-px": number;
  "data-focus-ring": "visible";
  "data-reduced-motion": "respected";
  "data-hover-only": string;
} {
  return {
    "data-min-target-size-px": input.minTargetSizePx,
    "data-focus-ring": "visible",
    "data-reduced-motion": "respected",
    "data-hover-only": String(input.hoverOnly ?? false)
  };
}
