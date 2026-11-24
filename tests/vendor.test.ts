import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gitFetchSnapshot, readStamp, syncVendor } from '../scripts/vendor.ts';
import type { FetchSnapshot } from '../scripts/vendor.ts';
import type { LockFile } from '../scripts/lock.ts';
import type { MarketplaceConfig, PluginDef } from '../scripts/types.ts';
import { makeFixtureRepo } from './helpers.ts';

const CURSOR = { '.cursor-plugin/plugin.json': '{"name":"a"}\n', 'README.md': 'one\n' };
const cfg = (...plugins: PluginDef[]): MarketplaceConfig => ({ name: 'm', owner: { name: 'o' }, plugins });
const root = () => mkdtemp(path.join(os.tmpdir(), 'vendor-root-'));
const plugin = (url: string, extra: Partial<PluginDef> = {}): PluginDef => ({ name: 'a', source: { type: 'git', url }, ...extra });
const lockOf = (url: string, tag: string | null, commit: string, p?: string): LockFile =>
  ({ plugins: { a: { url, ...(p ? { path: p } : {}), tag, commit, override: false } } });

test('vendors tag snapshot without .git and writes stamp', async () => {
  const repo = await makeFixtureRepo(['v1.0.0'], CURSOR);
  const r = await root();
  const res = await syncVendor(cfg(plugin(repo.url)), lockOf(repo.url, 'v1.0.0', repo.commits['v1.0.0']), r, gitFetchSnapshot);
  assert.deepEqual(res, { changes: ['a: vendored v1.0.0'], warnings: [], errors: [] });
  assert.equal(await readFile(path.join(r, 'vendor/a/README.md'), 'utf8'), 'one\n');
  assert.equal(existsSync(path.join(r, 'vendor/a/.git')), false);
  assert.deepEqual(await readStamp(r, 'a'), { url: repo.url, tag: 'v1.0.0', commit: repo.commits['v1.0.0'] });
  assert.deepEqual((await readdir(path.join(r, 'vendor'))), ['a']);
});

test('vendors only the plugin path subtree', async () => {
  const repo = await makeFixtureRepo(['v1.0.0'], { 'plugins/x/.cursor-plugin/plugin.json': '{}\n', 'other.txt': 'no\n' });
  const r = await root();
  const p = plugin(repo.url, { source: { type: 'git', url: repo.url, path: 'plugins/x' } });
  const res = await syncVendor(cfg(p), lockOf(repo.url, 'v1.0.0', repo.commits['v1.0.0'], 'plugins/x'), r, gitFetchSnapshot);
  assert.deepEqual(res.errors, []);
  assert.ok(existsSync(path.join(r, 'vendor/a/.cursor-plugin/plugin.json')));
  assert.equal(existsSync(path.join(r, 'vendor/a/other.txt')), false);
});

test('skips when stamp already matches (no file writes)', async () => {
  const repo = await makeFixtureRepo(['v1.0.0'], CURSOR);
  const r = await root();
  const lock = lockOf(repo.url, 'v1.0.0', repo.commits['v1.0.0']);
  await syncVendor(cfg(plugin(repo.url)), lock, r, gitFetchSnapshot);
  const before = (await stat(path.join(r, 'vendor/a/.vendor.json'))).mtimeMs;
  let fetched = 0;
  const counting: FetchSnapshot = async (...args) => { fetched++; return gitFetchSnapshot(...args); };
  const res = await syncVendor(cfg(plugin(repo.url)), lock, r, counting);
  assert.deepEqual(res, { changes: [], warnings: [], errors: [] });
  assert.equal(fetched, 0);
  assert.equal((await stat(path.join(r, 'vendor/a/.vendor.json'))).mtimeMs, before);
});

test('updates copy when lock commit changes', async () => {
  const repo = await makeFixtureRepo(['v1.0.0'], CURSOR);
  const r = await root();
  await syncVendor(cfg(plugin(repo.url)), lockOf(repo.url, 'v1.0.0', repo.commits['v1.0.0']), r, gitFetchSnapshot);
  await repo.addTag('v1.1.0', { ...CURSOR, 'README.md': 'two\n' });
  const res = await syncVendor(cfg(plugin(repo.url)), lockOf(repo.url, 'v1.1.0', repo.commits['v1.1.0']), r, gitFetchSnapshot);
  assert.deepEqual(res.changes, ['a: vendored v1.1.0']);
  assert.equal(await readFile(path.join(r, 'vendor/a/README.md'), 'utf8'), 'two\n');
});

test('missing path errors and leaves previous copy intact', async () => {
  const repo = await makeFixtureRepo(['v1.0.0'], CURSOR);
  const r = await root();
  await mkdir(path.join(r, 'vendor/a'), { recursive: true });
  await writeFile(path.join(r, 'vendor/a/keep.txt'), 'old\n');
  const p = plugin(repo.url, { source: { type: 'git', url: repo.url, path: 'plugins/missing' } });
  const res = await syncVendor(cfg(p), lockOf(repo.url, 'v1.0.0', repo.commits['v1.0.0'], 'plugins/missing'), r, gitFetchSnapshot);
  assert.deepEqual(res.errors, ['a: path plugins/missing not found at v1.0.0']);
  assert.equal(await readFile(path.join(r, 'vendor/a/keep.txt'), 'utf8'), 'old\n');
  assert.deepEqual(await readdir(path.join(r, 'vendor')), ['a']);
});

test('warns when no cursor/agent manifest', async () => {
  const repo = await makeFixtureRepo(['v1.0.0'], { 'README.md': 'x\n' });
  const r = await root();
  const res = await syncVendor(cfg(plugin(repo.url)), lockOf(repo.url, 'v1.0.0', repo.commits['v1.0.0']), r, gitFetchSnapshot);
  assert.deepEqual(res.warnings, ['a: vendor/a has no .cursor-plugin/plugin.json or plugin.json (Cursor needs one)']);
});

test('removes vendor dir for plugin no longer vendored', async () => {
  const r = await root();
  await mkdir(path.join(r, 'vendor/old'), { recursive: true });
  await writeFile(path.join(r, 'vendor/old/x'), 'x');
  const res = await syncVendor(cfg(), { plugins: {} }, r, gitFetchSnapshot);
  assert.deepEqual(res.changes, ['old: vendor removed']);
  assert.equal(existsSync(path.join(r, 'vendor/old')), false);
});

test('head mismatch is an error and writes nothing', async () => {
  const r = await root();
  const liar: FetchSnapshot = async (_url, _ref, dest) => { await writeFile(path.join(dest, 'f'), 'x'); return 'f'.repeat(40); };
  const res = await syncVendor(cfg(plugin('https://x/y.git')), lockOf('https://x/y.git', 'v1.0.0', 'e'.repeat(40)), r, liar);
  assert.deepEqual(res.errors, [`a: fetched ${'f'.repeat(40)} but the lock says ${'e'.repeat(40)}`]);
  assert.equal(existsSync(path.join(r, 'vendor/a')), false);
});

test('plugins with a null lock commit are skipped', async () => {
  const r = await root();
  const res = await syncVendor(cfg(plugin('https://x/y.git')), { plugins: { a: { url: 'u', tag: null, commit: null, override: false, error: 'e' } } }, r, async () => { throw new Error('should not fetch'); });
  assert.deepEqual(res, { changes: [], warnings: [], errors: [] });
});
