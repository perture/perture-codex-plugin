---
name: perture
description: Build, review, or safely fix React and Next.js frontend interfaces against a connected Perture brand. Use when the user invokes Perture or explicitly asks for the connected brand to govern frontend work; do not activate for unrelated general design requests.
---

# Perture Design Agent

Use Perture as the source of brand intent and the local repository as the source
of implementation context. Preserve the user's product behavior, content,
permissions and chosen architecture.

## Select one mode

- **Build**: the user asks to create or change frontend UI. Read
  [references/build.md](references/build.md).
- **Review**: the user asks whether existing UI follows the Perture brand. Read
  [references/review.md](references/review.md). Repository access stays
  read-only.
- **Fix**: the user asks to repair Perture findings. Read
  [references/fix.md](references/fix.md).

Build includes a scoped post-build review only when `automatic_reviews` is
enabled in the returned account behavior. Its safe repair loop also requires
`automatic_corrections`. Do not treat either automation as authorization for
unrelated cleanup. If the request is ambiguous between Review and Fix, begin
with Review and obtain authorization before any edit.

For every mode that runs deterministic checks, read
[references/local-validation.md](references/local-validation.md) before running
the bundled validator.

## Shared workflow

1. Call `list_brands` and resolve the exact requested brand. If more than one
   brand could match, ask the user which one to use. Never ask the user to paste
   credentials or private brand rules.
2. Call `set_active_brand` with that brand and retain the returned
   `brand_lock_token`. Pass the selected `brand_id` and this token to every
   subsequent brand-specific MCP call in the task.
3. Call `prepare_ui_change` with `mode`, a concrete summary, the known file
   scope, route hint and detected framework. It returns the current Frontend
   Contract, embedded Brand Contract V2, local inspection/check commands and a
   `change_id`.
   Before editing, require `frontend_contract.schema_version` and
   `frontend_contract.protocol.version` to both equal `1.3`, require the
   `runtime_compatibility` handshake, and require the top-level
   `interface_system_gate`. If any is missing or older, stop with an
   incompatible Perture runtime error and reconnect/update the Perture MCP.
   Never interpret `components: []` from an older contract, an archived
   storage reference, or a missing gate as evidence that the brand has no
   Interface System. When eligible components exist, also confirm that
   `get_interface_component_implementation` and
   `validate_interface_system_usage` are callable before changing source.
   When `interface_system_gate.required` is true, this is a hard build gate:
   map the requested UI to the eligible approved components before editing,
   use their verified implementation targets, and do not recreate parallel
   controls or containers. Treat `applicability_requirements` as semantic
   coverage, not a menu: if the output renders a button, input, navigation,
   overlay or feedback role that has approved component IDs, every instance of
   that role must originate from one of those IDs. Using an unrelated approved
   component never satisfies the missing role. For every selected Figma component, call
   `get_interface_component_implementation` before editing and write every
   returned artifact file byte-for-byte at its declared path. Never hand-build
   a file at the declared import path, edit the returned artifact, or treat an
   import path, export name, component ID or usage manifest as implementation
   evidence. If the artifact is unavailable, stop and report the Interface
   System gap instead of approximating the component. After implementation, create one
   `interface_usage_manifest` entry per used instance, call
   `validate_interface_system_usage`, and keep its exact successful JSON result
   in a temporary local file for the bundled source check. Zero usages, a stale
   receipt, or a component declared without its verified import and rendered
   source usage is an Error, never merely unverified coverage. Native semantic
   controls that bypass an applicable approved component are also Errors.
4. Read `frontend_contract.agent_behavior` and apply exactly these account
   defaults:
   - `automatic_corrections`: in Build, use the fixer only when this is true;
   - `automatic_reviews`: in Build, start the post-build check and verification
     only when this is true;
   - `logs`: the server persists preparation and verification history only when
     this is true.
   An explicit instruction in the current user request overrides automation:
   explicit Review and Fix still run even when their automatic defaults are
   off. Any correction that is actually applied must be revalidated once; this
   safety invariant is not a separate user setting.
5. Run the bundled repository inspection locally before editing. Keep source in
   the checkout and pass the returned Frontend Contract over standard input.
6. Respect `agent_readiness`:
   - `ready`: continue within Tier 1.
   - `best_effort`: continue only with the reported limitations and never claim
     full verification for unsupported checks.
   - `not_ready`: do not claim Perture verification; explain the missing or
     unsupported evidence before proceeding.
7. Apply this conflict order:
   1. explicit current user instruction;
   2. Perture hard rules and approved assets;
   3. compatible existing project components and tokens;
   4. Perture soft guidance;
   5. existing repository patterns;
   6. disclosed agent inference.
8. Run the local source check when Review or Fix was explicitly requested, or
   when Build returns `local_check`. In Build, invoke the bundled fixer only
   when `local_fix` is returned. Explicit Fix may return `local_fix` even when
   automatic corrections are disabled. Review never invokes the fixer.
9. Evaluate every item in `brand_contract.governance.objects`. Create a local
   JSON object report with one entry per exact object ID: `object_id`,
   `applicable`, `applied` and concrete `evidence`. `always` objects cannot be
   marked inapplicable. A contextual or when-used object may be inapplicable,
   but only with an explicit evidence-based reason. Do not omit voice, copy,
   output rules, imagery, icon library, component anatomy, layouts, grids,
   typography metrics or logo constraints merely because another object is
   easier to check.
   Resolve each object's complete value from its exact `source_path`; use
   `available_fields` as the inventory of authored information that must be
   considered. Do not reduce typography to only family and weight, colors to
   only hex values, or assets to only URLs when the contract provides metrics,
   behavior, delivery metadata, usage rules or forbidden transformations.
   A section with `status: archived` or `agent_access: preserved_only` is kept
   for data continuity but is not an active rule source, must not be applied and
   must not be reported as a missing active section.
10. Apply a repair preview only when every planned replacement is unambiguous,
   behavior-preserving and inside the authorized files. The `--apply` flag is
   the explicit local mutation boundary. Re-run the complete source check after
   every applied pass.
11. Run the returned rendered check against a loopback page at desktop and
   mobile with device scale factor 2. It is mandatory for a verified result and
   checks loaded fonts and exact typography roles, responsive overflow, palette,
   components, icon family and Unicode substitutions, raster sharpness,
   official logo usage, forbidden transformations, minimum size and clear
   space. A source-only result stays `not_verified`.
12. Keep detailed evidence and repair values local. Send `verify_ui_change` only
   the minimum `verification_report` produced after the final applied pass;
   its `coverage.interface_system` must come from the bundled validator after
   it consumes the exact signed validation result;
   omit source excerpts, current values and replacement values.
13. Treat `passed: true` as brand verification only when source coverage,
   rendered coverage and the full governed-object inventory are complete,
   `coverage.completeness` is `complete` and Repository Intelligence is
   `ready`. Warnings produce `verified_with_warnings`; Suggestions are optional
   improvements and never count as violations. Keep every item in
   `coverage.unverified` visible in the result.
14. Stop after the contract's maximum attempts. A stale contract requires a new
   `prepare_ui_change` and fresh local inspection/check, not reuse of the old
   result.

## Required remote gate

When Perture is expected to govern the current task, do not edit frontend code
until `list_brands`, `set_active_brand` and `prepare_ui_change` have all
succeeded. A discovered brand name or repository asset is not a substitute for
an active brand lock and a current Frontend Contract.

If one of these tools is missing, unavailable or rejects the request:

- stop the Perture-governed workflow before editing;
- name the blocked tool and report code-level brand status as `not_verified`;
- do not silently fall back to repository tokens, copied assets or inferred
  rules; and
- continue as a repository-only implementation only after the user explicitly
  authorizes that fallback with the limitation disclosed.

When an explicit Review or Fix is requested, or Build has
`automatic_reviews: true`, `verify_ui_change` is also required. If it is
unavailable, keep the result `not_verified`, report the completed local checks
separately and stop the Perture review loop.

`prepare_ui_change` and `verify_ui_change` record Perture Logs only when the
account's `logs` setting is enabled. In Review mode, state this conditional
external side effect before the first such call. If the user requires strictly
no external writes, use read-only brand context only, do not call those tools,
and report deterministic code-level status as `not_verified`.

## Hard boundaries

- Do not deploy, publish, submit to a marketplace, create a pull request, or
  call `submit_work` unless the user explicitly requests that separate action.
- Do not upload repository source, diffs, secrets or full local findings to
  Perture.
- Do not invent missing brand rules or upgrade inference into a Perture rule.
- Do not introduce a second component library, token system, icon package or
  styling architecture when compatible project primitives exist.
- Do not recreate a Figma Interface System component. Only the immutable files
  returned by `get_interface_component_implementation` count as its official
  implementation; wrappers may compose those exports but must not replace or
  restyle their internal visual contract.
- Do not claim screenshot, rendered, responsive or runtime verification from
  source-only checks.
- Do not claim functionality passed unless relevant project checks actually ran
  and passed.
- Do not use unsupported frameworks as evidence for `verified` status.

## Required result

End every mode with this evidence boundary, compacted to the task:

```text
Perture result

Code-level brand status: verified | verified_with_warnings | not_verified
Scope checked: <files or route>
Errors: <count>
Warnings: <count>
Suggestions: <count>
Rendered visual fidelity: verified | verified_with_warnings | not_verified
Functional checks: passed | failed | not_run

Changed:
- <scoped summary, or "No files changed" for Review>

Remaining:
- <unresolved and unverified items>
```

Errors and warnings must cite a rule and concrete local evidence. Keep finding
severity separate from verification coverage. Zero findings does not by itself
prove visual fidelity.
