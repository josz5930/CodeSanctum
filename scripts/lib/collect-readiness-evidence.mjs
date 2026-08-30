import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const canaryDir = path.join(repoRoot, "infra/deploy/readiness-canaries");

const SKIP_PATTERN = /\bPENDING\b|\bskipped\b|\bcommand not found\b|\bnot installed\b/i;

export function redactEvidenceText(text) {
  let redacted = String(text);
  redacted = redacted.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]");
  redacted = redacted.replace(/\b(?:postgres(?:ql)?|mysql|mongodb|redis|https?|otpauth):\/\/\S+/gi, "[REDACTED_URL]");
  redacted = redacted.replace(/^(Cookie|Set-Cookie|Authorization)\s*:[^\n]*/gim, "$1: [REDACTED_SECRET]");
  redacted = redacted.replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, "[REDACTED_IDENTIFIER]");
  redacted = redacted.replace(/\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/g, "[REDACTED_IDENTIFIER]");
  redacted = redacted.replace(/\b\d{3}[-.\s]\d{4}\b/g, "[REDACTED_IDENTIFIER]");
  redacted = redacted.replace(/\b(password|secret|token|api[_-]?key)\s*[:=]\s*\S+/gi, "$1=[REDACTED_SECRET]");
  return redacted;
}

export function sha256TextId(text) {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

function looksLikeRequiredSkip(text) {
  return SKIP_PATTERN.test(text);
}

export function collectObservation(input) {
  if (input.release_digest !== input.expected_release_digest) {
    return { outcome: "refused", reason: "release_mismatch" };
  }
  const combined = [input.stdout ?? "", input.stderr ?? ""].filter((part) => part.length > 0).join("\n");
  if (input.required && looksLikeRequiredSkip(combined)) {
    return { outcome: "refused", reason: "required_tool_skipped" };
  }

  const redactedAttachment = redactEvidenceText(combined);
  const attachmentDigest = sha256TextId(redactedAttachment);
  return {
    outcome: "collected",
    redacted_attachment: redactedAttachment,
    observation: {
      check_id: input.check_id,
      command: input.command,
      exit_status: input.exit_status,
      tool_version: input.tool_version,
      collected_at: input.collected_at,
      release_digest: input.release_digest,
      deployment_identity: input.deployment_identity,
      attachment_digest: attachmentDigest
    }
  };
}

export async function loadSyntheticCanaries(root = canaryDir) {
  const names = (await readdir(root)).filter((name) => !name.startsWith(".")).sort();
  const canaries = [];
  for (const name of names) {
    const absolute = path.join(root, name);
    const body = await readFile(absolute, "utf8");
    canaries.push({
      path: path.posix.join("infra/deploy/readiness-canaries", name),
      body,
      digest: sha256TextId(body)
    });
  }
  return canaries;
}

export function buildRerunManifest(input) {
  return {
    purpose: "Independent reviewer rerun instructions for environment-readiness observations. Not a protocol artifact.",
    release_digest: input.release_digest,
    deployment_identity: input.deployment_identity,
    observations: (input.observations ?? []).map((observation) => ({
      check_id: observation.check_id,
      command: observation.command,
      collected_at: observation.collected_at,
      attachment_digest: observation.attachment_digest
    })),
    canaries: (input.canaries ?? []).map((canary) => ({
      path: canary.path,
      digest: canary.digest
    }))
  };
}
