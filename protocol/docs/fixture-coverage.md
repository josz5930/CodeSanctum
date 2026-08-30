# Protocol Fixture Coverage

The fixture corpus treats schema rejection and live enum behavior as separate coverage obligations.

- Every artifact schema that carries a UTC RFC 3339 timestamp has an indexed calendar-invalid negative fixture. The matrix cycles through February 30, April 31, and February 29 in a non-leap year so the calendar-aware validator remains load-bearing beyond the timestamp regex.
- Every artifact schema containing an `enum` has an indexed invalid-enum negative fixture. These fixtures require the schema validator's `enum` failure code; unrelated missing-required-field errors do not satisfy the check.
- The live-value matrix singled out by [C1-09] covers every local-runner stage, every stored-object kind, all three environment profiles, and every currently implemented review-event type.
- `review-event.event_type: key_rotation_recorded` is reserved. Protocol v0 has no key-rotation record schema, producer, artifact-reference family, or review-event binding for it, so a valid event fixture would fabricate producer behavior.
- `customer-facing-finding-record.visibility: internal_only` is intentionally not live. The customer-facing projection semantic invariant requires `customer_facing`; the indexed `internal-only-visibility` negative fixture proves that boundary.
- `customer_validation_evidence` and `remote_dynamic_testing_evidence` each have an independent verification-pass scope, a matching valid verification-evidence record, and a missing-validation-artifacts negative fixture.

`npm run fixtures:coverage` derives the timestamp and enum schema inventories and checks these live/reserved decisions against the indexed corpus.
