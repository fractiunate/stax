import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveDeploymentContext } from './deployment-config.mjs';

const azure = {
  project: 'widget',
  customer_id: 'acme',
  stage: 'dev',
  cloud: 'Azure',
  default_location: 'northeurope',
  public_cloud_flag: true,
  resource_group_name: 'rg-widget',
  dns_zone_name: 'example.org',
  dns_zone_resource_group_name: 'rg-dns',
  state_storage_account_name: 'ST-Acme_Widget',
  state_container_name: 'terraform',
  state_resource_group_name: 'rg-state',
};

function resolve(deployment = azure, options = {}) {
  return resolveDeploymentContext({ documents: [{ sourceFile: 'configs/service.yaml', deployment }], ...options });
}

test('exports all deployment fields as strings, normalizing cloud and Azure storage names', () => {
  assert.deepEqual(resolve(), {
    PROJECT: 'widget',
    CUSTOMER_ID: 'acme',
    STAGE: 'dev',
    CLOUD: 'azure',
    DEFAULT_LOCATION: 'northeurope',
    RESOURCE_GROUP_NAME: 'rg-widget',
    PUBLIC_CLOUD_FLAG: 'true',
    DNS_ZONE_NAME: 'example.org',
    DNS_ZONE_RESOURCE_GROUP_NAME: 'rg-dns',
    STATE_STORAGE_ACCOUNT_NAME: 'stacmewidget',
    STATE_CONTAINER_NAME: 'terraform',
    STATE_RESOURCE_GROUP_NAME: 'rg-state',
    STATE_BUCKET_NAME: '',
    STATE_REGION: '',
    AWS_ENDPOINT_URL: '',
    AWS_ENDPOINT_URL_S3: '',
    AWS_ENDPOINT_URL_STS: '',
    AWS_ENDPOINT_URL_IAM: '',
    AWS_S3_COMPATIBLE: '',
    AWS_SKIP_STS_CHECK: '',
    STATE_USE_LOCKFILE: '',
    STATE_USE_PATH_STYLE: '',
  });
});

test('merges selected mappings in order before falling back to GitHub variables', () => {
  const context = resolveDeploymentContext({
    documents: [
      {
        sourceFile: 'configs/first.yaml',
        deployment: { ...azure, stage: 'selected-first', project: 'first', state_container_name: 'first', dns_zone_name: 'first.example.org' },
      },
      {
        sourceFile: 'configs/second.yaml',
        deployment: { stage: 'selected-second', project: '', state_container_name: null, public_cloud_flag: false },
      },
    ],
    variables: { project: 'from-var', PROJECT: 'uppercase-var', STAGE: 'var-stage', STATE_CONTAINER_NAME: 'var-container', PUBLIC_CLOUD_FLAG: 'true' },
  });
  assert.equal(context.PROJECT, 'first');
  assert.equal(context.STAGE, 'selected-second');
  assert.equal(context.STATE_CONTAINER_NAME, 'first');
  assert.equal(context.DNS_ZONE_NAME, 'first.example.org');
  assert.equal(context.PUBLIC_CLOUD_FLAG, 'false');
  assert.equal(resolve({ ...azure, project: '' }, { variables: { project: 'lowercase-var', PROJECT: 'uppercase-var' } }).PROJECT, 'lowercase-var');
  assert.equal(resolve({ ...azure, project: '' }, { variables: { PROJECT: 'uppercase-var' } }).PROJECT, 'uppercase-var');
  assert.equal(resolve({ ...azure, state_container_name: null }, { variables: { STATE_CONTAINER_NAME: 'from-var' } }).STATE_CONTAINER_NAME, 'from-var');
});

test('allows absent deployment mappings with complete GitHub variables, without inventing defaults', () => {
  const variables = Object.fromEntries(Object.entries(azure).map(([key, value]) => [key.toUpperCase(), String(value)]));
  const context = resolveDeploymentContext({ documents: [{ sourceFile: 'empty.yaml' }, { sourceFile: 'null.yaml', deployment: null }], variables });
  assert.equal(context.PROJECT, 'widget');
  assert.equal(context.CLOUD, 'azure');
  assert.equal(context.STATE_STORAGE_ACCOUNT_NAME, 'stacmewidget');
  assert.throws(() => resolveDeploymentContext({ documents: [] }), /deployment\.project.*GitHub variable PROJECT/);
});

test('preserves explicit false and requires all common fields even when cloud validation is skipped', () => {
  assert.equal(resolve({ ...azure, public_cloud_flag: false }).PUBLIC_CLOUD_FLAG, 'false');
  assert.equal(resolve({ ...azure, public_cloud_flag: null }, { variables: { PUBLIC_CLOUD_FLAG: 'false' } }).PUBLIC_CLOUD_FLAG, 'false');
  const pages = resolve({ project: 'docs', customer_id: 'acme', stage: 'dev', cloud: 'AWS', default_location: 'eu-west-1', public_cloud_flag: false }, { skipCloudValidation: true });
  assert.equal(pages.PUBLIC_CLOUD_FLAG, 'false');
  assert.equal(pages.STATE_BUCKET_NAME, '');
  assert.equal(pages.STATE_STORAGE_ACCOUNT_NAME, '');
  for (const field of ['project', 'customer_id', 'stage', 'cloud', 'default_location', 'public_cloud_flag']) {
    assert.throws(() => resolve({ ...azure, [field]: null }, { skipCloudValidation: true }), new RegExp(`deployment\\.${field}.*GitHub variable ${field.toUpperCase()}`));
  }
});

test('requires only the selected cloud state fields for non-Pages deployments', () => {
  const aws = { project: 'api', customer_id: 'acme', stage: 'prod', cloud: 'AWS', default_location: 'eu-west-1', public_cloud_flag: 'false', state_bucket_name: 'state-bucket', state_region: 'eu-west-1' };
  assert.equal(resolve(aws).CLOUD, 'aws');
  assert.equal(resolve(aws).STATE_STORAGE_ACCOUNT_NAME, '');
  for (const field of ['state_bucket_name', 'state_region']) {
    assert.throws(() => resolve({ ...aws, [field]: '' }), new RegExp(`deployment\\.${field}.*GitHub variable ${field.toUpperCase()}`));
  }
  for (const field of ['resource_group_name', 'dns_zone_name', 'dns_zone_resource_group_name', 'state_storage_account_name', 'state_container_name', 'state_resource_group_name']) {
    assert.throws(() => resolve({ ...azure, [field]: '' }), new RegExp(`deployment\\.${field}.*GitHub variable ${field.toUpperCase()}`));
  }
  assert.equal(resolve({ ...azure, state_container_name: '' }, { variables: { STATE_CONTAINER_NAME: 'shared-state' } }).STATE_CONTAINER_NAME, 'shared-state');
  assert.equal(resolve({ ...azure, state_container_name: '' }, { skipCloudValidation: true }).STATE_CONTAINER_NAME, '');
});

test('rejects invalid mappings, keys, values, clouds and unsafe workflow environment strings', () => {
  for (const deployment of [[], 'wrong', false, 7]) {
    assert.throws(() => resolve(deployment), /deployment must be a mapping/);
  }
  assert.throws(() => resolve({ ...azure, surprise: 'value' }), /unknown deployment key 'surprise'/);
  for (const value of [1, false, [], {}]) {
    assert.throws(() => resolve({ ...azure, stage: value }), /deployment\.stage must be a string/);
  }
  for (const value of [1, 'TRUE', 'yes', '0', {}]) {
    assert.throws(() => resolve({ ...azure, public_cloud_flag: value }), /public_cloud_flag must be a boolean or/);
  }
  assert.throws(() => resolve({ ...azure, cloud: 'gcp' }), /cloud.*azure.*aws/);
  assert.throws(() => resolve({ ...azure, stage: 'dev\ninjected=1' }), /stage must not contain newlines/);
  assert.throws(() => resolve({ ...azure, stage: '\n' }), /stage must not contain newlines/);
  assert.throws(() => resolve({ ...azure, project: null }, { variables: { project: '\n', PROJECT: 'valid' } }), /GitHub variable PROJECT.*newlines/);
  assert.throws(() => resolve({ ...azure, project: null }, { variables: { PROJECT: 'bad\rname' } }), /GitHub variable PROJECT.*newlines/);
  assert.throws(() => resolve({ ...azure, project: null }, { variables: { PROJECT: 3 } }), /GitHub variable PROJECT.*string/);
  assert.throws(() => resolve({ ...azure, public_cloud_flag: null }, { variables: { PUBLIC_CLOUD_FLAG: 'invalid' } }), /GitHub variable PUBLIC_CLOUD_FLAG.*boolean/);
});

test('enforces normalized Azure account length without truncating or deriving a fallback', () => {
  for (const name of ['A!', 'a'.repeat(25), '---']) {
    assert.throws(() => resolve({ ...azure, state_storage_account_name: name }), /STATE_STORAGE_ACCOUNT_NAME.*3-24/);
  }
  assert.throws(() => resolve({ ...azure, state_storage_account_name: '---' }, { skipCloudValidation: true }), /STATE_STORAGE_ACCOUNT_NAME.*3-24/);
  assert.equal(resolve({ ...azure, state_storage_account_name: 'A'.repeat(24) }).STATE_STORAGE_ACCOUNT_NAME, 'a'.repeat(24));
  assert.equal(resolve({ ...azure, state_storage_account_name: 'A-2c!' }).STATE_STORAGE_ACCOUNT_NAME, 'a2c');
});

const awsBase = { project: 'docs', customer_id: 'acme', stage: 'prod', public_cloud_flag: false, cloud: 'aws', default_location: 'eu-central-2', state_bucket_name: 'tfstate', state_region: 'eu-central-2' };

test('resolves S3-compatible endpoint options from config and GitHub variables', () => {
  const context = resolveDeploymentContext({
    documents: [{
      sourceFile: 'configs/wasabi.yaml',
      deployment: {
        ...awsBase,
        aws_endpoint_url_s3: 'https://s3.eu-central-2.wasabisys.com',
        aws_s3_compatible: true,
        state_use_lockfile: false,
      },
    }],
    variables: { AWS_ENDPOINT_URL_STS: 'https://sts.wasabisys.com', STATE_USE_PATH_STYLE: 'true', AWS_SKIP_STS_CHECK: 'false' },
  });
  assert.equal(context.AWS_ENDPOINT_URL_S3, 'https://s3.eu-central-2.wasabisys.com');
  assert.equal(context.AWS_ENDPOINT_URL_STS, 'https://sts.wasabisys.com');
  assert.equal(context.AWS_ENDPOINT_URL, '');
  assert.equal(context.AWS_S3_COMPATIBLE, 'true');
  assert.equal(context.STATE_USE_LOCKFILE, 'false');
  assert.equal(context.STATE_USE_PATH_STYLE, 'true');
  assert.equal(context.AWS_SKIP_STS_CHECK, 'false');
});

test('accepts plain http only for local endpoints', () => {
  for (const url of ['http://localhost:9000', 'http://127.0.0.1:9000/', 'https://minio.internal.example:9000']) {
    assert.equal(resolve({ ...awsBase, aws_endpoint_url: url }).AWS_ENDPOINT_URL, url);
  }
});

test('rejects invalid authorities and URL forms before exporting endpoints', () => {
  for (const url of ['https://', 'https://s3.example.com:invalid', 'https://s3.example.com:99999', 'https://s3.example.com/path@user', 'https://s3.example.com\\evil', 'http://LOCALHOST:9000']) {
    assert.throws(() => resolve({ ...awsBase, aws_endpoint_url_s3: url }), /aws_endpoint_url_s3/, url);
  }
});

test('rejects unsafe or malformed endpoint URLs', () => {
  for (const [url, message] of [
    ['s3.wasabisys.com', /absolute URL/],
    ['http://s3.wasabisys.com', /must use https/],
    ['ftp://localhost', /must use https/],
    ['https://key:secret@s3.wasabisys.com', /must not contain credentials/],
    ['https://s3.wasabisys.com/?x=1', /query string/],
  ]) {
    assert.throws(() => resolve({ ...awsBase, aws_endpoint_url_s3: url }), message, url);
  }
  assert.throws(
    () => resolveDeploymentContext({ documents: [{ deployment: awsBase }], variables: { AWS_ENDPOINT_URL_IAM: 'https://u:p@iam.wasabisys.com' } }),
    /GitHub variable AWS_ENDPOINT_URL_IAM.*credentials/,
  );
});

test('rejects non-boolean S3 compatibility flags', () => {
  for (const field of ['aws_s3_compatible', 'aws_skip_sts_check', 'state_use_lockfile', 'state_use_path_style']) {
    assert.throws(() => resolve({ ...awsBase, [field]: 'yes' }), new RegExp(`${field} must be a boolean`));
  }
});

test('rejects AWS endpoint options for non-AWS clouds unless they keep the default', () => {
  assert.throws(() => resolve({ ...azure, aws_endpoint_url_s3: 'https://s3.example.com' }), /aws_endpoint_url_s3 require cloud 'aws'/);
  assert.throws(() => resolve({ ...azure, state_use_lockfile: false }), /state_use_lockfile require cloud 'aws'/);
  assert.equal(resolve({ ...azure, state_use_lockfile: true, aws_s3_compatible: false }).CLOUD, 'azure');
  assert.equal(resolve({ ...azure, aws_endpoint_url_s3: 'https://s3.example.com' }, { skipCloudValidation: true }).AWS_ENDPOINT_URL_S3, 'https://s3.example.com');
});

test('state profile requires only backend coordinates, with an optional Azure container', () => {
  const stateOnly = { cloud: 'azure', default_location: 'northeurope', state_resource_group_name: 'rg-state', state_storage_account_name: 'stexamplestate' };
  const state = resolve(stateOnly, { profile: 'state' });
  assert.equal(state.STATE_STORAGE_ACCOUNT_NAME, 'stexamplestate');
  assert.equal(state.STATE_CONTAINER_NAME, '');
  assert.equal(state.PROJECT, '');
  assert.equal(resolve({ ...stateOnly, state_container_name: 'widget-tfstate' }, { profile: 'state' }).STATE_CONTAINER_NAME, 'widget-tfstate');
  // The deploy profile still rejects a state-only config.
  assert.throws(() => resolve(stateOnly), /deployment\.project/);
  for (const field of ['cloud', 'default_location', 'state_resource_group_name', 'state_storage_account_name']) {
    assert.throws(() => resolve({ ...stateOnly, [field]: '' }, { profile: 'state' }), new RegExp(`deployment\\.${field}.*GitHub variable ${field.toUpperCase()}`));
  }
  // Skipping credential checks never relaxes backend requirements for state configs.
  assert.throws(() => resolve({ ...stateOnly, state_resource_group_name: '' }, { profile: 'state', skipCloudValidation: true }), /state_resource_group_name/);
  assert.throws(() => resolve({ ...stateOnly, state_storage_account_name: 'a'.repeat(25) }, { profile: 'state' }), /3-24/);

  const aws = { cloud: 'aws', state_bucket_name: 'example-state', state_region: 'eu-west-1' };
  assert.equal(resolve(aws, { profile: 'state' }).STATE_BUCKET_NAME, 'example-state');
  assert.equal(resolve({ ...aws, state_region: '', default_location: 'eu-central-1' }, { profile: 'state' }).DEFAULT_LOCATION, 'eu-central-1');
  assert.throws(() => resolve({ ...aws, state_region: '' }, { profile: 'state' }), /state_region.*default_location/);
  assert.throws(() => resolve({ ...aws, state_bucket_name: '' }, { profile: 'state' }), /state_bucket_name/);
  assert.throws(() => resolve(stateOnly, { profile: 'plan' }), /profile must be 'deploy' or 'state'/);
  assert.throws(
    () => resolveDeploymentContext({ documents: [{ sourceFile: 'configs/state.yaml', deployment: stateOnly, stacks: [{ id: 'app' }] }], profile: 'state' }),
    /configs\/state\.yaml: state configs must not define stacks/,
  );
  assert.equal(resolveDeploymentContext({ documents: [{ deployment: stateOnly, stacks: [] }], profile: 'state' }).STATE_RESOURCE_GROUP_NAME, 'rg-state');
});
