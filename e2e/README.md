# End-to-end tests

The `e2e-*.yml` workflows run the framework's reusable workflows the way a project's deploy workflow does, with the code of the commit under test. Each scenario is its own workflow: a single run cannot call the stack dispatcher more than about twice before GitHub rejects it as too large. All of them run for every pull request, and each ends with a job named after its workflow (for example `E2E: Config resolution`) that fails if any of its jobs did not succeed. Those five jobs are the required checks for `main`. Run a scenario manually from **Actions → E2E: … → Run workflow**.

Each scenario covers one part of the framework with the most common setup, not every option:

| Scenario | Workflow | Config | What it checks |
|---|---|---|---|
| CLI new project | `e2e-cli.yml` | generated | `stax init` and `stax add` create a valid config; the generated `deploy.yml` matches the inputs and secrets of the reusable workflows; the configs in `e2e/configs` are valid |
| Config resolution | `e2e-config.yml` | `config-base.yaml`, `config-overlay.yaml`, `state-azure.yaml`, `state-aws.yaml` | deployment values from the later file win; globals stay per file; explicit and implicit (`stack.<id>.var.<key>`) dependencies across files; `group-` and `>` stack filters; `if` conditions; Azure and AWS state configs resolve with `config-profile: state` and `a-wf-deploy-state.yml` dry-runs without deploying |
| Infrastructure plan | `e2e-iac-plan.yml` | `iac-plan.yaml` | OpenTofu and Terraform plans (local state, no cloud provider) contain values from config and pipeline globals; a script stack in the next layer receives globals and `DRY_RUN=true`; nothing is applied |
| Site and image builds | `e2e-sites.yml` | `sites.yaml` | a GitHub Pages MkDocs site and a Docker image are built; nothing is published or pushed |
| Deploy and destroy | `e2e-deploy.yml` | `deploy.yaml` | an OpenTofu apply stores its output in the GitHub Environment `e2e`; a script stack receives it and stores a derived value; the OpenTofu stack is destroyed |

The CLI scenario builds the development package and passes the PR head SHA (or dispatch commit SHA) explicitly through `init --framework-ref`. It checks generated workflow inputs against the current checkout rather than assuming a published release.

Job assertions refresh pending jobs through their individual Jobs API endpoint, then allow up to one minute for final conclusions. They still fail on completed errors or incorrect job counts. The CLI scenario runs regression checks for this API visibility delay.

## Requirements

- **GitHub Environment `e2e`:** no protection rules or secrets. The deploy scenario writes `E2E_TOFU__MESSAGE` and `E2E_CONSUMER__DERIVED` to it and deletes them before and after each run. Runs of that scenario are serialized.
- **Release GitHub App:** the variable `RELEASE_APP_CLIENT_ID` and the secret `RELEASE_APP_CLIENT_SECRET`, with Environments, Secrets and Variables write access. The deploy scenario uses it to store values between stacks.
- **Pull requests from forks** receive no secrets and never execute credentialed deploy jobs. Their required check instead waits up to ten minutes for a successful maintainer-dispatched upstream `e2e-deploy.yml` run at the exact PR head SHA. After reviewing the code, a maintainer pushes that commit to an upstream verification branch and dispatches the workflow there. Then rerun the fork deploy check if its wait has already timed out. A different commit, different workflow, or newer failed acceptance does not satisfy the check. No `pull_request_target` execution or ruleset bypass is used.

## Files

- `configs/`: deploy configs, one per scenario (two for config resolution, plus two state configs).
- `stacks/echo/`: OpenTofu/Terraform module with a single `terraform_data` resource; its `message` output echoes `example_input`.
- `scripts/`: `check-inputs.sh` fails unless every input `expect_<name>` equals `<name>`; `consume.sh` checks the value received from `e2e-tofu` and stores a derived value.
- `sites/mkdocs/`, `docker/`: minimal site and image sources.
- `assert/`: `config.mjs` checks the config resolution outputs; `state.mjs` checks the state backend dry runs; `run.sh` checks jobs, artifacts and Environment variables of the current run.
