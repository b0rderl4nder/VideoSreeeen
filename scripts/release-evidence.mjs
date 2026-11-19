import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export const repo = 'b0rderl4nder/VideoSreeeen';
export const run = (command, args) =>
  execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

export function cleanCommit() {
  assert.equal(run('git', ['status', '--porcelain']), '', 'Release source must be committed');
  return run('git', ['rev-parse', 'HEAD']);
}

export function assertVerifiedMain(commit) {
  const remote = JSON.parse(run('gh', ['api', `repos/${repo}/git/ref/heads/main`]));
  assert.equal(remote.object.sha, commit, 'Release source must match GitHub main');
  const { workflow_runs: runs } = JSON.parse(
    run('gh', [
      'api',
      `repos/${repo}/actions/workflows/ci.yml/runs?branch=main&head_sha=${commit}&per_page=1`,
    ]),
  );
  const latest = runs[0];
  assert.ok(
    latest?.head_sha === commit &&
      latest.head_branch === 'main' &&
      latest.status === 'completed' &&
      latest.conclusion === 'success',
    'The latest Verify run for this main commit must have succeeded',
  );
}

export async function digest(path) {
  const hash = createHash('sha256');
  for await (const block of createReadStream(path)) hash.update(block);
  return hash.digest('hex');
}

export const stagedAssets = (version) => ({
  'VideoSreeeen-Setup.exe': 'windows/VideoSreeeen-Setup.exe',
  'VideoSreeeen-Setup.exe.blockmap': 'windows/VideoSreeeen-Setup.exe.blockmap',
  'latest.yml': 'windows/latest.yml',
  [`VideoSreeeen-Portable-${version}.exe`]: `windows/VideoSreeeen ${version}.exe`,
  'VideoSreeeen-Android.apk': 'VideoSreeeen-Android.apk',
  'VideoSreeeen-SourceHelper.zip': 'VideoSreeeen-SourceHelper.zip',
});

export async function verifiedAssets(directory, commit, version) {
  const receiptName = '.build-receipt.json';
  const receipt = JSON.parse(await readFile(join(directory, receiptName), 'utf8'));
  assert.equal(receipt.commit, commit, 'Release assets were prepared for a different commit');
  assert.equal(receipt.version, version, 'Release assets were prepared for a different version');
  const names = Object.keys(stagedAssets(version)).concat('update.json', 'SHA256SUMS.txt').sort();
  assert.deepEqual((await readdir(directory)).filter((name) => name !== receiptName).sort(), names);
  assert.deepEqual(Object.keys(receipt.hashes).sort(), names);
  for (const name of names)
    assert.equal(
      await digest(join(directory, name)),
      receipt.hashes[name],
      `Local asset changed: ${name}`,
    );
  return { names, hashes: receipt.hashes };
}
