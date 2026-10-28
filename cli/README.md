# stax CLI

Scaffolds, extends and validates projects for the stax stack framework. Package [`@gebit/stax-cli`](https://www.npmjs.com/package/@gebit/stax-cli), binary `stax`. Requires Node.js 24 or later.

```bash
npm install -g @gebit/stax-cli
```

## `stax init`

Generates a deploy wrapper and an empty stack list in a repository:

| File | Content |
|---|---|
| `.github/workflows/deploy.yml` | Manual `Deploy` workflow calling `a-wf-setup-ci.yml` and `a-wf-deploy-levels.yml` from `GEBITSolutions/stax` at the installed CLI version, with matching `actions-version` inputs |
| `configs/default.yaml` | One commented `deployment` block listing every required deployment value with its GitHub variable (`deployment.project` live only when `--project` is given), `stacks: []`, commented examples and a `yaml-language-server` schema link for editor completion at the same version |

```bash
stax init [directory] [--environment <github-environment>] [--project <name>] [--force] [--framework-ref <tag-or-commit-sha>]
```

`stax init` never prompts. `--environment` and `--project` are optional.

The installed CLI version sets both reusable workflow refs, both `actions-version` inputs and the editor schema URL. Global and project-local installs use the same rule. Use a CLI release that matches the framework version you deploy; `init` does not update existing configs or workflows.

`--framework-ref` is required only for a development build (`0.0.0-development`). Give it a tag, commit SHA or branch, including `main` if you choose to track it explicitly. Development builds do not default to `main`. Published CLI releases reject `--framework-ref` and use their own exact version.

- `--environment`: default GitHub Environment preselected in the deploy form. Without it, the form has no preselection.
- `--project`: lowercase letters, digits and hyphens, starting with a letter. Saved as `deployment.project` in `configs/default.yaml`; without it, the GitHub variable `PROJECT` supplies the value.
- Deployment values are not asked for. The generated config lists all required ones in one block, each next to its GitHub variable. Set them at least as GitHub variables (repository or Environment); a value uncommented in the config overrides the variable.
- Existing files are never overwritten unless `--force` is given. Without it, nothing is written.

Nothing is deployed until `configs/default.yaml` has at least one stack; add one with `stax add`. Set the required Azure resource, DNS and state deployment values in YAML or the matching GitHub variables before deploying; see [deployment configuration](../docs/docs/configuration.md).

The generated caller includes `pages: write` and `id-token: write` for GitHub Pages stacks. Existing callers upgrading to the Pages-enabled framework must add `pages: write` to their existing workflow permissions so nested workflow validation succeeds. A Pages-only caller can use the setup workflow's `skip-azure-credentials-validation: true`; see the repository's dedicated `configs/stax-docs.yaml` and `.github/workflows/docs.yml` example.

## `stax add`

Adds a stack to a deploy config in `configs/`:

```bash
stax add [directory] [--config <name>] [--name <stack name>] [--type <type>] [--yes]
```

- `--config`: `configs/<name>.yaml`, the name the Deploy workflow takes. Without it, the existing configs are offered. With `--yes`, `default` (or the only config) is used.
- `--name`: display name. The id is derived from it: lowercase letters and digits joined by dashes, plus six random digits, e.g. `Network Hub` → `network-hub-482913`. The id is only an identifier; nothing derives paths from it.
- `--type`: one of the stack types in the schema; offered as a list when missing.
- Fields the type requires are prompted for, with the schema example as default (`folder` defaults to the name's slug). `--yes` accepts the defaults.
- Every other field the type reads is added as a commented example with its description. Uncomment the ones you need.
- The stack is appended after the last stack; the rest of the file stays byte for byte. A stack that would make the config invalid (e.g. a second `github-pages-site-deploy` stack) is not written.
- Without a terminal, a missing value is an error.

The field list and examples come from the schema: each stack property lists the types that read it in `x-stax-types` (`"all"` for every type) and its example in `examples`.

`stax add` reads the schema bundled with the installed CLI. It works offline and does not fetch the editor schema URL in `configs/default.yaml`.

## `stax validate config`

Checks deploy configs against the schema in [`schema/deploy-config.schema.json`](../schema/deploy-config.schema.json) and against the rules the pipeline enforces.

Validation reads the schema bundled with the installed CLI, not the editor schema URL. It works offline; match your installed CLI to the framework version you deploy.

```bash
stax validate config                 # deploy configs directly in configs/
stax validate config -r              # ... and in its subdirectories
stax validate config configs/prod.yaml
stax validate config other-dir -r --strict
```

- `[path]` is a file or a directory; it defaults to `configs`. A named file is always validated. When scanning a directory, YAML files without `deployment`, `stacks`, `externalRepos` or `globals` (for example Helm values) are listed as skipped.
- Findings show `line:column`, severity and the field path, e.g. `stacks[1].type`.
- Exit code 1 when any file has errors; warnings only fail with `--strict`.
- `deployment` fields are optional in local validation because GitHub variables can supply them. Setup checks the required values after resolution. Unknown deployment keys fail validation because setup rejects them.

| Errors (the pipeline fails or silently skips the stack) | Warnings |
|---|---|
| Invalid YAML; wrong field types (e.g. `local_backend: "false"` instead of a boolean) | Fields the schema does not know (often typos such as `depend_on`) |
| Missing `id` or `type`; unknown `type`; more than one `github-pages-site-deploy` stack or `destroy` on it | `depends_on` or `stack.<id>.var.<key>` pointing to a stack in another config |
| Type-specific required fields: `folder` for `terraform`/`opentofu`/`function-build-deploy`, Packer `packer_directory`/`packer_version`, `s3-site-deploy` `location`, `script` `script`, `bizep` `template`, `function-build-deploy` `runtime` | `source_repo` alias not defined in this file (configs deployed together share `externalRepos`) |
| Packer paths that are absolute, contain `..`, backslashes, empty segments or control characters; non-exact `packer_version`; `build_target: hetzner` without `hetzner` | No stacks defined; deprecated Gallery aliases (`gallery_name` and the other top-level Gallery fields); `build_target: aws` (reserved, the workflow rejects it) |
| Duplicate stack ids; malformed `stack.<id>.var.<key>` references | |
| Dependency cycles (including through `stack.<id>...` inputs); dependency chains deeper than 14 levels | |

### `folder` is required

`terraform`, `opentofu` and `function-build-deploy` stacks must set `folder`: the stack directory below `stack_base_path` (default `terraform/stacks`) or below `functions/`. The pipeline no longer falls back to the stack id, and setup fails for a stack without `folder`. To migrate a stack that relied on the fallback, add `folder: <its id>`.

## Development

```bash
cd cli
npm ci
npm run typecheck
npm test            # copies ../schema first
npm run build
npm run sync-schema && node src/cli.ts validate config ../path/to/configs   # runs from source (Node 24 type stripping)
```

For a development build, choose a framework ref when initializing a project, for example `node src/cli.ts init ../my-project --framework-ref main` (or `stax init ../my-project --framework-ref main` after `npm link`). A released CLI needs no ref and rejects this option.

## Releasing

The CLI is released together with the reusable workflows, under the same version. [`release.yml`](../.github/workflows/release.yml) runs on every push to `main` and composes the `a-wf-release-*` phase workflows:

1. `a-wf-release-version.yml` waits for approval and derives the next version from conventional commits.
2. [`cli-pack.yml`](../.github/workflows/cli-pack.yml) sets the package version to that version, typechecks, tests, builds and packs the CLI.
3. `a-wf-release-prepare.yml` commits the release changes, creates the tag and the pre-release, and attaches the packed tarball.
4. `a-wf-release-approve.yml` waits for the second approval (`publish-release` environment).
5. [`docs.yml`](../.github/workflows/docs.yml) deploys the documentation site; if it fails, nothing is published.
6. `a-wf-release-publish.yml` publishes the release.
7. [`cli-publish.yml`](../.github/workflows/cli-publish.yml) runs `npm publish` on the same tarball.

Publishing uses npm trusted publishing (OIDC): no npm token is stored, and npm attaches a provenance attestation. The `version` in `package.json` stays `0.0.0-development`; only published packages carry a real version.
