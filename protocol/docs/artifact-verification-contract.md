# Artifact Verification Contract

Epic 2 intake verification must not trust stale metadata from manifest preview or bundle preparation. Any boundary that accepts a referenced artifact must verify the same bytes it is about to copy, sign, store, or compare.

For each artifact reference, verify:

1. `protocol_version` is accepted for the current gate.
2. `artifact_type` is allowed in the current environment and workflow stage.
3. `digest` is `sha256:<64 lowercase hex>` and matches the bytes read at the verification boundary.
4. `size_bytes` equals the byte length read at the verification boundary.
5. `source_derived_class` is allowed by the environment evidence gate.
6. `manifest_entry_ref` is present and matches the expected manifest/bundle category.
7. `content_path`, when present, is relative, slash-separated, non-empty, anchored by `content_path_anchor`, and rejects absolute paths, drive prefixes, backslashes, `.`, `..`, null bytes, and anchor escapes.
8. Raw Snippet or targeted-file artifacts must be explicitly allowed by the current environment evidence gate and, in synthetic/demo fixtures, must carry `SYNTHETIC_DEMO_DATA` and `NOT_CUSTOMER_SOURCE` markers.

Current runner bundle preparation already copies protocol artifacts and calls Rust verification helpers before final `bundle_manifest.json` and `signature-envelope.bundle.json` are written. The Story 2.0 prerequisite gate also exercises the Story 1.8 artifact-copy gate and the portable path semantic gate.

Future Story 2.2 intake code should reuse this checklist directly or mirror it with the same invariant ID: `bundle-artifact-copy-verification`.
