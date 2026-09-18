# Build mode

Use this mode only for a user-authorized frontend implementation or change.

## Before editing

1. Confirm that the shared MCP gate completed: `list_brands`,
   `set_active_brand` and `prepare_ui_change` all succeeded, and retain the
   selected `brand_id`, `brand_lock_token`, `change_id` and contract version.
   If any required tool is unavailable, stop before editing instead of using a
   repository-only fallback without explicit user authorization.
   Require Frontend Contract schema/protocol `1.3`, its
   `runtime_compatibility` handshake and the top-level
   `interface_system_gate`. An older response, a missing gate, or an empty
   component list produced from a preserved/external Interface System is a
   blocking runtime mismatch, not authorization to hand-build controls.
2. Resolve the requested route, component and file scope. Inspect current git
   state and preserve unrelated work.
3. Run Repository Intelligence using the returned Frontend Contract.
4. If `interface_system_gate.required` is true, select the eligible approved
   Interface System components that implement the requested controls and
   structure. Cover every semantic role listed in
   `applicability_requirements`; an approved component from another role does
   not count. Use their verified implementation targets; do not substitute a
   newly styled native element or parallel component. For every selected Figma
   component, call `get_interface_component_implementation`, add every returned
   path to the authorized file scope and write the returned contents exactly.
   Do not edit those files. A missing artifact is a blocking Interface System
   gap, not permission to create a local substitute at the same path.
5. Create a short internal implementation plan containing:
   - selected brand and contract version;
   - authorized scope;
   - detected framework and styling system;
   - relevant hard rules and approved assets;
   - existing components, tokens and layout primitives to reuse;
   - proposed files and checks;
   - best-effort or unverified coverage.

Show the plan only when the user requested it, a hard-rule conflict exists, or
an unresolved choice would materially change the result.

## Implementation

- Make the smallest coherent patch inside the authorized scope.
- Reuse compatible project primitives before creating a component.
- Add a new primitive only when the repository inventory lacks a compatible
  one or reuse would cause a concrete architectural or behavioral problem.
- Derive important visual decisions from the Brand Contract, compatible project
  tokens/patterns or explicit user instruction. Do not add generic AI-style
  decoration by default.
- Preserve routing, data flow, permissions, interaction behavior and content
  meaning unless the user explicitly changes them.
- When Perture is silent, follow the repository and label consequential
  inference in the final report.

## Review and repair loop

Read `frontend_contract.agent_behavior` before starting this section.

The Interface System gate is mandatory even when automatic review is disabled.
After implementation, build the complete `interface_usage_manifest`, call
`validate_interface_system_usage`, save the exact successful result to a
temporary file, and pass it to the bundled validator with
`--interface-system-validation`. Remove that temporary file after the check.
If zero instances are declared or the validator cannot find each declared
component through its verified implementation target in source, report an
Error and do not claim Perture compliance. The same applies when source or DOM
contains a button, input, navigation, overlay or feedback instance that bypasses
an approved component assigned to that role, or when a declared component is
not present on the checked rendered route.

- If `automatic_reviews` is false, stop after the implementation and relevant
  functional checks. Do not run a post-build local check or call
  `verify_ui_change` automatically. A separate explicit Review or Fix request
  starts its own prepared mode.
- If `automatic_reviews` is true and `automatic_corrections` is false, run the
  local check and verification, but report findings without invoking the fixer.
- If both are true, follow the full loop below.

1. Run the returned local check on every changed frontend file.
2. Evaluate and record applicability for the complete governed-object inventory,
   then run the rendered check on the affected loopback route in both required
   viewports. Source-only evidence cannot complete this loop.
3. When `local_fix` is returned, select only deterministic, fixable candidate IDs created or exposed by the
   scoped work. Preview them with the bundled `fix` command before mutation.
4. Inspect the preview's replacements and blockers. Add `--apply` only when all
   planned changes preserve behavior and remain inside the authorized scope.
5. Re-run the complete source, governed-object and rendered check after each applied repair pass. Do not submit a
   dry-run or predicted report as verification evidence.
6. Call `verify_ui_change` with only the applied pass's sanitized
   `verification_report`.
   If the tool is unavailable, stop the review loop and keep Perture status
   `not_verified`; passing local checks alone are not a Perture verification.
7. If verification passes with complete coverage, stop. Report Warnings and
   Suggestions separately and preserve every unverified category.
8. Do not call `submit_work` unless separately
   requested.
9. If the attempt limit is reached or a safe fix is not clear, stop and report
   the remaining item instead of broadening the edit.

An explicit current request to Review or Fix overrides the corresponding
automatic default, but never expands file authorization. Revalidate after every
applied correction even when automatic reviews are otherwise disabled.

Run relevant existing functional checks when practical. Report them separately
from brand verification.
