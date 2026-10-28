import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planStateBackend } from './state-backend.mjs';

const azureEnv = {
  cloud: 'azure',
  dry_run: 'false',
  destroy: 'false',
  state_resource_group_name: 'rg-example-tfstate',
  state_storage_account_name: 'stexamplestate',
  state_storage_container_name: 'widget-tfstate',
};

test('maps the setup env to an Azure backend, reading the renamed container key', () => {
  assert.deepEqual(planStateBackend({ env: azureEnv, defaultLocation: 'NorthEurope' }), {
    cloud: 'azure',
    dry_run: 'false',
    resource_group_name: 'rg-example-tfstate',
    storage_account_name: 'stexamplestate',
    container_name: 'widget-tfstate',
    location: 'northeurope',
    bucket_name: '',
    region: '',
  });
});

test('allows an account without a container and treats anything but an explicit false as a dry run', () => {
  const plan = planStateBackend({ env: { ...azureEnv, state_storage_container_name: '', dry_run: '' }, defaultLocation: 'westeurope' });
  assert.equal(plan.container_name, '');
  assert.equal(plan.dry_run, 'true');
});

test('rejects destroy and invalid Azure coordinates', () => {
  assert.throws(() => planStateBackend({ env: { ...azureEnv, destroy: 'true' }, defaultLocation: 'northeurope' }), /never destroyed/);
  for (const name of ['st', 'a'.repeat(25), 'St-Upper']) {
    assert.throws(() => planStateBackend({ env: { ...azureEnv, state_storage_account_name: name }, defaultLocation: 'northeurope' }), /state storage account/);
  }
  for (const name of ['ab', 'Widget', '-widget', 'widget-', 'wid--get', 'a'.repeat(64)]) {
    assert.throws(() => planStateBackend({ env: { ...azureEnv, state_storage_container_name: name }, defaultLocation: 'northeurope' }), /state container/);
  }
  for (const name of ['', 'rg.', 'rg with space', 'r'.repeat(91)]) {
    assert.throws(() => planStateBackend({ env: { ...azureEnv, state_resource_group_name: name }, defaultLocation: 'northeurope' }), /state resource group/);
  }
  assert.throws(() => planStateBackend({ env: azureEnv, defaultLocation: '' }), /Azure location/);
  assert.throws(() => planStateBackend({ env: azureEnv, defaultLocation: 'north europe' }), /Azure location/);
});

test('maps AWS buckets with region fallback and rejects unknown input', () => {
  const aws = { cloud: 'AWS', dry_run: 'true', state_bucket_name: 'Example-State', state_region: '' };
  const plan = planStateBackend({ env: aws, defaultLocation: 'eu-central-1' });
  assert.equal(plan.bucket_name, 'example-state');
  assert.equal(plan.region, 'eu-central-1');
  assert.equal(planStateBackend({ env: { ...aws, state_region: 'eu-west-1' }, defaultLocation: 'eu-central-1' }).region, 'eu-west-1');
  assert.throws(() => planStateBackend({ env: { ...aws, state_bucket_name: '' } }), /state bucket/);
  assert.throws(() => planStateBackend({ env: aws }), /AWS region/);
  assert.throws(() => planStateBackend({ env: { ...aws, cloud: 'gcp' } }), /env\.cloud/);
  assert.throws(() => planStateBackend({ env: [] }), /JSON object/);
});
