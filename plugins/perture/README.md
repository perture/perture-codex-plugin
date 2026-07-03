# Perture Codex Plugin

This is the Perture thin-client plugin for Codex.

The plugin does not include Perture know-how. It registers the remote Perture MCP
server and gives Codex a short workflow instruction. Brand rules, memory,
performance logic, validation, permissions, and entitlements stay on
`https://app.perture.co`.

## What It Contains

- Codex manifest in `.codex-plugin/plugin.json`.
- Remote MCP config in `.mcp.json`.
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
Codex
  -> Perture plugin manifest
  -> Perture remote MCP server
  -> https://app.perture.co
  -> server-side auth, permissions, memory, and validation
```

Treat the plugin as visible client code. The Perture backend is the security
authority for every request.
