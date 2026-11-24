# AGENTS.md

Instructions and reference for coding agents working in this repo.

## What this repo is

A **pointer-only plugin marketplace**: one repo holding the marketplace catalogs for several
coding-agent harnesses. Where a harness allows it, entries point at plugins in *other* repos
instead of copying plugin code here. It may later be published as a public template
(`plugin-marketplace-template`).

## Git workflow

- Commit and push directly to `main`. No feature branches or PRs unless asked.

## Layout

| Path | Harness | Status |
|---|---|---|
| `.claude-plugin/marketplace.json` | Claude Code (Codex also reads it as "legacy-compatible") | stub, `plugins: []` |
| `.agents/plugins/marketplace.json` | OpenAI Codex (CLI + ChatGPT desktop) | stub, `plugins: []` |
| `.cursor-plugin/marketplace.json` | Cursor | stub, `plugins: []` |
| (undecided) | opencode | no marketplace concept; see below |

All three catalogs use the marketplace `name` **`rjstone`**, so installs read `<plugin>@rjstone`.
If you rename it, change all three together.

## Per-harness reference

Start from the linked docs. The notes below are short summaries, not the whole spec.

### Claude Code

- Docs: [marketplace reference](https://code.claude.com/docs/en/plugins/marketplace-reference),
  [create a marketplace](https://code.claude.com/docs/en/plugins/create-marketplace),
  [host a marketplace](https://code.claude.com/docs/en/plugins/host-marketplace),
  [plugin manifest reference](https://code.claude.com/docs/en/plugins/manifest-reference).
- **Plugins in other repos: yes.** Source types are:
  - a relative path inside this repo
  - `github` (`repo`)
  - `url` (any git URL)
  - `git-subdir` (`url` + `path`)
  - `npm`
  - `archive`
  - `command`
- Git sources accept `ref` and/or `sha`. If both are set, `sha` wins.
- Strict mode (`strict`, default `true`) decides how an entry merges with the plugin's own
  `plugin.json`. If the plugin repo has no `plugin.json`, the entry *is* the manifest. See
  [strict mode](https://code.claude.com/docs/en/plugins/marketplace-reference#strict-mode).
- Set `version` in one place only, either the entry or `plugin.json`. If no version is set,
  updates follow the commit SHA.
- Validate: `claude plugin validate .`
- Install:
  - `/plugin marketplace add rjstone/plugin-marketplace`
  - then `/plugin install <plugin>@rjstone`

### OpenAI Codex

- Docs: [Build plugins (marketplace sections)](https://developers.openai.com/plugins/build/plugins),
  [Plugins overview](https://learn.chatgpt.com/docs/plugins).
- **Plugins in other repos: yes.** The docs say a marketplace file "can live ... in a separate
  marketplace repo". Source types are:
  - `local` (`path`, written `./`-relative to the marketplace root)
  - `url` (git repo whose root is the plugin)
  - `git-subdir` (`url` + `path`)
  - `npm`
- Git sources accept `ref` or `sha`. If an entry's source can't be resolved, only that entry is
  skipped.
- Every entry must have `policy.installation`, `policy.authentication` and `category`.
  `interface.displayName` sets the catalog title.
- Codex also reads `.claude-plugin/marketplace.json`. It's untested whether one shared file
  can serve both tools, so keep two files for now.
- Add the marketplace: `codex plugin marketplace add rjstone/plugin-marketplace` (accepts
  `--ref` and `--sparse PATH`).

### Cursor

- Docs: [Plugins reference: multi-plugin repositories](https://cursor.com/docs/reference/plugins#marketplace-manifest-format),
  [Plugins](https://cursor.com/docs/plugins),
  [official template](https://github.com/cursor/plugin-template),
  [official plugins repo](https://github.com/cursor/plugins).
- **Plugins in other repos: not documented.** `source` is a plugin folder (or an object with
  `path`) inside this repo, and the rules forbid `..` and absolute paths. Options:
  - git submodules, but whether Cursor's importer fetches submodules is unverified
  - adding each plugin repo to Cursor directly
- Cursor also loads plugins that follow the open
  [Agent Plugins](https://agent-plugins.org) standard
  ([spec](https://github.com/agentplugins/agent-plugins-spec)). That standard is a lead for a
  shared cross-harness format and hasn't been researched yet.

### opencode (undecided)

- Docs: [Build plugins](https://opencode.ai/docs/build/plugins/),
  [Configure plugins](https://opencode.ai/docs/plugins/).
- **No marketplace concept.** Plugins are either npm packages or local paths, listed under
  `"plugins"` in `opencode.json(c)`. There's no catalog file and no git source.
- Options:
  - ship an `opencode.jsonc` here listing npm-published plugins
  - ship an `INSTALL.md` that the agent fetches and follows (the
    [superpowers](https://github.com/obra/superpowers) approach)

### Seen but not researched

Other repos have marketplace or plugin folders for these harnesses, but their docs haven't been
checked yet:

- Muse (`.muse-plugin/marketplace.json`)
- Hermes, Kimi, Devin, Antigravity, Pi (`.<harness>-plugin/` or `.pi/`)
- GitHub Copilot, Kiro, Gemini (named by other templates)

Check each harness's docs before adding a stub.

## Prior art (multi-harness marketplace templates)

As of 2026-11, every template checked keeps plugins inside the repo (relative `./plugins/...`
sources). None demonstrate the pointer-only approach.

- [thrsouza/ai-plugins-marketplace-template](https://github.com/thrsouza/ai-plugins-marketplace-template):
  Codex, Claude Code, Cursor, Antigravity, with empty stubs
- [ai-plugin-marketplace/template](https://github.com/ai-plugin-marketplace/template):
  Claude, Cursor, Kiro, Gemini
- [morris-frank/agent-plugin-template](https://github.com/morris-frank/agent-plugin-template):
  Claude, Codex, Cursor
- [CarterCole/example-ai-marketplace](https://github.com/CarterCole/example-ai-marketplace):
  Claude, Copilot, Codex, Cursor
- [DanielHou315/multi-harness-plugin-template](https://github.com/DanielHou315/multi-harness-plugin-template):
  one plugin for Claude, Cursor, Codex, pi, opencode
- [ivan-magda/claude-code-plugin-template](https://github.com/ivan-magda/claude-code-plugin-template):
  Claude only, the most-starred of these

## Adding a plugin

1. In `.claude-plugin/marketplace.json`, add an entry with a `github` or `git-subdir` source.
2. In `.agents/plugins/marketplace.json`, add an entry with a `url` or `git-subdir` source, plus
   `policy` and `category`.
3. Cursor: skip it unless the plugin is vendored here; see the Cursor section.
4. Use the same plugin `name` in every catalog, matching the plugin's own manifest `name`.
5. Run `claude plugin validate .` and check each file with `jq . <file>`.
