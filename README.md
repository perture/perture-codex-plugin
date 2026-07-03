# Perture Codex Plugin Marketplace

Private Codex marketplace for the Perture thin-client plugin.

This package is intentionally small. It does not contain Perture prompts, scoring,
brand-rule logic, validation logic, or local generation code. The plugin only
registers a remote Perture MCP server and short usage guidance. All privileged
work runs on `https://app.perture.co`.

## Structure

```text
.agents/plugins/marketplace.json
plugins/perture/
  .codex-plugin/plugin.json
  .mcp.json
  assets/
  skills/perture/SKILL.md
  README.md
```

## Local Test

From the parent directory:

```bash
codex plugin marketplace add ./perture-codex-plugin
```

Then open Codex, go to **Plugins**, choose **Perture Private**, and install
**Perture**. Start a new thread after installing.

## Private GitHub Distribution

After this folder is pushed to a private GitHub repository under the official
Perture organization, beta users can install the marketplace source:

```bash
codex plugin marketplace add git@github.com:perture/perture-codex-plugin.git --ref v0.1.0
```

They can then install **Perture** from the Codex plugin directory.

## Authentication

The plugin points Codex at `https://app.perture.co/mcp`. If the Codex MCP
connection handles OAuth, users should connect with their Perture account during
plugin setup. For local fallback testing only, set:

```bash
PERTURE_ACCESS_TOKEN=pto_...
```

Do not put tokens, API keys, brand rules, prompts, or customer data in this
repository.
