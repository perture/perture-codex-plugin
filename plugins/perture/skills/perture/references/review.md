# Review mode

Review is read-only with respect to the user's repository.

## Scope

- Use the files, component or route named by the user.
- If scope is implicit, use the current frontend diff when it is unambiguous.
- If neither the request nor repository state identifies a defensible scope,
  ask a focused question before claiming a review.

## Procedure

1. Tell the user that full Perture Review calls record preparation and
   verification events only when the account's Logs setting is enabled.
   Respect a request for no external writes by using read-only context and
   returning `not_verified` for the deterministic status.
2. Call `prepare_ui_change` with `mode: "review"` and the review scope.
3. Run Repository Intelligence and the local check without changing files.
4. Evaluate every governed brand object for applicability and record evidence.
   Run the required loopback rendered check; leave only genuinely unsupported
   or missing evidence unverified.
5. Treat duplicate or incompatible components, questionable hierarchy, layout
   consistency and semantic asset usage as warnings unless a hard rule proves
   an error.
6. Keep Suggestions separate from violations. They may recommend token reuse
   or another optional consistency improvement, but they do not downgrade a
   complete error-free review.
7. Call `verify_ui_change` with the sanitized report to check staleness and
   record the review. Ignore any submission path; Review never submits work.

Do not run formatters, codemods, dependency installers or commands that mutate
the checkout. Do not fix findings in the same mode. You may list which findings
appear safely fixable and wait for a separate Fix request.

An explicit Review request runs even when automatic reviews are disabled; that
setting controls post-Build automation, not the user's current instruction.

## Output

Report errors, warnings and suggestions with file/line evidence when available.
`Changed` must say `No files changed`. List unsupported categories and missing
brand fields under `Remaining` rather than silently omitting them.
