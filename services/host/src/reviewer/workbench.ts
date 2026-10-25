import { createHash } from "node:crypto";

import {
  appendReviewEvent,
  buildFindingClassificationEvent,
  computeReviewEventId,
  type ReviewEvent
} from "../../../../apps/control-plane/src/index.js";
import {
  canonicalizeProtocolJson,
  validateProtocolSchema,
  type FindingClassificationRecord,
  type ReviewFindingDraftSet
} from "../../../../packages/protocol-ts/src/index.js";
import type { ReviewerWorkbenchDraftInput } from "../../../../packages/ui/src/index.js";

import type { StoredFindingClassification } from "./classification-store.js";

export type ReviewFindingDraft = ReviewFindingDraftSet["review_finding_drafts"][number];

/** The classification currently in force for one draft of one draft set. */
export type CurrentClassification = {
  record: FindingClassificationRecord;
  event_id: string;
};

/**
 * Draft ids come from the candidate findings, so the same id can appear in
 * the draft sets of two submission attempts. A classification belongs to the
 * draft set it was made against.
 */
export function draftKey(draftSetDigest: string, draftRef: string): string {
  return `${draftSetDigest}|${draftRef}`;
}

/**
 * Walks the review-event log in order and returns, per draft, the record that
 * the latest `classification_recorded` event names. A stored record whose
 * event never landed is never current, and a later event supersedes an
 * earlier one, so the log stays the only authority on what is in force.
 */
export function currentClassifications(
  events: readonly ReviewEvent[],
  stored: readonly StoredFindingClassification[]
): Map<string, CurrentClassification> {
  const byArtifactRef = new Map<string, StoredFindingClassification>();
  for (const entry of stored) {
    byArtifactRef.set(`artifact_ref:${entry.record.classification_record_id.slice("classification_record:".length)}`, entry);
  }
  const current = new Map<string, CurrentClassification>();
  for (const event of [...events].sort((left, right) => left.sequence_number - right.sequence_number)) {
    if (event.event_type !== "classification_recorded") {
      continue;
    }
    const entry = byArtifactRef.get(event.artifact_refs[0] ?? "");
    if (entry === undefined) {
      continue;
    }
    current.set(draftKey(entry.draft_set_digest, entry.record.review_finding_draft_ref), { record: entry.record, event_id: event.event_id });
  }
  return current;
}

export type ParsedDraftSet =
  | { ok: true; draftSet: ReviewFindingDraftSet }
  | { ok: false; reason: "evidence_unavailable" | "draft_set_review_mismatch" };

/**
 * Parses and schema-checks a stored draft set. The normalizer takes its
 * review id from the review scope inside the customer's bundle, so a bundle
 * built for another review yields a set that names that review. Such a set is
 * refused here with its own reason rather than classified under this one.
 */
export function parseDraftSet(bytes: Uint8Array, reviewId: string): ParsedDraftSet {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { ok: false, reason: "evidence_unavailable" };
  }
  if (validateProtocolSchema("urn:codeattest:protocol:v0:review-finding-draft-set", parsed).length > 0) {
    return { ok: false, reason: "evidence_unavailable" };
  }
  const draftSet = parsed as ReviewFindingDraftSet;
  return draftSet.review_id === reviewId ? { ok: true, draftSet } : { ok: false, reason: "draft_set_review_mismatch" };
}

export function workbenchDraftInput(draftSet: ReviewFindingDraftSet, draft: ReviewFindingDraft): ReviewerWorkbenchDraftInput {
  return {
    reviewFindingDraftId: draft.review_finding_draft_id,
    title: draft.scanner_rule_ids.join(", "),
    affectedArea: draft.affected_area,
    scannerContext: [
      ...draft.sources.map((source) => ({ label: "Scanner", value: source })),
      ...draft.scanner_rule_ids.map((rule) => ({ label: "Rule", value: rule })),
      ...(draft.severity === undefined ? [] : [{ label: "Scanner severity", value: draft.severity }]),
      ...(draft.confidence === undefined ? [] : [{ label: "Scanner confidence", value: draft.confidence }]),
      ...draft.candidate_finding_refs.map((ref) => ({ label: "Candidate finding", value: ref }))
    ],
    evidenceReferences: draft.evidence_refs.map((ref) => ({
      label: ref.available_for_review ? "Available evidence" : "Unavailable evidence",
      value: ref.artifact_ref,
      availabilityState: ref.display_state
    })),
    evidenceBasis: draft.evidence_basis,
    thresholdGaps: draft.threshold_gaps,
    limitations: draftSet.normalization_limitations,
    sourceReferenceState: draft.source_reference_state
  };
}

/** What a reviewer may choose. Everything that binds the record to evidence comes from the stored draft instead. */
export type ClassificationInput = {
  classification: FindingClassificationRecord["classification"];
  rationale: string;
  confirmation_criteria?: string[];
  defensible_confirmation_criteria?: string;
  threshold_gaps?: string[];
  limitations?: string[];
  validation_path_summary?: string;
  visibility?: FindingClassificationRecord["visibility"];
};

function nonEmpty(values: readonly string[] | undefined): string[] | undefined {
  const kept = (values ?? []).map((value) => value.trim()).filter((value) => value.length > 0);
  return kept.length === 0 ? undefined : kept;
}

function optionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

/**
 * Builds the classification record from the reviewer's choices and the stored
 * draft. The evidence basis, evidence references, source reference state, and
 * source-derived class are copied from the draft, so a request cannot claim
 * evidence the draft does not have. The id is content-addressed.
 */
export function buildClassificationRecord(input: {
  reviewId: string;
  draftSet: ReviewFindingDraftSet;
  draft: ReviewFindingDraft;
  reviewerActorId: string;
  classifiedAt: string;
  choice: ClassificationInput;
  supersedes?: CurrentClassification;
}): FindingClassificationRecord {
  const { draft, choice } = input;
  const defensible = optionalText(choice.defensible_confirmation_criteria);
  const validationPath = optionalText(choice.validation_path_summary);
  const body: Omit<FindingClassificationRecord, "classification_record_id"> = {
    protocol_version: "codeattest.v0",
    review_id: input.reviewId,
    review_finding_draft_ref: draft.review_finding_draft_id,
    review_finding_draft_evidence_refs: draft.evidence_refs,
    classification: choice.classification,
    classified_at: input.classifiedAt,
    actor: { actor_type: "reviewer", actor_id: input.reviewerActorId },
    evidence_basis: draft.evidence_basis,
    confirmation_criteria: nonEmpty(choice.confirmation_criteria) ?? [],
    ...(defensible === undefined ? {} : { defensible_confirmation_criteria: defensible }),
    threshold_gaps: nonEmpty(choice.threshold_gaps) ?? draft.threshold_gaps,
    limitations: (nonEmpty(choice.limitations) ?? input.draftSet.normalization_limitations) as FindingClassificationRecord["limitations"],
    rationale: choice.rationale.trim(),
    ...(validationPath === undefined ? {} : { validation_path_summary: validationPath }),
    ...(input.supersedes === undefined
      ? {}
      : {
          supersedes_classification_record_ref: input.supersedes.record.classification_record_id,
          supersedes_event_id: input.supersedes.event_id
        }),
    source_reference_state: draft.source_reference_state,
    source_derived_class: draft.source_derived_class,
    visibility: choice.visibility ?? "internal_only"
  } as Omit<FindingClassificationRecord, "classification_record_id">;
  const digest = createHash("sha256").update(canonicalizeProtocolJson(body)).digest("hex");
  return { ...body, classification_record_id: `classification_record:${digest.slice(0, 32)}` } as FindingClassificationRecord;
}

export type ClassificationEventResult =
  | { outcome: "built"; event: ReviewEvent }
  | { outcome: "rejected"; reason: string };

/**
 * Builds the `classification_recorded` event for `record` at the end of the
 * log, fills its content-addressed id, and runs it through the control-plane's
 * pure append check, so a rejected event never reaches storage.
 */
export async function buildClassificationEvent(record: FindingClassificationRecord, events: readonly ReviewEvent[]): Promise<ClassificationEventResult> {
  const built = buildFindingClassificationEvent(record, {
    event_id: `sha256:${"0".repeat(64)}`,
    sequence_number: events.length
  });
  if (built.outcome === "rejected") {
    return { outcome: "rejected", reason: built.reason };
  }
  const event: ReviewEvent = { ...built.event, event_id: await computeReviewEventId(built.event) };
  const appended = await appendReviewEvent({ protocol_version: "codeattest.v0", review_id: record.review_id, events: [...events] }, event);
  if (appended.outcome === "rejected") {
    return { outcome: "rejected", reason: appended.reason };
  }
  return { outcome: "built", event };
}
