// Maps the resolved setup context (a-wf-setup-ci.yml outputs `env` and `default-location`)
// to the state backend that a-wf-deploy-state.yml provisions. Pure, so it is unit-tested
// and can run without cloud credentials.

const azureResourceGroup = /^[-\w.()]{1,90}$/;
const azureStorageAccount = /^[a-z0-9]{3,24}$/;
// Blob containers: 3-63 lowercase letters, digits and single hyphens, starting and ending alphanumeric.
const azureContainer = /^(?=.{3,63}$)[a-z0-9](?:[a-z0-9]|-(?!-))*[a-z0-9]$/;
const azureLocation = /^[a-z0-9]+$/;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function planStateBackend({ env, defaultLocation = '' }) {
  if (env === null || typeof env !== 'object' || Array.isArray(env)) {
    throw new Error('env must be the JSON object output by a-wf-setup-ci.yml');
  }
  if (text(env.destroy) === 'true') {
    throw new Error('State backends are never destroyed by a-wf-deploy-state.yml; run setup with destroy: false');
  }

  const cloud = text(env.cloud).toLowerCase();
  const plan = {
    cloud,
    dry_run: text(env.dry_run) === 'false' ? 'false' : 'true',
    resource_group_name: '',
    storage_account_name: '',
    container_name: '',
    location: '',
    bucket_name: '',
    region: '',
  };

  if (cloud === 'azure') {
    plan.resource_group_name = text(env.state_resource_group_name);
    plan.storage_account_name = text(env.state_storage_account_name);
    plan.container_name = text(env.state_storage_container_name);
    plan.location = text(defaultLocation).toLowerCase();
    if (!azureResourceGroup.test(plan.resource_group_name) || plan.resource_group_name.endsWith('.')) {
      throw new Error(`Invalid state resource group '${plan.resource_group_name}' (deployment.state_resource_group_name)`);
    }
    if (!azureStorageAccount.test(plan.storage_account_name)) {
      throw new Error(`Invalid state storage account '${plan.storage_account_name}': 3-24 lowercase letters or digits (deployment.state_storage_account_name)`);
    }
    if (plan.container_name && !azureContainer.test(plan.container_name)) {
      throw new Error(`Invalid state container '${plan.container_name}': 3-63 lowercase letters, digits and single hyphens (deployment.state_container_name)`);
    }
    if (!azureLocation.test(plan.location)) {
      throw new Error(`Invalid Azure location '${plan.location}' (deployment.default_location)`);
    }
    return plan;
  }

  if (cloud === 'aws') {
    plan.bucket_name = text(env.state_bucket_name).toLowerCase();
    plan.region = text(env.state_region) || text(defaultLocation);
    if (!plan.bucket_name) throw new Error('Missing state bucket (deployment.state_bucket_name)');
    if (!plan.region) throw new Error('Missing AWS region (deployment.state_region or deployment.default_location)');
    return plan;
  }

  throw new Error(`env.cloud must be 'azure' or 'aws' (received '${env.cloud ?? ''}')`);
}
