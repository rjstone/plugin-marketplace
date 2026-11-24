// Release-tag selection: plain semver tags only (vX.Y.Z or X.Y.Z), no pre-release or build suffix.

export interface Semver {
  major: number;
  minor: number;
  patch: number;
}

const RELEASE_TAG = /^v?(\d+)\.(\d+)\.(\d+)$/;

export function parseSemverTag(tag: string): Semver | null {
  const m = RELEASE_TAG.exec(tag);
  return m ? { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) } : null;
}

function compare(a: Semver, b: Semver): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/** Highest release tag; when `vX.Y.Z` and `X.Y.Z` tie, the `v` form wins. Null if none match. */
export function pickLatest(tags: Iterable<string>): string | null {
  let best: { tag: string; v: Semver } | null = null;
  for (const tag of tags) {
    const v = parseSemverTag(tag);
    if (!v) continue;
    const c = best ? compare(v, best.v) : 1;
    if (c > 0 || (c === 0 && best && tag.startsWith('v') && !best.tag.startsWith('v'))) best = { tag, v };
  }
  return best ? best.tag : null;
}
