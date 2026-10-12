import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig } from '../src/config.js';

test('the defaults apply to an empty or broken configuration', () => {
  const expected = { checkInterval: 30, offlineAfter: 60, wakeTimeout: 180, language: 'en' };
  assert.deepEqual(normalizeConfig(), expected);
  assert.deepEqual(normalizeConfig(null), expected);
  assert.deepEqual(
    normalizeConfig({ check_interval: '7', offline_after: 'x', language: 'it' }),
    expected,
  );
  assert.deepEqual(normalizeConfig(DEFAULT_CONFIG), expected);
});

test('the select values become numbers of seconds', () => {
  assert.deepEqual(
    normalizeConfig({
      check_interval: '300',
      offline_after: '0',
      wake_timeout: '600',
      language: 'de',
    }),
    { checkInterval: 300, offlineAfter: 0, wakeTimeout: 600, language: 'de' },
  );
  // A number stored by an older form is accepted too.
  assert.equal(normalizeConfig({ check_interval: 15 }).checkInterval, 15);
});
