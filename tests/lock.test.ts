import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pluginGitUrl, readLock, resolveLock, serializeLock } from '../scripts/lock.ts';
import type { FetchTags, LockFile } from '../scripts/lock.ts';
import type { MarketplaceConfig, PluginDef } from '../scripts/types.ts';

const c = (ch: string) => ch.repeat(40);
const URL_A = 'https://github.com/o/a.git';
const URL_B = 'https://github.com/o/b.git';

function cfg(...plugins: PluginDef[]): MarketplaceConfig {
  return { name: 'm', owner: { name: 'o' }, plugins };
}
const pa: PluginDef = { name: 'a', source: { type: 'github', repo: 'o/a' } };
const pb: PluginDef = { name: 'b', source: { type: 'github', repo: 'o/b', path: 'plugins/b' } };

function fake(remotes: Record<string, Record<string, string> | Error>): { fetch: FetchTags; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    fetch: async (url) => {
      calls.push(url);
      const r = remotes[url];
      if (r === undefined) throw new Error(`unknown remote ${url}`);
      if (r instanceof Error) throw r;
      return new Map(Object.entries(r));
    },
  };
}
const empty: LockFile = { plugins: {} };

test('pluginGitUrl maps github and git sources, null otherwise', () => {
  assert.equal(pluginGitUrl(pa), URL_A);
  assert.equal(pluginGitUrl({ name: 'g', source: { type: 'git', url: 'https://x/y.git' } }), 'https://x/y.git');
  assert.equal(pluginGitUrl({ name: 'n', source: { type: 'npm', package: 'p' } }), null);
  assert.equal(pluginGitUrl({ name: 'l', source: { type: 'local', path: 'x' } }), null);
});

test('new plugin locks highest tag', async () => {
  const { fetch } = fake({ [URL_A]: { 'v1.0.0': c('1'), 'v1.2.0': c('2'), 'v2.0.0-rc1': c('3') } });
  const r = await resolveLock(cfg(pa), empty, fetch);
  assert.deepEqual(r.lock.plugins.a, { url: URL_A, tag: 'v1.2.0', commit: c('2'), override: false });
  assert.deepEqual(r.changes, ['a: added v1.2.0']);
  assert.deepEqual(r.errors, []);
});

test('newer tag updates entry and records change', async () => {
  const prev: LockFile = { plugins: { a: { url: URL_A, tag: 'v1.0.0', commit: c('1'), override: false } } };
  const { fetch } = fake({ [URL_A]: { 'v1.0.0': c('1'), 'v1.1.0': c('2') } });
  const r = await resolveLock(cfg(pa), prev, fetch);
  assert.equal(r.lock.plugins.a.tag, 'v1.1.0');
  assert.deepEqual(r.changes, ['a: v1.0.0 -> v1.1.0']);
});

test('unchanged upstream produces no changes', async () => {
  const prev: LockFile = { plugins: { a: { url: URL_A, tag: 'v1.0.0', commit: c('1'), override: false } } };
  const { fetch } = fake({ [URL_A]: { 'v1.0.0': c('1') } });
  const r = await resolveLock(cfg(pa), prev, fetch);
  assert.deepEqual(r.lock, prev);
  assert.deepEqual(r.changes, []);
});

test('moved tag keeps old commit and errors', async () => {
  const prev: LockFile = { plugins: { a: { url: URL_A, tag: 'v1.0.0', commit: c('1'), override: false } } };
  const { fetch } = fake({ [URL_A]: { 'v1.0.0': c('9') } });
  const r = await resolveLock(cfg(pa), prev, fetch);
  assert.deepEqual(r.lock.plugins.a, {
    url: URL_A, tag: 'v1.0.0', commit: c('1'), override: false,
    error: `tag v1.0.0 moved from ${c('1')} to ${c('9')}`,
  });
  assert.deepEqual(r.errors, [`a: tag v1.0.0 moved from ${c('1')} to ${c('9')}`]);
  assert.deepEqual(r.changes, []);
});

test('no semver tags errors with null entry', async () => {
  const { fetch } = fake({ [URL_A]: { main: c('1'), 'v1.0.0-beta': c('2') } });
  const r = await resolveLock(cfg(pa), empty, fetch);
  assert.deepEqual(r.lock.plugins.a, { url: URL_A, tag: null, commit: null, override: false, error: 'no semver release tag' });
  assert.deepEqual(r.errors, ['a: no semver release tag']);
});

test('fetch failure keeps previous entry and errors', async () => {
  const prev: LockFile = { plugins: { a: { url: URL_A, tag: 'v1.0.0', commit: c('1'), override: false } } };
  const { fetch } = fake({ [URL_A]: new Error('could not read from remote') });
  const r = await resolveLock(cfg(pa), prev, fetch);
  assert.deepEqual(r.lock.plugins.a, { ...prev.plugins.a, error: 'could not read from remote' });
  assert.deepEqual(r.errors, ['a: could not read from remote']);
});

test('other plugins still resolve when one errors', async () => {
  const { fetch } = fake({ [URL_A]: new Error('boom'), [URL_B]: { '1.0.0': c('5') } });
  const r = await resolveLock(cfg(pa, pb), empty, fetch);
  assert.deepEqual(r.lock.plugins.b, { url: URL_B, path: 'plugins/b', tag: '1.0.0', commit: c('5'), override: false });
  assert.deepEqual(r.errors, ['a: boom']);
});

test('sha override needs no fetch', async () => {
  const p: PluginDef = { name: 'a', source: { type: 'github', repo: 'o/a', sha: c('7') } };
  const { fetch, calls } = fake({});
  const r = await resolveLock(cfg(p), empty, fetch);
  assert.deepEqual(r.lock.plugins.a, { url: URL_A, tag: null, commit: c('7'), override: true });
  assert.deepEqual(calls, []);
  assert.deepEqual(r.changes, ['a: added 7777777']);
});

test('ref override resolves that tag', async () => {
  const p: PluginDef = { name: 'a', source: { type: 'github', repo: 'o/a', ref: 'v1.0.0' } };
  const { fetch } = fake({ [URL_A]: { 'v1.0.0': c('1'), 'v2.0.0': c('2') } });
  const r = await resolveLock(cfg(p), empty, fetch);
  assert.deepEqual(r.lock.plugins.a, { url: URL_A, tag: 'v1.0.0', commit: c('1'), override: true });
});

test('ref override that is not a tag errors', async () => {
  const p: PluginDef = { name: 'a', source: { type: 'github', repo: 'o/a', ref: 'main' } };
  const { fetch } = fake({ [URL_A]: { 'v1.0.0': c('1') } });
  const r = await resolveLock(cfg(p), empty, fetch);
  assert.equal(r.lock.plugins.a.error, 'ref main is not a tag');
  assert.equal(r.lock.plugins.a.commit, null);
});

test('removed plugin dropped from lock', async () => {
  const prev: LockFile = { plugins: { gone: { url: URL_B, tag: 'v1.0.0', commit: c('1'), override: false } } };
  const { fetch } = fake({ [URL_A]: { 'v1.0.0': c('2') } });
  const r = await resolveLock(cfg(pa), prev, fetch);
  assert.deepEqual(Object.keys(r.lock.plugins), ['a']);
  assert.deepEqual(r.changes, ['a: added v1.0.0', 'gone: removed']);
});

test('non-git plugins get no lock entry', async () => {
  const { fetch, calls } = fake({});
  const r = await resolveLock(cfg({ name: 'n', source: { type: 'npm', package: 'p' } }, { name: 'l', source: { type: 'local', path: 'x' } }), empty, fetch);
  assert.deepEqual(r.lock, empty);
  assert.deepEqual(calls, []);
});

test('serializeLock is byte-stable and sorted', () => {
  const lock: LockFile = { plugins: {
    z: { url: URL_B, tag: 'v1.0.0', commit: c('2'), override: false },
    a: { url: URL_A, tag: 'v1.0.0', commit: c('1'), override: false },
  } };
  const s = serializeLock(lock);
  assert.ok(s.endsWith('}\n'));
  assert.ok(s.indexOf('"a"') < s.indexOf('"z"'));
  assert.equal(serializeLock(JSON.parse(s)), s);
});

test('readLock returns empty lock when file missing', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lock-'));
  assert.deepEqual(await readLock(dir), { plugins: {} });
});

test('multi-line fetch errors are stored as their first line only', async () => {
  const { fetch } = fake({ [URL_A]: new Error('fatal: repository not found\nextra detail that varies 12345') });
  const r = await resolveLock(cfg(pa), empty, fetch);
  assert.equal(r.lock.plugins.a.error, 'fatal: repository not found');
});
