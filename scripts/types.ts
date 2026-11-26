// Types for marketplace.config.ts, the single source of truth that scripts/build.ts turns into
// every harness's catalog. Keep this file to "erasable" TypeScript (no enums, namespaces or
// parameter properties) so Node can run it directly by stripping the types.

export interface Owner {
  name: string;
  email?: string;
  url?: string;
}

/** Where a plugin's files live. Pointer-only marketplaces use `github` or `git`. */
export type PluginSource =
  /** A GitHub repo. With `path`, the plugin is that subdirectory (git-subdir). */
  | { type: 'github'; repo: string; path?: string; ref?: string; sha?: string }
  /** Any git URL. With `path`, the plugin is that subdirectory (git-subdir). */
  | { type: 'git'; url: string; path?: string; ref?: string; sha?: string }
  /** A folder inside this marketplace repo (the only form Cursor accepts). */
  | { type: 'local'; path: string }
  /** An npm package (Claude Code and Codex only). */
  | { type: 'npm'; package: string; version?: string; registry?: string };

/** Catalogs a plugin is listed in by default. opencode and Pi are opt-in (see PluginDef). */
export type Target = 'claude' | 'codex' | 'cursor';

export interface CodexOptions {
  /** Codex requires a category on every entry. Default: "Productivity". */
  category?: string;
  /** Default: "AVAILABLE". */
  installation?: 'AVAILABLE' | 'INSTALLED_BY_DEFAULT' | 'NOT_AVAILABLE';
  /** Whether auth happens on install or first use. Default: "ON_INSTALL". */
  authentication?: 'ON_INSTALL' | (string & {});
}

export interface OpencodeOptions {
  /** npm package name opencode should load. */
  package: string;
  version?: string;
  /** Plugin options; when present the entry is written in object form. */
  options?: Record<string, unknown>;
}

export interface PiOptions {
  /** Explicit `pi install` source, e.g. "npm:@x/y@1.0.0". Default: derived from `source`. */
  source?: string;
}

export interface PluginDef {
  /** Must match the `name` in the plugin's own manifest. Lowercase kebab-case. */
  name: string;
  description?: string;
  /**
   * Only set this if the plugin's own manifest has no version: a manifest version wins, and
   * setting both causes confusion. With no version anywhere, updates follow the commit SHA.
   */
  version?: string;
  /** Category for Claude Code and Cursor entries. */
  category?: string;
  tags?: string[];
  source: PluginSource;
  /**
   * Copy into vendor/ for harnesses that can't point at other repos (Cursor). Has no effect
   * unless the marketplace sets `cursor: true`.
   * Default: true for github/git sources not excluded from Cursor.
   */
  vendor?: boolean;
  /** Leave the plugin out of these catalogs. */
  exclude?: Target[];
  codex?: CodexOptions;
  /** Extra fields merged into the Claude Code entry, e.g. `{ strict: false }`. */
  claude?: Record<string, unknown>;
  /** List the plugin in opencode/opencode.jsonc. */
  opencode?: OpencodeOptions;
  /** List the plugin in pi/packages.json. `true` derives the source from `source`. */
  pi?: PiOptions | true;
}

export interface MarketplaceConfig {
  /** Marketplace name: installs read `<plugin>@<name>`. Lowercase kebab-case. */
  name: string;
  owner: Owner;
  description?: string;
  /** Codex catalog title. Default: `name`. */
  displayName?: string;
  /**
   * Generate the Cursor catalog (.cursor-plugin/marketplace.json) and the vendor/ copies it
   * needs. Default: false (Cursor support is deferred; see AGENTS.md "Cursor").
   */
  cursor?: boolean;
  plugins: PluginDef[];
}

/** Identity helper that gives marketplace.config.ts type checking and editor completion. */
export function defineMarketplace(config: MarketplaceConfig): MarketplaceConfig {
  return config;
}
