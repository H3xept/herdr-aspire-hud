// Release contract: package.json is the one version source, herdr-plugin.toml
// has to repeat it, and the code's fallback plugin id has to match the
// manifest's, or a verb run from a plain shell looks for the daemon's pid file
// in another plugin's state directory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const PKG = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));

// Top-level keys only: everything before the first [table] or [[array]].
const manifest = readFileSync(new URL('herdr-plugin.toml', root), 'utf8').split(/^\[/m)[0];
const topLevel = (key) => new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, 'm').exec(manifest)?.[1];

function withoutHerdrEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('HERDR_')) delete env[key];
  return env;
}

test('herdr-plugin.toml carries the package.json version', () => {
  assert.equal(topLevel('version'), PKG.version);
});

test('aspire-hud version prints the package.json version', () => {
  const out = execFileSync(process.execPath, [new URL('bin/aspire-hud', root).pathname, 'version'], {
    encoding: 'utf8',
    env: withoutHerdrEnv(),
  });
  assert.equal(out.trim(), PKG.version);
});

test('the fallback plugin id outside herdr is the manifest id', () => {
  const out = execFileSync(process.execPath, [
    '--input-type=module',
    '-e',
    `import { PLUGIN_ID } from ${JSON.stringify(new URL('lib/env.mjs', root).href)}; process.stdout.write(PLUGIN_ID);`,
  ], { encoding: 'utf8', env: withoutHerdrEnv() });
  assert.equal(out, topLevel('id'));
});
