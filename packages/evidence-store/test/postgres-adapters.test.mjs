import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { postgresAvailable, withPostgres } from "./helpers/postgres-harness.mjs";
import { runAppendOnlyLogContract } from "./port-contract.mjs";
import { runArtifactStoreContract } from "./artifact-contract.mjs";
import { runRecordStoreContract } from "./record-store-contract.mjs";
import { runReadinessStoreContract } from "./readiness-store-contract.mjs";
import { makeReviewEvent, makeLifecycleEvent } from "./helpers/fixtures.mjs";
import { importCompiled } from "./helpers/compile.mjs";

const { createPostgresReviewEventLogStore } = await importCompiled("src/postgres/review-event-log-store.js");
const { createPostgresEvidenceLifecycleLogStore } = await importCompiled("src/postgres/evidence-lifecycle-log-store.js");
const { createFilesystemObjectStore } = await importCompiled("src/filesystem/object-store.js");
const { createPostgresArtifactStore } = await importCompiled("src/postgres/artifact-store.js");
const { createPostgresClassificationStore, createPostgresRetentionRecordStore, createPostgresEnvironmentGateStore } = await importCompiled("src/postgres/record-stores.js");
const { createPostgresReadinessEvidenceStore, createPostgresReadinessDecisionStore } = await importCompiled("src/postgres/readiness-stores.js");
const { createPostgresJobQueue } = await importCompiled("src/postgres/job-queue.js");

if (!(await postgresAvailable())) {
  console.log("postgres-adapters test skipped: no database reachable.");
  process.exit(0);
}

let counter = 0;
const nextReviewId = () => `review:synthetic_demo_${counter++}`;
const nextId = () => `id:synthetic_demo_${counter++}`;
let versionCounter = 0;
const nextVersion = () => ++versionCounter * 1000;

await withPostgres(async ({ appPool }) => {
  await runAppendOnlyLogContract({
    name: "postgres/review-event-log",
    createStore: async () => createPostgresReviewEventLogStore(appPool),
    makeEvent: makeReviewEvent,
    nextReviewId
  });

  await runAppendOnlyLogContract({
    name: "postgres/evidence-lifecycle-log",
    createStore: async () => createPostgresEvidenceLifecycleLogStore(appPool),
    makeEvent: makeLifecycleEvent,
    nextReviewId
  });

  await runArtifactStoreContract({
    name: "postgres/artifact-store",
    createStore: async () => {
      const root = await mkdtemp(path.join(tmpdir(), "onevps-object-store-"));
      const objects = createFilesystemObjectStore(root);
      const lifecycleLog = createPostgresEvidenceLifecycleLogStore(appPool);
      return { store: createPostgresArtifactStore({ sql: appPool, objects, lifecycleLog }), lifecycleLog };
    },
    nextReviewId
  });

  await runRecordStoreContract({
    name: "postgres/record-stores",
    createStores: async () => ({
      classifications: createPostgresClassificationStore(appPool),
      retentionRecords: createPostgresRetentionRecordStore(appPool),
      environmentGate: createPostgresEnvironmentGateStore(appPool),
      jobs: createPostgresJobQueue(appPool)
    }),
    nextId,
    nextVersion
  });

  await runReadinessStoreContract({
    name: "postgres/readiness-stores",
    createStores: async () => ({
      readinessEvidence: createPostgresReadinessEvidenceStore(appPool),
      readinessDecisions: createPostgresReadinessDecisionStore(appPool)
    })
  });
});
