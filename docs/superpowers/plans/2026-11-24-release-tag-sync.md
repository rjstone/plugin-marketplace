# Release-Tag Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Point every catalog at each plugin's latest semver release tag. The tag is resolved
automatically into a lock file, and copies are kept in `vendor/` for Cursor.

**Architecture:**

- Pure modules handle semver choice, `ls-remote` parsing and lock resolution. They take their
  network and git operations as injected functions, so tests need no network.
- `update.ts` runs the pipeline: resolve the lock, sync the copies, then run the existing
  generator.
- `build.ts` now reads the lock file and treats `--root` as the repo it reads from and writes
  to.
- One GitHub Actions workflow runs the update and commits with `GITHUB_TOKEN`.

**Tech Stack:**

- Node ≥ 22.18, running TypeScript directly by stripping types
- `node:test`
- `git` called through `child_process.execFile`
- GitHub Actions
- no npm dependencies

**Spec:** `docs/superpowers/specs/2026-11-24-release-tag-sync-design.md` (read it; this plan
argues from it).

## Global Constraints

- Node ≥ 22.18, no runtime dependencies, erasable TypeScript only: no `enum`, `namespace` or
  parameter properties. `tsconfig.json` has `erasableSyntaxOnly`.
- Import local modules with an explicit `.ts` extension. Use `import type` for type-only imports.
- Call `git` only through `execFile` with an argument array, never a shell string. Set
  `GIT_TERMINAL_PROMPT=0`.
- Generated JSON is `JSON.stringify(x, null, 2) + "\n"`.
- Release tag pattern: `^v?(\d+)\.(\d+)\.(\d+)$`. Compare the parts as numbers. When `vX.Y.Z` and
  `X.Y.Z` both exist, prefer `vX.Y.Z`.
- The lock file is `plugins.lock.json` at the root. Copies go in `vendor/<name>/`, each with a
  `.vendor.json` stamp.
- Catalogs emit `ref` (the tag, when there is one) **and** `sha` (the locked commit).
- A git URL may start with `https://`, `http://`, `ssh://`, `git@` or `file://`. `file://` is
  only there so tests can use local fixture repos.
- Never run code from fetched plugin repos.
- Commit and push straight to `main`.

## Review Focus

1. **`ls-remote` output with lightweight and annotated tags mixed, plus non-semver tags.** The
   right commit is picked: the peeled `^{}` line wins. Tested in Task 1.
2. **An unreachable repo or a `git` failure for one plugin.** That plugin is marked as errored,
   keeps its previous lock entry, and every other plugin still resolves. Tested in Task 2.
3. **A plugin removed or renamed in the config.** Its lock entry and `vendor/` folder are
   removed, with nothing left behind. Tested in Tasks 2 and 4.
4. **A copied plugin whose `path` doesn't exist at the tag.** It's reported as an error, and no
   partial or empty `vendor/<name>/` is written. Tested in Task 4.
5. **Re-running the update when nothing changed upstream.** It changes no files at all, so the
   workflow has nothing to commit. Tested in Task 5.

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/semver.ts` (new) | parse and choose release tags |
| `scripts/lsremote.ts` (new) | run and parse `git ls-remote --tags` |
| `scripts/lock.ts` (new) | lock file types, reading and writing, and `resolveLock` |
| `scripts/vendor.ts` (new) | `isVendored`, real git snapshots, `syncVendor`, stamps |
| `scripts/update.ts` (new) | orchestration and exit code for CI |
| `scripts/build.ts` (modify) | read the lock, emit `ref`+`sha`, Cursor copies, consistency checks, `--root` |
| `scripts/types.ts` (modify) | add `vendor?: boolean` to `PluginDef` |
| `tests/*.test.ts` (new) | one test file per module, plus `tests/helpers.ts` with the fixture git repo |
| `.github/workflows/update.yml` (new), `check.yml` (modify) | automation |
| `docs/plugin-repo-release-workflow.yml` (new) | snippet for plugin repos to copy |
| `package.json`, `AGENTS.md`, `marketplace.config.ts` (modify) | scripts and docs |

---

### Task 1: Semver selection and `ls-remote` parsing

**Files:**

- Create: `scripts/semver.ts`
- Create: `scripts/lsremote.ts`
- Test: `tests/semver.test.ts`, `tests/lsremote.test.ts`
- Modify: `package.json` (add `"test": "node --test tests/*.test.ts"`)

**Interfaces:**

- Produces:
  - `parseSemverTag(tag: string): { major: number; minor: number; patch: number } | null`
  - `pickLatest(tags: Iterable<string>): string | null`
  - `parseLsRemoteTags(output: string): Map<string, string>`, mapping tag name to commit, with the
    peeled `^{}` commit winning
  - `lsRemoteTags(url: string): Promise<Map<string, string>>`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/semver.test.ts
test('pickLatest orders numerically and ignores pre-release/non-semver', () => {
  assert.equal(pickLatest(['v1.9.0', 'v1.10.0', 'v2.0.0-beta', 'latest', '1.2']), 'v1.10.0');
});
test('pickLatest prefers v-prefixed duplicate', () => {
  assert.equal(pickLatest(['1.2.3', 'v1.2.3']), 'v1.2.3');
});
test('pickLatest returns null when nothing matches', () => {
  assert.equal(pickLatest(['main', 'v1.0.0-rc1']), null);
});
// tests/lsremote.test.ts
test('parseLsRemoteTags prefers peeled commit for annotated tags', () => {
  const out = 'aaa…(40)\trefs/tags/v1.0.0\nbbb…(40)\trefs/tags/v1.1.0\nccc…(40)\trefs/tags/v1.1.0^{}\n';
  const m = parseLsRemoteTags(out);
  assert.equal(m.get('v1.0.0'), 'aaa…'); assert.equal(m.get('v1.1.0'), 'ccc…');
});
test('lsRemoteTags reads a real local repo', async () => {
  const repo = await makeFixtureRepo(['v1.0.0', 'v1.2.0']); // tests/helpers.ts
  const m = await lsRemoteTags(repo.url);
  assert.equal(m.get('v1.2.0'), repo.commits['v1.2.0']);
});
```

`tests/helpers.ts` exports
`makeFixtureRepo(tags: string[], files?: Record<string, string>): Promise<{ url: string; dir: string; commits: Record<string, string>; addTag(tag: string, files?: Record<string, string>): Promise<string> }>`.

- The repo goes in a fresh `fs.mkdtemp` directory.
- Make one commit per tag, writing `files` (default: `.claude-plugin/plugin.json`).
- Annotate odd-numbered tags so both kinds of tag are tested.
- Return a `file://` URL.

- [ ] **Step 2: Run and confirm they fail**

Run `npm test`. Expected: FAIL (modules don't exist yet).

- [ ] **Step 3: Implement `scripts/semver.ts` and `scripts/lsremote.ts`**

`lsRemoteTags` runs `execFile('git', ['ls-remote', '--tags', url], { env: {...process.env, GIT_TERMINAL_PROMPT: '0'}, timeout: 60_000 })` and parses the result with `parseLsRemoteTags`.

- [ ] **Step 4: Run and confirm they pass**

Run `npm test`. Expected: all PASS.

- [ ] **Step 5: Commit**

Message: `feat: semver tag selection and ls-remote parsing`.

---

### Task 2: Lock resolution

**Files:**

- Create: `scripts/lock.ts`
- Modify: `scripts/types.ts`, which adds `vendor?: boolean` with this doc comment: *Copy into
  vendor/ for harnesses that can't point at other repos (Cursor). Default: true for github/git
  sources not excluded from Cursor.*
- Test: `tests/lock.test.ts`

**Interfaces:**

- Consumes: `pickLatest` (Task 1).
- Produces:
  - `interface LockEntry { url: string; path?: string; tag: string | null; commit: string | null; override: boolean; error?: string }`
  - `interface LockFile { plugins: Record<string, LockEntry> }`
  - `type FetchTags = (url: string) => Promise<Map<string, string>>`
  - `pluginGitUrl(p: PluginDef): string | null`, which returns `https://github.com/<repo>.git`
    for github sources, the URL for git sources, and `null` otherwise. Move this out of
    `build.ts` and import it from here.
  - `readLock(root: string): Promise<LockFile>`, which returns `{plugins:{}}` when the file is
    missing
  - `serializeLock(lock: LockFile): string`, with plugin keys sorted
  - `resolveLock(cfg: MarketplaceConfig, prev: LockFile, fetchTags: FetchTags): Promise<{ lock: LockFile; changes: string[]; errors: string[] }>`

`resolveLock` rules (spec section 3 and decisions 2-4). Only git-sourced plugins get entries;
plugins no longer in the config are dropped.

| Case | Result |
|---|---|
| `source.sha` set | `{tag:null, commit:sha, override:true}`. No network call. |
| `source.ref` set | The ref must be a key in the fetched tag map. If it isn't, `error: "ref <r> is not a tag"`. |
| No ref or sha | `tag = pickLatest(keys)`. No match gives `error: "no semver release tag"`. |
| Same tag as `prev`, different commit | Keep `prev`'s tag and commit and set `error: "tag <t> moved from <old> to <new>"`. |
| `fetchTags` throws | `error: "<message>"`. |
| Any error, `prev` entry exists | Keep `prev`'s tag and commit and add the error. |
| Any error, no `prev` entry | `{tag:null, commit:null, error}`. |

`changes` gets a line such as `my-plugin: v1.0.0 -> v1.1.0`, or `my-plugin: added v1.0.0`, or
`my-plugin: removed`. `errors` gets a line `<name>: <error>`.

- [ ] **Step 1: Write the failing tests**

Use a fake `fetchTags` built from a `Record<url, Record<tag, commit>>`. Cover these cases:

- `new plugin locks highest tag`
- `newer tag updates entry and records change`
- `moved tag keeps old commit and errors`
- `no semver tags errors with null entry`
- `fetch failure keeps previous entry and errors`
- `other plugins still resolve when one errors`
- `sha override needs no fetch`
- `ref override that is not a tag errors`
- `removed plugin dropped from lock`
- `serializeLock is byte-stable and sorted`

Each case asserts the exact `LockEntry`, plus the `changes` and `errors` arrays.

- [ ] **Step 2: Run `npm test`.** Expected: the new tests FAIL.

- [ ] **Step 3: Implement `scripts/lock.ts`** following the table above.

- [ ] **Step 4: Run `npm test`.** Expected: PASS.

- [ ] **Step 5: Commit**

Message: `feat: lock file resolution from release tags`.

---

### Task 3: The generator reads the lock

**Files:**

- Modify: `scripts/build.ts`
- Test: `tests/build.test.ts`

**Interfaces:**

- Consumes: `LockFile`, `readLock` and `pluginGitUrl` (Task 2), and `isVendored` (Task 4). Define
  `isVendored` in `scripts/vendor.ts` now: `isVendored(p: PluginDef): boolean`, true when
  `p.vendor ?? (source is github|git && !p.exclude?.includes('cursor'))`. Task 4 fills in the
  rest of `vendor.ts`.
- Produces:
  - `buildOutputs(cfg: MarketplaceConfig, lock: LockFile): Map<string, string>`, exported
  - `checkConsistency(cfg: MarketplaceConfig, lock: LockFile, root: string): Promise<{ errors: string[]; warnings: string[] }>`, exported
  - `main()` runs only when `build.ts` is the entry point
    (`import.meta.url === pathToFileURL(process.argv[1]).href`)
  - CLI: `--root <dir>` (default: repo root; holds the config, lock, `vendor/` and outputs),
    `--config <file>` (default: `<root>/marketplace.config.ts`), `--check`. **Remove `--out`.**

Behavior changes:

- Git plugin entries:
  - Claude and Codex get `ref: lock.tag` (when not null) and `sha: lock.commit`.
  - Pi gets `@<tag>`, or `@<commit>` when the tag is null.
  - Config `ref`/`sha` no longer pass through directly; they reach the catalogs only through the
    lock.
- A git plugin with no lock entry, or with a lock entry whose `commit` is null, is left out of
  every catalog, with a warning.
- Cursor gets `"./vendor/<name>"` for vendored plugins, and `"./<path>"` for local plugins as
  before. Remove the old "not listed for Cursor" warning for vendored plugins.
- `checkConsistency`:
  - error for each lock entry with `error`
  - error for each lock entry not in the config
  - warning for each config git plugin missing from the lock
  - error when a vendored plugin's `vendor/<name>/.vendor.json` is missing or its `commit` is
    not the lock commit (skipped when the lock commit is null)
  - error for any `vendor/*` folder that isn't a vendored plugin
- `--check` runs `checkConsistency` plus the existing stale-file comparison, and exits 1 on any
  error.

- [ ] **Step 1: Write the failing tests**

Call `buildOutputs` and `checkConsistency` directly, with an in-memory config, a lock and a temp
root:

- `claude github entry carries ref and sha from lock`
- `codex git-subdir entry carries ./path, ref and sha`
- `sha override emits sha only`
- `unlocked git plugin omitted with warning`
- `cursor lists vendored plugin as ./vendor/<name>`
- `pi uses @tag`
- `consistency: lock error is an error`
- `consistency: stray vendor dir is an error`
- `consistency: stamp mismatch is an error`
- `consistency: config plugin missing from lock is a warning`

- [ ] **Step 2: Run `npm test`.** Expected: the new tests FAIL.

- [ ] **Step 3: Implement the changes in `scripts/build.ts`**, plus `isVendored` in
  `scripts/vendor.ts`.

- [ ] **Step 4: Run `npm test`, `npm run typecheck`, `node scripts/build.ts --check`.**
  Expected: all PASS. The real repo has no plugins, so its generated files don't change.

- [ ] **Step 5: Commit**

Message: `feat: generator emits locked tags and vendor sources`.

---

### Task 4: Copy sync (`vendor/`)

**Files:**

- Modify: `scripts/vendor.ts`
- Test: `tests/vendor.test.ts`

**Interfaces:**

- Consumes: `LockFile` (Task 2), `isVendored` (Task 3), `makeFixtureRepo` (Task 1 helpers).
- Produces:
  - `interface VendorStamp { url: string; path?: string; tag: string | null; commit: string }`
  - `type FetchSnapshot = (url: string, refOrSha: string, dest: string) => Promise<string>`,
    which resolves to the HEAD commit it fetched
  - `gitFetchSnapshot: FetchSnapshot`
  - `readStamp(root: string, name: string): Promise<VendorStamp | null>`
  - `syncVendor(cfg: MarketplaceConfig, lock: LockFile, root: string, fetchSnapshot: FetchSnapshot): Promise<{ changes: string[]; warnings: string[]; errors: string[] }>`

`gitFetchSnapshot` runs in `dest`: `git init -q`, then
`git fetch -q --depth 1 <url> <refOrSha>`, then `git checkout -q FETCH_HEAD`. It returns
`git rev-parse HEAD`.

`syncVendor` rules:

- For each vendored plugin whose lock commit isn't null and whose stamp commit differs from the
  lock commit:
  1. Fetch into a temp folder with the tag, or the commit when the tag is null.
  2. Check that the HEAD it fetched equals the lock commit. If not, record an error.
  3. Check that `<tmp>/<path ?? ''>` exists. If not, record `error: "path <p> not found at <tag>"`
     and leave the old copy alone.
  4. Copy it into `vendor/<name>.tmp` with `fs.cp(recursive)`, filtering out `.git`, then write
     `.vendor.json`.
  5. Swap the folder in by removing the old `vendor/<name>` and renaming the `.tmp`, so a failure
     never leaves a half-written copy.
- Warn when a copy has neither `.cursor-plugin/plugin.json` nor `plugin.json`.
- Remove any `vendor/*` folder that isn't a vendored plugin, with a change line `<name>: vendor
  removed`.
- Always clean up temp folders.

- [ ] **Step 1: Write the failing tests**, using real fixture repos:

- `vendors tag snapshot without .git and writes stamp`
- `skips when stamp already matches (no file writes)`: check that the mtime is unchanged
- `updates copy when lock commit changes`
- `missing path errors and leaves previous copy intact`
- `warns when no cursor/agent manifest`
- `removes vendor dir for plugin no longer vendored`
- `head mismatch is an error`: use a fake `FetchSnapshot` that returns another commit

- [ ] **Step 2: Run `npm test`.** Expected: the new tests FAIL.

- [ ] **Step 3: Implement the rest of `scripts/vendor.ts`.**

- [ ] **Step 4: Run `npm test`.** Expected: PASS.

- [ ] **Step 5: Commit**

Message: `feat: vendor sync at locked release commits`.

---

### Task 5: `update.ts` orchestration

**Files:**

- Create: `scripts/update.ts`
- Test: `tests/update.test.ts`
- Modify: `package.json` (add `"update": "node scripts/update.ts"`)

**Interfaces:**

- Consumes: `readLock`, `resolveLock`, `serializeLock` (Task 2); `syncVendor`,
  `gitFetchSnapshot` (Task 4); `buildOutputs`, `checkConsistency` (Task 3); `lsRemoteTags`
  (Task 1).
- Produces:
  - `runUpdate(opts: { root: string; configPath?: string; fetchTags?: FetchTags; fetchSnapshot?: FetchSnapshot; messageFile?: string }): Promise<number>`,
    whose result is the exit code
  - CLI: `--root`, `--config`, `--message-file <path>`

Order of operations:

1. Load the config and run the existing config validation. A config error returns 2 and writes
   nothing.
2. `resolveLock`, then write `plugins.lock.json` only if its bytes changed.
3. `syncVendor`.
4. Write `buildOutputs`, only for files whose bytes changed.
5. Run `checkConsistency` and print the warnings.
6. Write the commit message to `--message-file`:
   - subject: `chore: update plugin releases` when there are changes,
     `chore: plugin update (errors)` when there are only errors
   - body: the change lines, then `Errors:` lines
7. If `GITHUB_STEP_SUMMARY` is set, append the same content as markdown.
8. Return 1 if there were any resolve, vendor or consistency errors, otherwise 0.

- [ ] **Step 1: Write the failing tests.** Use `--root` as a temp folder containing a config
  file that imports `scripts/types.ts` by absolute path, plus fixture repos.
  - `end-to-end: new plugin gets locked, vendored, and listed in all catalogs`
  - `second run with no upstream change modifies no files`: compare the mtimes and contents of
    every file under the root
  - `new upstream tag updates lock, vendor and catalogs`
  - `one broken plugin returns 1 but others are still written`
  - `config error returns 2 and writes nothing`
  - `message file lists changes and errors`

- [ ] **Step 2: Run `npm test`.** Expected: the new tests FAIL.

- [ ] **Step 3: Implement `scripts/update.ts`.**

- [ ] **Step 4: Run `npm test`, then `node scripts/update.ts`** on the real repo.
  Expected: PASS. The real repo then has `plugins.lock.json` containing `{"plugins": {}}`, and
  nothing else changes.

- [ ] **Step 5: Commit**

Message: `feat: update orchestration`.

---

### Task 6: Workflows and plugin-repo snippet

**Files:**

- Create: `.github/workflows/update.yml`
- Create: `docs/plugin-repo-release-workflow.yml`
- Modify: `.github/workflows/check.yml`

`update.yml`:

- Triggers:
  - `workflow_dispatch`, with inputs `repo` and `tag`, both optional strings
  - `schedule: cron '23 9 * * *'`
  - `push: branches [main], paths [marketplace.config.ts]`
- `concurrency: { group: plugin-update, cancel-in-progress: false }`
- `permissions: contents: write`
- Steps:
  1. checkout
  2. `setup-node` 22
  3. `node scripts/update.ts --message-file "$RUNNER_TEMP/msg"`, capturing the status:
     `set +e; …; echo "status=$?" >> "$GITHUB_OUTPUT"`
  4. `npx -y @anthropic-ai/claude-code plugin validate .`
  5. If `git status --porcelain` is non-empty:
     - set the committer to `github-actions[bot]`
       (`41898333+github-actions[bot]@users.noreply.github.com`)
     - `git add -A`
     - `git commit -F "$RUNNER_TEMP/msg"`
     - `git push`
  6. Last step: `exit` with the captured status.

`check.yml`: add `npm test` before the freshness check.

`docs/plugin-repo-release-workflow.yml`:

- Runs on `push: tags: ['v*.*.*', '[0-9]*.[0-9]*.[0-9]*']`.
- Steps:
  1. `actions/create-github-app-token@v2`, with
     - `app-id: ${{ vars.MARKETPLACE_APP_ID }}`
     - `private-key: ${{ secrets.MARKETPLACE_APP_PRIVATE_KEY }}`
     - `owner: <marketplace owner>`
     - `repositories: plugin-marketplace`
  2. `gh api -X POST repos/<owner>/plugin-marketplace/actions/workflows/update.yml/dispatches -f ref=main -f "inputs[repo]=${{ github.repository }}" -f "inputs[tag]=${{ github.ref_name }}"`,
     with `GH_TOKEN` set from the token step.
- Put a header comment naming the two settings, saying the App needs **Actions: Read and write**
  only, and saying to edit `<owner>`.

- [ ] **Step 1: Write the three files.**

- [ ] **Step 2: Validate the YAML.** Run
  `node -e` with a tiny check, or `python3 -c "import yaml…"` if PyYAML is present. Otherwise
  look for tab characters and check that `on:` keys parse. Expected: no errors.

- [ ] **Step 3: Commit**

Message: `ci: release-tag update workflow and plugin-repo dispatch snippet`.

---

### Task 7: Docs, config examples, final verification, push

**Files:**

- Modify: `AGENTS.md`
- Modify: `marketplace.config.ts`

`marketplace.config.ts`: the examples become unpinned (no `ref`/`sha`). Add one commented
override example with the comment `// hold back: must be a tag or sha, never a branch`.

AGENTS.md:

- Layout table: add `plugins.lock.json`, `vendor/`, `scripts/update.ts`, `update.yml`, `tests/`.
- Generator section:
  - replace `--out` with `--root`
  - add `npm test` and `npm run update`
  - update the source-mapping table: Cursor now lists vendored copies, and catalogs carry the
    locked `ref`+`sha`
- New "Releases and updates" section:
  - release tags are required (`vX.Y.Z` or `X.Y.Z`)
  - the moved-tag refusal, and how to accept a moved tag (delete the lock entry)
  - one-time App setup: Actions: Read and write only; `MARKETPLACE_APP_ID` and
    `MARKETPLACE_APP_PRIVATE_KEY` in each plugin repo; copy `docs/plugin-repo-release-workflow.yml`
  - only public plugin repos are supported
  - a config-only commit is briefly red until the bot commits
- Cursor section: copies replace submodules. Cite the Cursor forum gap and
  anthropics/claude-code#33164.

Steps:

- [ ] **Step 1: Apply the doc and config edits.**

- [ ] **Step 2: Run the full verification:**
  `npm test && npm run typecheck && node scripts/build.ts --check && claude plugin validate .`.
  Expected: all pass, with only the "no plugins defined" warning.

- [ ] **Step 3: Commit and push to `main`.**
  Message: `docs: release-tag sync usage and setup`, then `git push origin main`.

- [ ] **Step 4: Run the update workflow once and check it.** Trigger it manually through the
  GitHub MCP `actions_run_trigger` tool, then read the result with `actions_get`. Expected: the
  run succeeds and commits nothing.
