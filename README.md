# Perture for Codex

Official public source for the Perture Design Agent package for Codex.

The package combines Perture's authenticated remote MCP server with a local
Build/Review/Fix and Pro Brand Editor skills, repository inspection, deterministic source checks and
rendered desktop/mobile validation. The current package requires Frontend Contract
protocol `1.3`. Applicable approved Interface System components must use their
official implementation. Structural or content roles without an approved component
can be composed from compatible project primitives and brand tokens, but remain
unverified by the Interface System. Its `interface-evidence.v1`
protocol and signed `isv3` receipt bind source, component instances, rendered pixels,
route, commit and build. A changed source, artifact or build invalidates approval.

An owner with an active Pro plan can ask the plugin to add or edit Brand Page
colors, typography, logos, fonts, illustrations, spacing and rounding. These
changes require an active brand lock and explicit user request. Reconnect an
existing Perture account after updating so the consent screen can grant the
new write scopes; existing read-only tokens do not gain them automatically.

The package contains no credentials, customer data or private brand rules.
Repository inspection remains local. Source files explicitly submitted for
remote code verification are sent to Perture; unrelated files remain local.
Protected brand context and authorization remain on Perture infrastructure.

## Install and update

Add the public marketplace:

```text
codex plugin marketplace add perture/perture-codex-plugin
```

Open the Plugins directory, choose the `Perture` source, install `Perture`, and
complete the browser sign-in when Codex requests authorization.

For an existing installation, refresh the marketplace and update Perture in the
plugin browser. Start a new chat to load the new version. Installation or opening
a tutorial does not by itself establish an authenticated account connection.

The public Plugins Directory listing is submitted separately through OpenAI's
review portal. All protected behavior remains on Perture infrastructure and is
authorized on every request.
