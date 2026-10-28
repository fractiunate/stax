# Backends

stax owns the Terraform/OpenTofu backend type: the pipeline writes an override file with an `azurerm` backend for `cloud: azure`, an `s3` backend for `cloud: aws`, or a `local` backend for stacks with `local_backend: true`. Keep an empty `backend "s3" {}` (or `backend "azurerm" {}`) block in the stack, or none at all; the bucket, key, region and flags come from the deployment context.

## AWS S3

For `cloud: aws` the state lives in `state_bucket_name` in `state_region`, one key per stack. State is locked with S3 native locking (`use_lockfile`), which needs OpenTofu 1.10 or Terraform 1.11 or later. Create the bucket with the setup-state workflow (`cloud: aws`); it enables versioning, default encryption, a public access block, a TLS-only bucket policy and managed tags. Pass `dry_run: true` to only check the bucket and list what would change.

## S3-compatible storage

The S3 backend also works with S3-compatible stores such as [Wasabi](https://wasabi.com) or [MinIO](https://min.io). Point stax at the store with the optional deployment fields (or their GitHub variables):

```yaml
deployment:
  cloud: aws
  default_location: eu-central-2
  state_region: eu-central-2
  state_bucket_name: example-tfstate
  aws_endpoint_url_s3: https://s3.eu-central-2.wasabisys.com
  aws_endpoint_url_sts: https://sts.wasabisys.com
  aws_endpoint_url_iam: https://iam.wasabisys.com
  aws_s3_compatible: true
  state_use_lockfile: false   # only until the store is known to support conditional writes
```

| Field | Effect |
|---|---|
| `aws_endpoint_url`, `aws_endpoint_url_s3`, `aws_endpoint_url_sts`, `aws_endpoint_url_iam` | Exported as `AWS_ENDPOINT_URL`, `AWS_ENDPOINT_URL_S3`, … to the init, plan, apply and output steps and the STS identity check. The S3 backend, the AWS provider and the AWS CLI read them. Other job steps, such as the SSM keystore, keep using AWS. |
| `aws_s3_compatible: true` | Sets `AWS_REQUEST_CHECKSUM_CALCULATION` and `AWS_RESPONSE_CHECKSUM_VALIDATION` to `when_required` for those steps and adds `skip_s3_checksum`, `skip_region_validation` and `skip_requesting_account_id` to the backend. |
| `aws_skip_sts_check: true` | Skips `aws sts get-caller-identity` and adds `skip_credentials_validation` to the backend. Use it for stores without an STS endpoint. |
| `state_use_lockfile: false` | Turns off S3 native locking for stores that do not support conditional writes. Nothing stops two runs of a stack from writing the state at the same time, so serialize deployments yourself. |
| `state_use_path_style: true` | Uses path-style addressing (`https://host/bucket/key`), which MinIO usually needs. |

Notes:

- Authenticate with the static `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` secrets. GitHub OIDC exchanges its token at AWS STS, so `OIDC_ENABLED` cannot be combined with `aws_endpoint_url` or `aws_endpoint_url_sts`.
- The provider in your stack still needs settings that the backend flags do not cover, for example `skip_region_validation` and `skip_requesting_account_id` in the `aws` provider block for non-AWS regions.
- For the state bucket, call the setup-state workflow with the same endpoints and `aws_s3_compatible: "true"`. Versioning is required; public access block, default encryption, the TLS-only policy and tagging only warn when the store does not support them.

## State configs

STAX can also create the backend from a state config: a deploy config that contains only a `deployment` mapping with the backend coordinates. It must not define stacks.

```yaml
# configs/state/dev.yaml: storage account only
deployment:
  cloud: azure
  default_location: northeurope
  state_resource_group_name: rg-shop-dev-tfstate
  state_storage_account_name: stshopdevstate
```

```yaml
# configs/state/dev/shop.yaml: the same account plus the shop project's container
deployment:
  cloud: azure
  default_location: northeurope
  state_resource_group_name: rg-shop-dev-tfstate
  state_storage_account_name: stshopdevstate
  state_container_name: shop-tfstate
```

```yaml
# configs/state/aws.yaml
deployment:
  cloud: aws
  default_location: eu-central-1   # region fallback when state_region is empty
  state_bucket_name: example-shop-tfstate
```

| Field | Azure | AWS |
|---|---|---|
| `cloud` | Required | Required |
| `default_location` | Required: location of new resources | Region fallback |
| `state_resource_group_name` | Required | Not used |
| `state_storage_account_name` | Required, 3-24 lowercase letters or digits after normalization | Not used |
| `state_container_name` | Optional: omit it to deploy the account only | Not used |
| `state_bucket_name` | Not used | Required |
| `state_region` | Not used | Optional |
| `aws_endpoint_url`, `aws_endpoint_url_s3`, `aws_endpoint_url_sts`, `aws_s3_compatible`, `aws_skip_sts_check` | Not used | Optional: S3-compatible stores, as above |

Empty fields fall back to the GitHub variables listed in [Configuration](configuration.md). A run deploys one backend: when you select several files, later files override earlier values instead of adding containers. To share one storage account between projects, give each project its own config with the same account and its own `state_container_name`, and run the workflow once per config.

## Deploy workflow

Call `a-wf-setup-ci.yml` with `config-profile: state`, then pass its outputs to `a-wf-deploy-state.yml`. The repository that calls the workflows owns the configs, the GitHub Environment and the cloud credentials.

```yaml
# .github/workflows/state.yml
name: "Deploy: state backend"

on:
  workflow_dispatch:
    inputs:
      environment:
        description: GitHub Environment with the cloud credentials
        required: true
        type: environment
      state-config:
        description: State config under configs/state/, without .yaml
        required: true
        type: string
      dry-run:
        description: Plan only
        type: boolean
        default: true

permissions:
  contents: read
  id-token: write

jobs:
  setup:
    uses: GEBITSolutions/stax/.github/workflows/a-wf-setup-ci.yml@<ref>
    secrets: inherit
    with:
      environment: ${{ inputs.environment }}
      stack_filter: ""
      config-profile: state
      release_config_filepath: configs/state/${{ inputs.state-config }}.yaml
      dry-run: ${{ inputs.dry-run }}
      actions-version: <ref>

  state:
    needs: setup
    uses: GEBITSolutions/stax/.github/workflows/a-wf-deploy-state.yml@<ref>
    secrets: inherit
    with:
      env: ${{ needs.setup.outputs.env }}
      default_location: ${{ needs.setup.outputs.default-location }}
      actions-version: <ref>
```

Use the same `<ref>` for both workflows and both `actions-version` inputs.

With `dry-run: true` (the setup default), the plan job validates the config and writes the backend to the run summary; nothing is deployed and no cloud login happens. Set `dry-run: false` to deploy. `destroy: true` fails: state backends are never removed by STAX.

The workflow outputs the resolved backend (`cloud`, `dry-run`, `resource-group-name`, `storage-account-name`, `container-name`, `location`, `bucket-name`, `region`).

## What gets deployed

The provisioning job runs in the caller's GitHub Environment and logs in with its `ARM_*` variables (Azure) or `AWS_*` settings (AWS), using OIDC when `OIDC_ENABLED` is `true`. It is safe to run again: existing resources are reused and their security settings reapplied.

**Azure**

- The resource group, if it does not exist, in `default_location`.
- The storage account (Standard LRS, TLS 1.2, anonymous blob access disabled). The run fails if an account with that name exists in another resource group.
- Blob versioning, change feed and seven-day soft delete.
- The container, private, when `state_container_name` is set.

The identity needs `Contributor` on the subscription: the workflow creates the resource group and looks up the account name across the subscription. Containers are created with the account key; give the identities of your stack deployments `Storage Blob Data Contributor` on their container.

**AWS**

- The S3 bucket, hardened as described in [AWS S3](#aws-s3). The config's AWS endpoint options are passed on, so S3-compatible stores work the same way.

## Without a config

`a-wf-setup-state.yaml` provisions a backend from explicit inputs (`resource_group_name`, `storage_account_name`, `container_name`, `create-container`, `location`, `bucket_name`, `region` and the AWS endpoint options) and the `TF_STATE_*` variables. `a-wf-deploy-state.yml` calls it after resolving the config.
