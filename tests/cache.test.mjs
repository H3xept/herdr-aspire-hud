// The shared aspire cache: answers are reused within the TTL, fetched again
// after it or on a fresh poll, and a restart or a stop is never hidden by it.
// A fake `aspire` logs each call; a fake herdr socket answers workspace.list.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { forgetAppHosts, poll } from '../lib/collect.mjs';

const dir = mkdtempSync(join(tmpdir(), 'aspire-hud-cache-'));
const calls = join(dir, 'calls');
const pidFile = join(dir, 'pid-a');
let server;

before(async () => {
  const bin = join(dir, 'aspire');
  writeFileSync(bin, `#!/bin/sh
echo "$1" >> "${calls}"
case "$1" in
  ps) echo '[{"appHostPath":"/w/a/apphost.ts","appHostPid":'"$(cat ${pidFile})"',"cliPid":1,"status":"running"},{"appHostPath":"/w/b/apphost.ts","appHostPid":20,"cliPid":2,"status":"running"}]' ;;
  describe) echo '{"resources":[{"name":"db","state":"Running","healthStatus":"Healthy","urls":[]}]}' ;;
esac
`);
  chmodSync(bin, 0o755);
  writeFileSync(pidFile, '10');

  const sock = join(dir, 'herdr.sock');
  server = net.createServer((c) => c.on('data', () => c.end(`${JSON.stringify({ id: 'x', result: { workspaces: [] } })}\n`)));
  await new Promise((resolve) => server.listen(sock, resolve));

  Object.assign(process.env, { ASPIRE_BIN: bin, HERDR_SOCKET_PATH: sock, HERDR_PLUGIN_STATE_DIR: join(dir, 'state') });
});

after(() => server.close());

// Counts calls since the last reset: {ps: n, describe: n}.
function takeCalls() {
  let text = '';
  try { text = readFileSync(calls, 'utf8'); } catch { /* none yet */ }
  writeFileSync(calls, '');
  const out = { ps: 0, describe: 0 };
  for (const verb of text.split('\n').filter(Boolean)) out[verb] += 1;
  return out;
}

test('a second poll within the TTL is served from the cache; after it, aspire is asked again', async () => {
  takeCalls();
  const first = await poll({ ttlMs: 60_000 });
  assert.deepEqual(takeCalls(), { ps: 1, describe: 2 });
  assert.equal(first.apphosts.length, 2);

  const second = await poll({ ttlMs: 60_000 });
  assert.deepEqual(takeCalls(), { ps: 0, describe: 0 });
  assert.deepEqual(second.apphosts.map((a) => a.detail.resources.length), [1, 1]);

  await new Promise((r) => setTimeout(r, 30));
  await poll({ ttlMs: 20 });
  assert.deepEqual(takeCalls(), { ps: 1, describe: 2 });
});

test('a fresh poll skips the cache even when it is young', async () => {
  await poll({ ttlMs: 60_000 });
  takeCalls();
  await poll({ ttlMs: 60_000, fresh: true });
  assert.deepEqual(takeCalls(), { ps: 1, describe: 2 });
});

test('an AppHost that restarted under a new pid is described again while its old detail is young', async () => {
  await poll({ fresh: true });
  // Age only the ps list, so the next poll lists AppHosts again but every
  // resource list is still inside the TTL.
  const cacheFile = join(dir, 'state', 'cache.json');
  const cache = JSON.parse(readFileSync(cacheFile, 'utf8'));
  cache.ps.at = 0;
  writeFileSync(cacheFile, JSON.stringify(cache));
  writeFileSync(pidFile, '11');
  takeCalls();

  const snap = await poll({ ttlMs: 60_000 });
  assert.deepEqual(takeCalls(), { ps: 1, describe: 1 });
  const a = snap.apphosts.find((x) => x.appHostPath === '/w/a/apphost.ts');
  assert.equal(a.detail.pid, 11);
});

test('a stopped AppHost leaves the cache at once, without asking aspire', async () => {
  await poll({ fresh: true });
  takeCalls();
  forgetAppHosts(['/w/a/apphost.ts']);
  const snap = await poll({ ttlMs: 60_000 });
  assert.deepEqual(snap.apphosts.map((a) => a.appHostPath), ['/w/b/apphost.ts']);
  assert.deepEqual(takeCalls(), { ps: 0, describe: 0 });
});
