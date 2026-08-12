# Perture Codex Plugin Marketplace

Private source marketplace for the Perture thin-client plugin.

This release candidate adds the explicit Perture Integration Gateway v1 adapter
and keeps the remote MCP configuration as a compatibility fallback. It contains
no Perture prompts, scoring logic, customer rules, credentials, or customer
project data. Authentication, permissions, entitlements, memory, and validation
remain server-side on `app.perture.co`.

The gateway URL in this branch is a release target. This branch does not prove
that the corresponding Perture app release has been deployed, and it should not
replace the current compatible `main` package until that release is verified.

## Structure

```text
.agents/plugins/marketplace.json
plugins/perture/
  .codex-plugin/plugin.json
  .mcp.json
  assets/
  hooks/
  scripts/
  skills/perture/SKILL.md
  README.md
```

## Local test

From the parent directory:

```bash
codex plugin marketplace add ./perture-codex-plugin
```

Then open Codex, go to **Plugins**, choose **Perture Private**, and install
**Perture**. Start a new task after installing.

## Authentication

The compatibility MCP connection points to `https://app.perture.co/mcp`.
The gateway adapter points to
`https://app.perture.co/api/integrations/v1` and requires a token issued for
the Codex gateway client and audience. For local testing, keep the token only in
the process environment:

```bash
PERTURE_ACCESS_TOKEN=pto_...
```

Do not put tokens, API keys, brand rules, prompts, or customer data in this
repository.
