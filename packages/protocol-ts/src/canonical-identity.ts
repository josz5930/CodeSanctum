import { createHash } from "node:crypto";

const MAX_DEPTH = 64;
const MAX_NODES = 20_000;

export function canonicalizeProtocolJson(value: unknown): string {
  const ancestors = new Set<object>();
  let nodes = 0;

  function encode(current: unknown, depth: number): string {
    nodes += 1;
    if (nodes > MAX_NODES || depth > MAX_DEPTH) throw new TypeError("RFC 8785 input exceeds the supported JSON shape limits.");
    if (current === null) return "null";
    if (typeof current === "boolean") return current ? "true" : "false";
    if (typeof current === "string") {
      if (hasUnpairedSurrogate(current)) throw new TypeError("RFC 8785 input contains an unpaired surrogate.");
      return JSON.stringify(current);
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current) || Math.abs(current) > Number.MAX_SAFE_INTEGER) throw new TypeError("RFC 8785 input contains an unsafe number.");
      return JSON.stringify(current);
    }
    if (typeof current !== "object") throw new TypeError("RFC 8785 input contains an unsupported JSON value type.");
    if (ancestors.has(current)) throw new TypeError("RFC 8785 input must be acyclic JSON data.");
    const prototype = Object.getPrototypeOf(current);
    if (Array.isArray(current) ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw new TypeError("RFC 8785 input must use ordinary arrays and plain objects.");
    ancestors.add(current);
    try {
      const keys = Reflect.ownKeys(current);
      if (keys.some((key) => typeof key !== "string")) throw new TypeError("RFC 8785 input cannot contain symbol keys.");
      if (Array.isArray(current)) {
        if (keys.length !== current.length + 1 || keys.some((key) => typeof key !== "string" || (key !== "length" && !/^(?:0|[1-9][0-9]*)$/u.test(key)))) throw new TypeError("RFC 8785 arrays must be dense and contain no extra properties.");
        return `[${current.map((_entry, index) => encode(readDataProperty(current, String(index)), depth + 1)).join(",")}]`;
      }
      const stringKeys = keys as string[];
      return `{${stringKeys.sort().map((key) => `${encode(key, depth + 1)}:${encode(readDataProperty(current, key), depth + 1)}`).join(",")}}`;
    } finally {
      ancestors.delete(current);
    }
  }

  return encode(value, 0);
}

export function sha256ProtocolText(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

export function computeCanonicalSha256Id(value: unknown): string {
  return sha256ProtocolText(canonicalizeProtocolJson(value));
}

export function recomputeExcludedFieldIdentity(value: unknown, excludedField: string, namespace?: string): string | undefined {
  return recomputeExcludedFieldsIdentity(value, [excludedField], namespace);
}

export function recomputeExcludedFieldsIdentity(value: unknown, excludedFields: readonly string[], namespace?: string): string | undefined {
  if (!isPlainRecord(value) || excludedFields.length === 0 || !excludedFields.every((field) => Object.prototype.hasOwnProperty.call(value, field) || field === "exported_at")) return undefined;
  const excluded = new Set(excludedFields);
  const identityInput: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return undefined;
    if (excluded.has(key)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined || descriptor.enumerable !== true) return undefined;
    identityInput[key] = descriptor.value;
  }
  const digest = computeCanonicalSha256Id(identityInput);
  return namespace === undefined ? digest : `${namespace}:${digest.slice("sha256:".length)}`;
}

function readDataProperty(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined || descriptor.enumerable !== true) throw new TypeError("RFC 8785 input properties must be enumerable data properties.");
  return descriptor.value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}
