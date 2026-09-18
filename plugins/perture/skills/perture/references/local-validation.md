# Local validation transport

The bundled validator is `scripts/local-validator.js`. Source inspection stays
local. Rendered verification uses the repository's existing Playwright runtime
only against a loopback URL; it does not install packages or visit a remote URL.

Resolve the script relative to this skill directory. Do not assume a global
`perture` executable is installed.

## Contract transport

Take `frontend_contract` from the `prepare_ui_change` result and send exactly
one JSON document to the validator over standard input. Never place the JSON,
credentials or signed asset URLs in shell arguments or terminal output.

If the host cannot stream standard input, write the contract to a uniquely
named operating-system temporary file with access limited to the current user,
pass it through `--contract`, then remove it immediately after both commands.
Never write it inside the repository or commit it.

## Repository inspection

Run before editing:

```text
node <skill-directory>/scripts/local-validator.js inspect --contract-stdin --cwd <repository-root> --json
```

Require the returned `brand_contract.contract_version` to match the embedded
Brand Contract V2. Treat a truncated scan as incomplete coverage.

## Source check

Run after implementation or during Review:

```text
node <skill-directory>/scripts/local-validator.js check --contract-stdin --cwd <repository-root> --files <comma-separated-relative-files> --url <loopback-url> --object-report <repository-relative-json> --json
```

When `interface_system_gate.required` is true, first call
`validate_interface_system_usage`, save its exact JSON result to a uniquely
named operating-system temporary file, and add:

```text
--interface-system-validation <temporary-validation-result.json>
```

The validator checks that the receipt belongs to the current contract and that
every declared component is actually imported and rendered through its
verified implementation target in the checked source. For imported Figma
components it also hashes every official artifact file and compares the bytes
with the immutable hashes returned by `get_interface_component_implementation`.
Creating a new file with the expected path/export or copying the component ID
does not pass. It also compares semantic roles in source and rendered DOM with
the role-specific approved component IDs. A native button cannot be covered by
declaring a card, and a source import alone cannot pass when the component is
absent from the checked rendered route. It writes the signed,
sanitized result to `verification_report.coverage.interface_system`. Missing
validation, zero usage, or a declaration without source evidence is an Error.
Delete the temporary file immediately after the check.

When no explicit file scope exists, `check` uses the current tracked and
untracked git diff. Use `--all` only when the user authorized a repository-wide
review.

The source check reruns Repository Intelligence so component, token, icon and
coverage findings use the same repository state as the deterministic pass.

The object report must contain every ID from
`brand_contract.governance.objects`. Each item is
`{"object_id":"...","applicable":true|false,"applied":true|false,"evidence":"..."}`.
Always-applicable objects must be applicable and applied. Contextual and
when-used objects can be inapplicable only when the evidence explains why.

The rendered pass requires Playwright already installed in the target
repository. It checks desktop `1440x960` and mobile `390x844` at device scale
factor `2`. Absence of `--url`, Playwright, the object report or any governed
object leaves the combined report `not_verified`.

Exit codes are:

- `0`: inspection supported/best-effort, or check passed with complete
  coverage and no Errors;
- `1`: unsupported repository, incomplete check coverage or Error findings;
- `2`: invalid input, inaccessible files or validator failure.

Always parse the JSON rather than relying only on the exit code.

## Automatic repair

Automatic repair is available only in an explicitly authorized Build or Fix
mode. It requires an explicit frontend file scope and an explicit selection:

```text
node <skill-directory>/scripts/local-validator.js fix --contract-stdin --cwd <repository-root> --files <comma-separated-relative-files> --finding-ids <comma-separated-current-ids> --json
```

Use `--all-safe` instead of `--finding-ids` only when the user authorized every
safe Perture repair in that file scope. Never pass both. `--all` and implicit
git-diff scope are refused for repairs.

The first call is a dry run and returns `repair_preview`. Inspect `repairs`,
`planned_changed_files`, `blockers`, the before/after counts and every skipped
reason. To apply the exact current preview, rerun against the same current
contract and source with `--apply`:

```text
node <skill-directory>/scripts/local-validator.js fix --contract-stdin --cwd <repository-root> --files <comma-separated-relative-files> --finding-ids <comma-separated-current-ids> --apply --json
```

The fixer fails closed on incomplete Repository Intelligence, source changes,
out-of-scope paths, symlinks, overlapping edits, ambiguous approved values and
predicted error regressions. It rechecks the complete authorized scope after an
applied pass. A nonzero exit can still contain a valid partial-repair JSON
report, so parse `outcome`, `applied`, `complete`, `repairs` and `blockers`.

Do not send the repair report to Perture: it contains local current and
replacement values. Only an applied pass exposes a sanitized
`verification_report`, which remains the sole allowed input to
`verify_ui_change.report`.

Protocol `1.3` findings include `severity`, `category`, `kind`, optional
`brand_rule_id`, location, local `current_value`/`expected_value`, `fixable`,
message and repair guidance. `error` means a deterministic hard-rule or
approved-value violation. `warning` is contextual. `suggestion` is optional and
does not make `passed` false.

Require `coverage.completeness: complete`,
`coverage.repository_intelligence: ready`, empty
`coverage.brand_objects.unverified` and `rendered.status` of `verified` or
`verified_with_warnings` before using a verified status. Empty scope,
truncated inspection, missing object applicability, absent rendered evidence,
unsupported repositories and best-effort stacks remain `not_verified`, even
with zero Errors.

## Privacy before MCP verification

The local check may include short `evidence` values to guide local repairs. Do
not send these excerpts to Perture. The JSON output includes a
`verification_report` object that is already limited to:

- `protocol_version`;
- `contract_version`;
- `passed`;
- `files_checked`;
- sanitized `coverage` labels and rule IDs;
- sanitized rendered status, viewport metrics and category counts;
- each finding's `id`, `rule_id`, `brand_rule_id`, `severity`, `category`,
  `kind`, `file`, `line`, `column`, `message`, `fixable` and `suggestion`.

Pass only `verification_report` to `verify_ui_change.report`. It omits
`evidence`, `current_value`, `expected_value` and all additional source, diff
and repository metadata. This remote call records a Perture Log; it does not
authorize source upload.

If the script, Node.js or files are unavailable, return `not_verified`. Agent
judgment may still provide labeled contextual guidance, but it cannot replace a
required deterministic result.
