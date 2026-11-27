// Single source of truth for every catalog in this repo.
// Edit this file, then run `node scripts/build.ts` and commit the generated files.
// See AGENTS.md ("Adding a plugin") for what each field becomes in each harness.

import { defineMarketplace } from './scripts/types.ts';

export default defineMarketplace({
  name: 'rjstone',
  owner: { name: 'rjstone' },
  description: "Pointer-only plugin marketplace: every entry's source lives in another repo.",
  displayName: 'rjstone plugins',
  // Cursor support is deferred (see AGENTS.md "Cursor"). `true` brings back the Cursor catalog
  // and the vendor/ copies it needs; the next update run fills them in.
  cursor: false,
  plugins: [
    {
      name: 'custom-compaction',
      description:
        "Replaces Claude Code's built-in compaction with a configurable summarizer (the session's model or any OpenAI/Anthropic-format endpoint).",
      source: { type: 'github', repo: 'rjstone/custom-compaction-plugin', path: 'claude-code/custom-compaction' },
      // A Claude Code mod (function-hook plugin): Codex can't run it.
      exclude: ['codex'],
    },
    {
      name: 'github-ninja',
      description:
        'GitHub know-how for coding agents: the gh CLI and API, issues, commits and rebases, CI failure diagnosis, GitHub Actions hardening and efficiency, repo security audits, Dependabot, secret scanning, CodeQL and more.',
      // Skills only (repo root is the plugin), so every harness that reads skills can use it.
      source: { type: 'github', repo: 'rjstone/github-ninja-plugin' },
    },
    // Plugins are listed at their latest semver release tag (vX.Y.Z or X.Y.Z), resolved
    // automatically into plugins.lock.json by scripts/update.ts. Do not pin by hand.
    //
    // Example: a plugin at the root of its own GitHub repo.
    // {
    //   name: 'my-plugin',
    //   description: 'What it does.',
    //   source: { type: 'github', repo: 'rjstone/my-plugin' },
    //   codex: { category: 'Productivity' },
    //   opencode: { package: '@rjstone/opencode-my-plugin' }, // only if published for opencode
    //   pi: true,                                               // emit `git:github.com/...@<tag>`
    // },
    //
    // Example: a plugin in a subdirectory of another repo.
    // {
    //   name: 'other-plugin',
    //   source: { type: 'github', repo: 'rjstone/claude', path: 'plugins/other-plugin' },
    // },
    //
    // Example: hold a plugin back on an older release.
    // {
    //   name: 'held-plugin',
    //   source: { type: 'github', repo: 'rjstone/held-plugin', ref: 'v1.4.2' }, // hold back: must be a tag or sha, never a branch
    // },
  ],
});
