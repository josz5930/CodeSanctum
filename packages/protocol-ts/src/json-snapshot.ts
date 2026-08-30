/**
 * C6-01/C6-25: every UI/static-bundle boundary that receives `unknown` caller
 * input previously ran a boolean-only "is this safe JSON shape" scan and then
 * re-read the original object during schema/render access. That is unsafe on
 * two counts: `Object.getPrototypeOf`/`Reflect.ownKeys`/property access on a
 * revoked or trapping Proxy can throw instead of returning a verdict, and a
 * stateful Proxy can present benign descriptors during the scan and different
 * values on the later re-read. `snapshotJsonData` closes both: it walks the
 * input exactly once, catches every reflection failure, and returns a
 * deep-frozen, null-prototype, plain-JSON-only copy that callers must
 * validate and render instead of ever touching the original reference again.
 */
export type JsonSnapshotLimits = {
  maxNodes?: number;
  maxDepth?: number;
  maxStringLength?: number;
  maxArrayLength?: number;
  maxObjectKeys?: number;
};

const DEFAULT_LIMITS: Required<JsonSnapshotLimits> = {
  maxNodes: 20_000,
  maxDepth: 64,
  maxStringLength: 1_000_000,
  maxArrayLength: 100_000,
  maxObjectKeys: 10_000
};

export type JsonSnapshotResult =
  | { ok: true; value: unknown; payloadFieldPresent: boolean }
  | { ok: false; reason: string };

const DEFAULT_PAYLOAD_KEYS = new Set([
  "payload",
  "content",
  "body",
  "body_bytes",
  "raw_text",
  "raw_source",
  "source_text",
  "snippet",
  "stdout",
  "stderr",
  "script_output",
  "base64",
  "source_code",
  "evidence_content",
  "evidence_bytes"
]);

export function snapshotJsonData(value: unknown, limits: JsonSnapshotLimits = {}, payloadKeys: ReadonlySet<string> = DEFAULT_PAYLOAD_KEYS): JsonSnapshotResult {
  const effectiveLimits = { ...DEFAULT_LIMITS, ...limits };
  const ancestors = new Set<object>();
  let nodes = 0;
  let payloadFieldPresent = false;

  function fail(reason: string): { ok: false; reason: string } {
    return { ok: false, reason };
  }

  function visit(current: unknown, depth: number): { ok: true; value: unknown } | { ok: false; reason: string } {
    nodes += 1;
    if (nodes > effectiveLimits.maxNodes) return fail("too_many_nodes");
    if (depth > effectiveLimits.maxDepth) return fail("too_deep");
    if (current === null) return { ok: true, value: null };
    if (typeof current === "boolean") return { ok: true, value: current };
    if (typeof current === "string") {
      if (current.length > effectiveLimits.maxStringLength) return fail("string_too_long");
      return { ok: true, value: current };
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current) || Math.abs(current) > Number.MAX_SAFE_INTEGER) return fail("unsafe_number");
      return { ok: true, value: current };
    }
    if (typeof current !== "object") return fail("unsupported_type");
    if (ancestors.has(current)) return fail("cyclic_reference");

    try {
      const prototype = safeGetPrototypeOf(current);
      if (prototype === undefined) return fail("prototype_reflection_failed");
      const isArray = Array.isArray(current);
      if (isArray) {
        if (prototype !== Array.prototype) return fail("exotic_array_prototype");
      } else if (prototype !== Object.prototype && prototype !== null) {
        return fail("exotic_object_prototype");
      }

      ancestors.add(current);
      try {
        const ownKeys = safeOwnKeys(current);
        if (ownKeys === undefined) return fail("own_keys_reflection_failed");

        if (isArray) {
          const arr = current as unknown[];
          if (ownKeys.length !== arr.length + 1 || ownKeys.some((key) => typeof key !== "string" || (key !== "length" && !/^(?:0|[1-9][0-9]*)$/u.test(key)))) {
            return fail("non_dense_array");
          }
          if (arr.length > effectiveLimits.maxArrayLength) return fail("array_too_long");
          const out: unknown[] = new Array(arr.length);
          for (let index = 0; index < arr.length; index += 1) {
            const descriptor = safeGetOwnPropertyDescriptor(current, String(index));
            if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined || descriptor.enumerable !== true) {
              return fail("non_data_descriptor");
            }
            const result = visit(descriptor.value, depth + 1);
            if (!result.ok) return result;
            out[index] = result.value;
          }
          return { ok: true, value: Object.freeze(out) };
        }

        const stringKeys = ownKeys.filter((key): key is string => typeof key === "string");
        if (stringKeys.length !== ownKeys.length) return fail("symbol_key_present");
        if (stringKeys.length > effectiveLimits.maxObjectKeys) return fail("too_many_keys");
        const out: Record<string, unknown> = Object.create(null);
        for (const key of stringKeys) {
          const descriptor = safeGetOwnPropertyDescriptor(current, key);
          if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined || descriptor.enumerable !== true) {
            return fail("non_data_descriptor");
          }
          if (payloadKeys.has(key.toLowerCase())) payloadFieldPresent = true;
          const result = visit(descriptor.value, depth + 1);
          if (!result.ok) return result;
          out[key] = result.value;
        }
        return { ok: true, value: Object.freeze(out) };
      } finally {
        ancestors.delete(current);
      }
    } catch {
      return fail("reflection_threw");
    }
  }

  const result = visit(value, 0);
  if (!result.ok) return result;
  return { ok: true, value: result.value, payloadFieldPresent };
}

function safeGetPrototypeOf(value: object): object | null | undefined {
  try {
    return Object.getPrototypeOf(value);
  } catch {
    return undefined;
  }
}

function safeOwnKeys(value: object): Array<string | symbol> | undefined {
  try {
    return Reflect.ownKeys(value);
  } catch {
    return undefined;
  }
}

function safeGetOwnPropertyDescriptor(value: object, key: string): PropertyDescriptor | undefined {
  try {
    return Object.getOwnPropertyDescriptor(value, key);
  } catch {
    return undefined;
  }
}
