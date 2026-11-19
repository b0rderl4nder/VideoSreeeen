import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assertVerifiedMain, cleanCommit, digest, stagedAssets } from './release-evidence.mjs';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
const commit = cleanCommit();
const target = `artifacts/release/${pkg.version}`;
const [expected, stage] = process.argv.slice(2);
if (expected === '--preflight') {
  assertVerifiedMain(commit);
  const exists = await stat(target).then(
    () => true,
    (error) => {
      if (error.code !== 'ENOENT') throw error;
      return false;
    },
  );
  assert.ok(!exists, `Release directory already exists: ${target}`);
  console.log(commit);
} else {
  assert.equal(commit, expected, 'Source changed during the release build');
  assert.ok(stage, 'Use scripts/build-release.ps1 to build and prepare a release');
  assertVerifiedMain(commit);
  const prepared = join(stage, 'prepared');
  await mkdir(prepared);
  const assets = stagedAssets(pkg.version);
  for (const [name, relativePath] of Object.entries(assets))
    await copyFile(join(stage, relativePath), join(prepared, name));
  const latest = await readFile(join(prepared, 'latest.yml'), 'utf8');
  assert.equal(latest.match(/^version:\s*(\S+)\s*$/m)?.[1], pkg.version);
  const gradle = await readFile('android/app/build.gradle', 'utf8');
  assert.equal(gradle.match(/versionName\s+'([^']+)'/)?.[1], pkg.version);
  const versionCode = Number(gradle.match(/versionCode\s+(\d+)/)?.[1]);
  assert.ok(versionCode > 0);
  const apk = join(prepared, 'VideoSreeeen-Android.apk');
  const manifest = {
    version: pkg.version,
    android: {
      versionCode,
      url: `https://github.com/BorderArea01/VideoSreeeen/releases/download/v${pkg.version}/VideoSreeeen-Android.apk`,
      sha256: await digest(apk),
      size: (await stat(apk)).size,
    },
  };
  await writeFile(join(prepared, 'update.json'), JSON.stringify(manifest, null, 2) + '\n');
  const files = Object.keys(assets).concat('update.json');
  const hashes = await Promise.all(
    files.map(async (name) => [name, await digest(join(prepared, name))]),
  );
  await writeFile(
    join(prepared, 'SHA256SUMS.txt'),
    hashes.map(([name, sha]) => sha + '  ' + name).join('\n') + '\n',
  );
  hashes.push(['SHA256SUMS.txt', await digest(join(prepared, 'SHA256SUMS.txt'))]);
  const receipt = { commit, version: pkg.version, hashes: Object.fromEntries(hashes) };
  await writeFile(join(prepared, '.build-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  assert.equal(cleanCommit(), commit, 'Source changed while preparing release assets');
  await mkdir('artifacts/release', { recursive: true });
  await rename(prepared, target);
  console.log(`Prepared v${pkg.version} from ${commit}: ${hashes.length} assets`);
}
