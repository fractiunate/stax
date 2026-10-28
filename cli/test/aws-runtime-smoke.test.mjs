import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import YAML from 'yaml';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const action = YAML.parse(readFileSync(join(root, '.github/actions/terraform_action/v2.0/action.yaml'), 'utf8'));
const state = YAML.parse(readFileSync(join(root, '.github/workflows/a-wf-setup-state.yaml'), 'utf8'));
const actionStep = id => action.runs.steps.find(step => step.id === id);
const stateStep = name => state.jobs['setup-aws'].steps.find(step => step.name === name);

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'stax-aws-smoke-'));
  mkdirSync(join(dir, 'bin'));
  mkdirSync(join(dir, 'stack'));
  const log = join(dir, 'commands.log');
  const binary = join(dir, 'bin', 'terraform');
  writeFileSync(binary, `#!/usr/bin/env bash
if [[ "$1" == version && "$2" == -json ]]; then printf '{"terraform_version":"%s"}\\n' "$SMOKE_VERSION"; exit 0; fi
if [[ "$1" == version ]]; then echo "Terraform v$SMOKE_VERSION"; exit 0; fi
printf '%s|%s|%s|%s\\n' "$*" "\${AWS_ENDPOINT_URL_S3-}" "\${AWS_REQUEST_CHECKSUM_CALCULATION-}" "\${AWS_ENDPOINT_URL_STS-}" >> "$SMOKE_LOG"
if [[ " $* " == *' show -json '* ]]; then echo '{}'; fi
`);
  chmodSync(binary, 0o755);
  writeFileSync(join(dir, 'bin', 'aws'), `#!/usr/bin/env bash
printf 'aws %s\\n' "$*" >> "$SMOKE_LOG"
case "$*" in
  's3api head-bucket'*) case "$SMOKE_HEAD" in existing) exit 0;; missing) echo 'An error occurred (404) when calling the HeadBucket operation: Not Found' >&2; exit 255;; *) echo 'Could not connect to the endpoint URL' >&2; exit 255;; esac;;
  's3api get-bucket-versioning'*) echo Enabled;;
  *) echo 'Unexpected AWS operation in read-only smoke' >&2; exit 99;;
esac
`);
  chmodSync(join(dir, 'bin', 'aws'), 0o755);
  const env = { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}`, RUNNER_TEMP: dir,
    GITHUB_RUN_ID: '123', GITHUB_JOB: 'smoke', GITHUB_OUTPUT: join(dir, 'output'),
    GITHUB_ENV: join(dir, 'env'), SMOKE_LOG: log, SMOKE_HEAD: 'existing', SMOKE_VERSION: '1.11.0', GITHUB_REPOSITORY: 'example/project' };
  for (const key of ['AWS_ENDPOINT_URL', 'AWS_ENDPOINT_URL_S3', 'AWS_ENDPOINT_URL_STS', 'AWS_ENDPOINT_URL_IAM']) delete env[key];
  return { dir, log, env, close: () => rmSync(dir, { recursive: true, force: true }) };
}

function run(step, fixture, overrides = {}, substitutions = {}) {
  const script = step.run.replace(/\$\{\{([\s\S]*?)\}\}/g, (_match, expression) => {
    const key = expression.trim();
    if (!(key in substitutions)) throw new Error(`Unstubbed workflow expression: ${key}`);
    return substitutions[key];
  });
  const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
    cwd: fixture.dir, env: { ...fixture.env, ...overrides }, encoding: 'utf8',
  });
  return { ...result, output: result.stdout + result.stderr };
}

function initEnv(f, extra = {}) {
  return { ACTION_DEBUG: 'false', ACTION_STAGE: 'dev', ACTION_CHDIR: join(f.dir, 'stack'),
    ACTION_IAC_PROVIDER: 'terraform', ACTION_CLOUD: 'aws', ACTION_LOCAL_STATE: 'false',
    ACTION_BACKEND_CONFIG: '', OVERRIDE_STATE_KEY: 'test.tfstate',
    OVERRIDE_STATE_BUCKET_NAME: 'state-bucket', OVERRIDE_STATE_REGION: 'eu-central-1',
    ACTION_STATE_USE_LOCKFILE: 'true', ACTION_STATE_USE_PATH_STYLE: 'false',
    ACTION_AWS_S3_COMPATIBLE: 'false', ACTION_AWS_SKIP_STS_CHECK: 'false',
    ACTION_AWS_ENDPOINTS_FILE: '', ...extra };
}

function commands(f) { return readFileSync(f.log, 'utf8'); }

test('endpoint exports reach Terraform only, and native S3 locking stays enabled by default', () => {
  const f = fixture();
  try {
    const endpoint = run(actionStep('aws-endpoints'), f, {
      ACTION_AWS_ENDPOINT_URL: '', ACTION_AWS_ENDPOINT_URL_S3: 'https://s3.example.test',
      ACTION_AWS_ENDPOINT_URL_STS: 'https://sts.example.test', ACTION_AWS_ENDPOINT_URL_IAM: '',
      ACTION_AWS_S3_COMPATIBLE: 'true', ACTION_AWS_SKIP_STS_CHECK: 'true',
      ACTION_STATE_USE_LOCKFILE: 'true', ACTION_STATE_USE_PATH_STYLE: 'true',
    });
    assert.equal(endpoint.status, 0, endpoint.output);
    const envFile = readFileSync(f.env.GITHUB_OUTPUT, 'utf8').match(/^env-file=(.*)$/m)?.[1];
    assert.ok(envFile);
    assert.equal(f.env.AWS_ENDPOINT_URL_S3, undefined);
    const result = run(actionStep('init'), f, initEnv(f, {
      ACTION_AWS_ENDPOINTS_FILE: envFile, ACTION_AWS_S3_COMPATIBLE: 'true',
      ACTION_AWS_SKIP_STS_CHECK: 'true', ACTION_STATE_USE_PATH_STYLE: 'true',
    }));
    assert.equal(result.status, 0, result.output);
    assert.match(commands(f), /-backend-config=use_lockfile=true/);
    assert.match(commands(f), /-backend-config=skip_s3_checksum=true/);
    assert.match(commands(f), /-backend-config=skip_credentials_validation=true/);
    assert.match(commands(f), /-backend-config=use_path_style=true/);
    assert.match(commands(f), /\|https:\/\/s3\.example\.test\|when_required\|https:\/\/sts\.example\.test/);
    assert.equal(f.env.AWS_ENDPOINT_URL_S3, undefined);
  } finally { f.close(); }
});

test('unlocked legacy backend omits unsupported lockfile option; local and Azure keep their backend modes', () => {
  const f = fixture();
  try {
    for (const [cloud, extra] of [
      ['aws', { ACTION_STATE_USE_LOCKFILE: 'false', SMOKE_VERSION: '1.5.5' }],
      ['aws', { ACTION_LOCAL_STATE: 'true' }],
      ['azure', { OVERRIDE_STATE_BUCKET_NAME: '', OVERRIDE_STATE_KEY: '',
        OVERRIDE_STATE_STORAGE_ACCOUNT_NAME: 'account', OVERRIDE_STATE_CONTAINER_NAME: 'tfstate',
        OVERRIDE_STATE_RESOURCE_GROUP_NAME: 'rg' }],
    ]) {
      writeFileSync(f.log, '');
      const result = run(actionStep('init'), f, initEnv(f, { ACTION_CLOUD: cloud, ...extra }));
      assert.equal(result.status, 0, result.output);
      const args = commands(f);
      const backend = readFileSync(join(f.dir, 'stack', 'zz_backend_override.tf'), 'utf8');
      if (cloud === 'azure') {
        assert.match(backend, /backend "azurerm"/);
        assert.match(args, /-backend-config=container_name=tfstate/);
        assert.doesNotMatch(args, /use_lockfile/);
      } else if (extra.ACTION_LOCAL_STATE) {
        assert.match(backend, /backend "local"/);
        assert.doesNotMatch(args, /-backend-config=/);
      } else {
        assert.match(backend, /backend "s3"/);
        assert.match(args, /-backend-config=bucket=state-bucket/);
        assert.doesNotMatch(args, /use_lockfile/);
      }
    }
  } finally { f.close(); }
});

test('dry-run never mutates AWS and ambiguous head-bucket errors fail closed', () => {
  for (const [head, expectedStatus, expectedBucket] of [
    ['existing', 0, 'bucket_exists=true'], ['missing', 0, 'bucket_exists=false'], ['error', 1, null],
  ]) {
    const f = fixture();
    try {
      const result = run(stateStep('Ensure state bucket'), f,
        { DRY_RUN: 'true', S3_COMPATIBLE: 'true', SKIP_STS_CHECK: 'true', SMOKE_HEAD: head },
        { 'steps.resolve-config.outputs.bucket_name': 'state-bucket',
          'steps.resolve-config.outputs.region': 'eu-central-1' });
      assert.equal(result.status, expectedStatus, result.output);
      if (expectedBucket) assert.match(readFileSync(f.env.GITHUB_OUTPUT, 'utf8'), new RegExp(expectedBucket));
      assert.doesNotMatch(commands(f), /aws s3api (create|put|delete)-/);
      if (head === 'existing') assert.match(commands(f), /get-bucket-versioning/);
    } finally { f.close(); }
  }
});

test('AWS plans lock by default; explicit dry-run no-lock and unchanged Azure default do not', () => {
  for (const [cloud, noLock, unlocked] of [
    ['aws', '', false], ['aws', 'true', true], ['azure', '', true],
  ]) {
    const f = fixture();
    try {
      const result = run(actionStep('plan'), f, {
        ACTION_DEBUG: 'false', ACTION_CHDIR: join(f.dir, 'stack'), ACTION_IAC_PROVIDER: 'terraform',
        ACTION_CLOUD: cloud, ACTION_DESTROY: 'false', ACTION_NO_LOCK: noLock,
        ACTION_BACKEND_CONFIG: '', ACTION_TFVARS_FILE: '', ACTION_LOCATION: '',
        ACTION_GH_TOKEN: '', ACTION_GH_OWNER: 'example', ACTION_PLAN_BINARY_NAME: 'plan.tfplan',
        ACTION_AWS_ENDPOINTS_FILE: '', TF_VARS_MAP: '"[]"',
        OVERRIDE_STATE_KEY: '', OVERRIDE_STATE_CONTAINER_NAME: '',
        OVERRIDE_STATE_STORAGE_ACCOUNT_NAME: '', OVERRIDE_STATE_RESOURCE_GROUP_NAME: '',
        OVERRIDE_STATE_BUCKET_NAME: '', OVERRIDE_STATE_REGION: '',
      }, {
        "inputs.iac-provider == 'opentofu' && 'OpenTofu' || 'Terraform'": 'Terraform',
        'github.repository': 'example/project',
      });
      assert.equal(result.status, 0, result.output);
      assert.equal(commands(f).includes('-lock=false'), unlocked);
    } finally { f.close(); }
  }
});

test('runtime endpoint validation rejects malformed authorities and ports in both shell steps', () => {
  for (const url of ['https://', 'https://s3.example.test:65536', 'https://s3.example.test/path#fragment', 'https://s3.example.test\\evil']) {
    const f = fixture();
    try {
      const inputs = { ACTION_AWS_ENDPOINT_URL: '', ACTION_AWS_ENDPOINT_URL_S3: url,
        ACTION_AWS_ENDPOINT_URL_STS: '', ACTION_AWS_ENDPOINT_URL_IAM: '',
        ACTION_AWS_S3_COMPATIBLE: 'false', ACTION_AWS_SKIP_STS_CHECK: 'false',
        ACTION_STATE_USE_LOCKFILE: 'true', ACTION_STATE_USE_PATH_STYLE: 'false' };
      const endpoint = run(actionStep('aws-endpoints'), f, inputs);
      assert.notEqual(endpoint.status, 0, url);
      assert.match(endpoint.output, /must be a valid https URL/);
      const stateResolve = run(stateStep('Resolve config'), f, {
        INPUT_AWS_ENDPOINT_URL: '', INPUT_AWS_ENDPOINT_URL_S3: url, INPUT_AWS_ENDPOINT_URL_STS: '',
        S3_COMPATIBLE: 'false', SKIP_STS_CHECK: 'false', OIDC_ENABLED: 'false',
        DRY_RUN: 'true', AWS_REGION: 'eu-central-1',
      }, { 'inputs.bucket_name || vars.STATE_BUCKET_NAME': 'state-bucket', 'inputs.environment': 'smoke' });
      assert.notEqual(stateResolve.status, 0, url);
      assert.match(stateResolve.output, /must be a valid https URL/);
    } finally { f.close(); }
  }
});
