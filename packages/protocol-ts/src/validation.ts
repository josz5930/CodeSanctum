import { protocolV0Schemas, type ProtocolV0SchemaId } from "./generated/protocol-v0-schemas.js";

export type ProtocolValidationError = {
  code: string;
  location: string;
};

export function validateProtocolSchema(schemaId: ProtocolV0SchemaId, value: unknown): ProtocolValidationError[] {
  const schema = protocolV0Schemas[schemaId];
  const schemaMap = protocolV0Schemas as unknown as Record<string, JsonSchema>;
  const errors: ProtocolValidationError[] = [];
  validateSchemaValue(value, schema as JsonSchema, schemaMap, "$", errors);
  return errors;
}

type JsonSchema = {
  readonly $ref?: string;
  readonly const?: unknown;
  readonly enum?: readonly unknown[];
  readonly type?: string;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly uniqueItems?: boolean;
  readonly items?: JsonSchema;
  readonly contains?: JsonSchema;
  readonly minContains?: number;
  readonly maxContains?: number;
  readonly required?: readonly string[];
  readonly dependentRequired?: Readonly<Record<string, readonly string[]>>;
  readonly dependentSchemas?: Readonly<Record<string, JsonSchema>>;
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly additionalProperties?: boolean;
  readonly allOf?: readonly JsonSchema[];
  readonly anyOf?: readonly JsonSchema[];
  readonly oneOf?: readonly JsonSchema[];
  readonly not?: JsonSchema;
  readonly if?: JsonSchema;
  readonly then?: JsonSchema;
  readonly else?: JsonSchema;
};

function validateSchemaValue(value: unknown, schema: JsonSchema, schemaMap: Record<string, JsonSchema>, location: string, errors: ProtocolValidationError[]): void {
  if (schema.$ref !== undefined) {
    const resolved = resolveRef(schema.$ref, schemaMap);
    if (resolved === undefined) {
      errors.push({ code: "unresolved_ref", location });
      return;
    }
    validateSchemaValue(value, resolved, schemaMap, location, errors);
    return;
  }

  if (Array.isArray(schema.allOf)) {
    for (const childSchema of schema.allOf) {
      validateSchemaValue(value, childSchema, schemaMap, location, errors);
    }
  }

  if (Array.isArray(schema.anyOf)) {
    const matches = schema.anyOf.filter((candidate) => {
      const candidateErrors: ProtocolValidationError[] = [];
      validateSchemaValue(value, candidate, schemaMap, location, candidateErrors);
      return candidateErrors.length === 0;
    }).length;
    if (matches === 0) errors.push({ code: "any_of", location });
  }

  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter((candidate) => {
      const candidateErrors: ProtocolValidationError[] = [];
      validateSchemaValue(value, candidate, schemaMap, location, candidateErrors);
      return candidateErrors.length === 0;
    }).length;
    if (matches !== 1) errors.push({ code: "one_of", location });
  }

  if (schema.not !== undefined) {
    const notErrors: ProtocolValidationError[] = [];
    validateSchemaValue(value, schema.not, schemaMap, location, notErrors);
    if (notErrors.length === 0) errors.push({ code: "not", location });
  }

  if (schema.if !== undefined) {
    const ifErrors: ProtocolValidationError[] = [];
    validateSchemaValue(value, schema.if, schemaMap, location, ifErrors);
    if (ifErrors.length === 0 && schema.then !== undefined) {
      validateSchemaValue(value, schema.then, schemaMap, location, errors);
    } else if (ifErrors.length > 0 && schema.else !== undefined) {
      validateSchemaValue(value, schema.else, schemaMap, location, errors);
    }
  }

  if (schema.const !== undefined && !jsonValueEquals(value, schema.const)) {
    errors.push({ code: "const", location });
  }

  if (schema.enum !== undefined && !schema.enum.some((item) => jsonValueEquals(value, item))) {
    errors.push({ code: "enum", location });
  }

  if (schema.type !== undefined && !matchesType(value, schema.type)) {
    errors.push({ code: "type", location });
    return;
  }

  if (schema.type === "string") {
    if (typeof value !== "string") {
      return;
    }
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      errors.push({ code: "min_length", location });
    }
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      errors.push({ code: "max_length", location });
    }
    if (schema.pattern !== undefined && !(new RegExp(schema.pattern).test(value))) {
      errors.push({ code: "pattern", location });
    }
    if (schema.pattern === "^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:(?:[0-5][0-9]|60)(?:\\.[0-9]{1,9})?(?:Z|\\+00:00)$" && !isUtcRfc3339Timestamp(value)) {
      errors.push({ code: "utc_rfc3339_timestamp", location });
    }
  }

  if ((schema.type === "integer" || schema.type === "number") && typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      errors.push({ code: "minimum", location });
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      errors.push({ code: "maximum", location });
    }
  }

  const hasArrayKeywords = schema.minItems !== undefined || schema.maxItems !== undefined || schema.uniqueItems !== undefined || schema.items !== undefined || schema.contains !== undefined;
  if (schema.type === "array" || (hasArrayKeywords && Array.isArray(value))) {
    if (!Array.isArray(value)) {
      return;
    }
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      errors.push({ code: "min_items", location });
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      errors.push({ code: "max_items", location });
    }
    if (schema.uniqueItems === true) {
      const seen = new Set<string>();
      for (const [index, item] of value.entries()) {
        const key = stableJson(item);
        if (seen.has(key)) {
          errors.push({ code: "unique_items", location: `${location}[${index}]` });
          break;
        }
        seen.add(key);
      }
    }
    if (schema.items !== undefined) {
      value.forEach((item, index) => validateSchemaValue(item, schema.items as JsonSchema, schemaMap, `${location}[${index}]`, errors));
    }
    if (schema.contains !== undefined) {
      const matches = value.filter((item, index) => {
        const containsErrors: ProtocolValidationError[] = [];
        validateSchemaValue(item, schema.contains as JsonSchema, schemaMap, `${location}[${index}]`, containsErrors);
        return containsErrors.length === 0;
      }).length;
      const minimum = schema.minContains ?? 1;
      if (matches < minimum) errors.push({ code: "contains", location });
      if (schema.maxContains !== undefined && matches > schema.maxContains) errors.push({ code: "max_contains", location });
    }
  }

  const hasObjectKeywords = schema.required !== undefined || schema.dependentRequired !== undefined || schema.dependentSchemas !== undefined || schema.properties !== undefined || schema.additionalProperties !== undefined;
  if (schema.type === "object" || (hasObjectKeywords && isRecord(value))) {
    if (!isRecord(value)) {
      return;
    }
    if (!isPlainRecord(value)) {
      errors.push({ code: "type", location });
      return;
    }

    const { dataProperties, accessorKeys } = ownEnumerableDataProperties(value);
    for (const accessorKey of accessorKeys) {
      errors.push({ code: "accessor_property", location: `${location}.${accessorKey}` });
    }

    const required = schema.required ?? [];
    for (const requiredProperty of required) {
      if (dataProperties[requiredProperty] === undefined) {
        errors.push({ code: "required", location: `${location}.${requiredProperty}` });
      }
    }

    const dependentRequired = schema.dependentRequired ?? {};
    for (const [propertyName, dependentProperties] of Object.entries(dependentRequired)) {
      if (dataProperties[propertyName] !== undefined) {
        for (const dependentProperty of dependentProperties) {
          if (dataProperties[dependentProperty] === undefined) {
            errors.push({ code: "dependent_required", location: `${location}.${dependentProperty}` });
          }
        }
      }
    }

    const dependentSchemas = schema.dependentSchemas ?? {};
    for (const [propertyName, dependentSchema] of Object.entries(dependentSchemas)) {
      if (dataProperties[propertyName] !== undefined) {
        validateSchemaValue(value, dependentSchema, schemaMap, location, errors);
      }
    }

    const properties = schema.properties ?? {};
    for (const [propertyName, propertyValue] of Object.entries(dataProperties)) {
      if (propertyValue === undefined) {
        // Consistent with the `required` check above: an explicit `undefined`
        // value is treated as an absent property, not a present one of the
        // wrong type.
        continue;
      }
      if (properties[propertyName] !== undefined) {
        validateSchemaValue(propertyValue, properties[propertyName], schemaMap, `${location}.${propertyName}`, errors);
      } else if (schema.additionalProperties === false) {
        errors.push({ code: "additional_property", location: `${location}.${propertyName}` });
      }
    }
  }
}

function resolveRef(ref: string, schemaMap: Record<string, JsonSchema>): JsonSchema | undefined {
  const [schemaId, fragment] = ref.split("#");
  let target = schemaId === undefined ? undefined : schemaMap[schemaId];
  if (target === undefined) {
    return undefined;
  }
  if (fragment === undefined || fragment === "") {
    return target;
  }
  const pointer = fragment.startsWith("/") ? fragment : fragment.slice(1);
  const segments = pointer.split("/").filter(Boolean).map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
  for (const segment of segments) {
    const next = (target as Record<string, unknown>)[segment];
    if (!isRecord(next)) {
      return undefined;
    }
    target = next as JsonSchema;
  }
  return target;
}

function matchesType(value: unknown, type: string): boolean {
  if (type === "null") {
    return value === null;
  }
  if (type === "array") {
    return Array.isArray(value);
  }
  if (type === "object") {
    return isPlainRecord(value);
  }
  if (type === "integer") {
    return Number.isSafeInteger(value);
  }
  if (type === "number") {
    return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER;
  }
  return typeof value === type;
}

function jsonValueEquals(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// C3-01: `isRecord` accepts any non-array object regardless of prototype, so
// a caller can put every required protocol field on an object's prototype
// (e.g. `Object.create(validProtocolObject)`), expose zero own properties,
// and have `required`/`properties` checks pass by reading through the
// prototype chain. A plain-JSON value can never have a non-Object.prototype
// (or null) prototype, so reject anything else as a type mismatch rather
// than silently validating inherited state.
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// Restricts a plain record to its own, enumerable, non-accessor properties.
// `required`/`dependentRequired` must only be satisfied by real own data, not
// by an inherited value; and an accessor (getter) property is rejected
// outright rather than trusted, since its value could differ between the
// moment it's validated and the moment a caller reads a field off the same
// object afterward.
function ownEnumerableDataProperties(value: Record<string, unknown>): { dataProperties: Record<string, unknown>; accessorKeys: string[] } {
  const dataProperties: Record<string, unknown> = {};
  const accessorKeys: string[] = [];
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && "value" in descriptor) {
      dataProperties[key] = descriptor.value;
    } else {
      accessorKeys.push(key);
    }
  }
  return { dataProperties, accessorKeys };
}

const UTC_RFC3339_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|\+00:00)$/;

export function isUtcRfc3339Timestamp(value: string): boolean {
  const match = UTC_RFC3339_PATTERN.exec(value);
  if (match === null) {
    return false;
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  if (yearText === undefined || monthText === undefined || dayText === undefined || hourText === undefined || minuteText === undefined || secondText === undefined) {
    return false;
  }
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 60) {
    return false;
  }
  const daysByMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const daysInMonth = daysByMonth[month - 1];
  return daysInMonth !== undefined && day >= 1 && day <= daysInMonth;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

// C5-15/C5-20/C5-31: chronology checks across intake/worker must not rely on
// lexical string comparison (fails across `Z`/`+00:00` spellings and varying
// fractional-second precision) or `Date.parse` (drops sub-millisecond
// precision, so distinct nanosecond-precision timestamps can compare equal).
const UTC_RFC3339_FRACTION_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(?:Z|\+00:00)$/;

export function utcRfc3339ToNanoseconds(value: string): bigint {
  if (!isUtcRfc3339Timestamp(value)) {
    throw new TypeError("value must be a valid UTC RFC 3339 timestamp");
  }
  const match = UTC_RFC3339_FRACTION_PATTERN.exec(value);
  if (match === null) {
    throw new TypeError("value must be a valid UTC RFC 3339 timestamp");
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fractionText] = match;
  if (yearText === undefined || monthText === undefined || dayText === undefined || hourText === undefined || minuteText === undefined || secondText === undefined) {
    throw new TypeError("value must be a valid UTC RFC 3339 timestamp");
  }
  const days = daysFromCivil(Number(yearText), Number(monthText), Number(dayText));
  const secondsSinceEpoch = BigInt(days) * 86400n + BigInt(hourText) * 3600n + BigInt(minuteText) * 60n + BigInt(secondText);
  const nanoseconds = BigInt((fractionText ?? "").padEnd(9, "0"));
  return secondsSinceEpoch * 1_000_000_000n + nanoseconds;
}

export function compareUtcRfc3339Timestamps(left: string, right: string): -1 | 0 | 1 {
  const leftNanos = utcRfc3339ToNanoseconds(left);
  const rightNanos = utcRfc3339ToNanoseconds(right);
  if (leftNanos < rightNanos) {
    return -1;
  }
  if (leftNanos > rightNanos) {
    return 1;
  }
  return 0;
}

// Howard Hinnant's `days_from_civil`: exact proleptic-Gregorian day count
// relative to the 1970-01-01 epoch, valid for the full year range this
// pattern accepts (0000-9999).
function daysFromCivil(year: number, month: number, day: number): number {
  const shiftedYear = month <= 2 ? year - 1 : year;
  const era = Math.floor((shiftedYear >= 0 ? shiftedYear : shiftedYear - 399) / 400);
  const yearOfEra = shiftedYear - era * 400;
  const monthOfYear = (month + 9) % 12;
  const dayOfYear = Math.floor((153 * monthOfYear + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}
