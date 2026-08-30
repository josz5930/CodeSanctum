// Offline trust-anchor tool. Run this on the air-gapped machine that holds
// the anchor private key; it is never run on the VPS and the host never
// invokes it. See infra/custody/README.md for the procedure.
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1 || index + 1 >= process.argv.length) {
    throw new Error(`missing required argument --${name}`);
  }
  return process.argv[index + 1];
}

async function main() {
  const directoryPath = argument("directory");
  const anchorKeyPath = argument("anchor-key");
  const anchorKeyId = argument("anchor-key-id");
  const anchorKeyVersion = argument("anchor-key-version");
  const signingTime = argument("signing-time");
  const outPath = argument("out");

  const document = JSON.parse(await readFile(directoryPath, "utf8"));
  if (document.directory_signature !== undefined) {
    throw new Error("this directory is already signed; publish a new directory_version instead of re-signing one");
  }

  const outDir = await mkdtemp(path.join(tmpdir(), "onevps-sign-directory-"));
  try {
    execFileSync("npx", ["tsc", "-p", path.join(repoRoot, "packages", "signing", "tsconfig.json"), "--outDir", outDir], { stdio: "inherit" });
    const signing = await import(pathToFileURL(path.join(outDir, "packages", "signing", "src", "index.js")).href);
    const anchorKey = new Uint8Array(await readFile(anchorKeyPath));
    // Build the signature against a shell carrying a placeholder signature so
    // the identity is computed over exactly the fields the verifier excludes.
    const shell = { ...document, directory_signature: undefined };
    delete shell.directory_signature;
    const signingInput = signing.keyDirectorySigningInput(shell);
    const signature = signing.signIdentityEnvelope({
      signing_input: signingInput,
      key: { key_id: anchorKeyId, key_version: anchorKeyVersion, privateKeyPkcs8: anchorKey },
      signing_time: signingTime,
      signing_mode: "managed_key",
      signing_limitations: [
        "Key custody is self-hosted software custody in a non-validated module, not a hardware security module.",
        "The offline trust anchor signs only this directory and never signs evidence artifacts."
      ]
    });
    const signed = { ...document, directory_signature: signature };
    const anchorPublicKey = signing.publicKeyFromPkcs8(anchorKey);
    if (anchorPublicKey === undefined) {
      throw new Error("--anchor-key is not an ML-DSA-65 PKCS#8 private key");
    }
    if (!signing.verifyKeyDirectory(signed, anchorPublicKey)) {
      throw new Error("the freshly signed directory does not verify; refusing to write it");
    }
    console.log(`Anchor public key: ${signing.encodeBase64Url(anchorPublicKey)}`);
    await writeFile(outPath, `${JSON.stringify(signed, null, 2)}\n`);
    console.log(`Signed directory version ${signed.directory_version} written to ${outPath}`);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}

await main();
