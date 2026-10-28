// Checks the state-backend dry runs of e2e-config.yml: setup with config-profile: state
// followed by a-wf-deploy-state.yml. Each run is passed as RUN_<NAME>_PLAN (JSON of the
// workflow outputs). The e2e Environment has no cloud credentials, so a provision attempt
// would fail the run: a successful run also proves the dry run deployed nothing.
import assert from 'node:assert/strict';

const plan = name => JSON.parse(process.env[`RUN_${name}_PLAN`]);

assert.deepEqual(plan('AZURE'), {
  cloud: 'azure',
  'dry-run': 'true',
  'resource-group-name': 'rg-e2e-tfstate',
  'storage-account-name': 'ste2estate',
  'container-name': 'e2e-tfstate',
  location: 'westeurope',
  'bucket-name': '',
  region: '',
}, 'Azure state config resolves to normalized backend coordinates');

const aws = plan('AWS');
assert.deepEqual(
  { cloud: aws.cloud, dryRun: aws['dry-run'], bucket: aws['bucket-name'], region: aws.region, account: aws['storage-account-name'] },
  { cloud: 'aws', dryRun: 'true', bucket: 'e2e-example-state', region: 'eu-central-1', account: '' },
  'AWS state config resolves the bucket and falls back to default_location for the region',
);

console.log('State backend checks passed');
