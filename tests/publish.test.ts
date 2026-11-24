import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { publish } from '../scripts/publish.ts';

const run = promisify(execFile);
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@e', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@e' };
const git = async (cwd: string, ...a: string[]) => (await run('git', a, { cwd, env: ENV })).stdout.trim();

/** A bare "origin" with one commit on main, plus two clones of it. */
async function setup(): Promise<{ origin: string; a: string; b: string; msg: string }> {
  const base = await mkdtemp(path.join(os.tmpdir(), 'publish-'));
  const origin = path.join(base, 'origin.git');
  await run('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  const seed = path.join(base, 'seed');
  await run('git', ['clone', '-q', origin, seed]);
  await writeFile(path.join(seed, 'README'), 'seed\n');
  await git(seed, 'add', '-A');
  await git(seed, 'commit', '-q', '-m', 'seed');
  await git(seed, 'push', '-q', 'origin', 'HEAD:main');
  const a = path.join(base, 'a'), b = path.join(base, 'b');
  await run('git', ['clone', '-q', origin, a]);
  await run('git', ['clone', '-q', origin, b]);
  const msg = path.join(base, 'msg');
  await writeFile(msg, 'chore: update plugin releases\n');
  return { origin, a, b, msg };
}

test('nothing to commit returns "nothing" and does not call regenerate', async () => {
  const { a, msg } = await setup();
  let regen = 0;
  assert.equal(await publish({ cwd: a, messageFile: msg, env: ENV, regenerate: async () => { regen++; } }), 'nothing');
  assert.equal(regen, 0);
});

test('commits and pushes local changes', async () => {
  const { origin, a, msg } = await setup();
  await writeFile(path.join(a, 'gen.json'), '1\n');
  assert.equal(await publish({ cwd: a, messageFile: msg, env: ENV, regenerate: async () => {} }), 'pushed');
  assert.equal(await git(origin, 'log', '-1', '--format=%s', 'main'), 'chore: update plugin releases');
});

test('rejected push resets to origin/main, regenerates and retries', async () => {
  const { origin, a, b, msg } = await setup();
  // someone else pushes while the update runs
  await writeFile(path.join(b, 'other.txt'), 'human\n');
  await git(b, 'add', '-A');
  await git(b, 'commit', '-q', '-m', 'human change');
  await git(b, 'push', '-q', 'origin', 'HEAD:main');
  await writeFile(path.join(a, 'gen.json'), 'stale\n');
  let regen = 0;
  const result = await publish({
    cwd: a, messageFile: msg, env: ENV,
    regenerate: async () => { regen++; await writeFile(path.join(a, 'gen.json'), 'fresh\n'); },
  });
  assert.equal(result, 'pushed');
  assert.equal(regen, 1);
  assert.equal(await git(origin, 'log', '-2', '--format=%s', 'main'), 'chore: update plugin releases\nhuman change');
  assert.equal(await git(origin, 'show', 'main:gen.json'), 'fresh');
  assert.equal(await readFile(path.join(a, 'other.txt'), 'utf8'), 'human\n');
});

test('gives up after the attempt limit', async () => {
  const { a, b, msg } = await setup();
  let n = 0;
  const race = async () => {
    // keep moving origin/main so every push is rejected
    await writeFile(path.join(b, `race${n++}.txt`), 'x\n');
    await git(b, 'add', '-A');
    await git(b, 'commit', '-q', '-m', 'race');
    await git(b, 'push', '-q', 'origin', 'HEAD:main');
    await writeFile(path.join(a, 'gen.json'), String(n));
  };
  await race();
  await assert.rejects(publish({ cwd: a, messageFile: msg, env: ENV, attempts: 2, regenerate: race }), /push rejected 2 times/);
});
