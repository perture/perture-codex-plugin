# Perture AI Coding Plugin

This is the Perture thin-client plugin for Codex and Claude Code.

The plugin does not include Perture know-how. Its preferred local adapter calls
the versioned Perture Integration Gateway; the remote MCP server remains a
compatibility path for clients that have not adopted the gateway yet. Brand
rules, memory, performance logic, validation, permissions, and entitlements
stay on `https://app.perture.co`.

For frontend work, the remote server compiles a versioned frontend contract.
The agent runs `perture check` against changed repository files, sends the
deterministic report back through `verify_ui_change`, and only then submits the
Work. The plugin still contains no customer rules or scoring logic.

## What It Contains

- Codex manifest in `.codex-plugin/plugin.json`.
- Claude Code manifest in `.claude-plugin/plugin.json`.
- Remote MCP config in `.mcp.json`.
- Gateway adapter in `scripts/perture-integration.mjs`.
- Codex lifecycle hook in `hooks/hooks.json` that delivers only correction
  requests explicitly created by the user in Perture Logs.
- Minimal skill in `skills/perture/SKILL.md`.
- Public Perture icon/logo assets.

## What It Does Not Contain

- Proprietary prompts.
- Brand scoring logic.
- Client-side rule engine.
- Client-side asset or rules generation code.
- API keys or bearer tokens.
- Customer project data.

## Runtime Model

```text
Codex or Claude Code
  -> Perture plugin adapter
  -> Integration Gateway v1
  -> https://app.perture.co
  -> server-side auth, permissions, memory, and validation

Legacy MCP clients may still use `.mcp.json`; they do not change the gateway
contract.
```

Treat the plugin as visible client code. The Perture backend is the security
authority for every request.

## Manual Corrections

Clicking **Send to coding agent** in Perture creates a platform-neutral pending
request. The first connected coding agent in the matching repository can claim
it. In Codex, the trusted plugin hook performs that check on the next session
start or user prompt and adds the problem, findings, files, contract, and
completion protocol to context. The hook never creates correction requests and
never starts a model turn while Codex is idle.

## Authentication

For the gateway adapter, set the token only in the local environment:

```bash
PERTURE_ACCESS_TOKEN=pto_...
```

Use `PERTURE_INTEGRATION_PLATFORM=claude-code` when running the same adapter
from Claude Code. A gateway token must be issued for the corresponding client
ID and the `/api/integrations/v1` audience. Tokens issued only for `/mcp` are
rejected by the gateway.

Do not put tokens, API keys, brand rules, prompts, or customer data in this
plugin.
