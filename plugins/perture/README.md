# Perture for Codex

This is the Perture thin-client package for Codex.

The standalone adapter calls the versioned Perture Integration Gateway and is
bound to the `codex` platform by default. The remote MCP server remains a
compatibility path for clients that have not adopted the gateway. Brand rules,
memory, validation, permissions, and entitlements remain server-side on
`https://app.perture.co`.

## Contents

- Codex manifest in `.codex-plugin/plugin.json`.
- Compatibility remote MCP config in `.mcp.json`.
- Standalone gateway adapter in `scripts/perture-integration.mjs`.
- User-requested correction delivery hooks in `hooks/`.
- Minimal operating guidance in `skills/perture/SKILL.md`.
- Public Perture icon and logo assets.

The correction hook only checks for work the signed-in user explicitly sent to
a coding agent. It does not create requests, start idle model turns, deploy,
publish, or authorize unrelated changes.

The package contains no API keys, bearer tokens, customer data, proprietary
prompts, scoring rules, or local authorization logic.

## Authentication

Set the token only in the local environment:

```bash
PERTURE_ACCESS_TOKEN=pto_...
```

The token must be issued for the Codex gateway client and
`/api/integrations/v1` audience. A token issued only for `/mcp` is rejected
by the gateway.

The gateway URL is a release target and does not prove that the matching app
release has already been deployed.
