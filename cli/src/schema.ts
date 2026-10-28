import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";

/** One stack property in deploy-config.schema.json. */
export interface StackFieldSchema {
  description?: string;
  enum?: string[];
  examples?: unknown[];
  /** Stack types that read the field; "all" for every type. Fields without it are not offered by `stax add`. */
  "x-stax-types"?: "all" | string[];
}

interface TypeCondition {
  if: { properties: Record<string, { const?: string; enum?: string[] }>; required?: string[] };
  then: { required: string[] };
}

interface DeployConfigSchema {
  $id: string;
  properties: Record<string, unknown>;
  $defs: {
    externalRepo: { properties: Record<string, unknown> };
    stack: {
      properties: Record<string, StackFieldSchema>;
      allOf: TypeCondition[];
    };
  };
}

export const schema = JSON.parse(
  readFileSync(new URL("../schema/deploy-config.schema.json", import.meta.url), "utf8"),
) as DeployConfigSchema;

export const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
ajv.addKeyword({
  keyword: "x-stax-types",
  metaSchema: { anyOf: [{ const: "all" }, { type: "array", items: { type: "string" } }] },
});

export const validateDeployConfig = ajv.compile(schema);
export const STACK_TYPES = schema.$defs.stack.properties.type?.enum ?? [];

/**
 * Fields the schema requires for `type`, besides id and type, in schema order.
 * Conditions that also depend on another field (build_target, for example) are
 * not unconditional requirements of the type.
 */
export function requiredStackFields(type: string): string[] {
  return schema.$defs.stack.allOf
    .filter(({ if: condition }) => {
      const keys = Object.keys(condition.properties);
      if (keys.length !== 1 || keys[0] !== "type") return false;
      if ((condition.required ?? ["type"]).some((field) => field !== "type")) return false;
      const { const: single, enum: anyOf } = condition.properties.type ?? {};
      return single === type || (anyOf?.includes(type) ?? false);
    })
    .flatMap((rule) => rule.then.required);
}

/** Validates one value against a stack property's schema; returns the first problem. */
export function stackFieldProblem(field: string, value: unknown): string | undefined {
  const validate = ajv.getSchema(`${schema.$id}#/$defs/stack/properties/${field}`);
  if (!validate) throw new Error(`unknown stack field ${field}`);
  if (validate(value)) return undefined;
  const [error] = validate.errors ?? [];
  const allowed = error?.keyword === "enum" ? error.params.allowedValues : undefined;
  if (Array.isArray(allowed)) return `must be one of: ${allowed.join(", ")}`;
  const [example] = schema.$defs.stack.properties[field]?.examples ?? [];
  return `${error?.message ?? "invalid value"}${typeof example === "string" ? ` (e.g. ${example})` : ""}`;
}
