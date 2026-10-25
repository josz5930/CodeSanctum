import type { ClassificationBadgeView, ReviewerClassificationWorkbenchView } from "../../../packages/ui/src/index.js";
import { actionableAttributes } from "./a11y.js";

export type WorkbenchDraftView = {
  draftRef: string;
  workbench: ReviewerClassificationWorkbenchView;
  current: { recordRef: string; classification: string; visibility: string; classifiedAt: string } | null;
  defaults: { thresholdGaps: string[]; limitations: string[] };
};

const CHOICES = [
  { value: "likely", label: "Likely" },
  { value: "confirmed", label: "Confirmed" },
  { value: "inconclusive", label: "Inconclusive" },
  { value: "requires_customer_side_validation", label: "Requires customer-side validation" }
];

function fieldId(draftRef: string, name: string): string {
  return `${draftRef.replace(/[^a-z0-9_-]/gi, "-")}-${name}`;
}

/** The current classification, text-first: the label carries the meaning, colour never does. */
function Badge({ badge }: { badge: ClassificationBadgeView }) {
  return (
    <section data-slot="classification-badge" data-classification={badge.classification} data-token-role={badge.tokenRole}>
      <h4>
        Current classification: <span aria-label={badge.accessibleLabel}>{badge.visibleLabel}</span>
      </h4>
      <p>{badge.meaning}</p>
      {badge.evidenceBasis.length === 0 ? null : (
        <p>Evidence basis: {badge.evidenceBasis.map((basis) => basis.label).join(", ")}</p>
      )}
    </section>
  );
}

function TextArea({ id, name, label, hint, defaultValue, required }: { id: string; name: string; label: string; hint?: string; defaultValue?: string; required?: boolean }) {
  return (
    <div data-slot="workbench-field">
      <label htmlFor={id}>{label}</label>
      {hint === undefined ? null : <p id={`${id}-hint`}>{hint}</p>}
      <textarea
        id={id}
        name={name}
        rows={3}
        maxLength={4000}
        defaultValue={defaultValue}
        required={required}
        aria-describedby={hint === undefined ? undefined : `${id}-hint`}
        data-text-entry-zone="true"
      />
    </div>
  );
}

/**
 * One finding draft in the reviewer workbench: the read-only panels from the
 * `@onevps/ui` contract, then a plain HTML form that records a classification.
 * The form sends only the reviewer's choices; the host binds the record to the
 * stored draft's evidence. It works without client JavaScript.
 */
export function ClassificationWorkbench({ view, reviewScope, draftSetDigest }: { view: WorkbenchDraftView; reviewScope: string; draftSetDigest: string }) {
  const { workbench } = view;
  const id = (name: string) => fieldId(view.draftRef, name);
  return (
    <article data-slot="classification-workbench" data-draft-ref={workbench.draftRef} data-available={String(workbench.available)} id={fieldId(view.draftRef, "draft")}>
      <h3>{workbench.title}</h3>
      <p data-slot="affected-area">{workbench.affectedArea}</p>
      {workbench.currentState.badge === null ? <p data-slot="unclassified">Not classified yet.</p> : <Badge badge={workbench.currentState.badge} />}
      {view.current === null ? null : (
        <p data-slot="current-record">
          Recorded {view.current.classifiedAt}, {view.current.visibility === "customer_facing" ? "shared with the customer" : "internal only"}.
        </p>
      )}
      {workbench.panels
        .filter((panel) => panel.items.length > 0)
        .map((panel) => (
          <section key={panel.id} data-slot="workbench-panel" data-panel-id={panel.id}>
            <h4>{panel.title}</h4>
            <p>{panel.summary}</p>
            <dl>
              {panel.items.map((item, index) => (
                <div key={index}>
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      {!workbench.available ? (
        <p data-slot="workbench-unavailable">This draft cannot be classified.</p>
      ) : (
        <form method="post" action="/reviewer/classify" data-slot="classification-form">
          <input type="hidden" name="review_scope" value={reviewScope} />
          <input type="hidden" name="draft_set_digest" value={draftSetDigest} />
          <input type="hidden" name="review_finding_draft_ref" value={view.draftRef} />
          <fieldset>
            <legend>{view.current === null ? "Classification" : "New classification (supersedes the current one)"}</legend>
            {CHOICES.map((choice) => (
              <label key={choice.value} {...actionableAttributes({ minTargetSizePx: workbench.minTargetSizePx })}>
                <input type="radio" name="classification" value={choice.value} required defaultChecked={view.current?.classification === choice.value} />
                {choice.label}
              </label>
            ))}
          </fieldset>
          <TextArea id={id("rationale")} name="rationale" label="Rationale" hint="Why the evidence supports this classification. Describe it; do not quote code." required />
          <TextArea id={id("criteria")} name="confirmation_criteria" label="Confirmation criteria" hint="Needed for Confirmed. One per line." />
          <TextArea id={id("defensible")} name="defensible_confirmation_criteria" label="Defensible confirmation criteria" hint="Needed to confirm on scanner output or metadata alone." />
          <TextArea id={id("validation")} name="validation_path_summary" label="Validation path" hint="Needed for Requires customer-side validation." />
          <TextArea id={id("gaps")} name="threshold_gaps" label="Threshold gaps" hint="One per line." defaultValue={view.defaults.thresholdGaps.join("\n")} />
          <TextArea id={id("limitations")} name="limitations" label="Limitations" hint="At least one. One per line." defaultValue={view.defaults.limitations.join("\n")} required />
          <label {...actionableAttributes({ minTargetSizePx: workbench.minTargetSizePx })}>
            <input type="checkbox" name="share_with_customer" value="yes" />
            Show this classification in the customer review history
          </label>
          <button type="submit" {...actionableAttributes({ minTargetSizePx: workbench.minTargetSizePx })}>
            Record classification
          </button>
        </form>
      )}
    </article>
  );
}
