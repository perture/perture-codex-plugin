# Perture for Codex

Official public source for the Perture Design Agent package for Codex.

The package combines Perture's authenticated remote MCP server with a local
Build/Review/Fix skill, repository inspection, deterministic source checks and
rendered desktop/mobile validation. Version `0.8.6` requires Frontend Contract
protocol `1.3` and fails closed when an approved Interface System component is
missing, unavailable or bypassed by a hand-built control. Its `interface-evidence.v1`
protocol and signed `isv3` receipt bind source, component instances, rendered pixels,
route, commit and build. A changed source, artifact or build invalidates approval.

The package contains no credentials, customer data or private brand rules.
Repository source remains local; protected brand context and authorization
remain on Perture infrastructure.

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
