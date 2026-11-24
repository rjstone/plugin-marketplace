import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSemverTag, pickLatest } from '../scripts/semver.ts';

test('parseSemverTag accepts vX.Y.Z and X.Y.Z only', () => {
  assert.deepEqual(parseSemverTag('v1.2.3'), { major: 1, minor: 2, patch: 3 });
  assert.deepEqual(parseSemverTag('10.0.1'), { major: 10, minor: 0, patch: 1 });
  assert.equal(parseSemverTag('v1.2.3-beta'), null);
  assert.equal(parseSemverTag('v1.2'), null);
  assert.equal(parseSemverTag('release-1.2.3'), null);
});
test('pickLatest orders numerically and ignores pre-release/non-semver', () => {
  assert.equal(pickLatest(['v1.9.0', 'v1.10.0', 'v2.0.0-beta', 'latest', '1.2']), 'v1.10.0');
});
test('pickLatest prefers v-prefixed duplicate', () => {
  assert.equal(pickLatest(['1.2.3', 'v1.2.3']), 'v1.2.3');
  assert.equal(pickLatest(['v1.2.3', '1.2.3']), 'v1.2.3');
});
test('pickLatest returns null when nothing matches', () => {
  assert.equal(pickLatest(['main', 'v1.0.0-rc1']), null);
  assert.equal(pickLatest([]), null);
});
