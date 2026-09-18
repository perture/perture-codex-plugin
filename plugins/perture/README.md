# Perture

Official Design Agent connection package for Perture.

The package combines a public Build/Review/Fix workflow skill, local read-only
repository inspection and source checks, host manifests, public brand assets,
and the remote Perture MCP locator.

Validation protocol `1.3` returns structured Error, Warning and Suggestion
findings across color, exact typography roles, spacing, layout, component,
asset, iconography, imagery, shape and explicit brand-rule checks. It requires
an applicability decision for every governed brand object and a headless
desktop/mobile rendered pass before reporting verified fidelity.

Repair protocol `1.0` adds a local dry-run-first Fix path for explicitly scoped
deterministic findings. It applies only unambiguous replacements, revalidates
the full authorized scope and keeps current/replacement values out of remote
verification reports.

Account behavior is carried in every Frontend Contract. Automatic corrections,
automatic reviews and Perture Logs can be controlled independently in Settings.
Explicit Review or Fix requests still run, while every applied correction keeps
its mandatory revalidation boundary.

Brand-governed work fails closed: the host must list brands, activate the
selected brand and obtain a current Frontend Contract before editing. Missing
activation, preparation or verification tools never trigger a silent
repository-only fallback or a Perture verification claim.

Imported Figma components are delivered as immutable official implementation
artifacts. The host must materialize their exact files and the local validator
checks every SHA-256 before accepting Interface System usage; a hand-built
component at the expected path cannot pass as the official implementation.

The bundled local scripts do not contain credentials, customer data or private
brand rules. Repository source remains local. Rendered validation uses the
repository's existing Playwright only on loopback pages. Authentication, brand data, authorization, logs and
protected Perture behavior remain on Perture infrastructure and are authorized
on every remote request.

The coding host remains the interface. The package does not add a separate UI
or authorize deployment, publication or submission. See `LICENSE`.
