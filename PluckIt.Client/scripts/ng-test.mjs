#!/usr/bin/env node
/**
 * Runs `ng test` with Node flags required for a working jsdom localStorage.
 *
 * Node 25+ enables a stub Web Storage API by default. That stub shadows
 * jsdom's Storage and breaks tests (`setItem` / `clear` are not functions).
 * Disabling it with `--no-webstorage` lets jsdom own localStorage again.
 * The flag does not exist on Node 20 (CI), so apply it only on Node 25+.
 */
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const major = Number(process.versions.node.split('.')[0]);
const env = { ...process.env };

if (major >= 25) {
  const flag = '--no-webstorage';
  env.NODE_OPTIONS = env.NODE_OPTIONS ? `${env.NODE_OPTIONS} ${flag}` : flag;
}

const result = spawnSync('npx', ['ng', 'test', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
  shell: true,
});

process.exit(result.status ?? 1);
