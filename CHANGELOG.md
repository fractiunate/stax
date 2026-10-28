## Unreleased

### 🚀 New Features
  - Packer stacks accept `build_target`: `azure` (the default, unchanged Compute Gallery publish), `hetzner` (labelled snapshots with `keep_last` retention) and `aws` (reserved; the workflow rejects it). Normalized outputs are `image_id`, `image_ref`, `build_target`, `version`, `labels` and `git_sha`.
  - Top-level Gallery fields remain deprecated aliases of `azure.*`. Existing Packer stacks that pass those fields as inputs keep the same var-file and still publish `image_id`.

## Release 1.5.0

Merged PRs: 37

### 🚀 New Features
  - Add the reusable workflow a-wf-deploy-state.yml: it deploys the Terraform/OpenTofu state backend described by a state config (Azure resource group, storage account and optional private container, or an S3 bucket including S3-compatible endpoint options). Call a-wf-setup-ci.yml with config-profile: state first and pass its env and default-location outputs. setup's dry-run (default true) only plans without cloud access; destroy is rejected.
  - Add the config-profile input to a-wf-setup-ci.yml. config-profile: state requires only cloud and the backend fields, makes state_container_name optional, and rejects configs that define stacks.
  - Add location and create-container inputs to a-wf-setup-state.yaml, so a storage account can be deployed before any container and in a chosen location.

### 🐞 Bugfixes
  - a-wf-setup-state.yaml created and updated storage accounts with anonymous blob access allowed; it now disables it and creates containers private.
  - a-wf-setup-state.yaml logged an error but continued when the storage account existed in another resource group; the run now fails.

### 💥 Breaking Changes
  - a-wf-setup-state.yaml now disables anonymous blob access on every Azure storage account it touches, including existing accounts. Anything reading public blobs from a state account loses that access.

### 📝 Documentation
  - Document state configs, a-wf-deploy-state.yml and the deployed resources on the Backends page; correct the claim that setup rejects configs without stacks.

## Release 1.4.0

Merged PRs: 36

### 🚀 New Features
  - Support custom AWS endpoints and S3-compatible storage such as Wasabi or MinIO for Terraform/OpenTofu stacks with the optional deployment fields aws_endpoint_url, aws_endpoint_url_s3, aws_endpoint_url_sts, aws_endpoint_url_iam, aws_s3_compatible, aws_skip_sts_check, state_use_lockfile and state_use_path_style (or the matching GitHub variables). The endpoints apply only to the Terraform steps of the action.
  - Validate the new fields in the schema and with stax validate config: endpoints must be https URLs without credentials, booleans must be true or false, and non-default values are rejected for clouds other than aws.
  - Add S3-compatible mode and a read-only dry_run input to the setup-state workflow for cloud: aws.

### 🐞 Bugfixes
  - Disable state locking for plans when no-lock is true. The plan step passed a bare -lock (meaning -lock=true), so dry-run plans still acquired the state lock.
  - Skip Infracost setup, breakdown and report uploads when INFRACOST_API_KEY is unset, so plans no longer log a fake Error: INFRACOST_API_KEY is not set.
  - Wait for final Jobs API conclusions in E2E job assertions instead of failing when completed dependency jobs are briefly still reported as running.

### 📝 Documentation
  - Document S3-compatible backends (Wasabi, MinIO), the OIDC limitation and the lockfile caveat.

## Release 1.3.3

Merged PRs: 34

### 🐞 Bugfixes
  - Honor stack if conditions even when no stack filter is supplied, including deployments where every selected stack is excluded (issue: #28).
  - Remove inserted spaces from Terraform and OpenTofu plan artifact names (issue: #29).
  - Forward actions-repository to Terraform/OpenTofu, script and SWA stack workflows so custom framework repositories are respected (issue: #30).

### 💥 Breaking Changes
  - Deployment behavior change: unfiltered deployments now skip stacks whose if condition evaluates false. Previously those conditions were ignored without a stack filter. Review existing conditions before upgrading; if every selected stack is excluded, no stacks are deployed.
  - Plan artifact names no longer contain spaces between the provider, stack and location components. Update artifact downloads that match the previous spaced names.