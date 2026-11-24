// Commit the update job's changes and push them to the current branch on origin. If the push
// is rejected because the branch moved during the run, reset to the new origin state,
// regenerate everything, and try again. Generated files are never merged by hand.
//
//   node scripts/publish.ts --message-file <path> [--attempts 3]
//
// Exit codes: 0 pushed or nothing to commit, 1 failed.

import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT } from './build.ts';
import { runUpdate } from './update.ts';

const run = promisify(execFile);

export interface PublishOptions {
  cwd: string;
  messageFile: string;
  /** Re-run the update after resetting to origin; must rewrite the message file. */
  regenerate: () => Promise<void>;
  attempts?: number;
  env?: NodeJS.ProcessEnv;
}

export async function publish(opts: PublishOptions): Promise<'nothing' | 'pushed'> {
  const env = { ...(opts.env ?? process.env), GIT_TERMINAL_PROMPT: '0' };
  const git = async (...args: string[]) => (await run('git', args, { cwd: opts.cwd, env })).stdout.trim();
  const branch = await git('rev-parse', '--abbrev-ref', 'HEAD');
  const attempts = opts.attempts ?? 3;

  for (let i = 1; i <= attempts; i++) {
    if (!(await git('status', '--porcelain'))) return 'nothing';
    await git('add', '-A');
    await git('commit', '-q', '-F', opts.messageFile);
    try {
      await git('push', '-q', 'origin', `HEAD:${branch}`);
      return 'pushed';
    } catch {
      if (i === attempts) break;
      await git('fetch', '-q', 'origin', branch);
      await git('reset', '-q', '--hard', `origin/${branch}`);
      await git('clean', '-q', '-fd');
      await opts.regenerate();
    }
  }
  throw new Error(`push rejected ${attempts} times; ${opts.cwd} has the last attempt committed locally`);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const messageFile = arg('--message-file');
  if (!messageFile) {
    console.error('usage: node scripts/publish.ts --message-file <path> [--attempts N]');
    process.exit(1);
  }
  try {
    const result = await publish({
      cwd: REPO_ROOT,
      messageFile,
      attempts: Number(arg('--attempts') ?? 3),
      regenerate: async () => {
        const code = await runUpdate({ root: REPO_ROOT, messageFile });
        if (code !== 0 && code !== 1) throw new Error(`update exited ${code} while retrying`);
      },
    });
    console.log(result === 'pushed' ? 'pushed' : 'nothing to commit');
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
