import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ErrorObject } from "ajv/dist/2020.js";
import { isMap, isScalar, LineCounter, parseDocument, type Document } from "yaml";
import { isRecord } from "./guards.ts";
import { ajv, schema, validateDeployConfig as validateSchema } from "./schema.ts";

export type Severity = "error" | "warning";

export interface Finding {
  severity: Severity;
  message: string;
  line: number;
  column: number;
}

type Path = (string | number)[];

/** a-wf-deploy-levels runs dependency levels l0 to l13. */
const MAX_LEVELS = 14;

const KNOWN_KEYS = {
  root: Object.keys(schema.properties),
  stack: Object.keys(schema.$defs.stack.properties),
  externalRepo: Object.keys(schema.$defs.externalRepo.properties),
};

/** Renders a document path the way users read it: stacks[1].depends_on[0]. */
function formatPath(path: Path): string {
  return path
    .map((segment, index) => (typeof segment === "number" ? `[${segment}]` : index === 0 ? segment : `.${segment}`))
    .join("");
}

class Reporter {
  readonly findings: Finding[] = [];
  private readonly seen = new Set<string>();
  private readonly doc: Document;
  private readonly lineCounter: LineCounter;

  constructor(doc: Document, lineCounter: LineCounter) {
    this.doc = doc;
    this.lineCounter = lineCounter;
  }

  add(severity: Severity, path: Path, message: string): void {
    const text = path.length > 0 ? `${formatPath(path)}: ${message}` : message;
    const dedupeKey = `${severity}|${text}`;
    if (this.seen.has(dedupeKey)) return;
    this.seen.add(dedupeKey);
    const { line, col } = this.position(path);
    this.findings.push({ severity, message: text, line, column: col });
  }

  /**
   * Position of a field's key (paths ending in a field name) or of a list item, falling back to the
   * nearest existing ancestor.
   */
  private position(path: Path): { line: number; col: number } {
    if (typeof path.at(-1) === "string") {
      const parent = this.doc.getIn(path.slice(0, -1), true);
      if (isMap(parent)) {
        const pair = parent.items.find((item) => isScalar(item.key) && item.key.value === path.at(-1));
        if (pair && isScalar(pair.key) && pair.key.range) return this.lineCounter.linePos(pair.key.range[0]);
      }
    }
    for (let depth = path.length; depth >= 0; depth -= 1) {
      const node = depth === 0 ? this.doc.contents : this.doc.getIn(path.slice(0, depth), true);
      if (node && typeof node === "object" && "range" in node && Array.isArray(node.range)) {
        return this.lineCounter.linePos(node.range[0] as number);
      }
    }
    return { line: 1, col: 1 };
  }
}

function schemaMessage(error: ErrorObject, path: Path): string {
  switch (error.keyword) {
    case "required":
      return `missing required field "${String(error.params.missingProperty)}"`;
    case "enum": {
      const allowed = (error.params.allowedValues as unknown[]).join(", ");
      return path.at(-1) === "type" ? `unknown stack type; expected one of: ${allowed}` : `must be one of: ${allowed}`;
    }
    case "pattern":
      return path.at(-1) === "packer_version"
        ? "must be an exact numeric Major.Minor.Patch version"
        : `must match ${String(error.params.pattern)}`;
    default:
      return error.message ?? error.keyword;
  }
}

function checkSchema(data: unknown, report: Reporter): void {
  if (validateSchema(data)) return;
  for (const error of validateSchema.errors ?? []) {
    // "if" errors only say a "then" branch failed; the branch's own error carries the detail.
    if (error.keyword === "if") continue;
    const path: Path = error.instancePath
      .split("/")
      .slice(1)
      .map((segment) => (/^\d+$/.test(segment) ? Number(segment) : segment.replaceAll("~1", "/").replaceAll("~0", "~")));
    report.add("error", path, schemaMessage(error, path));
  }
}

function checkUnknownKeys(value: unknown, known: string[], path: Path, report: Reporter): void {
  if (!isRecord(value)) return;
  for (const key of Object.keys(value)) {
    if (!known.includes(key)) report.add("warning", [...path, key], "unknown field");
  }
}

/** Mirrors validateRelativePosixPath in gh-create-deploy-config (Packer paths). */
function packerPathProblem(value: string): string | undefined {
  if (/^[A-Za-z]:/.test(value) || value.startsWith("/")) return "must be repository-relative";
  if (/[\u0000-\u001f\u007f]/.test(value)) return "must not contain control characters";
  if (value.includes("\\")) return "must use POSIX separators";
  const segments = value.split("/");
  if (segments.includes("..")) return 'must not contain a ".." segment';
  if (segments.includes("")) return "must not contain empty path segments";
  return undefined;
}

const GALLERY_FIELDS = [
  "image_resource_group_name",
  "gallery_name",
  "image_definition_name",
  "image_version",
  "target_regions",
] as const;

const RESERVED_SNAPSHOT_LABELS = ["managed_by", "stax_stack_id", "stax_env", "stax_git_sha", "stax_build_target"];

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** build_target rules that JSON Schema if/then cannot express: aliases, conflicts, and the AWS stub. */
function checkPackerBuildTarget(stack: Record<string, unknown>, index: number, report: Reporter): void {
  const target = stack.build_target === undefined ? "azure" : stack.build_target;
  if (target !== "azure" && target !== "hetzner" && target !== "aws") return;

  if (target === "aws") {
    report.add("warning", ["stacks", index, "build_target"], "aws is reserved and not implemented; the workflow rejects it until an AMI executor exists");
  }

  for (const field of GALLERY_FIELDS) {
    if (stack[field] !== undefined) {
      report.add("warning", ["stacks", index, field], `deprecated alias of azure.${field}; move it under azure`);
    }
  }

  const azure = isRecord(stack.azure) ? stack.azure : undefined;
  if (azure) {
    for (const field of GALLERY_FIELDS) {
      if (stack[field] !== undefined && azure[field] !== undefined && !sameJson(stack[field], azure[field])) {
        report.add("error", ["stacks", index, "azure", field], `conflicts with deprecated alias ${field}`);
      }
    }
  }

  if (target === "azure" && stack.hetzner !== undefined) {
    report.add("error", ["stacks", index, "hetzner"], "does not apply when build_target is azure");
  }
  if (target === "azure" && stack.aws !== undefined) {
    report.add("error", ["stacks", index, "aws"], "does not apply when build_target is azure");
  }
  if (target === "hetzner" && (azure || GALLERY_FIELDS.some((field) => stack[field] !== undefined))) {
    report.add("error", ["stacks", index, "build_target"], "hetzner does not use Azure Gallery fields");
  }
  if (target === "hetzner" && stack.aws !== undefined) {
    report.add("error", ["stacks", index, "aws"], "does not apply when build_target is hetzner");
  }
  if (target === "aws" && (azure || stack.hetzner !== undefined || GALLERY_FIELDS.some((field) => stack[field] !== undefined))) {
    report.add("error", ["stacks", index, "build_target"], "aws does not use Azure Gallery or Hetzner fields");
  }

  if (isRecord(stack.hetzner) && isRecord(stack.hetzner.snapshot_labels)) {
    for (const key of RESERVED_SNAPSHOT_LABELS) {
      if (stack.hetzner.snapshot_labels[key] !== undefined) {
        report.add("warning", ["stacks", index, "hetzner", "snapshot_labels", key], "reserved label; STAX overwrites it");
      }
    }
  }

  if ((stack.destroy === true || stack.destroy === "true") && target !== "hetzner") {
    report.add("warning", ["stacks", index, "destroy"], "Packer destroy is only supported for build_target hetzner; Azure Gallery builds stay build-only");
  }
}

/** Collects stack.<id>.var|secret.<key> references in an input value, like update_deploy_config. */
function collectStackReferences(value: unknown, path: Path, out: { path: Path; ref: string }[]): void {
  if (typeof value === "string") {
    if (value.startsWith("stack.")) out.push({ path, ref: value });
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => collectStackReferences(item, [...path, index], out));
  } else if (isRecord(value)) {
    for (const [key, nested] of Object.entries(value)) collectStackReferences(nested, [...path, key], out);
  }
}

function checkPipelineRules(data: Record<string, unknown>, report: Reporter): void {
  const stacks = Array.isArray(data.stacks) ? data.stacks : [];
  if (stacks.length === 0) {
    report.add("warning", data.stacks === undefined ? [] : ["stacks"], "no stacks defined; nothing will be deployed");
    return;
  }
  const aliases = isRecord(data.externalRepos) ? Object.keys(data.externalRepos) : [];

  const firstIndexById = new Map<string, number>();
  stacks.forEach((stack, index) => {
    if (!isRecord(stack) || typeof stack.id !== "string") return;
    if (firstIndexById.has(stack.id)) {
      report.add("error", ["stacks", index, "id"], `duplicate stack id "${stack.id}"`);
    } else {
      firstIndexById.set(stack.id, index);
    }
  });

  const dependencies = new Map<string, Set<string>>();
  // Cross-config references are a normal multi-config pattern: report each referenced id once per file.
  const externalDependsOn = new Map<string, { path: Path; count: number }>();
  const externalReferences = new Map<string, { path: Path; count: number }>();
  const noteExternal = (seen: Map<string, { path: Path; count: number }>, id: string, path: Path) => {
    const entry = seen.get(id);
    if (entry) entry.count += 1;
    else seen.set(id, { path, count: 1 });
  };
  let pagesStackId: string | undefined;
  stacks.forEach((stack, index) => {
    if (!isRecord(stack) || typeof stack.id !== "string" || firstIndexById.get(stack.id) !== index) return;
    const deps = new Set<string>();
    dependencies.set(stack.id, deps);

    // Pages stacks also accept a direct owner/repository (github-pages-config.mjs).
    const directRepository = stack.type === "github-pages-site-deploy" && typeof stack.source_repo === "string" && stack.source_repo.includes("/");
    if (typeof stack.source_repo === "string" && !directRepository && !aliases.includes(stack.source_repo)) {
      // setup-ci merges externalRepos across all configs passed together, so the alias may live in another file.
      const defined = aliases.length > 0 ? `this file defines: ${aliases.join(", ")}` : "this file defines no externalRepos";
      report.add(
        "warning",
        ["stacks", index, "source_repo"],
        `externalRepos alias "${stack.source_repo}" is not in this file (${defined}); unless another config deployed with this one defines it, the stack fails or uses the calling repository, depending on its type`,
      );
    }

    if (stack.type === "packer") {
      for (const field of ["packer_directory", "packer_template"] as const) {
        const value = stack[field];
        const problem = typeof value === "string" ? packerPathProblem(value) : undefined;
        if (problem) report.add("error", ["stacks", index, field], problem);
      }
      checkPackerBuildTarget(stack, index, report);
    } else if (stack.build_target !== undefined) {
      report.add("warning", ["stacks", index, "build_target"], "applies to packer stacks only");
    }

    // Mirrors validateGitHubPagesConfig and github-pages-config.mjs.
    if (stack.type === "github-pages-site-deploy") {
      if (pagesStackId !== undefined) {
        report.add("error", ["stacks", index, "type"], `more than one github-pages-site-deploy stack ("${pagesStackId}" and "${stack.id}")`);
      }
      pagesStackId ??= stack.id;
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(stack.id)) {
        report.add("error", ["stacks", index, "id"], "a github-pages-site-deploy id may contain only letters, digits, dots, underscores and hyphens");
      }
      if (stack.destroy === true || stack.destroy === "true") {
        report.add("error", ["stacks", index, "destroy"], "github-pages-site-deploy does not support destroy");
      }
    }

    if (Array.isArray(stack.depends_on)) {
      stack.depends_on.forEach((dependency, depIndex) => {
        if (typeof dependency !== "string") return;
        if (firstIndexById.has(dependency)) {
          deps.add(dependency);
        } else {
          noteExternal(externalDependsOn, dependency, ["stacks", index, "depends_on", depIndex]);
        }
      });
    }

    const references: { path: Path; ref: string }[] = [];
    collectStackReferences(stack.input, ["stacks", index, "input"], references);
    for (const { path, ref } of references) {
      const [, referencedId, kind, key] = ref.split(".");
      if (ref.split(".").length !== 4 || (kind !== "var" && kind !== "secret") || !referencedId || !key) {
        report.add("error", path, `invalid stack reference "${ref}"; expected stack.<id>.var.<key> or stack.<id>.secret.<key>`);
      } else if (firstIndexById.has(referencedId)) {
        deps.add(referencedId);
      } else {
        noteExternal(externalReferences, referencedId, path);
      }
    }
  });

  for (const [id, { path, count }] of externalDependsOn) {
    const suffix = count === 1 ? "" : ` (${count} references)`;
    report.add(
      "warning",
      path,
      `"${id}" is not in this file${suffix}; the pipeline treats it as a dependency on another config and ignores it for ordering`,
    );
  }
  for (const [id, { path, count }] of externalReferences) {
    const suffix = count === 1 ? "" : ` (${count} references)`;
    report.add("warning", path, `stack "${id}" is not in this file${suffix}; its values are read from stored outputs at runtime`);
  }

  // Level scheduling as in generate_layerdeployment: a stack runs one level after its last dependency.
  const level = new Map<string, number>();
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const [id, deps] of dependencies) {
      if (level.has(id) || ![...deps].every((dep) => level.has(dep))) continue;
      level.set(id, deps.size === 0 ? 0 : Math.max(...[...deps].map((dep) => level.get(dep) ?? 0)) + 1);
      progressed = true;
    }
  }
  for (const [id, deps] of dependencies) {
    const index = firstIndexById.get(id) ?? 0;
    const stackLevel = level.get(id);
    if (stackLevel === undefined) {
      const unresolved = [...deps].filter((dep) => !level.has(dep));
      report.add("error", ["stacks", index, "id"], `"${id}" cannot be scheduled: dependency cycle through ${unresolved.join(", ")}`);
    } else if (stackLevel >= MAX_LEVELS) {
      report.add(
        "error",
        ["stacks", index, "id"],
        `"${id}" needs dependency level l${stackLevel}; the pipeline runs at most ${MAX_LEVELS} levels (l0-l${MAX_LEVELS - 1})`,
      );
    }
  }
}

const AWS_OPTION_DEFAULTS: Record<string, string> = {
  aws_endpoint_url: "",
  aws_endpoint_url_s3: "",
  aws_endpoint_url_sts: "",
  aws_endpoint_url_iam: "",
  aws_s3_compatible: "false",
  aws_skip_sts_check: "false",
  state_use_lockfile: "true",
  state_use_path_style: "false",
};

const ENDPOINT_FIELDS = ["aws_endpoint_url", "aws_endpoint_url_s3", "aws_endpoint_url_sts", "aws_endpoint_url_iam"];

function checkEndpointURLs(deployment: Record<string, unknown>, report: Reporter): void {
  const endpointShape = ajv.getSchema(`${schema.$id}#/$defs/endpointUrl`);
  if (!endpointShape) throw new Error("endpointUrl schema definition is missing");
  for (const field of ENDPOINT_FIELDS) {
    const raw = deployment[field];
    if (typeof raw !== "string" || !raw.trim() || !endpointShape(raw)) continue;
    const value = raw.trim();
    try {
      new URL(value);
    } catch {
      report.add("error", ["deployment", field], "must be a valid absolute URL with a hostname and valid port");
      continue;
    }
    if (!value.startsWith("https://") && !/^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]+)?(?:\/|$)/.test(value)) {
      report.add("error", ["deployment", field], "must use https (http is only allowed for localhost / 127.0.0.1 / [::1])");
    }
  }
}

function deploymentText(value: unknown): string {
  return value === undefined || value === null ? "" : String(value).trim();
}

/** Mirrors the AWS option checks in .github/scripts/deployment-config.mjs and a-wf-setup-ci. */
function checkDeploymentRules(data: Record<string, unknown>, report: Reporter): void {
  const deployment = data.deployment;
  if (!isRecord(deployment)) return;
  const cloud = deploymentText(deployment.cloud).toLowerCase();
  checkEndpointURLs(deployment, report);
  const changed = Object.entries(AWS_OPTION_DEFAULTS)
    .filter(([field, fallback]) => {
      const value = deploymentText(deployment[field]);
      return value !== "" && value !== fallback;
    })
    .map(([field]) => field);

  // An unset cloud may still resolve to aws from the CLOUD variable.
  if (cloud !== "" && cloud !== "aws") {
    for (const field of changed) report.add("error", ["deployment", field], `only applies to cloud "aws" (cloud is "${cloud}")`);
    return;
  }
}

/** Validates one deploy config. Findings are sorted by position. */
export function validateConfigText(text: string): Finding[] {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, prettyErrors: false });
  const report = new Reporter(doc, lineCounter);

  if (doc.errors.length > 0) {
    return doc.errors.map((error) => {
      const { line, col } = lineCounter.linePos(error.pos[0]);
      return { severity: "error" as const, message: `invalid YAML: ${error.message.split("\n")[0]}`, line, column: col };
    });
  }

  const data: unknown = doc.toJS();
  if (!isRecord(data)) {
    report.add("error", [], "a deploy config must be a mapping with a stacks list");
    return report.findings;
  }

  checkSchema(data, report);
  checkUnknownKeys(data, KNOWN_KEYS.root, [], report);
  if (isRecord(data.externalRepos)) {
    for (const [alias, entries] of Object.entries(data.externalRepos)) {
      if (Array.isArray(entries)) {
        entries.forEach((entry, index) => checkUnknownKeys(entry, KNOWN_KEYS.externalRepo, ["externalRepos", alias, index], report));
      }
    }
  }
  if (Array.isArray(data.stacks)) {
    data.stacks.forEach((stack, index) => checkUnknownKeys(stack, KNOWN_KEYS.stack, ["stacks", index], report));
  }
  checkDeploymentRules(data, report);
  checkPipelineRules(data, report);

  return report.findings.sort((a, b) => a.line - b.line || a.column - b.column);
}

/**
 * Whether a YAML file in a scanned directory is a deploy config: a mapping with at least one of the
 * deploy-config top-level keys. Files that fail to parse count as deploy configs so the error is shown.
 */
export function isDeployConfigText(text: string): boolean {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) return true;
  const data: unknown = doc.toJS();
  return isRecord(data) && KNOWN_KEYS.root.some((key) => key in data);
}

/**
 * YAML files to validate: `target` itself when it is a file, otherwise the .yaml/.yml files in the
 * directory (and its subdirectories when `recursive`), sorted by path.
 */
export function collectConfigFiles(target: string, recursive: boolean): string[] {
  if (statSync(target).isFile()) return [target];
  return readdirSync(target, { recursive, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}
