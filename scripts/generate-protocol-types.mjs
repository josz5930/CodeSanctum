import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  generateProtocolTypeArtifacts,
  generatedManifestForArtifacts,
  generatedRoot
} from "./lib/protocol-types-generator.mjs";

const shouldWrite = process.argv.includes("--write");
const artifacts = await generateProtocolTypeArtifacts();

if (!shouldWrite) {
  for (const file of artifacts.files) {
    console.log(`${file.path} ${file.sha256}`);
  }
  process.exit(0);
}

const root = generatedRoot();
await mkdir(root, { recursive: true });

for (const file of artifacts.files) {
  await writeFile(path.join(root, file.path), file.content, "utf8");
}

await writeFile(
  path.join(root, "bindings-manifest.json"),
  `${JSON.stringify(generatedManifestForArtifacts(artifacts), null, 2)}\n`,
  "utf8"
);

console.log("Generated protocol TypeScript bindings and manifest.");
