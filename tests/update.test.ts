import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runUpdate } from '../scripts/update.ts';
import { makeFixtureRepo } from './helpers.ts';

const TYPES = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts/types.ts')).href;
const CURSOR = { '.cursor-plugin/plugin.json': '{"name":"a"}\n', 'README.md': 'one\n' };

// Cursor on by default here, so the vendor/ path stays covered while the feature is deferred.
async function makeRoot(plugins: string, name = 'm', cursor = true): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'update-root-'));
  await writeFile(path.join(root, 'marketplace.config.ts'),
    `import { defineMarketplace } from '${TYPES}';\nexport default defineMarketplace({ name: '${name}', owner: { name: 'o' }, cursor: ${cursor}, plugins: [${plugins}] });\n`);
  return root;
}
const gitPlugin = (name: string, url: string) => `{ name: '${name}', source: { type: 'git', url: '${url}' } }`;

async function snapshot(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const e of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!e.isFile()) continue;
    const f = path.join(e.parentPath, e.name);
    out[path.relative(dir, f)] = `${(await stat(f)).mtimeMs}:${await readFile(f, 'utf8')}`;
  }
  return out;
}
const json = async (root: string, f: string) => JSON.parse((await readFile(path.join(root, f), 'utf8')).replace(/^\s*\/\/.*$/gm, ''));
const entry = (cat: any, name: string) => cat.plugins.find((p: any) => p.name === name);

test('end-to-end: new plugin gets locked, vendored, and listed in all catalogs', async () => {
  const repo = await makeFixtureRepo(['v1.0.0'], CURSOR);
  const root = await makeRoot(gitPlugin('a', repo.url));
  assert.equal(await runUpdate({ root }), 0);
  const lock = await json(root, 'plugins.lock.json');
  assert.equal(lock.plugins.a.tag, 'v1.0.0');
  assert.equal(lock.plugins.a.commit, repo.commits['v1.0.0']);
  assert.ok(existsSync(path.join(root, 'vendor/a/README.md')));
  assert.deepEqual(entry(await json(root, '.claude-plugin/marketplace.json'), 'a').source,
    { source: 'url', url: repo.url, ref: 'v1.0.0', sha: repo.commits['v1.0.0'] });
  assert.equal(entry(await json(root, '.cursor-plugin/marketplace.json'), 'a').source, './vendor/a');
  assert.ok(entry(await json(root, '.agents/plugins/marketplace.json'), 'a'));
});

test('second run with no upstream change modifies no files', async () => {
  const repo = await makeFixtureRepo(['v1.0.0'], CURSOR);
  const root = await makeRoot(gitPlugin('a', repo.url));
  assert.equal(await runUpdate({ root }), 0);
  const before = await snapshot(root);
  assert.equal(await runUpdate({ root }), 0);
  assert.deepEqual(await snapshot(root), before);
});

test('new upstream tag updates lock, vendor and catalogs', async () => {
  const repo = await makeFixtureRepo(['v1.0.0'], CURSOR);
  const root = await makeRoot(gitPlugin('a', repo.url));
  await runUpdate({ root });
  await repo.addTag('v1.1.0', { ...CURSOR, 'README.md': 'two\n' });
  const msg = path.join(root, 'msg.txt');
  assert.equal(await runUpdate({ root, messageFile: msg }), 0);
  assert.equal((await json(root, 'plugins.lock.json')).plugins.a.tag, 'v1.1.0');
  assert.equal(await readFile(path.join(root, 'vendor/a/README.md'), 'utf8'), 'two\n');
  assert.equal(entry(await json(root, '.claude-plugin/marketplace.json'), 'a').source.ref, 'v1.1.0');
  const text = await readFile(msg, 'utf8');
  assert.match(text, /^chore: update plugin releases\n/);
  assert.match(text, /a: v1\.0\.0 -> v1\.1\.0/);
});

test('one broken plugin returns 1 but others are still written', async () => {
  const repo = await makeFixtureRepo(['v1.0.0'], CURSOR);
  const missing = pathToFileURL(path.join(os.tmpdir(), 'no-such-repo-' + Date.now())).href;
  const root = await makeRoot(`${gitPlugin('a', repo.url)}, ${gitPlugin('b', missing)}`);
  const msg = path.join(root, 'msg.txt');
  assert.equal(await runUpdate({ root, messageFile: msg }), 1);
  const claude = await json(root, '.claude-plugin/marketplace.json');
  assert.ok(entry(claude, 'a'));
  assert.equal(entry(claude, 'b'), undefined);
  const text = await readFile(msg, 'utf8');
  assert.match(text, /a: added v1\.0\.0/);
  assert.match(text, /\nErrors:\n(.|\n)*b: /);
});

test('errors only produces the errors subject', async () => {
  const missing = pathToFileURL(path.join(os.tmpdir(), 'no-such-repo-' + Date.now())).href;
  const root = await makeRoot(gitPlugin('b', missing));
  const msg = path.join(root, 'msg.txt');
  assert.equal(await runUpdate({ root, messageFile: msg }), 1);
  assert.match(await readFile(msg, 'utf8'), /^chore: plugin update \(errors\)\n/);
});

test('config error returns 2 and writes nothing', async () => {
  const root = await makeRoot('', 'Bad Name');
  assert.equal(await runUpdate({ root }), 2);
  assert.deepEqual(await readdir(root), ['marketplace.config.ts']);
});

test('CLI exits 3 on an unexpected crash (corrupt lock file)', async () => {
  const { execFile } = await import('node:child_process');
  const repo = await makeFixtureRepo(['v1.0.0'], CURSOR);
  const root = await makeRoot(gitPlugin('a', repo.url));
  await writeFile(path.join(root, 'plugins.lock.json'), '{ not json');
  const script = fileURLToPath(new URL('../scripts/update.ts', import.meta.url));
  const code = await new Promise<number | null>((resolve) => {
    execFile('node', [script, '--root', root], (err) => resolve(err ? (err as { code?: number }).code ?? null : 0));
  });
  assert.equal(code, 3);
});

test('cursor off: no vendor/ copy and no Cursor catalog; turning it off cleans both up', async () => {
  const repo = await makeFixtureRepo(['v1.0.0'], CURSOR);
  const off = await makeRoot(gitPlugin('a', repo.url), 'm', false);
  assert.equal(await runUpdate({ root: off }), 0);
  assert.equal(existsSync(path.join(off, 'vendor')), false);
  assert.equal(existsSync(path.join(off, '.cursor-plugin/marketplace.json')), false);
  assert.ok(entry(await json(off, '.claude-plugin/marketplace.json'), 'a'));

  const was = await makeRoot(gitPlugin('a', repo.url));
  assert.equal(await runUpdate({ root: was }), 0);
  assert.ok(existsSync(path.join(was, 'vendor/a/README.md')));
  // A new file: import() caches modules by URL, so rewriting the same config would not reload it.
  const offConfig = path.join(was, 'off.config.ts');
  await writeFile(offConfig, (await readFile(path.join(was, 'marketplace.config.ts'), 'utf8')).replace('cursor: true', 'cursor: false'));
  assert.equal(await runUpdate({ root: was, configPath: offConfig }), 0);
  assert.equal(existsSync(path.join(was, 'vendor/a')), false);
  assert.equal(existsSync(path.join(was, '.cursor-plugin/marketplace.json')), false);
});
