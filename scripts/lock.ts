// plugins.lock.json: the resolved release (tag + commit) for every git-sourced plugin.
// Written only by scripts/update.ts; read by scripts/build.ts.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pickLatest } from './semver.ts';
import type { MarketplaceConfig, PluginDef } from './types.ts';

export interface LockEntry {
  url: string;
  path?: string;
  /** Release tag, or null for a sha override / unresolved plugin. */
  tag: string | null;
  /** Commit the tag points to (peeled), or null if never resolved. */
  commit: string | null;
  /** True when the config pins `ref` or `sha` by hand. */
  override: boolean;
  /** Set when the latest resolution failed; the previous tag/commit (if any) are kept. */
  error?: string;
}

export interface LockFile {
  plugins: Record<string, LockEntry>;
}

export type FetchTags = (url: string) => Promise<Map<string, string>>;

export const LOCK_FILE = 'plugins.lock.json';

export function pluginGitUrl(p: PluginDef): string | null {
  const s = p.source;
  if (s.type === 'github') return `https://github.com/${s.repo}.git`;
  if (s.type === 'git') return s.url;
  return null;
}

export async function readLock(root: string): Promise<LockFile> {
  const file = path.join(root, LOCK_FILE);
  if (!existsSync(file)) return { plugins: {} };
  const parsed = JSON.parse(await readFile(file, 'utf8')) as Partial<LockFile>;
  return { plugins: parsed.plugins ?? {} };
}

export function serializeLock(lock: LockFile): string {
  const plugins = Object.fromEntries(Object.keys(lock.plugins).sort().map((k) => [k, lock.plugins[k]]));
  return `${JSON.stringify({ plugins }, null, 2)}\n`;
}

function label(e: { tag: string | null; commit: string | null }): string {
  return e.tag ?? (e.commit ? e.commit.slice(0, 7) : 'unresolved');
}

/** Resolve one plugin to { tag, commit } or an error message. */
async function resolveOne(
  p: PluginDef,
  url: string,
  fetchTags: FetchTags,
): Promise<{ tag: string | null; commit: string; override: boolean } | { error: string; override: boolean }> {
  const s = p.source as { ref?: string; sha?: string };
  if (s.sha) return { tag: null, commit: s.sha, override: true };
  const override = s.ref !== undefined;
  let tags: Map<string, string>;
  try {
    tags = await fetchTags(url);
  } catch (err) {
    return { error: (err instanceof Error ? err.message : String(err)).split('\n')[0], override };
  }
  if (override) {
    const commit = tags.get(s.ref!);
    return commit ? { tag: s.ref!, commit, override } : { error: `ref ${s.ref} is not a tag`, override };
  }
  const tag = pickLatest(tags.keys());
  return tag ? { tag, commit: tags.get(tag)!, override } : { error: 'no semver release tag', override };
}

export async function resolveLock(
  cfg: MarketplaceConfig,
  prev: LockFile,
  fetchTags: FetchTags,
): Promise<{ lock: LockFile; changes: string[]; errors: string[] }> {
  const lock: LockFile = { plugins: {} };
  const changes: string[] = [];
  const errors: string[] = [];

  for (const p of cfg.plugins) {
    const url = pluginGitUrl(p);
    if (!url) continue;
    const before = prev.plugins[p.name];
    const base = { url, ...(p.source.type !== 'npm' && p.source.type !== 'local' && p.source.path ? { path: p.source.path } : {}) };
    const r = await resolveOne(p, url, fetchTags);

    let error = 'error' in r ? r.error : undefined;
    if (!error && 'commit' in r && before && before.tag !== null && before.tag === r.tag && before.commit && before.commit !== r.commit) {
      error = `tag ${r.tag} moved from ${before.commit} to ${r.commit}`;
    }

    if (error) {
      lock.plugins[p.name] = before && before.commit
        ? { ...before, error }
        : { ...base, tag: null, commit: null, override: r.override, error };
      errors.push(`${p.name}: ${error}`);
      continue;
    }

    const ok = r as { tag: string | null; commit: string; override: boolean };
    const entry: LockEntry = { ...base, tag: ok.tag, commit: ok.commit, override: ok.override };
    lock.plugins[p.name] = entry;
    if (!before || !before.commit) changes.push(`${p.name}: added ${label(entry)}`);
    else if (before.commit !== entry.commit || before.tag !== entry.tag) changes.push(`${p.name}: ${label(before)} -> ${label(entry)}`);
  }

  for (const name of Object.keys(prev.plugins)) {
    if (!(name in lock.plugins)) changes.push(`${name}: removed`);
  }
  return { lock, changes, errors };
}
