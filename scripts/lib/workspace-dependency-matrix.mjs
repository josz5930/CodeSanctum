// Single source of truth for the `@onevps/*` dependency-direction policy
// documented in README.md's "Dependency Direction" section: protocol-ts must
// have no @onevps/* dependencies, and every other workspace may depend on
// protocol-ts only (unless explicitly listed otherwise below). Shared by
// scripts/check-all-workspace-boundaries.mjs (package-metadata edges) and
// scripts/check-workspace-boundary.mjs (tsconfig path-bearing fields) so the
// two enforcement points cannot drift apart.
export const ALLOWED_DIRECT_ONEVPS_TARGETS = {
  "@onevps/protocol-ts": new Set(),
  "@onevps/host": new Set([
    "@onevps/control-plane",
    "@onevps/evidence-store",
    "@onevps/identity-store",
    "@onevps/intake-service",
    "@onevps/protocol-ts",
    "@onevps/signing",
    "@onevps/ui"
  ]),
  "@onevps/web": new Set([
    "@onevps/protocol-ts",
    "@onevps/ui"
  ])
};
export const DEFAULT_ALLOWED_DIRECT_TARGETS = new Set(["@onevps/protocol-ts"]);

export function allowedOnevpsTargetsFor(packageName) {
  return ALLOWED_DIRECT_ONEVPS_TARGETS[packageName] ?? DEFAULT_ALLOWED_DIRECT_TARGETS;
}
