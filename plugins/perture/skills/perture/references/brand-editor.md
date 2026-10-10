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
3. For colors and typography, call `list_brand_page_items` for the resource.
   Use `create_brand_page_item` for a new record or `update_brand_page_item`
   with the exact `item_id` for an existing record. A new color needs a name
   and hex value. Typography uses `style_type` (`title`, `body`, `caption`).
4. For a logo, font or illustration, use only the exact local file the user
   identified. `upload_brand_file` accepts its simple file name, correct MIME
   type and standard base64 content, up to 8 MiB. It returns a `file_id`; call
   `create_brand_page_item` with that ID to register the asset in the relevant
   Brand Page section. If a file is larger than 8 MiB or the host cannot read
   it, ask the user to upload it in the Brand Page. Never paste the base64 into
   a chat response or log. File replacement and deletion are unavailable.
5. For spacing or rounding, call `list_brand_design_guidance`. Then call
   `save_brand_design_measurement` with `kind: "spacing"` or `"radii"`, the
   exact `expected_content_hash`, and one measurement. Use an existing `id`
   to edit a preset or row. Omit `id` to create a custom row with `label` and
   `value` in pixels. A zero value is valid; use `null` only when the user
   explicitly wants to clear it. The server preserves the other Interface
   System fields and checks the saved result. If it returns a conflict, list
   guidance again and reconcile the user's intended change with the new
   values before retrying.
6. If the user asks to change Perture agent behavior or Figma sync settings,
   call `get_perture_settings`, then `update_perture_settings` with only the
   requested boolean fields. Confirm the returned values. Billing, credentials,
   email and password are outside this workflow.
7. Read the affected resource or guidance again and report the saved values.
   Do not claim that a draft edit published a Brand Release or changed an
   existing codebase.

All editing tools require the current brand lock. The server verifies Pro
ownership, OAuth scopes and the destination brand on each call.
