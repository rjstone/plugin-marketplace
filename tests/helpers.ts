// Test helpers: throwaway local git repos used as plugin sources (file:// URLs, no network).
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const run = promisify(execFile);

async function git(dir: string, ...args: string[]): Promise<string> {
  const { stdout } = await run('git', args, {
    cwd: dir,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com',
      GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com',
    },
  });
  return stdout.trim();
}

export interface FixtureRepo {
  url: string;
  dir: string;
  commits: Record<string, string>;
  addTag(tag: string, files?: Record<string, string>): Promise<string>;
}

const DEFAULT_FILES = { '.claude-plugin/plugin.json': '{"name":"fixture"}\n' };

/** A repo with one commit per tag. Odd-numbered tags (1st, 3rd, ...) are annotated. */
export async function makeFixtureRepo(tags: string[], files: Record<string, string> = DEFAULT_FILES): Promise<FixtureRepo> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'fixture-repo-'));
  await git(dir, 'init', '-q', '-b', 'main');
  const commits: Record<string, string> = {};
  let count = 0;
  const addTag = async (tag: string, extra: Record<string, string> = files): Promise<string> => {
    for (const [rel, content] of Object.entries({ ...extra, 'VERSION': `${tag}\n` })) {
      await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
      await writeFile(path.join(dir, rel), content);
    }
    await git(dir, 'add', '-A');
    await git(dir, 'commit', '-q', '-m', tag);
    count++;
    if (count % 2 === 1) await git(dir, 'tag', '-a', tag, '-m', tag);
    else await git(dir, 'tag', tag);
    commits[tag] = await git(dir, 'rev-parse', 'HEAD');
    return commits[tag];
  };
  for (const t of tags) await addTag(t);
  return { url: pathToFileURL(dir).href, dir, commits, addTag };
}
