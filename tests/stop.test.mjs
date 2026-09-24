// Stopping an AppHost: `aspire stop` is trusted when it succeeds, and signals
// finish the job only when it fails. A fake `aspire` stands in for the CLI and
// `sleep` processes stand in for the AppHost and its launching CLI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { stopAppHost } from '../lib/aspire.mjs';

const dir = mkdtempSync(join(tmpdir(), 'aspire-hud-stop-'));

function fakeAspire(exitCode) {
  const bin = join(dir, `aspire-${exitCode}`);
  writeFileSync(bin, `#!/bin/sh\necho "$@" >> "${join(dir, 'calls')}"\necho "boom" >&2\nexit ${exitCode}\n`);
  chmodSync(bin, 0o755);
  return bin;
}

function fakeProcess() {
  const child = spawn('sleep', ['60'], { stdio: 'ignore' });
  const exited = new Promise((resolve) => child.on('exit', (_code, signal) => resolve(signal)));
  return { pid: child.pid, exited, child };
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('a successful aspire stop sends no signals and never passes --force', async () => {
  process.env.ASPIRE_BIN = fakeAspire(0);
  const host = fakeProcess();
  try {
    const result = await stopAppHost({ appHostPath: '/w/a/apphost.ts', appHostPid: host.pid });
    assert.equal(result.how, 'stopped');
    assert.equal(alive(host.pid), true);
    const call = readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n').pop();
    assert.match(call, /^stop --apphost \/w\/a\/apphost\.ts /);
    assert.doesNotMatch(call, /--force/);
  } finally {
    host.child.kill('SIGKILL');
  }
});

test('when aspire stop fails, the AppHost and its CLI are signalled until gone', async () => {
  process.env.ASPIRE_BIN = fakeAspire(1);
  const host = fakeProcess();
  const cli = fakeProcess();
  const result = await stopAppHost(
    { appHostPath: '/w/b/apphost.ts', appHostPid: host.pid, cliPid: cli.pid },
    { graceMs: 1_000 },
  );
  assert.equal(result.how, 'killed');
  assert.match(result.error, /boom/);
  assert.equal(await host.exited, 'SIGTERM');
  assert.equal(await cli.exited, 'SIGTERM');
});

test('a failed aspire stop on processes that are already gone counts as stopped', async () => {
  process.env.ASPIRE_BIN = fakeAspire(1);
  const host = fakeProcess();
  host.child.kill('SIGKILL');
  await host.exited;
  const result = await stopAppHost({ appHostPath: '/w/c/apphost.ts', appHostPid: host.pid });
  assert.equal(result.how, 'stopped');
});
