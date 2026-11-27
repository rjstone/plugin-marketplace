# plugin-marketplace
For coding agent plugin “marketplace” metadata for all of my plugins. One-stop shop.

## Plugins

Add the marketplace once (Claude Code, at the prompt of a terminal session):

```
/plugin marketplace add rjstone/plugin-marketplace
```

| Plugin | Harness | What it does | Install |
| --- | --- | --- | --- |
| [custom-compaction](https://github.com/rjstone/custom-compaction-plugin) | Claude Code | Replaces the built-in compaction with a configurable summarizer (the session's model or any OpenAI/Anthropic-format endpoint) | `/plugin install custom-compaction@rjstone` |

Each entry points at the plugin's own repo, pinned to its latest release tag. Options for an
installed plugin go in `settings.json` under `pluginConfigs["<plugin>@rjstone"]` (see each plugin's
README). How the catalogs are built and updated: [AGENTS.md](AGENTS.md).
