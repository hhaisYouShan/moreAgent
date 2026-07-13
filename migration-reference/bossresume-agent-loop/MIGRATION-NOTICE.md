# Migration reference notice

Source: `hhaisYouShan/bossResume` at `d400f508ecaeb0cf20b8c6dae7b182af0111ffd2`, copied from `scripts/agent-loop/**`.

This directory is a read-only provenance snapshot. It is not part of the MoreAgent runtime, must not be imported from `src/**`, and must not be used as a CLI entrypoint. File hashes are recorded in `SOURCE-MANIFEST.json`.

Extract one module at a time into MoreAgent Core, replace project facts with Adapter configuration, then dual-run against BossResume before changing a consumer call site. Delete a reference module only after its extracted replacement is switched and accepted.
