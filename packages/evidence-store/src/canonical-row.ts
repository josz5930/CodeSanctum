import { canonicalizeProtocolJson, computeCanonicalSha256Id } from "../../protocol-ts/src/index.js";

/**
 * A protocol artifact as it is stored: the exact RFC 8785 canonical bytes plus
 * the sha256 identity derived from them.
 *
 * `body` is stored in a Postgres `text` column, never `jsonb`. `jsonb` orders
 * keys by length-then-bytes while JCS orders by UTF-16 code unit, and `jsonb`
 * renormalizes values through `numeric`. Round-tripping through `jsonb` would
 * therefore return different bytes, a different digest, and a broken identity
 * chain.
 */
export type CanonicalRow = {
  body: string;
  digest: string;
};

export function toCanonicalRow(artifact: unknown): CanonicalRow {
  const body = canonicalizeProtocolJson(artifact);
  return { body, digest: computeCanonicalSha256Id(artifact) };
}

export function fromCanonicalRow(body: string): unknown {
  return JSON.parse(body);
}

/**
 * Re-derives the digest from the stored bytes. Used by the round-trip test that
 * guards the text-not-jsonb decision, and by adapters reading rows back.
 */
export function canonicalRowDigestMatches(row: CanonicalRow): boolean {
  try {
    return toCanonicalRow(fromCanonicalRow(row.body)).digest === row.digest;
  } catch {
    return false;
  }
}
