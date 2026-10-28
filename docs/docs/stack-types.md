# Supported stack types

Combine these technologies and workflow types in your STAX Framework deployment stacks.

Checked boxes indicate support. Unchecked boxes indicate planned support, not available yet.

## Infrastructure as code

- [x] **Terraform** (`terraform`): provision cloud infrastructure.
- [x] **OpenTofu** (`opentofu`): provision cloud infrastructure.
- [x] **Bicep** (`bicep`): provision Azure infrastructure.
- [ ] **CDK**: planned, not supported yet.

## Docker and image builds

- [x] **Docker** (`docker-build-push`): build container images and push them to a registry.
- [x] **Packer** (`packer`): build machine images for Azure Compute Gallery or Hetzner Cloud. AWS AMIs are reserved and not implemented.

### Packer images

`type: packer` takes `packer_directory`, an exact `packer_version`, and an optional `packer_template` (default `.`). `build_target` selects the publisher. Omit it, or set `azure`, to keep today's Azure Compute Gallery behavior.

The template owns the source block (builder, base image, provisioners) and must declare any Packer variables it reads. STAX owns credentials, the injected var-file, `packer fmt` / `init` / `validate`, publishing, retention, and outputs. A Hetzner template must write `manifest.json` with a manifest post-processor. Gallery builds still take `image_id` from `az sig image-version show`; the manifest is optional there.

STAX injects `stax_build_target`, `stax_stack_id`, `stax_env`, `stax_git_sha` and `stax_image_version` only when the template declares that variable, so existing Gallery templates keep validating. It also flattens `azure.*` or `hetzner.*` into the same `.pkrvars.json` file as stack inputs. An input that disagrees with the build-target field fails the run.

| `build_target` | Credentials | Publish |
|---|---|---|
| `azure` (default) | `ARM_*` and `OIDC_ENABLED`, unchanged | Compute Gallery image version. `destroy` is rejected. |
| `hetzner` | `HCLOUD_TOKEN` on the GitHub Environment | Labelled snapshot. `keep_last` (default 3) deletes older matches. `destroy: true` deletes matches beyond `keep_last`, or all of them when `keep_last` is 0. |
| `aws` | Reserved | Not implemented. `stax validate config` warns; the workflow fails. The output names will not change when an AMI executor is added. |

`azure` fields are `image_resource_group_name`, `gallery_name`, `image_definition_name`, `image_version` and `target_regions`. The same names at the top level of the stack are deprecated aliases. Configs that still pass them through `input` do not need either form.

`hetzner` requires `location` and `server_type` (`cax11` is arm64; the template's base image must match, STAX does not translate architecture). Optional: `snapshot_name` (default: the stack id), `snapshot_labels`, `keep_last`. STAX merges labels with `stax_stack_id`, `stax_env`, `stax_git_sha`, `stax_build_target=hetzner` and `managed_by=stax`, and those keys win. A `cax11` build is about €0.01 per hour; snapshots are about €0.017 per GB-month. The job summary prints that estimate. `dry_run` validates the template and does not create a server or call the Hetzner API.

Downstream stacks read published values with `stack.<id>.var.<output>`:

| Output | Meaning |
|---|---|
| `image_id` | Gallery version resource ID, Hetzner snapshot id, or later an AMI id |
| `image_ref` | `azure:gallery:<resource-group>/<gallery>/<definition>/<version>` or `hcloud:snapshot:<id>` |
| `build_target` | `azure`, `hetzner`, or later `aws` |
| `version` | Gallery `image_version`, or `0.0.0+<git sha>` for Hetzner |
| `labels` | JSON object of tags or snapshot labels |
| `git_sha` | Source commit |

`output-var` lists which of those to export. A list that only contains `image_id` still exports only that value.

```yaml
stacks:
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
```

## Packages

- [x] **RPM** (`rpmbuild`): build RPM packages.

## Deployments

- [x] **Cloud functions** (`function-build-deploy`): build and deploy cloud functions.
- [x] **Azure Static Web Apps** (`swa-site-deploy`): deploy websites.
- [x] **Azure Static Web Apps documentation** (`swa-docs-site-deploy`): deploy documentation sites.
- [x] **Amazon S3** (`s3-site-deploy`): deploy static websites.
- [x] **GitHub Pages** (`github-pages-site-deploy`): build MkDocs or Zensical documentation, or publish a prebuilt static site.

## Scripts

Use the `script` workflow type to run custom scripts:

- [x] **Bash**: run shell scripts.
- [x] **Python**: run Python scripts.

## Helm deployments

- [x] **Helm**: deploy Helm charts to Kubernetes clusters.

## Raw Kubernetes manifest deployments

- [x] **Kubernetes manifests**: deploy Kubernetes resources from raw YAML manifests.
