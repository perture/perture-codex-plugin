# Edit a Perture Brand Page (Pro)

Use this workflow only when the account owner explicitly asks to change their
Brand Page. A connected plugin or an automatic review is not edit permission.

1. Call `list_brands`, resolve the requested brand, then call `set_active_brand`.
   Pass its `brand_id` and `brand_lock_token` to every Brand Page tool. Never
   copy another brand's assets into the active one without an explicit request.
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
   Brand Page section. If a file is larger than 8 MiB or the host cannot read
   it, ask the user to upload it in the Brand Page. Never paste the base64 into
   a chat response or log. File replacement is unavailable. To delete an
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
