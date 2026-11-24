// vendor/<name>/: copies of plugins at their locked release, for harnesses that can only list
// folders inside this repo (Cursor). Each copy carries a .vendor.json stamp.

import { execFile } from 'node:child_process';
import { existsSync, lstatSync } from 'node:fs';
import { cp, mkdtemp, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { LockEntry, LockFile } from './lock.ts';
import type { MarketplaceConfig, PluginDef } from './types.ts';

const run = promisify(execFile);

export const VENDOR_DIR = 'vendor';
export const STAMP_FILE = '.vendor.json';

export interface VendorStamp {
  url: string;
  path?: string;
  tag: string | null;
  commit: string;
}

export function isVendored(p: PluginDef): boolean {
  const git = p.source.type === 'github' || p.source.type === 'git';
  return git && (p.vendor ?? !p.exclude?.includes('cursor'));
}

/** True when a copy's stamp is exactly the locked release: same commit, url and path. */
export function stampMatches(stamp: VendorStamp | null, e: LockEntry): boolean {
  return !!stamp && stamp.commit === e.commit && stamp.url === e.url && (stamp.path ?? null) === (e.path ?? null);
}

export async function readStamp(root: string, name: string): Promise<VendorStamp | null> {
  const file = path.join(root, VENDOR_DIR, name, STAMP_FILE);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(await readFile(file, 'utf8')) as VendorStamp;
  } catch {
    return null;
  }
}

/** Fetch `refOrSha` from `url` into the empty directory `dest`; resolves to the fetched commit. */
export type FetchSnapshot = (url: string, refOrSha: string, dest: string) => Promise<string>;

export const gitFetchSnapshot: FetchSnapshot = async (url, refOrSha, dest) => {
  const opts = { cwd: dest, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, timeout: 300_000 };
  await run('git', ['init', '-q'], opts);
  await run('git', ['fetch', '-q', '--depth', '1', url, refOrSha], opts);
  await run('git', ['checkout', '-q', 'FETCH_HEAD'], opts);
  const { stdout } = await run('git', ['rev-parse', 'HEAD'], opts);
  return stdout.trim();
};

function label(tag: string | null, commit: string): string {
  return tag ?? commit.slice(0, 7);
}

/**
 * Bring vendor/ in line with the lock: refresh each vendored plugin whose stamp is not at the
 * locked commit, and delete folders for plugins that are no longer vendored. A copy is built in
 * vendor/<name>.tmp and swapped in only when complete, so a failure leaves the old copy intact.
 * Nothing fetched is ever executed.
 */
export async function syncVendor(
  cfg: MarketplaceConfig,
  lock: LockFile,
  root: string,
  fetchSnapshot: FetchSnapshot,
): Promise<{ changes: string[]; warnings: string[]; errors: string[] }> {
  const changes: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const vendorRoot = path.join(root, VENDOR_DIR);
  const wanted = new Set(cfg.plugins.filter(isVendored).map((p) => p.name));

  for (const p of cfg.plugins.filter(isVendored)) {
    const e = lock.plugins[p.name];
    if (!e?.commit) continue;
    if (stampMatches(await readStamp(root, p.name), e)) continue;

    const ref = e.tag ?? e.commit;
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'vendor-fetch-'));
    const staging = path.join(vendorRoot, `${p.name}.tmp`);
    try {
      const got = await fetchSnapshot(e.url, ref, tmp);
      if (got !== e.commit) {
        errors.push(`${p.name}: fetched ${got} but the lock says ${e.commit}`);
        continue;
      }
      const src = path.join(tmp, e.path ?? '');
      if (!existsSync(src)) {
        errors.push(`${p.name}: path ${e.path} not found at ${label(e.tag, e.commit)}`);
        continue;
      }
      // Fetched content is untrusted: never follow a symlink out of the fetched repo, never copy
      // symlinks (they could point anywhere once committed), and never write through one.
      const realTmp = await realpath(tmp);
      const realSrc = await realpath(src);
      if (realSrc !== realTmp && !realSrc.startsWith(realTmp + path.sep)) {
        errors.push(`${p.name}: path ${e.path} resolves outside the plugin repo`);
        continue;
      }
      let skipped = 0;
      await rm(staging, { recursive: true, force: true });
      await cp(realSrc, staging, {
        recursive: true,
        filter: (f) => {
          if (path.basename(f) === '.git') return false;
          if (lstatSync(f).isSymbolicLink()) {
            skipped++;
            return false;
          }
          return true;
        },
      });
      if (skipped) warnings.push(`${p.name}: skipped ${skipped} symlink(s) (not copied into ${VENDOR_DIR}/)`);
      const stamp: VendorStamp = { url: e.url, ...(e.path ? { path: e.path } : {}), tag: e.tag, commit: e.commit };
      const stampFile = path.join(staging, STAMP_FILE);
      await rm(stampFile, { force: true });
      await writeFile(stampFile, `${JSON.stringify(stamp, null, 2)}\n`, { flag: 'wx' });
      const dest = path.join(vendorRoot, p.name);
      await rm(dest, { recursive: true, force: true });
      await rename(staging, dest);
      changes.push(`${p.name}: vendored ${label(e.tag, e.commit)}`);
      if (!existsSync(path.join(dest, '.cursor-plugin', 'plugin.json')) && !existsSync(path.join(dest, 'plugin.json'))) {
        warnings.push(`${p.name}: ${VENDOR_DIR}/${p.name} has no .cursor-plugin/plugin.json or plugin.json (Cursor needs one)`);
      }
    } catch (err) {
      errors.push(`${p.name}: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
    } finally {
      await rm(tmp, { recursive: true, force: true });
      await rm(staging, { recursive: true, force: true });
    }
  }

  if (existsSync(vendorRoot)) {
    for (const d of await readdir(vendorRoot, { withFileTypes: true })) {
      if (!d.isDirectory() || wanted.has(d.name)) continue;
      await rm(path.join(vendorRoot, d.name), { recursive: true, force: true });
      changes.push(`${d.name}: vendor removed`);
    }
  }
  return { changes, warnings, errors };
}

/** Names of vendored plugins whose copy in vendor/ is exactly at their locked release. */
export async function vendorReady(cfg: MarketplaceConfig, lock: LockFile, root: string): Promise<Set<string>> {
  const ready = new Set<string>();
  for (const p of cfg.plugins.filter(isVendored)) {
    const e = lock.plugins[p.name];
    if (e?.commit && stampMatches(await readStamp(root, p.name), e)) ready.add(p.name);
  }
  return ready;
}
