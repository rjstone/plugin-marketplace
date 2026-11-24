import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildOutputs, checkConsistency } from '../scripts/build.ts';
import { isVendored } from '../scripts/vendor.ts';
import type { LockFile } from '../scripts/lock.ts';
import type { MarketplaceConfig, PluginDef } from '../scripts/types.ts';

const c = (ch: string) => ch.repeat(40);
const pa: PluginDef = { name: 'a', source: { type: 'github', repo: 'o/a' }, pi: true };
const pb: PluginDef = { name: 'b', source: { type: 'git', url: 'https://gl.example/o/b.git', path: 'plugins/b' } };
const ps: PluginDef = { name: 's', source: { type: 'github', repo: 'o/s', sha: c('7') } };
const pc: PluginDef = { name: 'unlocked', source: { type: 'github', repo: 'o/c' } };
const pl: PluginDef = { name: 'loc', source: { type: 'local', path: 'plugins/loc' } };
const lock: LockFile = { plugins: {
  a: { url: 'https://github.com/o/a.git', tag: 'v1.2.0', commit: c('1'), override: false },
  b: { url: 'https://gl.example/o/b.git', path: 'plugins/b', tag: '2.0.0', commit: c('2'), override: false },
  s: { url: 'https://github.com/o/s.git', tag: null, commit: c('7'), override: true },
} };
const cfg = (...plugins: PluginDef[]): MarketplaceConfig => ({ name: 'm', owner: { name: 'o' }, plugins });

function catalog(out: Map<string, string>, file: string): any {
  const raw = out.get(file)!;
  return JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ''));
}
const entry = (cat: any, name: string) => cat.plugins.find((p: any) => p.name === name);

test('isVendored defaults to git sources not excluded from cursor', () => {
  assert.equal(isVendored(pa), true);
  assert.equal(isVendored({ ...pa, exclude: ['cursor'] }), false);
  assert.equal(isVendored({ ...pa, vendor: false }), false);
  assert.equal(isVendored(pl), false);
  assert.equal(isVendored({ name: 'n', source: { type: 'npm', package: 'p' } }), false);
});

test('claude github entry carries ref and sha from lock', () => {
  const claude = catalog(buildOutputs(cfg(pa), lock), '.claude-plugin/marketplace.json');
  assert.deepEqual(entry(claude, 'a').source, { source: 'github', repo: 'o/a', ref: 'v1.2.0', sha: c('1') });
});

test('codex git-subdir entry carries ./path and sha only (claude carries ref and sha)', () => {
  const codex = catalog(buildOutputs(cfg(pb), lock), '.agents/plugins/marketplace.json');
  assert.deepEqual(entry(codex, 'b').source, { source: 'git-subdir', url: 'https://gl.example/o/b.git', path: './plugins/b', sha: c('2') });
  const claude = catalog(buildOutputs(cfg(pb), lock), '.claude-plugin/marketplace.json');
  assert.deepEqual(entry(claude, 'b').source, { source: 'git-subdir', url: 'https://gl.example/o/b.git', path: 'plugins/b', ref: '2.0.0', sha: c('2') });
});

test('sha override emits sha only', () => {
  const claude = catalog(buildOutputs(cfg(ps), lock), '.claude-plugin/marketplace.json');
  assert.deepEqual(entry(claude, 's').source, { source: 'github', repo: 'o/s', sha: c('7') });
});

test('unlocked git plugin omitted from every catalog', () => {
  const out = buildOutputs(cfg(pa, pc), lock);
  for (const f of ['.claude-plugin/marketplace.json', '.agents/plugins/marketplace.json', '.cursor-plugin/marketplace.json']) {
    assert.equal(entry(catalog(out, f), 'unlocked'), undefined, f);
  }
});

test('locked entry with null commit is omitted', () => {
  const l: LockFile = { plugins: { a: { url: 'u', tag: null, commit: null, override: false, error: 'x' } } };
  assert.equal(entry(catalog(buildOutputs(cfg(pa), l), '.claude-plugin/marketplace.json'), 'a'), undefined);
});

test('cursor lists vendored plugin as ./vendor/<name> and local as before', () => {
  const cursor = catalog(buildOutputs(cfg(pa, pl), lock, new Set(['a'])), '.cursor-plugin/marketplace.json');
  assert.equal(entry(cursor, 'a').source, './vendor/a');
  assert.equal(entry(cursor, 'loc').source, './plugins/loc');
});

test('pi uses @tag, and @commit for sha overrides', () => {
  const pi = JSON.parse(buildOutputs(cfg(pa, { ...ps, pi: true }), lock).get('pi/packages.json')!);
  assert.deepEqual(pi.packages, ['git:github.com/o/a@v1.2.0', `git:github.com/o/s@${c('7')}`]);
});

async function root(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'build-'));
}
async function stamp(r: string, name: string, commit: string, url = 'https://github.com/o/a.git'): Promise<void> {
  await mkdir(path.join(r, 'vendor', name), { recursive: true });
  await writeFile(path.join(r, 'vendor', name, '.vendor.json'), JSON.stringify({ url, tag: 'v1.2.0', commit }));
}

test('consistency: clean when stamps match', async () => {
  const r = await root();
  await stamp(r, 'a', c('1'));
  assert.deepEqual(await checkConsistency(cfg(pa), { plugins: { a: lock.plugins.a } }, r), { errors: [], warnings: [] });
});

test('consistency: lock error is an error', async () => {
  const r = await root();
  await stamp(r, 'a', c('1'));
  const res = await checkConsistency(cfg(pa), { plugins: { a: { ...lock.plugins.a, error: 'tag moved' } } }, r);
  assert.deepEqual(res.errors, ['a: tag moved']);
});

test('consistency: lock entry not in config is an error', async () => {
  const res = await checkConsistency(cfg(), { plugins: { a: lock.plugins.a } }, await root());
  assert.deepEqual(res.errors, ['a: in plugins.lock.json but not in the config']);
});

test('consistency: config plugin missing from lock is a warning', async () => {
  const res = await checkConsistency(cfg(pc), { plugins: {} }, await root());
  assert.deepEqual(res, { errors: [], warnings: ['unlocked: not in plugins.lock.json yet (run node scripts/update.ts)'] });
});

test('consistency: stamp missing or mismatched is an error', async () => {
  const r = await root();
  let res = await checkConsistency(cfg(pa), { plugins: { a: lock.plugins.a } }, r);
  assert.deepEqual(res.errors, ['a: vendor/a is missing or not at the locked commit']);
  await stamp(r, 'a', c('9'));
  res = await checkConsistency(cfg(pa), { plugins: { a: lock.plugins.a } }, r);
  assert.deepEqual(res.errors, ['a: vendor/a is missing or not at the locked commit']);
});

test('consistency: stray vendor dir is an error', async () => {
  const r = await root();
  await stamp(r, 'old', c('3'));
  const res = await checkConsistency(cfg(), { plugins: {} }, r);
  assert.deepEqual(res.errors, ['vendor/old: not a vendored plugin in the config']);
});

// ---- final-review fixes ----

test('cursor omits a vendored plugin whose copy is not ready', () => {
  const cursor = catalog(buildOutputs(cfg(pa), lock, new Set()), '.cursor-plugin/marketplace.json');
  assert.equal(entry(cursor, 'a'), undefined);
  const claude = catalog(buildOutputs(cfg(pa), lock, new Set()), '.claude-plugin/marketplace.json');
  assert.ok(entry(claude, 'a'));
});

test('lock entry whose url or path no longer matches the config is omitted', () => {
  const moved: PluginDef = { name: 'a', source: { type: 'github', repo: 'o/new-home' } };
  const l: LockFile = { plugins: { a: { ...lock.plugins.a, error: 'no semver release tag' } } };
  for (const f of ['.claude-plugin/marketplace.json', '.agents/plugins/marketplace.json']) {
    assert.equal(entry(catalog(buildOutputs(cfg(moved), l), f), 'a'), undefined, f);
  }
  const repathed: PluginDef = { ...pb, source: { type: 'git', url: 'https://gl.example/o/b.git', path: 'plugins/other' } };
  assert.equal(entry(catalog(buildOutputs(cfg(repathed), lock), '.claude-plugin/marketplace.json'), 'b'), undefined);
});

test('errored entry at the same url keeps listing its previous release', () => {
  const l: LockFile = { plugins: { a: { ...lock.plugins.a, error: 'tag moved' } } };
  assert.equal(entry(catalog(buildOutputs(cfg(pa), l), '.claude-plugin/marketplace.json'), 'a').source.sha, c('1'));
});

test('consistency: stamp with a different path is an error', async () => {
  const r = await root();
  await mkdir(path.join(r, 'vendor', 'b'), { recursive: true });
  await writeFile(path.join(r, 'vendor', 'b', '.vendor.json'), JSON.stringify({ url: 'https://gl.example/o/b.git', path: 'plugins/old', tag: '2.0.0', commit: c('2') }));
  const res = await checkConsistency(cfg(pb), { plugins: { b: lock.plugins.b } }, r);
  assert.deepEqual(res.errors, ['b: vendor/b is missing or not at the locked commit']);
});

test('consistency: lock entry whose url differs from the config is a warning', async () => {
  const moved: PluginDef = { name: 'a', source: { type: 'github', repo: 'o/new-home' }, vendor: false };
  const res = await checkConsistency(cfg(moved), { plugins: { a: lock.plugins.a } }, await root());
  assert.deepEqual(res.warnings, ['a: plugins.lock.json entry does not match the config source yet (run node scripts/update.ts)']);
});
