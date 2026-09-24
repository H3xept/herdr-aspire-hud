import { test } from 'node:test';
import assert from 'node:assert/strict';

import { confirmText } from '../lib/hud.mjs';

const names = Array.from({ length: 13 }, (_, i) => `worktree-number-${i} (no space)`);

test('the stop prompt fits the popup width and always ends in the y/n question', () => {
  for (const cols of [30, 58, 90, 178]) {
    const text = confirmText(names, cols);
    assert.ok([...text].length <= cols, `${cols} cols: ${text}`);
    assert.match(text, /^stop 13 AppHosts.*\? y\/n$/);
  }
  assert.equal(confirmText([`${'x'.repeat(100)}`], 40).length, 40);
  assert.match(confirmText([`${'x'.repeat(100)}`], 40), /… ?\? y\/n$/);
});

test('the stop prompt names as many AppHosts as fit and counts the rest', () => {
  assert.equal(confirmText(['a', 'b', 'c'], 80), 'stop 3 AppHosts: a, b, c? y/n');
  assert.equal(confirmText(['alpha', 'beta', 'gamma'], 36), 'stop 3 AppHosts: alpha, +2 more? y/n');
  assert.equal(confirmText(['alpha', 'beta', 'gamma'], 25), 'stop 3 AppHosts? y/n');
});
