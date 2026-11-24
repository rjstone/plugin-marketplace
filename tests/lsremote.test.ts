import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lsRemoteTags, parseLsRemoteTags } from '../scripts/lsremote.ts';
import { makeFixtureRepo } from './helpers.ts';

const A = 'a'.repeat(40), B = 'b'.repeat(40), C = 'c'.repeat(40);

test('parseLsRemoteTags prefers peeled commit for annotated tags', () => {
  const out = `${A}\trefs/tags/v1.0.0\n${B}\trefs/tags/v1.1.0\n${C}\trefs/tags/v1.1.0^{}\n`;
  const m = parseLsRemoteTags(out);
  assert.equal(m.get('v1.0.0'), A);
  assert.equal(m.get('v1.1.0'), C);
  assert.equal(m.size, 2);
});
test('parseLsRemoteTags keeps peeled commit when it precedes the tag line', () => {
  const m = parseLsRemoteTags(`${C}\trefs/tags/v2.0.0^{}\n${B}\trefs/tags/v2.0.0\n`);
  assert.equal(m.get('v2.0.0'), C);
});
test('parseLsRemoteTags ignores blank lines and non-tag refs', () => {
  const m = parseLsRemoteTags(`\n${A}\trefs/heads/main\n${B}\trefs/tags/x\n`);
  assert.deepEqual([...m.keys()], ['x']);
});
test('lsRemoteTags reads a real local repo (annotated and lightweight)', async () => {
  const repo = await makeFixtureRepo(['v1.0.0', 'v1.2.0']);
  const m = await lsRemoteTags(repo.url);
  assert.equal(m.get('v1.0.0'), repo.commits['v1.0.0']); // annotated
  assert.equal(m.get('v1.2.0'), repo.commits['v1.2.0']); // lightweight
});

test('lsRemoteTags failure message is a single stable line', async () => {
  const missing = 'file:///tmp/no-such-repo-for-lsremote-test';
  await assert.rejects(lsRemoteTags(missing), (err: Error) => {
    assert.ok(!err.message.includes('\n'), err.message);
    assert.match(err.message, /^fatal: /);
    return true;
  });
});
