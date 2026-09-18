# Fix mode

Use Fix only after explicit authorization to change code.

An explicit Fix request runs even when automatic corrections are disabled;
that setting controls unsolicited post-Build repair, not the user's current
authorization. Every applied correction still requires a complete revalidation
pass.

## Establish the baseline

- Reuse Perture findings already present in the current conversation only when
  their contract and repository versions are still current.
- Otherwise run Review first, keeping the repository read-only until findings
  exist.
- Record the before counts and identify the exact authorized files.
- Call `prepare_ui_change` with `mode: "fix"` before the first edit.

## Safe automatic fixes

A finding is automatically fixable only when it identifies a concrete file and
rule, the replacement is deterministic or narrowly bounded, behavior and
content meaning remain unchanged, and the file is inside the authorized scope.
`fixable: true` confirms only that the validator found a bounded candidate; it
does not expand the user's authorized files or permit an ambiguous replacement.

Use the bundled repair protocol instead of editing from a message alone:

1. pass the current explicit file scope and either current finding IDs or
   `--all-safe` to `local-validator.js fix`;
2. omit `--apply` for the mandatory dry-run preview;
3. inspect every planned replacement and skipped reason;
4. add `--apply` only when the preview has complete Repository Intelligence,
   no blockers and no semantic choice hidden inside the replacement; and
5. treat only the applied pass's `verification_report` as remote verification
   input.

The fixer can replace spacing/radius literals with the nearest approved value.
It may replace color, family or weight only when the contract leaves exactly
one approved choice and the source value is exact. Multiple valid colors,
typefaces, weights, expiring asset URLs, component substitutions and
alpha-bearing colors remain manual decisions.

Typical candidates include approved token substitution, font-family
correction, spacing/radius replacement, approved asset replacement and reuse of
an existing component when the mapping is unambiguous.

Ask for focused approval or leave the finding unresolved when a change would:

- delete or broadly replace components;
- restructure major layout or content hierarchy;
- change product behavior, data flow, permissions or routing;
- migrate styling or design-system architecture;
- affect files outside the authorized scope; or
- require choosing among ambiguous component or asset alternatives.

## Repair loop

1. Preview only the selected safe candidates.
2. Apply only the reviewed preview inside the authorized files.
3. Run the complete source, governed-object applicability and loopback rendered
   check on every changed frontend file and affected route.
4. Run relevant functional checks when available.
5. Call `verify_ui_change` with the sanitized post-apply report.
6. Require complete coverage before reporting the repaired scope as verified.
7. Repeat only within the contract's maximum attempts.
8. Stop on stale contract, failed tooling, unsupported coverage or an unsafe
   remaining finding.

Report before and after counts. Never convert a warning into an error merely to
justify a fix, and never claim functionality was preserved unless relevant
functional checks passed.
