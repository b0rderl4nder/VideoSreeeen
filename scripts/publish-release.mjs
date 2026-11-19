import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { assertVerifiedMain, cleanCommit, repo, run, verifiedAssets } from './release-evidence.mjs';
const pkg = JSON.parse(await readFile('package.json', 'utf8')),
  tag = 'v' + pkg.version;
const commit = cleanCommit();
assertVerifiedMain(commit);
const list = JSON.parse(
  run('gh', ['release', 'list', '--repo', repo, '--limit', '100', '--json', 'tagName,isDraft']),
);
const existing = list.find((r) => r.tagName === tag);
assert.ok(
  !existing || existing.isDraft,
  'A published release with this version already exists; assets are immutable',
);
const directory = `artifacts/release/${pkg.version}`;
const { names, hashes } = await verifiedAssets(directory, commit, pkg.version);
assert.equal(
  JSON.parse(await readFile(join(directory, 'update.json'), 'utf8')).version,
  pkg.version,
);
// Keep a failed upload as a draft. Never publish an incomplete set of clients.
if (!existing)
  run('gh', [
    'release',
    'create',
    tag,
    '--repo',
    repo,
    '--target',
    commit,
    '--draft',
    '--title',
    `VideoSreeeen ${pkg.version}`,
    '--notes-file',
    'docs/release-notes.md',
  ]);
const view = () =>
  JSON.parse(
    run('gh', [
      'release',
      'view',
      tag,
      '--repo',
      repo,
      '--json',
      'isDraft,targetCommitish,tagName,assets',
    ]),
  );
const draft = view();
assert.equal(draft.isDraft, true);
assert.equal(
  draft.targetCommitish,
  commit,
  'Draft points to different source; review it before resuming',
);
async function verifyAsset(asset) {
  assert.ok(names.includes(asset.name), 'Unexpected draft asset ' + asset.name);
  const file = join(directory, asset.name);
  assert.equal(asset.size, (await stat(file)).size);
  assert.equal(
    asset.digest,
    'sha256:' + hashes[asset.name],
    'Draft asset differs from validated file',
  );
}
for (const asset of draft.assets) await verifyAsset(asset);
const missing = names.filter((name) => !draft.assets.some((asset) => asset.name === name));
if (missing.length)
  run('gh', [
    'release',
    'upload',
    tag,
    '--repo',
    repo,
    ...missing.map((name) => join(directory, name)),
  ]);
// The CLI resolves draft releases without relying on a public tag/ref that
// GitHub has not created yet. Always verify bytes before making it public.
const result = view();
assert.equal(result.assets.length, names.length);
for (const asset of result.assets) await verifyAsset(asset);
assert.equal(cleanCommit(), commit, 'Source changed during release upload');
assertVerifiedMain(commit);
run('gh', [
  'release',
  'edit',
  tag,
  '--repo',
  repo,
  '--draft=false',
  '--latest',
  '--notes-file',
  'docs/release-notes.md',
]);
assert.equal(view().isDraft, false);
console.log(`Published https://github.com/${repo}/releases/tag/${tag} at ${commit}`);
