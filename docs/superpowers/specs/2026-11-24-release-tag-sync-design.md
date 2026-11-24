# Design: release-tag sync for the plugin marketplace

Date: 2026-11-24. Status: awaiting approval.

## Intent and why

This repo is a marketplace that only *points at* plugins in other repos. A person maintaining it
should do only two things by hand:

- add a plugin
- add or change a plugin's marketplace metadata (description, category, Codex policy, and so on)

**Each plugin repo decides what "latest" means by publishing semver release tags.** The
marketplace follows each plugin's latest release tag automatically in every harness. It never
follows the default branch, and nobody pins anything by hand. Users who want an older release can
pin a tag themselves, because release tags are required.

Some harnesses can't point at other repos (Cursor today). For those, the marketplace keeps a copy
of each plugin at the same release tag, refreshed automatically.

This repo may become a public template (`plugin-marketplace-template`), so all of this must work
for someone else's account without editing code.

## Goals

1. Every catalog points each plugin at its **latest semver release tag**.
2. Updates happen **automatically**:
   - right away when one of the maintainer's own plugin repos pushes a release tag
   - within a day for any other plugin repo
3. Cursor (and any later harness that can't point at other repos) gets a **copy** of each plugin
   at that same tag, under `vendor/<plugin-name>/`.
4. The maintainer edits only `marketplace.config.ts`. Everything else is generated or committed
   by the bot.
5. Nothing is committed unless it passes the same checks as CI.

## Non-goals

- Git submodules. They're ruled out: Cursor's plugin installer doesn't fetch them (a "confirmed
  gap", per its staff on the Cursor forum), and Claude Code doesn't refresh them when a marketplace
  updates (anthropics/claude-code#33164, closed "not planned").
- npm-sourced plugins. Their version comes from the npm registry, so they're passed through
  without tag tracking.
- `local` plugins already kept in this repo. They're passed through unchanged.
- A catalog for Kimi or any other new harness. The copy mechanism should make one easy to add
  later, but this design doesn't add any.
- Pre-release channels such as `-beta` or `-rc` tags.

## Anti-goals (failure even if it "works")

- Shipping unreleased default-branch code to any harness.
- Silently falling back to the default branch when a plugin has no release tags.
- The maintainer having to bump versions or pins in this repo for routine plugin releases.
- Different harnesses running different versions of the same plugin.
- Unreviewed bot commits that fail validation.

## Approaches considered

| Approach | What it trades off | Status |
|---|---|---|
| **A. Lock file + tags in every catalog** | One automated commit per plugin release. In return every harness gets the same release, and the copies match it | **chosen** |
| B. Tags only for the copies; other harnesses follow the default branch | Simpler, but harnesses would run different versions and see unreleased code | rejected by the maintainer |
| C. Git submodules for the copies | No copied files to commit, but Cursor's installer ignores submodules and Claude Code doesn't update them | ruled out by research |

Update triggers considered: notifications from plugin repos only (misses third-party repos),
polling only (slow), and **both, feeding one idempotent job (chosen)**. Plugin repos start the
marketplace workflow with `workflow_dispatch`, which needs only Actions: write. They don't use
`repository_dispatch`, which needs Contents: write and would amount to push access.

"Release tag" means the **highest semver git tag found with `git ls-remote --tags`** (chosen).
That works on any git host and needs no API token. The other option was GitHub's "latest release"
API, which only works on GitHub.

## Design

### 1. Config (`marketplace.config.ts`), the only file edited by hand

- Plugin entries normally have **no `ref`/`sha`**.
- An explicit `ref` or `sha` stays allowed as a manual override, for example to hold a plugin
  back. That plugin then skips tag resolution, and the lock file records the override.
- A new per-plugin field, `vendor?: boolean`, controls copying. Its default:
  - `true` for `github`/`git` sources that aren't excluded from Cursor
  - `false` for everything else
- Copying lets Cursor list a plugin from another repo, which today gets skipped with a warning.

### 2. Lock file (`plugins.lock.json`), generated

Written only by the update script, never by hand, and always committed. One entry per git-sourced
plugin:

```json
{
  "plugins": {
    "my-plugin": {
      "url": "https://github.com/rjstone/my-plugin.git",
      "tag": "v1.4.0",
      "commit": "<40-hex commit the tag points to, after resolving annotated tags>",
      "override": false
    }
  }
}
```

`commit` is how the job notices a tag that was moved to a different commit, and it's the commit
the copy is taken from.

### 3. Tag resolution (`scripts/update.ts`, the resolve step)

1. Run `git ls-remote --tags <url>` for each git-sourced plugin, with no checkout. For annotated
   tags, use the `refs/tags/<t>^{}` line to get the commit.
2. Keep only tags matching `^v?(\d+)\.(\d+)\.(\d+)$`, which drops pre-release and build suffixes.
   Compare them as numbers and pick the highest. If both `v1.2.3` and `1.2.3` exist for the same
   version, prefer the `v` form.
3. **A plugin with no matching tag is an error.** The job fails and names the plugin.
   - Every other plugin's update still gets written. The job reports the failure through its
     exit code and the Actions run summary.
   - The bad plugin keeps its previous lock entry, or is left out if it's new.
4. Use `git` on the runner. Public repos need no token. Private plugin repos are out of scope for
   this version, so document that limit.

### 4. Generated catalogs (`scripts/build.ts`, extended)

- For each git-sourced plugin, the build reads `tag` from the lock file and emits it as `ref`:
  - Claude: `github` / `url` / `git-subdir` with `ref`
  - Codex: `url` / `git-subdir` with `ref`
  - Pi: `git:...@<tag>`
- **Builder's call:** whether to also emit `sha` (the locked commit) for tamper-evidence. Claude
  prefers `sha` over `ref` when both are set. Either choice is acceptable; say in AGENTS.md which
  was chosen.
- Cursor: copied plugins are listed as `"./vendor/<name>"`.
- A git plugin missing from the lock file is a build error ("run the update script first"), not
  an unpinned entry.
- `--check` also fails when the lock file has entries that don't match the config (stale or
  missing plugins).

### 5. Copies (`vendor/<name>/`), refreshed by `scripts/update.ts`

- For each copied plugin whose `vendor/<name>/.vendor.json` commit differs from the lock commit:
  1. Shallow-clone that tag into a temp directory.
  2. Take the plugin's `path` subfolder (or the repo root if there's no `path`).
  3. Replace `vendor/<name>/` with it, leaving out `.git`.
  4. Write `.vendor.json` with `{ url, path, tag, commit }`.
- Remove copy folders for plugins that were deleted from the config or are no longer copied.
- Warn, without failing, if a copy has neither `.cursor-plugin/plugin.json` nor a root
  `plugin.json`, since Cursor needs one of them.
- `build.ts --check` verifies every `.vendor.json` matches the lock file. It doesn't re-hash file
  contents. **Builder's call:** add a content hash if it's cheap.
- Treat copied content as untrusted: never run anything from it during the update.

### 6. Automation (GitHub Actions)

**Credentials.**

- **Plugin repos never push to the marketplace.** They only *start* its update workflow.
- The marketplace workflow clones the public plugin repos with no auth, and commits with its own
  built-in `GITHUB_TOKEN`, using `permissions: contents: write` on that job only.
- **Notifier GitHub App**, installed on the marketplace repo:
  - Permission: **Actions: Read and write** only. That's enough to call the `workflow_dispatch`
    API. Remove the "Workflows" permission, and grant no Contents permission.
  - Each plugin repo stores the App ID in the repository variable `MARKETPLACE_APP_ID` and the
    private key in the secret `MARKETPLACE_APP_PRIVATE_KEY`. The client secret is not used.
  - A leaked key can only start, cancel or disable runs of the marketplace's workflows. It can't
    change any code.
- Template users create their own App the same way.
- The App is optional: without it, the daily schedule still picks up every release.

**`.github/workflows/update.yml`** (new) runs on:

- `workflow_dispatch`, with optional inputs `repo` and `tag`, informational only. Plugin repos and
  the "Run workflow" button both use this.
- `schedule`, daily
- `push` to `main` with `paths: [marketplace.config.ts]` (see decision 1 below)

It uses one concurrency group (`plugin-update`, no cancel-in-progress) so runs don't race.
Steps:

1. Check out with the default token.
2. Run `node scripts/update.ts`: resolve tags, refresh copies, rebuild.
3. Run `node scripts/build.ts --check` and `claude plugin validate .` **inside this job.** Pushes
   made with `GITHUB_TOKEN` don't trigger other workflows, so `check.yml` won't run on the bot's
   commit.
4. If anything changed, commit as `github-actions[bot]` with a message listing the plugin version
   changes, then push to `main`.
5. If nothing changed, exit cleanly.

**Plugin-repo snippet (`docs/plugin-repo-release-workflow.yml`, documented, not run here).**
Plugin authors copy this into their own repo. It runs on `push: tags: ['v*.*.*', '*.*.*']`:

1. Mint a token for the marketplace installation with `actions/create-github-app-token`, using the
   inputs `owner` and `repositories: plugin-marketplace`.
2. Call `POST repos/<owner>/plugin-marketplace/actions/workflows/update.yml/dispatches` with
   `ref: main` and `inputs: { repo, tag }`.

The marketplace job ignores the inputs' contents and just resolves everything.

**`check.yml`** (existing) adds the lock-file and copy consistency checks to `build.ts --check`.

### 7. Docs

Update AGENTS.md:

- The config examples become unpinned.
- `ref`/`sha` are described as an override.
- New files: the lock file, `vendor/`, `update.ts`, `update.yml`.
- How to set up the App.
- The plugin-repo snippet.
- "Release tags are required" as a rule for listed plugins.
- The private-repo limit.

## Decisions from the design review (builder's calls unless noted)

1. **A config change starts an update.** `update.yml` also runs on `push` to `main` with
   `paths: [marketplace.config.ts]`. The bot's commits never touch that file, so the job can't
   trigger itself in a loop.
   - The maintainer *may* run `node scripts/update.ts` locally before committing, but doesn't
     have to.
   - If they don't, the config-only commit shows a red `check.yml` run until the bot's follow-up
     commit lands, usually within minutes. AGENTS.md says to expect this.
2. **One broken plugin doesn't block the others.**
   - A plugin with no release tag, or that can't be reached, is left out of every catalog, with a
     warning naming it. If it had a previous lock entry, that entry is kept.
   - The job commits and pushes everyone else's updates, then exits non-zero so the run shows as
     failed and names the plugin.
   - `build.ts` treats "listed in config but not in the lock" as a warning in normal runs.
     `--check` turns it into an error only when the lock records an error for that plugin, so a
     plugin that hasn't been resolved yet doesn't break CI.
3. **A tag moved to a different commit is refused.**
   - The job keeps the old locked commit, doesn't refresh the copy, and fails, naming the plugin
     and both commits. The other plugins still update.
   - To accept a moved tag, a person deletes that plugin's lock entry.
   - The catalogs therefore emit **`sha` (the locked commit) alongside `ref` (the tag)**, so users
     get exactly the reviewed commit even if a tag moves upstream. This settles the `sha` choice
     left open in section 4.
4. **Manual overrides:**
   - `ref` must be a **tag** that exists in the plugin repo. A ref found only under `refs/heads/`
     (a branch) is a config error, because shipping a branch would be an anti-goal.
   - An override tag is resolved to its commit on every run, and the moved-tag rule applies.
   - A `sha` override is used as-is. Its lock `tag` is `null`, and the catalogs emit `sha` only.
5. **opencode and Pi.**
   - Pi entries derived from a git source already use `@<tag>`.
   - An explicit `pi.source` and an opencode npm `version` come from the npm registry, a
     separate release channel, so they stay as written in the config. If `version` is unset, npm
     "latest" is used. AGENTS.md explains that keeping npm releases matched to git tags is the
     plugin author's job.
6. **Credential scope (decided by the maintainer).** Plugin repos only start the workflow
   (`workflow_dispatch`, via an App with Actions: write). They never get push access. See
   section 6.

## Constraints

- Node ≥ 22.18, no runtime dependencies, erasable TypeScript only (existing rules).
- Shell out to `git` only through `child_process.execFile` with argument arrays, never a shell
  string, because URLs come from config.
- Generated output stays byte-stable: 2-space JSON plus a trailing newline.
- Commit and push go straight to `main` (repo policy).

## Testing (expected)

- Unit tests with `node:test` (built in, no dependencies) for:
  - semver filtering and ordering, including `v` vs no-`v` duplicates and pre-release exclusion
  - parsing `ls-remote` output, including annotated tags
  - lock-to-catalog mapping for each source type
- An integration run against at least one real public repo that has semver tags, done once by hand
  or as an optional CI job.

## Left to the builder

- Whether to emit `sha` alongside `ref` (section 4).
- Whether to add a content hash for copies (section 5).
- How `update.ts` is split internally, the exact commit message format, and the cron hour.
- Test layout.
