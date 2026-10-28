# Configuration

## Deployment context

Put deployment values under the top-level `deployment` mapping in `configs/<name>.yaml`, or set them as GitHub variables. The setup workflow reads this mapping to build the deployment environment. `stax init` lists every required value, each next to its GitHub variable, in one commented `deployment` block of `configs/default.yaml`. `stax init --project shop` additionally writes `deployment.project: shop` live.

```yaml
# configs/default.yaml
deployment:
  project: shop
  customer_id: default
  stage: dev
  cloud: azure
  default_location: northeurope
  public_cloud_flag: true
  resource_group_name: rg-shop-dev
  dns_zone_name: example.com
  dns_zone_resource_group_name: rg-dns
  state_storage_account_name: shopstate
  state_container_name: shop-tfstate
  state_resource_group_name: rg-state
stacks: []
```

```yaml
# configs/prod.yaml
deployment:
  stage: prod
  resource_group_name: rg-shop-prod
  state_container_name: shop-prod-tfstate
stacks: []
```

Selecting `configs/prod.yaml` uses its `stage`, resource group and state container. Supply the remaining required values through GitHub variables or add them to that selected YAML. A config without stacks deploys nothing; the CLI's `validate config --strict` reports it.

The setup workflow reads only the files you select. `configs/default.yaml` is a normal config file: it contributes no values when you select `prod`. The same rule applies to external configuration repositories.

For multiple configs, pass `release_config_filepath: configs/prod.yaml,configs/region.yaml` to the setup reusable workflow. Later selected files override earlier values in the shared run context. The generated Deploy form selects one config by name.

Precedence per field is selected YAML → GitHub variable. An empty string or `null` falls through to the GitHub variable if no other selected file supplies the field; `false` remains an explicit value.

### Supported fields and GitHub variable fallback

| YAML `deployment` field | GitHub variable | Requirement |
|---|---|---|
| `project` | `PROJECT` (`vars.project` also works) | Required |
| `customer_id` | `CUSTOMER_ID` | Required |
| `stage` | `STAGE` | Required |
| `cloud` | `CLOUD` | Required; `azure` or `aws` |
| `default_location` | `DEFAULT_LOCATION` | Required |
| `public_cloud_flag` | `PUBLIC_CLOUD_FLAG` | Required; boolean `true`/`false` or their string forms |
| `resource_group_name` | `RESOURCE_GROUP_NAME` | Required for Azure |
| `dns_zone_name` | `DNS_ZONE_NAME` | Required for Azure |
| `dns_zone_resource_group_name` | `DNS_ZONE_RESOURCE_GROUP_NAME` | Required for Azure |
| `state_storage_account_name` | `STATE_STORAGE_ACCOUNT_NAME` | Required for Azure |
| `state_container_name` | `STATE_CONTAINER_NAME` | Required for Azure |
| `state_resource_group_name` | `STATE_RESOURCE_GROUP_NAME` | Required for Azure |
| `state_bucket_name` | `STATE_BUCKET_NAME` | Required for AWS |
| `state_region` | `STATE_REGION` | Required for AWS |
| `aws_endpoint_url` | `AWS_ENDPOINT_URL` | Optional, AWS only; base endpoint for every AWS service |
| `aws_endpoint_url_s3` | `AWS_ENDPOINT_URL_S3` | Optional, AWS only; S3 endpoint for the state backend and the AWS provider |
| `aws_endpoint_url_sts` | `AWS_ENDPOINT_URL_STS` | Optional, AWS only; not supported with `OIDC_ENABLED` |
| `aws_endpoint_url_iam` | `AWS_ENDPOINT_URL_IAM` | Optional, AWS only |
| `aws_s3_compatible` | `AWS_S3_COMPATIBLE` | Optional, AWS only; boolean, default `false` |
| `aws_skip_sts_check` | `AWS_SKIP_STS_CHECK` | Optional, AWS only; boolean, default `false` |
| `state_use_lockfile` | `STATE_USE_LOCKFILE` | Optional, AWS only; boolean, default `true` |
| `state_use_path_style` | `STATE_USE_PATH_STYLE` | Optional, AWS only; boolean, default `false` |

The optional AWS fields target S3-compatible storage such as Wasabi or MinIO; see [Backends](backends.md#s3-compatible-storage). Endpoint URLs must use `https` (`http` only for `localhost`, `127.0.0.1` or `[::1]`) and cannot contain credentials, query strings, fragments, whitespace or backslashes. Setting one of them to a non-default value with another cloud fails the setup.

These requirements apply to stack deployments. A state config, resolved with `config-profile: state`, needs only the backend fields; see [Backends](backends.md).

## Stack conditions

A stack's `if` string is evaluated whether or not a stack filter is supplied. For example, `if: "'{stage}' === 'prod'"` selects the stack only for the production stage. A false condition excludes the stack; if every selected stack is excluded, the deployment plan is empty.

Previously, unfiltered deployments ignored these conditions. Review existing conditions before upgrading: stacks that previously ran despite a false condition will now be skipped.
