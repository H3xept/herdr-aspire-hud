// The rules that decide what the sidebar says. The resource shapes are taken
// from `aspire describe --format Json` on Aspire 13.5 AppHosts, including the
// states seen live: explicit-start resources that never ran, migrators that
// exited 0, and containers that died with 255 when Docker restarted.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classify, mapToSpaces, summarize, tokensFor } from '../lib/model.mjs';

const res = (state, extra = {}) => ({ resourceType: 'Executable', state, ...extra });

test('a one-shot that exited 0 is ok, one that exited nonzero is down', () => {
  assert.equal(classify(res('Exited', { resourceType: 'Container', exitCode: 0 })), 'ok');
  assert.equal(classify(res('Exited', { resourceType: 'Container', exitCode: 255 })), 'down');
  assert.equal(classify(res('Finished', { exitCode: 1 })), 'down');
  // Stopped with no exit code is not running, so it is not ok.
  assert.equal(classify(res('Exited', { exitCode: null })), 'down');
});

test('running is ok only while not reported unhealthy', () => {
  assert.equal(classify(res('Running', { healthStatus: 'Healthy' })), 'ok');
  assert.equal(classify(res('Running', { healthStatus: null })), 'ok');
  assert.equal(classify(res('Running', { healthStatus: 'Unhealthy' })), 'warn');
  assert.equal(classify(res('Running', { healthStatus: 'Degraded' })), 'warn');
});

test('unsettled and unknown states warn; failed start and a sick runtime are down', () => {
  for (const state of ['Starting', 'Waiting', 'Stopping', 'SomethingNew']) assert.equal(classify(res(state)), 'warn');
  assert.equal(classify(res('FailedToStart')), 'down');
  assert.equal(classify(res('RuntimeUnhealthy')), 'down');
});

test('the count leaves out parameters and never-started resources', () => {
  const s = summarize([
    res('Running', { healthStatus: 'Healthy' }),
    res('Running', { resourceType: 'Parameter', healthStatus: 'Healthy' }),
    res('NotStarted'),
    res('Exited', { exitCode: 255 }),
  ]);
  assert.deepEqual(s, { ok: 1, warn: 0, down: 1, idle: 1, total: 2 });
});

test('a space gets exactly one token, colored by its worst resource', () => {
  const healthy = { resources: [res('Running'), res('Exited', { exitCode: 0 })] };
  const starting = { resources: [res('Running'), res('Starting')] };
  const broken = { resources: [res('Running'), res('Exited', { exitCode: 255 })] };

  assert.deepEqual(tokensFor([healthy]), { aspire_ok: '◆ 2/2', aspire_warn: null, aspire_down: null });
  assert.deepEqual(tokensFor([starting]), { aspire_ok: null, aspire_warn: '◆ 1/2', aspire_down: null });
  // Two AppHosts in one space: counts add up, the worse level wins.
  assert.deepEqual(tokensFor([healthy, broken]), { aspire_ok: null, aspire_warn: null, aspire_down: '◆ 3/4' });
});

test('an AppHost that did not answer describe shows as a warning with no count', () => {
  assert.deepEqual(tokensFor([{ error: 'aspire describe: timed out' }]),
    { aspire_ok: null, aspire_warn: '◆ ?', aspire_down: null });
  // One known AppHost still contributes its count, but the space cannot be ok.
  assert.deepEqual(tokensFor([{ resources: [res('Running')] }, { error: 'x' }]),
    { aspire_ok: null, aspire_warn: '◆ 1/1', aspire_down: null });
});

test('an AppHost maps to the deepest worktree that contains it, on a path boundary', () => {
  const spaces = [
    { workspace_id: 'repo', worktree: { checkout_path: '/w/main' } },
    { workspace_id: 'nested', worktree: { checkout_path: '/w/main/wts/feat' } },
    { workspace_id: 'sibling', worktree: { checkout_path: '/w/main-2' } },
    { workspace_id: 'twin', worktree: { checkout_path: '/w/main-2' } },
    { workspace_id: 'plain' },
  ];
  const map = mapToSpaces([
    { appHostPath: '/w/main/ops/apphost.ts' },
    { appHostPath: '/w/main/wts/feat/ops/apphost.ts' },
    { appHostPath: '/w/main-2/ops/apphost.ts' },
    { appHostPath: '/elsewhere/apphost.ts' },
  ], spaces);

  assert.deepEqual(map.get('/w/main/ops/apphost.ts'), ['repo']);
  assert.deepEqual(map.get('/w/main/wts/feat/ops/apphost.ts'), ['nested']);
  // "/w/main" is a string prefix of "/w/main-2" but not a directory prefix.
  assert.deepEqual(map.get('/w/main-2/ops/apphost.ts'), ['sibling', 'twin']);
  assert.deepEqual(map.get('/elsewhere/apphost.ts'), []);
});
