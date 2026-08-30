import { readFile } from "node:fs/promises";
import path from "node:path";

import { loadSchemas, readJson, resolveProjectPath, sha256Hex } from "./protocol-utils.mjs";

const generatedTypeFile = "protocol-v0.ts";
const generatedSchemaFile = "protocol-v0-schemas.ts";
const generatedClaimSafetyPolicyFile = "claim-safety-policy.ts";
const claimSafetyPolicyPath = resolveProjectPath("protocol/policies/claim-safety.v0.json");

export async function generateProtocolTypeArtifacts() {
  const { schemas, schemaMap } = await loadSchemas();
  const sortedSchemas = schemas.toSorted((left, right) => left.relativePath.localeCompare(right.relativePath));
  const sourceSchemas = [];

  for (const { relativePath, filePath } of sortedSchemas) {
    sourceSchemas.push({
      path: relativePath,
      sha256: sha256Hex(await readFile(filePath))
    });
  }

  const typeContent = renderTypes(sortedSchemas, schemaMap);
  const schemaContent = renderSchemas(sortedSchemas);
  const claimSafetyPolicy = await readJson(claimSafetyPolicyPath);
  const claimSafetyPolicyContent = renderClaimSafetyPolicy(claimSafetyPolicy);

  sourceSchemas.push({
    path: path.relative(resolveProjectPath("."), claimSafetyPolicyPath),
    sha256: sha256Hex(await readFile(claimSafetyPolicyPath))
  });

  return {
    files: [
      {
        path: generatedTypeFile,
        content: typeContent,
        sha256: sha256Hex(typeContent)
      },
      {
        path: generatedSchemaFile,
        content: schemaContent,
        sha256: sha256Hex(schemaContent)
      },
      {
        path: generatedClaimSafetyPolicyFile,
        content: claimSafetyPolicyContent,
        sha256: sha256Hex(claimSafetyPolicyContent)
      }
    ],
    sourceSchemas
  };
}

function renderClaimSafetyPolicy(policy) {
  const lines = [
    "// Generated from protocol/policies/claim-safety.v0.json. Do not edit by hand.",
    "// Regenerate with: npm run generate --workspace @onevps/protocol-ts",
    "",
    `export const CLAIM_SAFE_FORBIDDEN_PHRASES = ${JSON.stringify(policy.claim_safe_forbidden_phrases, null, 2)} as const;`,
    "",
    `export const CLAIM_SAFE_POSITIVE_CLOSURE_PHRASES = ${JSON.stringify(policy.positive_closure_phrases, null, 2)} as const;`,
    "",
    `export const CLAIM_SAFE_TYPED_REFERENCE_NAMESPACES = ${JSON.stringify(policy.typed_reference_namespaces, null, 2)} as const;`,
    "",
    `export const CLAIM_SAFE_TEXT_MAX_LENGTH = ${JSON.stringify(policy.claim_safe_text_max_length)};`,
    "",
    `export const PII_EMAIL_ADDRESS_PATTERN_SOURCE = ${JSON.stringify(policy.pii_email_address_pattern)};`,
    "",
    `export const SOURCE_TEXT_FORBIDDEN_PHRASES = ${JSON.stringify(policy.source_text_forbidden_phrases, null, 2)} as const;`,
    ""
  ];

  return `${lines.join("\n").trimEnd()}\n`;
}

export function generatedManifestForArtifacts(artifacts) {
  return {
    schemaVersion: 1,
    ownerStory: "1.3",
    status: "generated-from-protocol-schemas",
    hashAlgorithm: "sha256",
    sourceSchemas: artifacts.sourceSchemas,
    files: artifacts.files.map((file) => ({
      path: file.path,
      sha256: file.sha256
    }))
  };
}

function renderTypes(schemas, schemaMap) {
  const lines = [
    "// Generated from protocol/schemas/*.schema.json. Do not edit by hand.",
    "// Regenerate with: npm run generate --workspace @onevps/protocol-ts",
    "",
    "export type NonEmptyArray<T> = [T, ...T[]];",
    ""
  ];

  const sharedDefinitions = schemaMap.get("urn:codeattest:protocol:v0:shared-definitions")?.$defs ?? {};
  for (const [definitionName, definitionSchema] of Object.entries(sharedDefinitions).sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`export type ${pascalCase(definitionName)} = ${schemaToTypeScript(definitionSchema, schemaMap, 0)};`, "");
  }

  for (const { schema } of schemas) {
    if (schema.$id === "urn:codeattest:protocol:v0:shared-definitions") {
      continue;
    }
    const typeName = typeNameForSchemaId(schema.$id);
    lines.push(`export type ${typeName} = ${schemaToTypeScript(schema, schemaMap, 0)};`, "");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}


function renderSchemas(schemas) {
  const lines = [
    "// Generated from protocol/schemas/*.schema.json. Do not edit by hand.",
    "// Regenerate with: npm run generate --workspace @onevps/protocol-ts",
    ""
  ];

  const entries = [];
  for (const { schema } of schemas) {
    if (typeof schema.$id !== "string") {
      continue;
    }
    entries.push([schema.$id, schema]);
  }

  lines.push("export const protocolV0Schemas = {");
  for (const [schemaId, schema] of entries) {
    lines.push(`  ${JSON.stringify(schemaId)}: ${JSON.stringify(schema, null, 2).replaceAll("\n", "\n  ")},`);
  }
  lines.push("} as const;", "");
  lines.push("export type ProtocolV0SchemaId = keyof typeof protocolV0Schemas;", "");

  return `${lines.join("\n").trimEnd()}\n`;
}

function schemaToTypeScript(schema, schemaMap, indentLevel) {
  if (schema.$id === "urn:codeattest:protocol:v0:finding-classification-record") {
    return findingClassificationRecordToTypeScript(schema, schemaMap, indentLevel);
  }
  if (schema.$ref) {
    return typeNameForRef(schema.$ref);
  }
  if (schema.const !== undefined) {
    return JSON.stringify(schema.const);
  }
  if (schema.enum) {
    return schema.enum.map((value) => JSON.stringify(value)).join(" | ");
  }

  if (schema.type === "string") {
    return "string";
  }
  if (schema.type === "boolean") {
    return "boolean";
  }
  if (schema.type === "integer" || schema.type === "number") {
    return "number";
  }
  if (schema.type === "array") {
    const itemType = schemaToTypeScript(schema.items ?? {}, schemaMap, indentLevel);
    // C7-19: an exact minItems === maxItems bound (e.g. a fixed identity-input
    // exclusion list) previously collapsed to Array<T>, so TypeScript accepted
    // too few or too many elements even though the schema requires an exact
    // count. Render a fixed-length tuple instead.
    if (typeof schema.minItems === "number" && schema.minItems === schema.maxItems) {
      return `[${Array(schema.minItems).fill(itemType).join(", ")}]`;
    }
    return schema.minItems === 1 ? `NonEmptyArray<${itemType}>` : `Array<${itemType}>`;
  }
  if (schema.type === "object") {
    return objectSchemaToTypeScript(schema, schemaMap, indentLevel);
  }

  return "unknown";
}

function objectSchemaToTypeScript(schema, schemaMap, indentLevel) {
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const branches = conditionalRequiredBranches(schema, properties);
  if (branches) {
    return branches
      .map(({ discriminantField, literal, additionalRequired }) => {
        const branchRequired = new Set([...required, ...additionalRequired]);
        const overrides = new Map([[discriminantField, JSON.stringify(literal)]]);
        return objectPropertiesToTypeScript(properties, branchRequired, schemaMap, indentLevel, overrides);
      })
      .join(" | ");
  }
  return objectPropertiesToTypeScript(properties, required, schemaMap, indentLevel, new Map());
}

// C7-02: `allOf`/`if`/`then` conditional requirements (e.g.
// requested_verification_type: "reviewer_authored_script_output" requiring
// reviewer_validation_script_ref) were previously dropped entirely, so
// generated types accepted objects the schema actually rejects. This handles
// the required-field subset of conditional schemas: a single top-level
// string-enum discriminant field, with each `if` clause testing that field
// via `const` or `enum` and requiring additional fields via `then.required`.
// Other clauses may enforce value/state matrices which TypeScript object types
// cannot faithfully render; they are ignored here without erasing the required
// field discrimination that can be rendered. `bindings:check` plus the
// `@ts-expect-error` compile tests guard that supported subset.
function conditionalRequiredBranches(schema, properties) {
  if (!Array.isArray(schema.allOf) || schema.allOf.length === 0) {
    return undefined;
  }

  const requiredClauses = schema.allOf.filter((clause) => {
    const ifProperties = clause?.if?.properties;
    return Boolean(
      ifProperties &&
      typeof ifProperties === "object" &&
      !Array.isArray(ifProperties) &&
      Object.keys(ifProperties).length === 1 &&
      Array.isArray(clause?.then?.required)
    );
  });
  if (requiredClauses.length === 0) {
    return undefined;
  }
  if (requiredClauses.length !== schema.allOf.length && schema["x-typescript-conditional-required"] !== true) {
    return undefined;
  }

  const discriminantFields = new Set();
  for (const clause of requiredClauses) {
    const ifProperties = clause?.if?.properties;
    const fieldNames = Object.keys(ifProperties);
    discriminantFields.add(fieldNames[0]);
  }
  if (discriminantFields.size !== 1) {
    return undefined;
  }
  const [discriminantField] = discriminantFields;
  const discriminantSchema = properties[discriminantField];
  if (!discriminantSchema || discriminantSchema.type !== "string" || !Array.isArray(discriminantSchema.enum)) {
    return undefined;
  }

  return discriminantSchema.enum.map((literal) => {
    const additionalRequired = new Set();
    for (const clause of requiredClauses) {
      const condition = clause.if.properties[discriminantField];
      const matches = condition.const !== undefined ? condition.const === literal : Array.isArray(condition.enum) && condition.enum.includes(literal);
      if (matches) {
        for (const field of clause.then.required) {
          additionalRequired.add(field);
        }
      }
    }
    return { discriminantField, literal, additionalRequired };
  });
}

function findingClassificationRecordToTypeScript(schema, schemaMap, indentLevel) {
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const confirmed = objectPropertiesToTypeScript(properties, required, schemaMap, indentLevel, new Map([
    ["classification", "\"confirmed\""],
    ["confirmation_criteria", "NonEmptyArray<NonEmptyString>"]
  ]));
  const nonConfirmed = objectPropertiesToTypeScript(properties, required, schemaMap, indentLevel, new Map([
    ["classification", "\"likely\" | \"inconclusive\" | \"requires_customer_side_validation\""],
    ["confirmation_criteria", "Array<NonEmptyString>"]
  ]));
  return `${confirmed} | ${nonConfirmed}`;
}

function objectPropertiesToTypeScript(properties, required, schemaMap, indentLevel, propertyTypeOverrides) {
  const baseIndent = indent(indentLevel);
  const childIndent = indent(indentLevel + 1);
  const lines = ["{"];

  for (const [propertyName, propertySchema] of Object.entries(properties)) {
    const optional = required.has(propertyName) ? "" : "?";
    const propertyType = propertyTypeOverrides.get(propertyName) ?? schemaToTypeScript(propertySchema, schemaMap, indentLevel + 1);
    lines.push(`${childIndent}${propertyName}${optional}: ${propertyType};`);
  }

  lines.push(`${baseIndent}}`);
  return lines.join("\n");
}

function typeNameForRef(ref) {
  const [schemaId, fragment] = ref.split("#");
  if (fragment?.startsWith("/$defs/")) {
    return pascalCase(fragment.replace("/$defs/", ""));
  }
  return typeNameForSchemaId(schemaId);
}

function typeNameForSchemaId(schemaId) {
  return pascalCase(schemaId.split(":").at(-1) ?? "unknown");
}

function pascalCase(value) {
  return value
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("");
}

function indent(level) {
  return "  ".repeat(level);
}

export function generatedRoot() {
  return resolveProjectPath("packages/protocol-ts/src/generated");
}
