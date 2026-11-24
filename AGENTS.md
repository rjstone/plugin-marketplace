# AGENTS.md

Instructions and reference for coding agents working in this repo.

## What this repo is

A **pointer-only plugin marketplace**: one repo holding the marketplace catalogs for several
coding-agent harnesses. Where a harness allows it, entries point at plugins in *other* repos
instead of copying plugin code here. It may later be published as a public template
(`plugin-marketplace-template`).

## Git workflow

- Commit and push directly to `main`. No feature branches or PRs unless asked.

## Key finding: `.claude-plugin/marketplace.json` is a de facto shared format

Many harnesses read Claude Code's catalog location and schema, either directly or as a
fallback. **That file is the main catalog.** Add harness-specific files only where a harness
needs fields Claude's schema lacks (Codex's `policy`), or doesn't read Claude's file at all
(Cursor).

| Reads `.claude-plugin/marketplace.json` | How |
|---|---|
| Claude Code | native |
| OpenAI Codex | "legacy-compatible" location; native file is `.agents/plugins/marketplace.json` |
| GitHub Copilot CLI | last in its lookup order (`marketplace.json` → `.plugin/` → `.github/plugin/` → `.claude-plugin/`) |
| VS Code agent plugins (experimental) | its docs point to Claude's marketplace schema |
| Factory Droid | fallback after `.factory-plugin/marketplace.json` |
| Augment Auggie | supported alongside `.augment-plugin/marketplace.json` |
| JetBrains Junie CLI | alternative to `.junie-extension/marketplace.json` |
| Qwen Code | uses Claude marketplaces; no catalog file of its own |

Open question: does one file with both Claude-only and Codex-only fields work in every reader?
Untested. Codex requires `policy` and `category`, and every other reader would need to ignore
those fields.

## Layout

| Path | Harness | Status |
|---|---|---|
| `.claude-plugin/marketplace.json` | Claude Code + the readers above | stub, `plugins: []` |
| `.agents/plugins/marketplace.json` | OpenAI Codex | stub, `plugins: []` |
| `.cursor-plugin/marketplace.json` | Cursor | stub, `plugins: []` |
| `opencode/opencode.jsonc` | opencode | config snippet, not a catalog (see below) |

All catalogs use the marketplace `name` **`rjstone`**, so installs read `<plugin>@rjstone`.
If you rename it, change every catalog together.

## Harnesses with a catalog that can point at other repos

Start from the linked docs. The notes below are short summaries, not the whole spec.

### Claude Code

- Docs: [marketplace reference](https://code.claude.com/docs/en/plugins/marketplace-reference),
  [create a marketplace](https://code.claude.com/docs/en/plugins/create-marketplace),
  [host a marketplace](https://code.claude.com/docs/en/plugins/host-marketplace),
  [plugin manifest reference](https://code.claude.com/docs/en/plugins/manifest-reference).
- Source types:
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
- Native catalog: `.agents/plugins/marketplace.json`. Source types are:
  - `local` (`path`, written `./`-relative to the marketplace root)
  - `url` (git repo whose root is the plugin)
  - `git-subdir` (`url` + `path`)
  - `npm`
- Git sources accept `ref` or `sha`. If an entry's source can't be resolved, only that entry is
  skipped.
- Every entry must have `policy.installation`, `policy.authentication` and `category`.
  `interface.displayName` sets the catalog title.
- Add the marketplace: `codex plugin marketplace add rjstone/plugin-marketplace` (accepts
  `--ref` and `--sparse PATH`).

### GitHub Copilot CLI and VS Code

- Docs:
  - [CLI plugin reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference)
  - [plugin and marketplace reference](https://docs.github.com/en/copilot/reference/plugin-and-marketplace-reference)
  - [create and share marketplaces](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/create-and-share-plugin-marketplaces)
  - [official starter](https://github.com/github/plugin-marketplace-starter)
- Native catalog: `.github/plugin/marketplace.json`. Copilot also reads Claude's file, so no
  separate stub is needed.
- Sources: a relative path, `{"source":"github","repo":...,"ref":...,"path":...}`, or `url`,
  each with optional `sha`.
- Commands:
  - `copilot plugin marketplace add owner/repo[#ref]`
  - `copilot plugin install <plugin>@<marketplace>`
- A repo can set default marketplaces in `.github/copilot/settings.json`.
- VS Code: [agent plugin reference](https://code.visualstudio.com/docs/agents/reference/agent-plugin-reference),
  [agent plugins](https://code.visualstudio.com/docs/agent-customization/agent-plugins).
  - Add marketplaces through the `chat.plugins.marketplaces` setting (`owner/repo#ref|sha`, a git
    URL, or `file:///`).
  - VS Code auto-detects Agent Plugins, Copilot and Claude plugin manifests.

### Factory Droid, Augment Auggie, JetBrains Junie, Qwen Code

These four read Claude's file; their native paths are optional. Researched from docs, with
some details taken from search excerpts only.

- Factory Droid:
  - native catalog: `.factory-plugin/marketplace.json`
  - sources: Claude-style objects and npm
  - docs: [plugins](https://docs.factory.ai/cli/configuration/plugins)
- Augment Auggie:
  - native catalog: `.augment-plugin/marketplace.json`
  - docs: [plugins](https://docs.augmentcode.com/cli/plugins)
- JetBrains Junie CLI:
  - native catalog: `.junie-extension/marketplace.json`
  - add with `/extensions marketplace add`
  - docs: [extensions](https://junie.jetbrains.com/docs/junie-cli-extensions.html)
- Qwen Code:
  - add with `qwen extensions sources add <repo>`
  - install with `qwen extensions install <mkt>:<plugin>`
  - docs: [extensions](https://qwenlm.github.io/qwen-code-docs/en/users/extension/introduction)

### Devin

- Docs: [plugins overview](https://docs.devin.ai/cli/extensibility/plugins/overview).
- No `marketplace.json`. Instead, a "meta-plugin" `.devin-plugin/plugin.json` lists
  `requiredPlugins` / `optionalPlugins`, and that list acts as the catalog.
- Sources: `github`, `url`, `git-subdir`, with `ref`/`sha`.
- Devin also reads `.claude-plugin/plugin.json`, a *plugin* manifest, not a catalog.
- Not stubbed yet.

## Harnesses where catalog sources must live in this repo

### Cursor

- Docs: [Plugins reference: multi-plugin repositories](https://cursor.com/docs/reference/plugins#marketplace-manifest-format),
  [Plugins](https://cursor.com/docs/plugins),
  [official template](https://github.com/cursor/plugin-template),
  [official plugins repo](https://github.com/cursor/plugins).
- `source` is a plugin folder (or an object with `path`) inside this repo, and the rules forbid
  `..` and absolute paths. Pointing at other repos isn't documented. Options:
  - git submodules, but whether Cursor's importer fetches submodules is unverified
  - adding each plugin repo to Cursor directly

### Kimi Code CLI (uncertain)

- Docs: [plugins](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/plugins).
- Uses a custom marketplace JSON given by path or URL (`/plugins marketplace <src>` or
  `KIMI_CODE_PLUGIN_MARKETPLACE_URL`).
- The example only shows `"source": "./my-plugin"`. Whether it accepts external sources is
  unconfirmed.

## Harnesses with no catalog you can host

These have no catalog file you can host. Plugins install one repo at a time, or from a list
the vendor curates.

### opencode

- Docs: [Build plugins](https://opencode.ai/docs/build/plugins/),
  [Configure plugins](https://opencode.ai/docs/plugins/).
- Plugins are npm packages or local paths, listed under `"plugins"` in `opencode.json(c)`.
- `opencode/opencode.jsonc` here is a snippet of plugin lines. An agent picks the ones the user
  asks for and merges them into the user's opencode config.

### Pi

- Docs: [packages](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md),
  [gallery](https://pi.dev/packages).
- Install from npm, git or a local path:
  - `pi install npm:@x/y@1.0.0`
  - `pi install git:github.com/x/y@v1`
  - `pi install ./local`
- Installed packages are recorded in `packages` in `~/.pi/agent/settings.json`, or in
  `.pi/settings.json` with `--local`.
- The gallery lists npm packages that have the keyword `pi-package`.
- A pointer list here would be a `packages` snippet, the same approach as opencode.

### Google Antigravity vs Gemini CLI (two different systems)

- Antigravity ([plugins](https://antigravity.google/docs/plugins)):
  - plugin manifest: `plugin.json` at the root, or `.antigravity-plugin/plugin.json`
  - install with `agy plugin install <github-url>`
  - the only marketplace allowed is `antigravity-plugins-official`
  - `agy plugin import gemini|claude` migrates existing Gemini extensions or Claude plugins
  - follows Agent Plugins
- Gemini CLI ([releasing extensions](https://geminicli.com/docs/extensions/releasing)):
  - each extension has `gemini-extension.json`
  - install with `gemini extensions install <git-url> [--ref]`
  - the gallery crawls GitHub repos tagged with the topic `gemini-cli-extension`
  - possible custom registry via `experimental.extensionRegistryURI` (unverified)

### Others

- **Kiro**:
  - [powers](https://kiro.dev/docs/powers/installation)
  - official registry plus "Import power from GitHub"
  - accepts Agent Plugins `plugin.json` or `POWER.md`
- **Cline**:
  - [plugins](https://docs.cline.bot/customization/plugins)
  - central `cline/marketplace` repo, added to by PR
  - `cline plugin install <git-url>`
- **Hermes Agent**:
  - [plugin catalog](https://hermes-agent.nousresearch.com/docs/user-guide/features/plugin-catalog)
  - plugins go into the central catalog by PR
  - for *skills*, any GitHub repo can be a "tap": `hermes skills tap add owner/repo`
- **Amp**:
  - [plugins](https://ampcode.com/docs/customize/plugins)
  - TS/JS modules
  - `amp plugins add <url>`
- **Roo Code, Goose, Zed**: curated central marketplaces only.
- **No evidence found yet**: Windsurf, Crush, Muse. Z.ai zcode reportedly uses a Claude-style
  `marketplace.json` (unverified).

## Agent Plugins open standard

- Links: [agent-plugins.org](https://agent-plugins.org),
  [spec 1.0.0](https://agent-plugins.org/specification),
  [manifest](https://agent-plugins.org/plugin-authors/manifest),
  [compatible clients](https://agent-plugins.org/compatible-clients),
  [spec repo](https://github.com/agentplugins/agent-plugins-spec).
- Governance: a vendor-neutral steering committee with members from Amazon, Cursor, Microsoft,
  OpenAI and Vercel. 1.0.0 is published; 1.1.0 is a draft that adds hooks and icons.
- Clients listed as compatible include VS Code, Cursor, Copilot, ChatGPT/Codex, Kiro, Hermes,
  Antigravity and OpenHands. **Claude Code is not listed.**
- It's a **plugin** format, not a catalog format:
  - root `plugin.json` with `$schema`
  - `skills/<name>/SKILL.md`
  - root `mcp.json`
  - `${PLUGIN_ROOT}` / `${PLUGIN_DATA}` variables
- It deliberately defines no marketplace or registry. Registries are listed only under
  [future considerations](https://github.com/agentplugins/agent-plugins-spec/blob/main/FUTURE_CONSIDERATIONS.md).
- **For this repo:** it affects how *plugin* repos are laid out, not the catalogs here. A plugin
  can carry both a root `plugin.json` (Agent Plugins) and `.claude-plugin/plugin.json`, sharing
  `skills/`.
  - Watch for one difference: Agent Plugins' `mcp.json` needs `$schema` and a `type` on each
    server, and uses `${PLUGIN_ROOT}`.
  - Claude's `.mcp.json` uses `${CLAUDE_PLUGIN_ROOT}` instead.

### Open Plugins (superseded) and AI Catalog

- **Open Plugins** (`open-plugins.com`, from Vercel Labs' `vercel-labs/open-plugin`) came before
  Agent Plugins. `open-plugins.com` now redirects to agent-plugins.org.
  - Its marketplace spec ([archived 2026-07](https://web.archive.org/web/20260708065721/https://open-plugins.com/plugin-builders/marketplace))
    put the file at the repo root as `marketplace.json`.
  - Lookup order: `marketplace.json` → `.plugin/marketplace.json` → `.<tool>-plugin/marketplace.json`.
    Copilot CLI's lookup order follows this.
  - `source` had to be a **relative path starting with `./`**, so it can't point at other repos.
  - Agent Plugins dropped the marketplace part. Its lead maintainer said "marketplaces are a
    distribution artifact ... outside the scope of the spec"
    ([discussion #42](https://github.com/agentplugins/agent-plugins-spec/discussions/42)).
  - Don't generate this file. Since Copilot reads the root `marketplace.json` first, one placed
    here would take priority over `.claude-plugin/marketplace.json` for Copilot.
- **AI Catalog** ([ai-catalog.io](https://ai-catalog.io/), v0.9, release candidate for 1.0)
  is what that maintainer personally recommends for distribution, along with
  [ARD](https://agenticresourcediscovery.org/), which is built on AI Catalog.
  - It's a general discovery JSON: `specVersion`, `host`, and `entries[]` of
    `{identifier, type (media type), url}`. Catalogs can nest.
  - It lists "Claude Code plugins" as one kind of thing it can index.
  - No coding agent is known to install plugins from it. It's a possible extra generated output
    for discoverability, not a replacement for the per-harness catalogs.

## Prior art (multi-harness marketplace templates)

As of 2026-11, every template checked keeps plugins inside the repo (relative `./plugins/...`
sources). None demonstrate the pointer-only approach.

- [github/plugin-marketplace-starter](https://github.com/github/plugin-marketplace-starter):
  GitHub's official Copilot starter
- [thrsouza/ai-plugins-marketplace-template](https://github.com/thrsouza/ai-plugins-marketplace-template):
  Codex, Claude Code, Cursor, Antigravity, with empty stubs
- [ai-plugin-marketplace/template](https://github.com/ai-plugin-marketplace/template):
  Claude, Cursor, Kiro, Gemini, Vercel Skills.
  - It's a thin wrapper around the `@ai-plugin-marketplace/cli` + `core` npm toolkit
    (`aipm build`/`validate`).
  - It **generates** the Claude, Cursor, Codex and Open Plugins catalogs from
    `aipm.workspace.ts` plus each plugin's `aipm.config.ts`.
  - **No pointer-only support.** In core 0.11.0, `pipeline/build.js` sets every `source` to
    `./<plugin folder in this repo>`, and the Codex output is hard-coded to
    `{source: 'local'}`. The build-from-one-source idea and its committed-output freshness check
    are worth copying.
- [morris-frank/agent-plugin-template](https://github.com/morris-frank/agent-plugin-template):
  Claude, Codex, Cursor
- [CarterCole/example-ai-marketplace](https://github.com/CarterCole/example-ai-marketplace):
  Claude, Copilot, Codex, Cursor
- [DanielHou315/multi-harness-plugin-template](https://github.com/DanielHou315/multi-harness-plugin-template):
  one plugin for Claude, Cursor, Codex, pi, opencode
- [ivan-magda/claude-code-plugin-template](https://github.com/ivan-magda/claude-code-plugin-template):
  Claude only, the most-starred of these

## Adding a plugin

1. In `.claude-plugin/marketplace.json`, add an entry with a `github` or `git-subdir` source,
   pinned with `ref` or `sha`. This one entry covers every harness in the "Key finding" table.
2. In `.agents/plugins/marketplace.json`, add an entry with a `url` or `git-subdir` source, plus
   `policy` and `category`.
3. Cursor: skip it unless the plugin is vendored here; see the Cursor section.
4. opencode / Pi: if the plugin is published as an npm or pi package, add its line to the
   snippet.
5. Use the same plugin `name` in every catalog, matching the plugin's own manifest `name`.
6. Run `claude plugin validate .` and check each file with `jq . <file>` (use `jq` on the
   `.jsonc` file only after stripping its comments).
