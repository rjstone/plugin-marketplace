// Read a remote's tags without cloning: `git ls-remote --tags <url>`.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const PEELED = '^{}';

/** tag name -> commit. For annotated tags the peeled (`^{}`) commit wins over the tag object. */
export function parseLsRemoteTags(output: string): Map<string, string> {
  const tags = new Map<string, string>();
  const peeled = new Set<string>();
  for (const line of output.split('\n')) {
    const [sha, ref] = line.trim().split(/\s+/);
    if (!sha || !ref?.startsWith('refs/tags/')) continue;
    let name = ref.slice('refs/tags/'.length);
    if (name.endsWith(PEELED)) {
      name = name.slice(0, -PEELED.length);
      tags.set(name, sha);
      peeled.add(name);
    } else if (!peeled.has(name)) {
      tags.set(name, sha);
    }
  }
  return tags;
}

/**
 * Reduce a failed git call to one stable line (the `fatal:`/`error:` line when there is one), so
 * a plugin that keeps failing does not rewrite plugins.lock.json with new error text every run.
 */
export function gitErrorLine(err: unknown): string {
  const e = err as { stderr?: string; message?: string };
  const lines = String(e.stderr ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.find((l) => /^(fatal|error):/.test(l)) ?? lines[0] ?? String(e.message ?? err).split('\n')[0];
}

export async function lsRemoteTags(url: string): Promise<Map<string, string>> {
  try {
    const { stdout } = await run('git', ['ls-remote', '--tags', url], {
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      timeout: 60_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    return parseLsRemoteTags(stdout);
  } catch (err) {
    throw new Error(gitErrorLine(err));
  }
}
