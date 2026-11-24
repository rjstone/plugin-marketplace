// Resolve every git-sourced plugin to its latest semver release tag, refresh vendor/ copies,
// and regenerate every catalog. Run by .github/workflows/update.yml; safe to run locally.
//
//   node scripts/update.ts [--root <dir>] [--config <file>] [--message-file <path>]
//
// Exit codes: 0 ok, 1 some plugin failed (everything else is still written), 2 config invalid.

import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildOutputs, checkConsistency, loadConfig, REPO_ROOT, validateConfig, writeOutputs } from './build.ts';
import { LOCK_FILE, readLock, resolveLock, serializeLock } from './lock.ts';
import type { FetchTags } from './lock.ts';
import { lsRemoteTags } from './lsremote.ts';
import { gitFetchSnapshot, syncVendor } from './vendor.ts';
import type { FetchSnapshot } from './vendor.ts';

export interface UpdateOptions {
  root: string;
  configPath?: string;
  fetchTags?: FetchTags;
  fetchSnapshot?: FetchSnapshot;
  messageFile?: string;
}

export async function runUpdate(opts: UpdateOptions): Promise<number> {
  const root = path.resolve(opts.root);
  const cfg = await loadConfig(path.resolve(opts.configPath ?? path.join(root, 'marketplace.config.ts')));

  const v = validateConfig(cfg, root);
  for (const w of v.warnings) console.warn(`warning: ${w}`);
  if (v.errors.length) {
    for (const e of v.errors) console.error(`error: ${e}`);
    return 2;
  }

  const resolved = await resolveLock(cfg, await readLock(root), opts.fetchTags ?? lsRemoteTags);
  const lockText = serializeLock(resolved.lock);
  const lockFile = path.join(root, LOCK_FILE);
  if (!existsSync(lockFile) || (await readFile(lockFile, 'utf8')) !== lockText) await writeFile(lockFile, lockText);

  const vendored = await syncVendor(cfg, resolved.lock, root, opts.fetchSnapshot ?? gitFetchSnapshot);
  for (const f of await writeOutputs(root, buildOutputs(cfg, resolved.lock))) console.log(`wrote ${f}`);
  const consistency = await checkConsistency(cfg, resolved.lock, root);

  const changes = [...resolved.changes, ...vendored.changes];
  const errors = [...new Set([...resolved.errors, ...vendored.errors, ...consistency.errors])];
  for (const w of [...vendored.warnings, ...consistency.warnings]) console.warn(`warning: ${w}`);
  for (const c of changes) console.log(c);
  for (const e of errors) console.error(`error: ${e}`);

  const subject = changes.length || !errors.length ? 'chore: update plugin releases' : 'chore: plugin update (errors)';
  const body = [...changes, ...(errors.length ? ['', 'Errors:', ...errors] : [])].join('\n');
  if (opts.messageFile) await writeFile(opts.messageFile, `${subject}\n\n${body}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const md = ['### Plugin update', ...changes.map((c) => `- ${c}`), ...(errors.length ? ['', '**Errors**', ...errors.map((e) => `- ${e}`)] : [])];
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${md.join('\n')}\n`);
  }
  return errors.length ? 1 : 0;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await runUpdate({
    root: arg('--root') ?? REPO_ROOT,
    configPath: arg('--config'),
    messageFile: arg('--message-file'),
  });
}
