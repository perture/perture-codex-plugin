# Local gateway adapter

Run this file from the local plugin checkout:

```text
node scripts/perture-integration.mjs --operation list-brands
node scripts/perture-integration.mjs --operation context --brand <brand-id>
```

Set `PERTURE_INTEGRATION_PLATFORM=claude-code` for Claude Code. Keep the token
in the process environment only. This adapter calls explicit gateway routes
and never prints the token.
