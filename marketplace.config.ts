// Single source of truth for every catalog in this repo.
// Edit this file, then run `node scripts/build.ts` and commit the generated files.
// See AGENTS.md ("Adding a plugin") for what each field becomes in each harness.

import { defineMarketplace } from './scripts/types.ts';

export default defineMarketplace({
  name: 'rjstone',
  owner: { name: 'rjstone' },
  description: "Pointer-only plugin marketplace: every entry's source lives in another repo.",
  displayName: 'rjstone plugins',
  plugins: [
    // Example: a plugin at the root of its own GitHub repo, pinned to a tag.
    // {
    //   name: 'my-plugin',
    //   description: 'What it does.',
    //   source: { type: 'github', repo: 'rjstone/my-plugin', ref: 'v1.0.0' },
    //   codex: { category: 'Productivity' },
    //   opencode: { package: '@rjstone/opencode-my-plugin' }, // only if published for opencode
    //   pi: true,                                               // emit `git:github.com/...@v1.0.0`
    // },
    //
    // Example: a plugin in a subdirectory of another repo, pinned to a commit.
    // {
    //   name: 'other-plugin',
    //   source: { type: 'github', repo: 'rjstone/claude', path: 'plugins/other-plugin',
    //             sha: '0123456789abcdef0123456789abcdef01234567' },
    // },
  ],
});
