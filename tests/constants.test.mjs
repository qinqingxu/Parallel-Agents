import assert from 'node:assert/strict';
import test from 'node:test';

import { INVENTORY_AUTO_REFRESH_MS } from '../src/shared/constants.ts';

test('automatically refreshes inventory every ten minutes', () => {
  assert.equal(INVENTORY_AUTO_REFRESH_MS, 10 * 60 * 1000);
});
