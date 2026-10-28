import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const helper = fileURLToPath(new URL('./run.sh', import.meta.url));
function scenario(conclusions, expectedStatus, expectedCalls) {
  const directory = mkdtempSync(join(tmpdir(), 'stax-jobs-'));
  try {
    writeFileSync(join(directory, 'responses.json'), JSON.stringify(conclusions));
    writeFileSync(join(directory, 'gh'), `#!${process.execPath}
const fs = require('node:fs');
const dir = process.env.FIXTURE;
const calls = Number(fs.existsSync(dir+'/calls') ? fs.readFileSync(dir+'/calls','utf8') : 0);
const states = JSON.parse(fs.readFileSync(dir+'/responses.json','utf8'));
fs.writeFileSync(dir+'/calls', String(calls+1));
console.log(JSON.stringify({id:42,name:'Build / Docker: fixture', conclusion:states[Math.min(calls,states.length-1)]}));
`, { mode: 0o755 });
    writeFileSync(join(directory, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const result = spawnSync('bash', [helper, 'jobs', 'Docker: fixture$', 'success', '1'], {
      encoding: 'utf8', env: { ...process.env, PATH: directory + delimiter + process.env.PATH,
        FIXTURE: directory, GITHUB_REPOSITORY: 'example/framework', GITHUB_RUN_ID: '1', GITHUB_RUN_ATTEMPT: '1' },
    });
    assert.equal(result.status, expectedStatus, result.stdout + result.stderr);
    assert.equal(Number(readFileSync(join(directory, 'calls'), 'utf8')), expectedCalls);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test('waits for a matching job that is still in progress in the Jobs API', () => scenario([null, 'success'], 0, 2));
test('does not retry or hide a completed failed job', () => scenario(['failure', 'success'], 1, 1));
test('fails when the API never reports a final conclusion', () => scenario([null], 1, 26));
