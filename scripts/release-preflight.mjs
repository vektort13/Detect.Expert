// ADR-002, F091/F147: fail before build on an unsupported runtime or non-frozen workspace.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

export function supportedNode(version) {
  return /^v?(24|25)\.[0-9]+\.[0-9]+$/.test(version);
}

export function releasePreflight(root, { version = process.version, run = spawnSync, log = console.log } = {}) {
  log('release-verify: Node ' + version);
  if (!supportedNode(version)) throw new Error('Node >=24 <26 required before build');
  const lockfileSha256 = createHash('sha256').update(readFileSync(join(root, 'pnpm-lock.yaml'))).digest('hex');
  log('release-verify: lockfile sha256 ' + lockfileSha256);
  const cli = process.env.npm_execpath;
  if (!cli) throw new Error('Run pnpm release:verify to use the pinned package manager');
  // Respect the existing installation's content-addressed store; sandbox HOME defaults can differ.
  const modules = join(root, 'node_modules', '.modules.yaml');
  const stored = existsSync(modules) ? /^storeDir: (.+)$/m.exec(readFileSync(modules, 'utf8'))?.[1]?.trim() : undefined;
  const storeArgs = stored ? ['--store-dir', /[\\/]v10$/.test(stored) ? dirname(stored) : stored] : [];
  const result = run(process.execPath, [cli, 'install', '--offline', '--frozen-lockfile', '--ignore-scripts', ...storeArgs], {
    cwd: root, stdio: 'inherit', env: { ...process.env, CI: 'true' },
  });
  if (result.status !== 0) throw new Error('frozen offline installation preflight failed');
  const after = createHash('sha256').update(readFileSync(join(root, 'pnpm-lock.yaml'))).digest('hex');
  if (after !== lockfileSha256) throw new Error('preflight changed lockfile');
  return lockfileSha256;
}
