import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trustedDeployRun } from './e2e-trusted-run.mjs';

const run = { id: 1, repository: { full_name: 'example/framework' }, head_sha: 'abc',
  event: 'workflow_dispatch', path: '.github/workflows/e2e-deploy.yml', conclusion: 'success' };

test('requires upstream, exact head SHA and credentialed workflow dispatched by maintainers', () => {
  for (const change of [{ repository: { full_name: 'fork/framework' } }, { head_sha: 'old' },
    { event: 'pull_request' }, { path: '.github/workflows/cli.yml' }]) {
    assert.equal(trustedDeployRun([{ ...run, ...change }], 'example/framework', 'abc'), undefined);
  }
  assert.equal(trustedDeployRun([run], 'example/framework', 'abc'), run);
});

test('a newer failure or pending run cannot be hidden behind earlier success', () => {
  for (const conclusion of ['failure', null]) {
    const latest = { ...run, id: 2, conclusion };
    assert.equal(trustedDeployRun([run, latest], 'example/framework', 'abc'), latest);
  }
});
