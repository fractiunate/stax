![STAX Framework](.github/assets/banner.jpg 'STAX Framework')

<p align="center">
  <br/>
  <strong>STAX</strong> is an opinionated GitHub Actions framework &mdash;
  <br/>
  declare your stacks once, deploy cloud infrastructure and services together.
  <br/><br/>
</p>

<div align="center">

[![CLI](https://github.com/GEBITSolutions/stax/actions/workflows/cli.yml/badge.svg?branch=main)](https://github.com/GEBITSolutions/stax/actions/workflows/cli.yml)
[![Documentation](https://github.com/GEBITSolutions/stax/actions/workflows/docs.yml/badge.svg?branch=main)](https://github.com/GEBITSolutions/stax/actions/workflows/docs.yml)
[![License](https://img.shields.io/badge/License-GPL--3.0--only-blue.svg)](LICENSE)

</div>

## Install

The `stax` CLI needs Node.js 24 or later:

```bash
npm install -g @gebit/stax-cli
```

For a local development build, choose a framework ref explicitly when running `init`:

```bash
git clone https://github.com/GEBITSolutions/stax.git
cd stax/cli
npm install && npm run build && npm link
stax init /path/to/project --framework-ref main
```

You can use a tag, commit SHA or branch instead of `main`. Development builds require `--framework-ref`; published CLI releases reject it.

With a published CLI, scaffold a repository, add a stack and check the result:

```bash
stax init
stax add
stax validate config
```

`stax init` writes a Deploy workflow and `configs/default.yaml` with every required deployment value listed next to its GitHub variable. The installed CLI version sets the workflow refs, `actions-version` inputs and editor schema URL for both global and project-local installs. Match the installed CLI to the framework version you deploy; existing files are not auto-upgraded. `stax add` and `stax validate config` use the bundled schema offline rather than following the editor URL. See the [CLI reference](cli/README.md) for commands and options.

## Documentation

The canonical [documentation site](docs/README.md) lives in `docs/`, including its Zensical configuration, locked dependencies, content, and assets. Start with [Configuration](docs/docs/configuration.md) and [Supported stack types](docs/docs/stack-types.md).

Preview from the repository root:

```sh
cd docs
uv sync --locked
uv run zensical serve --dev-addr 127.0.0.1:8017
```

Open <http://127.0.0.1:8017/>. To build the static site, run `uv run zensical build --clean` from `docs/`; output goes to `docs/site/`.

## Support

Having trouble? Open an [issue](https://github.com/GEBITSolutions/stax/issues).

## Directory

| Path | Contents |
| --- | --- |
| [cli](cli) | `@gebit/stax-cli`: the `stax` command (`init`, `add`, `validate config`) |
| [schema](schema) | JSON Schema for deploy configs, used by the CLI and by editors for completion |
| [.github/workflows](.github/workflows) | Reusable workflows: `a-wf-setup-ci.yml` reads the deploy config, `a-wf-deploy-levels.yml` deploys stacks level by level, `a-wf-deploy-state.yml` deploys the state backend described by a state config |
| [.github/actions](.github/actions) | Actions the workflows build on: deploy-config generation, stack inputs, versioning, static sites, Terraform |
| [configs](configs) | This repository's own deploy configs |
| [docs](docs) | Documentation site sources |
| [e2e](e2e) | End-to-end tests run on every pull request: example projects deployed through the reusable workflows |

## Links

- **STAX framework and CLI:** [GPL-3.0-only](LICENSE).
- **`get-next-version-typescript-action`:** [MIT](.github/actions/get-next-version-typescript-action/LICENSE). This TypeScript port of [thenativeweb/get-next-version](https://github.com/thenativeweb/get-next-version) is licensed separately; the MIT license applies to this action only.
- [Documentation](docs/README.md)
- [CLI reference](cli/README.md)
- [Deploy config schema](schema/deploy-config.schema.json)
