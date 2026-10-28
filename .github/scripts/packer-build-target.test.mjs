import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  assembleVarFile,
  azureImageRef,
  costNote,
  declaredPackerVariables,
  galleryFieldsFromStack,
  hetznerImageRef,
  manifestSnapshotId,
  parseWorkflowRef,
  resolveBuildTarget,
  resolveHetzner,
  snapshotsToDelete,
  transferVariableMap,
} from './packer-build-target.mjs';

const sha = '0123456789abcdef0123456789abcdef01234567';

test('omitted build_target stays azure and aliases fold into the gallery object', () => {
  assert.equal(resolveBuildTarget({ type: 'packer' }), 'azure');
  const resolved = galleryFieldsFromStack({
    gallery_name: 'corp_gallery',
    image_version: '1.2.3',
    azure: { image_version: '1.2.3', image_definition_name: 'ubuntu2404' },
  });
  assert.deepEqual(resolved.fields, {
    gallery_name: 'corp_gallery',
    image_version: '1.2.3',
    image_definition_name: 'ubuntu2404',
  });
  assert.throws(() => galleryFieldsFromStack({ gallery_name: 'a', azure: { gallery_name: 'b' } }), /conflicts/);
});

test('legacy var files stay byte-identical when nothing new is declared', () => {
  const existing = {
    image_resource_group_name: 'rg-images',
    gallery_name: 'corp_gallery',
    image_definition_name: 'ubuntu2404',
    image_version: '1.2.3',
    target_regions: ['westeurope'],
  };
  const assembled = assembleVarFile({
    existing,
    targetFields: {},
    stax: { stax_build_target: 'azure', stax_git_sha: sha },
    declared: new Set(),
  });
  assert.equal(assembled.changed, false);
  assert.deepEqual(assembled.vars, existing);
});

test('declared stax variables are injected and input conflicts are rejected', () => {
  const assembled = assembleVarFile({
    existing: { gallery_name: 'corp_gallery' },
    targetFields: { gallery_name: 'corp_gallery', image_version: '1.2.3' },
    stax: { stax_build_target: 'azure', stax_image_version: '1.2.3', stax_git_sha: sha },
    declared: new Set(['stax_build_target', 'stax_image_version']),
  });
  assert.deepEqual(assembled.added, ['image_version', 'stax_build_target', 'stax_image_version']);
  assert.equal(assembled.vars.stax_git_sha, undefined);
  assert.throws(
    () => assembleVarFile({
      existing: { gallery_name: 'from-input' },
      targetFields: { gallery_name: 'from-azure' },
      stax: {},
      declared: new Set(),
    }),
    /conflicts/,
  );
});

test('hetzner labels keep the retention selector even when the user sets those keys', () => {
  const resolved = resolveHetzner({
    id: 'golden-hetzner',
    hetzner: {
      location: 'fsn1',
      server_type: 'cax11',
      snapshot_name: 'personal-assistant-golden',
      snapshot_labels: { 'personal-assistant': 'true', role: 'golden', managed_by: 'someone-else' },
    },
  }, { gitSha: sha, environment: 'dev' });
  assert.equal(resolved.keepLast, 3);
  assert.equal(resolved.fields.snapshot_labels.managed_by, 'stax');
  assert.equal(resolved.fields.snapshot_labels.stax_stack_id, 'golden-hetzner');
  assert.equal(resolved.fields.snapshot_labels['personal-assistant'], 'true');
  assert.equal(resolved.fields.server_type, 'cax11');
  assert.match(costNote('cax11', 3), /€0\.01 per hour/);
});

test('retention keeps the newest matches and never deletes the snapshot just built', () => {
  const images = [1, 2, 3, 4].map((id) => ({
    id,
    type: 'snapshot',
    created: `2026-10-0${id}T00:00:00Z`,
    labels: { managed_by: 'stax', stax_stack_id: 'golden-hetzner', stax_env: 'dev', stax_build_target: 'hetzner', role: 'golden' },
  }));
  images.push({ id: 9, type: 'snapshot', created: '2026-10-09T00:00:00Z', labels: { managed_by: 'other' } });
  const selector = { managed_by: 'stax', stax_stack_id: 'golden-hetzner', stax_env: 'dev', stax_build_target: 'hetzner' };
  assert.deepEqual(snapshotsToDelete({ images, selector, keepLast: 3, protectIds: ['4'] }), ['1']);
  assert.deepEqual(snapshotsToDelete({ images, selector, keepLast: 0, protectIds: ['4'] }), ['1', '2', '3']);
  assert.deepEqual(snapshotsToDelete({ images, selector, keepLast: 0 }), ['1', '2', '3', '4']);
});

test('manifest ids and normalized outputs', () => {
  assert.equal(manifestSnapshotId({ builds: [{ artifact_id: 'hcloud.personal_assistant:42' }, { artifact_id: '99' }] }), '99');
  assert.equal(hetznerImageRef('99'), 'hcloud:snapshot:99');
  assert.equal(azureImageRef({ resourceGroup: 'rg-images', gallery: 'corp_gallery', definition: 'ubuntu2404', version: '1.2.3' }), 'azure:gallery:rg-images/corp_gallery/ubuntu2404/1.2.3');
  assert.deepEqual(
    transferVariableMap('golden-hetzner', ['image_id', 'labels', 'missing'], { image_id: '99', labels: '{"role":"golden"}', image_ref: '' }),
    { GOLDEN_HETZNER__IMAGE_ID: '99', GOLDEN_HETZNER__LABELS: '{"role":"golden"}' },
  );
  assert.throws(() => manifestSnapshotId({ builds: [] }), /manifest/);
});

test('template variable discovery ignores the plugin cache', () => {
  const root = mkdtempSync(join(tmpdir(), 'packer-vars-'));
  mkdirSync(join(root, '.packer'));
  writeFileSync(join(root, 'image.pkr.hcl'), 'variable "location" {\n  type = string\n}\nvariable "stax_git_sha" {\n  type = string\n}\n');
  writeFileSync(join(root, '.packer', 'ignore.pkr.hcl'), 'variable "token" {\n  type = string\n}\n');
  assert.deepEqual([...declaredPackerVariables(root)].sort(), ['location', 'stax_git_sha']);
});

test('workflow ref parsing', () => {
  assert.deepEqual(
    parseWorkflowRef('fractiunate/stax/.github/workflows/a-wf-deploy-stack-packer.yml@refs/heads/cursor/packer-multicloud-cd34'),
    { repository: 'fractiunate/stax', ref: 'refs/heads/cursor/packer-multicloud-cd34' },
  );
  assert.throws(() => parseWorkflowRef('main'), /workflow_ref/);
});
