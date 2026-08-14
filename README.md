# Perture for Codex

Official public source for the Perture thin connection package for Codex.

The package registers Perture's authenticated remote MCP server and a minimal
user-approved-work reminder. It contains no credentials, customer data,
business rules, scoring, prompts, validators, request clients, or proprietary
implementation logic.

## Install for testing

Clone this repository, then add the local marketplace from its parent folder:

```text
codex plugin marketplace add ./perture-codex-plugin
```

Open the Plugins directory, choose the `Perture` source, install `Perture`, and
complete the browser sign-in when Codex requests authorization.

The public Plugins Directory listing is submitted separately through OpenAI's
review portal. All protected behavior remains on Perture infrastructure and is
authorized on every request.
