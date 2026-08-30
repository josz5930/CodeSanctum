import { runAppendOnlyLogContract } from "./port-contract.mjs";
import { runArtifactStoreContract } from "./artifact-contract.mjs";
import { runRecordStoreContract } from "./record-store-contract.mjs";
import { runReadinessStoreContract } from "./readiness-store-contract.mjs";
import { makeReviewEvent, makeLifecycleEvent, REVIEW_ID } from "./helpers/fixtures.mjs";
import { importCompiled } from "./helpers/compile.mjs";

const { createMemoryReviewEventLogStore } = await importCompiled("src/memory/review-event-log-store.js");
const { createMemoryEvidenceLifecycleLogStore } = await importCompiled("src/memory/evidence-lifecycle-log-store.js");
const { createMemoryArtifactStore } = await importCompiled("src/memory/artifact-store.js");
const { createMemoryClassificationStore, createMemoryRetentionRecordStore, createMemoryEnvironmentGateStore } = await importCompiled("src/memory/record-stores.js");
const { createMemoryReadinessEvidenceStore, createMemoryReadinessDecisionStore } = await importCompiled("src/memory/readiness-stores.js");
const { createMemoryJobQueue } = await importCompiled("src/memory/job-queue.js");

await runAppendOnlyLogContract({
  name: "memory/review-event-log",
  createStore: async () => createMemoryReviewEventLogStore(),
  makeEvent: makeReviewEvent,
  nextReviewId: () => REVIEW_ID
});

await runAppendOnlyLogContract({
  name: "memory/evidence-lifecycle-log",
  createStore: async () => createMemoryEvidenceLifecycleLogStore(),
  makeEvent: makeLifecycleEvent,
  nextReviewId: () => REVIEW_ID
});

await runArtifactStoreContract({
  name: "memory/artifact-store",
  createStore: async () => {
    const lifecycleLog = createMemoryEvidenceLifecycleLogStore();
    return { store: createMemoryArtifactStore(lifecycleLog), lifecycleLog };
  },
  nextReviewId: () => REVIEW_ID
});

let memoryIdCounter = 0;
await runRecordStoreContract({
  name: "memory/record-stores",
  createStores: async () => ({
    classifications: createMemoryClassificationStore(),
    retentionRecords: createMemoryRetentionRecordStore(),
    environmentGate: createMemoryEnvironmentGateStore(),
    jobs: createMemoryJobQueue()
  }),
  nextId: () => `id:synthetic_demo_${memoryIdCounter++}`,
  nextVersion: () => 1
});

await runReadinessStoreContract({
  name: "memory/readiness-stores",
  createStores: async () => ({
    readinessEvidence: createMemoryReadinessEvidenceStore(),
    readinessDecisions: createMemoryReadinessDecisionStore()
  })
});
