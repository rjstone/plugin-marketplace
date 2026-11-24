// vendor/<name>/: copies of plugins at their locked release, for harnesses that can only list
// folders inside this repo (Cursor). Each copy carries a .vendor.json stamp.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { PluginDef } from './types.ts';

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

export async function readStamp(root: string, name: string): Promise<VendorStamp | null> {
  const file = path.join(root, VENDOR_DIR, name, STAMP_FILE);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(await readFile(file, 'utf8')) as VendorStamp;
  } catch {
    return null;
  }
}
