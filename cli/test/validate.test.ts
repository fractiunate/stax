import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateConfigText, type Finding } from "../src/validate.ts";

const CLI = join(import.meta.dirname, "../src/cli.ts");

function brief(findings: Finding[]) {
  return findings.map(({ severity, line, message }) => ({ severity, line, message }));
}

describe("validateConfigText", () => {
  it("accepts a config whose references all resolve", () => {
    const config = `externalRepos:
  shared:
    - repoURL: github.com/example-org/stacks.git
      targetRevision: main
      use_app_token: true
stacks:
  - id: network
    type: opentofu
    source_repo: shared
    local_backend: false
    folder: network
  - id: app
    type: terraform
    depends_on: [network]
    input:
      - global.pipeline.var.project
      - vnet_id: stack.network.var.vnet_id
    folder: app
  - id: image
    type: packer
    packer_directory: images/ubuntu
    packer_template: azure.pkr.hcl
    packer_version: "1.11.2"
  - id: docs
    type: github-pages-site-deploy
    site_source_type: zensical
    source_repo: example-org/docs
`;
    expect(validateConfigText(config)).toEqual([]);
  });

  it("accepts partial deployment context with explicit false and GitHub fallbacks", () => {
    expect(validateConfigText("deployment:\n  project: shop\n  cloud: Azure\n  public_cloud_flag: false\n  stage: null\nstacks:\n  - id: docs\n    type: github-pages-site-deploy\n")).toEqual([]);
  });

  const wasabi = `deployment:
  cloud: aws
  aws_endpoint_url_s3: https://s3.eu-central-2.wasabisys.com
  aws_endpoint_url_sts: https://sts.wasabisys.com
  aws_s3_compatible: true
  state_use_path_style: "false"
`;
  const docsStack = "stacks:\n  - id: docs\n    type: github-pages-site-deploy\n";

  it("accepts S3-compatible endpoint options for AWS", () => {
    expect(validateConfigText(wasabi + docsStack)).toEqual([]);
  });

  it("accepts unlocked S3-compatible state with an explicit false", () => {
    expect(validateConfigText(`${wasabi}  state_use_lockfile: false\n${docsStack}`)).toEqual([]);
  });

  it("accepts skipping STS for an S3 endpoint without STS", () => {
    expect(validateConfigText(`deployment:\n  cloud: aws\n  aws_endpoint_url_s3: https://s3.example.com\n  aws_skip_sts_check: true\n${docsStack}`)).toEqual([]);
  });

  it("rejects AWS endpoint options for Azure but accepts their defaults", () => {
    const findings = validateConfigText(`deployment:\n  cloud: azure\n  aws_endpoint_url_s3: https://s3.example.com\n  state_use_lockfile: true\n${docsStack}`);
    expect(brief(findings)).toEqual([
      { severity: "error", line: 3, message: 'deployment.aws_endpoint_url_s3: only applies to cloud "aws" (cloud is "azure")' },
    ]);
  });

  it.each([
    "aws_endpoint_url_s3: s3.wasabisys.com",
    "aws_endpoint_url_s3: http://s3.wasabisys.com",
    "aws_endpoint_url_iam: https://key:secret@iam.wasabisys.com",
    "aws_endpoint_url: https://s3.example.com/?region=x",
    "aws_s3_compatible: yes",
    "state_use_lockfile: 0",
  ])("rejects invalid endpoint option %s", (field) => {
    const findings = validateConfigText(`deployment:\n  cloud: aws\n  ${field}\n${docsStack}`);
    expect(findings).toEqual(expect.arrayContaining([expect.objectContaining({ severity: "error", message: expect.stringContaining("deployment.") })]));
  });

  it("accepts plain http endpoints on localhost", () => {
    expect(validateConfigText(`deployment:\n  cloud: aws\n  aws_endpoint_url: http://127.0.0.1:9000\n${docsStack}`)).toEqual([]);
  });

  it.each([
    "aws_endpoint_url_s3: https://",
    "aws_endpoint_url_s3: https://s3.example.com:invalid",
    "aws_endpoint_url_s3: https://s3.example.com:99999",
    "aws_endpoint_url_s3: https://s3.example.com/path@user",
    "aws_endpoint_url_s3: https://s3.example.com\\evil",
    "aws_endpoint_url_s3: http://LOCALHOST:9000",
  ])("rejects malformed or ambiguous endpoint %s", (field) => {
    const findings = validateConfigText(`deployment:\n  cloud: aws\n  ${field}\n${docsStack}`);
    expect(findings).toEqual(expect.arrayContaining([expect.objectContaining({ severity: "error", message: expect.stringContaining("deployment.aws_endpoint_url_s3") })]));
  });

  it.each([
    "project: 12",
    "cloud: gcp",
    "public_cloud_flag: yes",
    "unknown_context_field: value",
  ])("rejects invalid deployment context %s", (field) => {
    const findings = validateConfigText(`deployment:\n  ${field}\nstacks:\n  - id: docs\n    type: github-pages-site-deploy\n`);
    expect(findings).toEqual(expect.arrayContaining([expect.objectContaining({ severity: "error", message: expect.stringContaining("deployment") })]));
  });

  it.each([
    {
      name: "unknown stack type",
      config: "stacks:\n  - id: a\n    type: terrafrom\n",
      expected: { severity: "error", line: 3, message: "stacks[0].type: unknown stack type; expected one of: terraform," },
    },
    {
      name: "missing id",
      config: "stacks:\n  - type: opentofu\n    folder: a\n",
      expected: { severity: "error", line: 2, message: 'stacks[0]: missing required field "id"' },
    },
    {
      name: "missing type, which the pipeline silently skips",
      config: "stacks:\n  - id: a\n",
      expected: { severity: "error", line: 2, message: 'stacks[0]: missing required field "type"' },
    },
    {
      name: "packer without version",
      config: "stacks:\n  - id: img\n    type: packer\n    packer_directory: images\n",
      expected: { severity: "error", line: 2, message: 'stacks[0]: missing required field "packer_version"' },
    },
    {
      name: "packer version range",
      config: "stacks:\n  - id: img\n    type: packer\n    packer_directory: images\n    packer_version: ~1.11\n",
      expected: { severity: "error", line: 5, message: "stacks[0].packer_version: must be an exact numeric Major.Minor.Patch version" },
    },
    {
      name: "packer path leaving the repository",
      config: "stacks:\n  - id: img\n    type: packer\n    packer_directory: ../images\n    packer_version: 1.11.2\n",
      expected: { severity: "error", line: 4, message: 'stacks[0].packer_directory: must not contain a ".." segment' },
    },
    {
      name: "string where the workflows need a boolean",
      config: 'stacks:\n  - id: a\n    type: opentofu\n    local_backend: "false"\n    folder: a\n',
      expected: { severity: "error", line: 4, message: "stacks[0].local_backend: must be boolean" },
    },
    {
      name: "s3 site without region",
      config: "stacks:\n  - id: site\n    type: s3-site-deploy\n",
      expected: { severity: "error", line: 2, message: 'stacks[0]: missing required field "location"' },
    },
    {
      name: "duplicate stack id",
      config: "stacks:\n  - id: a\n    type: opentofu\n    folder: a\n  - id: a\n    type: opentofu\n    folder: a\n",
      expected: { severity: "error", line: 5, message: 'stacks[1].id: duplicate stack id "a"' },
    },
    {
      name: "malformed stack reference",
      config: "stacks:\n  - id: a\n    type: opentofu\n    input:\n      - stack.b.output.x\n    folder: a\n",
      expected: { severity: "error", line: 5, message: 'stacks[0].input[0]: invalid stack reference "stack.b.output.x"' },
    },
    {
      name: "a second GitHub Pages stack",
      config: "stacks:\n  - id: a\n    type: github-pages-site-deploy\n  - id: b\n    type: github-pages-site-deploy\n",
      expected: { severity: "error", line: 5, message: 'stacks[1].type: more than one github-pages-site-deploy stack ("a" and "b")' },
    },
    {
      name: "destroy on a GitHub Pages stack",
      config: "stacks:\n  - id: a\n    type: github-pages-site-deploy\n    destroy: true\n",
      expected: { severity: "error", line: 4, message: "stacks[0].destroy: github-pages-site-deploy does not support destroy" },
    },
    {
      name: "invalid YAML",
      config: "stacks:\n  - id: a\n   type: opentofu\n",
      expected: { severity: "error", line: 3, message: "invalid YAML:" },
    },
    {
      name: "document that is not a mapping",
      config: "- id: a\n",
      expected: { severity: "error", line: 1, message: "a deploy config must be a mapping with a stacks list" },
    },
  ])("reports $name", ({ config, expected }) => {
    const findings = brief(validateConfigText(config));
    expect(findings).toContainEqual({ ...expected, message: expect.stringContaining(expected.message) });
    expect(findings.filter((finding) => finding.severity === "error")).toHaveLength(1);
  });

  it("reports every stack in a dependency cycle, including cycles through input references", () => {
    const config =
      "stacks:\n  - id: a\n    type: opentofu\n    depends_on: [b]\n    folder: a\n  - id: b\n    type: opentofu\n    input:\n      - x: stack.a.var.x\n    folder: b\n";
    expect(brief(validateConfigText(config))).toEqual([
      { severity: "error", line: 2, message: 'stacks[0].id: "a" cannot be scheduled: dependency cycle through b' },
      { severity: "error", line: 6, message: 'stacks[1].id: "b" cannot be scheduled: dependency cycle through a' },
    ]);
  });

  it("rejects dependency chains deeper than the 14 pipeline levels", () => {
    const chain = Array.from(
      { length: 15 },
      (_, i) => `  - id: s${i}\n    type: opentofu\n    folder: s${i}\n${i > 0 ? `    depends_on: [s${i - 1}]\n` : ""}`,
    );
    const findings = brief(validateConfigText(`stacks:\n${chain.join("")}`));
    expect(findings).toEqual([
      {
        severity: "error",
        line: expect.any(Number),
        message: 'stacks[14].id: "s14" needs dependency level l14; the pipeline runs at most 14 levels (l0-l13)',
      },
    ]);
  });

  it.each([
    {
      name: "unknown field (likely a typo)",
      config: "stacks:\n  - id: a\n    type: opentofu\n    depend_on: [b]\n    folder: a\n",
      expected: { severity: "warning", line: 4, message: "stacks[0].depend_on: unknown field" },
    },
    {
      name: "depends_on outside this file, which the pipeline ignores for ordering",
      config: "stacks:\n  - id: a\n    type: opentofu\n    depends_on: [shared-network]\n    folder: a\n",
      expected: { severity: "warning", line: 4, message: 'stacks[0].depends_on[0]: "shared-network" is not in this file' },
    },
    {
      name: "stack reference outside this file",
      config: "stacks:\n  - id: a\n    type: opentofu\n    input:\n      - stack.other.var.x\n    folder: a\n",
      expected: { severity: "warning", line: 5, message: 'stacks[0].input[0]: stack "other" is not in this file' },
    },
    {
      name: "externalRepos alias from another config deployed together with this one",
      config: "externalRepos: []\nstacks:\n  - id: a\n    type: opentofu\n    source_repo: shared\n    folder: a\n",
      expected: {
        severity: "warning",
        line: 5,
        message: 'stacks[0].source_repo: externalRepos alias "shared" is not in this file (this file defines no externalRepos)',
      },
    },
  ])("warns about $name without failing", ({ config, expected }) => {
    expect(brief(validateConfigText(config))).toEqual([{ ...expected, message: expect.stringContaining(expected.message) }]);
  });

  it("accepts a legacy Packer stack and a Hetzner stack, and warns that AWS is not implemented", () => {
    const legacy = `stacks:
  - id: img
    type: packer
    packer_directory: images/ubuntu
    packer_template: azure.pkr.hcl
    packer_version: "1.11.2"
    input:
      - gallery_name: corp_gallery
`;
    expect(validateConfigText(legacy)).toEqual([]);

    const hetzner = `stacks:
  - id: golden-hetzner
    type: packer
    packer_directory: packer/personal-assistant
    packer_template: .
    packer_version: "1.16.1"
    build_target: hetzner
    hetzner:
      location: fsn1
      server_type: cax11
      snapshot_name: personal-assistant-golden
      snapshot_labels:
        personal-assistant: "true"
        role: golden
      keep_last: 3
    output-var: [image_id, image_ref, build_target, version, labels]
`;
    expect(validateConfigText(hetzner)).toEqual([]);

    const aws = `stacks:
  - id: golden-aws
    type: packer
    packer_directory: packer/ami
    packer_version: "1.16.1"
    build_target: aws
    aws:
      regions: [eu-central-1]
`;
    expect(brief(validateConfigText(aws))).toEqual([
      { severity: "warning", line: 6, message: expect.stringContaining("aws is reserved and not implemented") },
    ]);
  });

  it("rejects a Hetzner target without hetzner and conflicting Gallery aliases", () => {
    const missing = brief(validateConfigText("stacks:\n  - id: img\n    type: packer\n    packer_directory: images\n    packer_version: 1.11.2\n    build_target: hetzner\n"));
    expect(missing).toContainEqual({ severity: "error", line: 2, message: expect.stringContaining('missing required field "hetzner"') });

    const conflict = brief(validateConfigText(`stacks:
  - id: img
    type: packer
    packer_directory: images
    packer_version: "1.11.2"
    gallery_name: old
    azure:
      gallery_name: new
`));
    expect(conflict).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: "error", message: expect.stringContaining("conflicts with deprecated alias gallery_name") }),
      expect.objectContaining({ severity: "warning", message: expect.stringContaining("deprecated alias of azure.gallery_name") }),
    ]));
  });

  it("validates the Packer examples", () => {
    const directory = join(import.meta.dirname, "../../examples/packer");
    for (const name of ["legacy-azure.yaml", "azure.yaml", "hetzner-personal-assistant.yaml"]) {
      expect(validateConfigText(readFileSync(join(directory, name), "utf8")), name).toEqual([]);
    }
    const aws = brief(validateConfigText(readFileSync(join(directory, "aws-reserved.yaml"), "utf8")));
    expect(aws).toEqual([expect.objectContaining({ severity: "warning", message: expect.stringContaining("not implemented") })]);
    expect(aws.filter((finding) => finding.severity === "error")).toEqual([]);
  });
});

describe("stax validate config", () => {
  const VALID = "stacks:\n  - id: a\n    type: opentofu\n    folder: a\n";
  const WARNING = "stacks:\n  - id: a\n    type: opentofu\n    depend_on: [b]\n    folder: a\n";
  const ERROR = "stacks:\n  - id: a\n    type: terrafrom\n";

  function project(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), "stax-validate-"));
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(join(root, path, ".."), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    return root;
  }

  function run(cwd: string, args: string[]) {
    return spawnSync(process.execPath, [CLI, "validate", "config", ...args], { cwd, encoding: "utf8" });
  }

  it("checks configs/ by default and only descends into subdirectories with -r", () => {
    const cwd = project({ "configs/a.yaml": VALID, "configs/team/b.yml": ERROR, "configs/notes.txt": "x" });

    const flat = run(cwd, []);
    expect(flat.status).toBe(0);
    expect(flat.stdout).toContain("configs/a.yaml: ok");
    expect(flat.stdout).not.toContain("b.yml");

    const recursive = run(cwd, ["-r"]);
    expect(recursive.status).toBe(1);
    expect(recursive.stdout).toContain("configs/team/b.yml\n  3:5     error    stacks[0].type: unknown stack type");
    expect(recursive.stdout).toContain("2 files checked: 1 error, 0 warnings");
  });

  it("validates a single named file", () => {
    const cwd = project({ "configs/a.yaml": ERROR, "other/prod.yaml": VALID });
    const result = run(cwd, ["other/prod.yaml"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("other/prod.yaml: ok\n\n1 file checked: 0 errors, 0 warnings");
  });

  it("skips other YAML in scanned directories but validates a file named explicitly", () => {
    const cwd = project({ "configs/a.yaml": VALID, "configs/helm/values.yaml": "replicaCount: 2\n" });

    const scan = run(cwd, ["-r"]);
    expect(scan.status).toBe(0);
    expect(scan.stdout).toContain("configs/helm/values.yaml: skipped (no stacks, externalRepos or globals)");
    expect(scan.stdout).toContain("1 file checked, 1 skipped: 0 errors, 0 warnings");

    const named = run(cwd, ["configs/helm/values.yaml"]);
    expect(named.stdout).toContain("replicaCount: unknown field");
  });

  it("passes with warnings unless --strict is given", () => {
    const cwd = project({ "configs/a.yaml": WARNING });
    expect(run(cwd, []).status).toBe(0);
    expect(run(cwd, ["--strict"]).status).toBe(1);
  });

  it("fails clearly when there is nothing to validate", () => {
    const cwd = project({ "configs/team/b.yaml": VALID });
    const empty = run(cwd, []);
    expect(empty.status).toBe(1);
    expect(empty.stderr).toContain("stax: no .yaml/.yml files in configs (use -r to include subdirectories)");

    const missing = run(cwd, ["nope.yaml"]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("stax: nope.yaml does not exist");
  });
});
