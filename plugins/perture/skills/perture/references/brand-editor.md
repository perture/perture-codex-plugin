# Edit a Perture Brand Page (Pro)

Use this workflow only when the account owner explicitly asks to change their
Brand Page. A connected plugin or an automatic review is not edit permission.

1. Call `list_brands`, resolve the requested brand, then call `set_active_brand`.
   Pass its `brand_id` and `brand_lock_token` to every Brand Page tool. Never
   copy another brand's assets into the active one without an explicit request.
   Call `get_brand_editor_capabilities` once for an editing task. It describes
   the live server's supported resources, operations, file limits and source
   boundaries. If a listed operation is absent from this chat's callable tools,
   report the stale host catalog; do not bypass MCP with a database, direct API
   or browser edit. This capability read is not part of ordinary output generation.
2. These tools are available only to the owner of an active Pro account. A new
   OAuth connection requests `brands:write` and `settings:write` on the consent screen. Existing
   connections may need to be removed and connected again. If tools are absent,
   explain the missing Pro plan or write authorization; do not use a different
   account or a direct database write to bypass the gate.
   Brand Page sections hidden by the owner are preserved but excluded from
   agent context and item lists. Do not edit an existing item in a hidden
   section. When the owner explicitly asks to add something there, call
   `list_brand_design_guidance`, use its `content_hash` with
   `show_brand_page_section` for the exact section, and then list existing
   items before creating anything. This prevents duplicates. A direct create
   request also reactivates the section after the server verifies its save;
   check `section_reactivated` or re-list `hidden_sections`. If reactivation
   is uncertain, reconcile the saved item before retrying.
3. For colors and typography, call `list_brand_page_items` for the resource.
   Use `create_brand_page_item` for a new record or `update_brand_page_item`
   with the exact `item_id` for an existing record. A new color needs a name
   and hex value. Typography uses `style_type` (`title`, `body`, `caption`).
   Item writes must return `verified: true` and a `snapshot_content_hash`;
   otherwise the Brand Page did not confirm the edit.
4. For a logo, font or illustration, use only the exact local file the user
   identified. `upload_brand_file` accepts its simple file name, correct MIME
   type and standard base64 content, up to 8 MiB. It returns a `file_id`; call
   `create_brand_page_item` with that ID to register the asset in the relevant
   Brand Page section. Never paste the base64 into a chat response or log.
   Icons, patterns, imagery and generic assets also
   accept typed uploads; read the draft and pass `expected_snapshot_content_hash`
   for these kinds. Files over 8 MiB use `manage_brand_file_upload`: begin with
   the declared byte size, SHA-256 and draft hash, append indexed chunks of at
   most 256 KiB using `index` and `expected_upload_revision`, then complete
   with the returned upload revision. The assembled limit is
   32 MiB. If the host cannot read the file or it exceeds 32 MiB, report that
   exact boundary. Upload sessions belong to this owner and brand and expire after
   30 minutes. Inspect status after an uncertain response; never start a second
   upload blindly. Upload completion registers a file, not a Brand Page item.
   To replace an existing logo, font or illustration file, upload the new file,
   read its editor item and the current draft, and call `replace_brand_item_file`
   with `resource`, `item_id`, `file_id` and `expected_snapshot_content_hash`.
   The item's ID, metadata and snapshot binding remain stable; old source files
   are retained for published releases. To delete an
   explicitly selected editor item, first read its ID and the draft hash,
   then call `delete_brand_page_item` with `resource`, `item_id` and
   `expected_snapshot_content_hash`. It removes the exact editor/snapshot
   item while preserving uploaded files. A reconciliation error requires a
   fresh read of both stores before retrying; never repeat blindly.
   For an image supplied only as a style or imagery reference, call
   `create_brand_illustration_reference` with that illustration `file_id`,
   `name`, and `reference_kind` (`style` or `imagery`). Add a specific
   `usage_instruction` when the user provides one. The server saves it as
   reference-only; do not use the image directly in generated work. Before
   uploading, list existing illustrations and avoid duplicates. Re-list after
   creation and confirm `reference_only: true` and
   `use_official_asset_directly: false` for the saved item.
5. For spacing or rounding, call `list_brand_design_guidance`. Then call
   `save_brand_design_measurement` with `kind: "spacing"` or `"radii"`, the
   exact `expected_content_hash`, and one measurement. Use an existing `id`
   to edit a preset or row. Omit `id` to create a custom row with `label` and
   `value` in pixels. A zero value is valid; use `null` only when the user
   explicitly wants to clear it. The server preserves the other Interface
   System fields and checks the saved result. If it returns a conflict, list
   guidance again and reconcile the user's intended change with the new
   values before retrying.
6. For profile copy, color behavior, grid, layout, voice, output rules or do/don't rules, call
   `get_brand_page_draft`, then `update_brand_page_draft` with its exact
   `snapshot_content_hash`. Patch only the requested fields. `voice` accepts a
   partial object; a supplied list replaces that complete list. `output_rule`
   edits one output type and preserves other types. `item_guidance` edits one
   existing color, logo, typography, asset or iconography item by snapshot ID.
   For a font's usage rule, select its snapshot ID from `draft.assets` and use
   `item_guidance: {resource: "assets", id, usage_rule}`. For iconography, the
   same patch accepts `style`, `stroke`, `weight`, `geometry`, `detail_level`
   and a typed partial `specification`; structured fields stay synchronized.
   Keep existing logo selection metadata and color Type metadata in any edited
   usage rule. For `grids` and `do_dont`, send the complete arrays with every
   existing ID and field; this tool does not delete rows. Edit name, category
   or main use case in a separate request so the snapshot and editor projection
   can both be checked.
7. For Interface System textual rules, call `list_brand_design_guidance`,
   then `save_brand_textual_rule` with the exact `content_hash`. Pass an
   existing rule ID to edit it or omit ID to add one. Re-list after each save
   to get the next hash before adding another rule.
   To author a component selection, read `interface_selection.components`
   in this guidance, then call `save_brand_interface_selection` with the
   current hash and `mapping: {component_id, variant, intent, framework,
   context: {background, surface?}}`. Select the exact approved component and
   variant for the requested semantic role; catalog similarity never creates
   a mapping. The tool preserves original code, rejects ambiguity and checks
   the resolver after saving. Re-list after each mapping.
   If a component's `source_authoring.status` is `verification_on_save`, an
   empty `verified_targets` cache does not block authoring. Submit the mapping
   directly: the server compiles an immutable implementation from the current
   complete Figma source, checks the selected variant and competing candidates
   for the same intent, and saves only the selection with a version check.
   Do not publish a preliminary release merely to populate this cache. Missing
   or unresolved exact source, failed compilation or ambiguous resolution
   blocks the save; report that failure instead of inventing a replacement.
   For an obsolete legacy logo, compare `draft.legacy_logo_inventory` with
   the editor logo list. `reconcile_brand_logo` requires `snapshot_logo_id`,
   `expected_snapshot_content_hash` and `action: "link"` or `"remove"`.
   A link also needs the exact `editor_logo_id`. Link only to the same durable
   source file, or remove only a
   specifically selected obsolete snapshot row; never invent replacement art.
8. If the user asks to change Perture agent behavior or Figma sync settings,
   call `get_perture_settings`, then `update_perture_settings` with only the
   requested boolean fields. Confirm the returned values. Billing, credentials,
   email and password are outside this workflow.
9. Read the affected resource or guidance again and report the saved values.
   A draft edit does not publish a Brand Release. When the user explicitly wants
   the saved guidance available to agents, call `publish_brand_release` using
   the exact current `snapshot_content_hash`; include the published release
   number when known. Read the output reference again after its verified publication.
   Do not claim that a draft edit changed an existing codebase.

All editing tools require the current brand lock. The server verifies Pro
ownership, OAuth scopes and the destination brand on each call.

## Complete resource editing

Use `list_brand_snapshot_items` before `manage_brand_snapshot_item` for
`grids`, `do_dont`, `iconography`, `imagery`, `patterns`, `assets`, legacy
`spacing`/`composition`, `brand_feel`, or typography metrics. The mutation
requires the exact `expected_snapshot_content_hash` and an explicit `action`:
`create`, `update`, `delete` or `reorder`. Updates use `item_id` and a scoped
`item`; ordering supplies every current ID exactly once in `ordered_ids`.
The existing draft array patch still preserves all rows; use explicit delete
instead of omitting a row from an array.

Use the resource's typed fields and same-brand `file_id` references. Never
submit a raw source URL as an editable replacement. Specifications for imagery
and iconography support their library, metrics, examples and rules. A projected
font/logo/illustration keeps its editor lifecycle: an `EDITOR_RESOURCE_REQUIRED`
error provides the exact resource, item IDs and tool to use. Do not delete its
snapshot projection to bypass an in-use check.

Typography snapshot editing accepts `font_size_px`, `line_height`,
`letter_spacing_em` and `fallback_family` and projects them into the existing
canonical typography metadata. Font binding, family and style registration use
the existing typography editor tools. Do not discard authored usage prose.

## Sections and guidance lifecycle

Read `list_brand_page_sections` before `manage_brand_page_section`.
`operation` is `show`, `hide`, `reorder`, `create`, `update` or `delete`, with
the current `expected_content_hash`. Create/update custom content through
`section: {title, description}`; existing operations identify `section_id`.
Reorder supplies the full `section_ids` inventory. Hiding preserves content;
hidden custom sections are archived separately and restored with their IDs,
metadata and order. Built-in section deletion archives the section. Only
explicitly deleting a custom section removes that custom record.

Use `manage_brand_design_guidance` with `operation: "delete"` or `"reorder"`,
`kind: "spacing" | "radii" | "textual_rules"`, and the current guidance hash.
Delete selects `item_id`; reorder supplies every `item_id` in `item_ids`.
Deleting a built-in measurement clears its authored value and relation fields
while retaining the preset ID; deleting a custom measurement or textual rule
removes that row. Existing save tools remain the add/edit path.

## Interface System authoring

Read `get_brand_interface_draft` for exact component/variant definitions,
governance, source boundaries and `content_hash`. Optionally scope the read to
`component_id` or include archived definitions. Use
`manage_brand_interface_system` with `expected_content_hash` and an `operation`
object whose `type` is one of:

- `create_component`, `update_component`, `delete_component`,
  `restore_component`, `reorder_components`;
- `create_variant`, `update_variant`, `delete_variant`, `reorder_variants`;
- `set_governance`, `unmap_selection`, `import_source`.

Use exact component IDs and variant names. New authored definitions start as
drafts. Design approval is separate from verified executable source and must
be explicitly requested. Changes reset review and executable claims as needed.
Never self-declare a verified target, immutable artifact or Figma provenance.
Captured Figma geometry is immutable: update it through a complete source
import using the normal capture pipeline. User-supplied source imports record
their origin and do not attest that a live Figma capture occurred.

Existing `save_brand_interface_selection` maps a role to an approved component;
`unmap_selection` removes an explicitly selected binding. Deletion may detach
the gallery item while retaining its original source journal. Read the receipt
and affected draft before claiming that source or coverage changed.

## Explicit physical file cleanup

`list_brand_files` returns bounded metadata and IDs, including older uploads.
It does not declare files unused. Deleting an item or replacing a file does
not authorize physical deletion. After a separate explicit cleanup request,
read the current snapshot hash and call `delete_brand_file` with `file_id`,
`expected_snapshot_content_hash`, and `confirm_physical_delete: true`.
The server blocks referenced, foreign or uncertain files, protects every
immutable release and fences concurrent reference/publication writes. An
unknown deletion outcome requires reconciliation; do not repeat automatically.

All these operations edit drafts only. Publication remains a separate,
explicit `publish_brand_release` action with a fresh snapshot hash.
