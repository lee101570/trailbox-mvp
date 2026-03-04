#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const packageDirs = [
  'packages/protocol',
  'packages/storage',
  'packages/sdk-core',
  'packages/sdk-next',
  'packages/agent',
  'apps/dashboard',
  'packages/cli',
];

if (!process.env.NPM_TOKEN && !process.env.NODE_AUTH_TOKEN) {
  console.error('[release] Missing NPM token. Set NPM_TOKEN or NODE_AUTH_TOKEN.');
  process.exit(1);
}

for (const relDir of packageDirs) {
  const dir = join(root, relDir);
  const pkgPath = join(dir, 'package.json');
  if (!existsSync(pkgPath)) {
    console.log(`[release] skip missing package: ${relDir}`);
    continue;
  }

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  if (pkg.private) {
    console.log(`[release] skip private package: ${pkg.name || relDir}`);
    continue;
  }
  if (!pkg.name || !pkg.version) {
    console.log(`[release] skip invalid package metadata: ${relDir}`);
    continue;
  }
  if (!existsSync(join(dir, 'dist'))) {
    console.error(`[release] missing dist for ${pkg.name}. Run build before publish.`);
    process.exit(1);
  }

  const versionTag = `${pkg.name}@${pkg.version}`;
  const versionCheck = run('npm', ['view', versionTag, 'version', '--registry=https://registry.npmjs.org'], {
    cwd: dir,
    stdio: 'pipe',
  });

  if (versionCheck.status === 0) {
    console.log(`[release] already published: ${versionTag}`);
    continue;
  }
  const checkOutput = `${versionCheck.stdout || ''}\n${versionCheck.stderr || ''}`;
  const isNotFound = /E404|404 Not Found|No match found for version/i.test(checkOutput);
  if (!isNotFound) {
    console.error(`[release] failed to verify existing version for ${versionTag}`);
    process.stderr.write(checkOutput);
    process.exit(versionCheck.status || 1);
  }

  console.log(`[release] publishing ${versionTag}`);
  const publish = run(
    'npm',
    ['publish', '--access', 'public', '--provenance', '--registry=https://registry.npmjs.org'],
    {
      cwd: dir,
      stdio: 'inherit',
    }
  );
  if (publish.status !== 0) {
    console.error(`[release] failed publish: ${versionTag}`);
    process.exit(publish.status || 1);
  }
}

console.log('[release] publish workflow completed');

function run(command, args, options) {
  const cmd = process.platform === 'win32' ? `${command}.cmd` : command;
  return spawnSync(cmd, args, {
    ...options,
    env: process.env,
    encoding: 'utf8',
  });
}
