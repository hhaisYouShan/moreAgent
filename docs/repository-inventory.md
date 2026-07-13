# Repository inventory and migration classification

```yaml
status: active
version: 1.0
updated_at: 2026-07-13
stage: 1
```

This document classifies every top-level repository area by authority and migration role. It is the Stage 1 repository-structure decision record.

## Classification vocabulary

| Class | Meaning |
|---|---|
| `CANONICAL` | Current AI Software Company OS fact source or implementation |
| `PROFILE` | Declarative project, workflow, agent, policy, capability, or acceptance configuration |
| `ADAPTER` | Boundary code translating external tools or projects into Core contracts |
| `COMPATIBILITY_ACTIVE` | Existing BossResume-derived runtime still used as migration parity reference |
| `MIGRATION_REFERENCE` | Immutable source snapshot; never executed and never edited for new behavior |
| `VALIDATION_RESERVED` | Stage 7 or later validation assets; inactive before Stage 6 approval |
| `HISTORICAL` | Preserved evidence or superseded design; not current authority |
| `REMOVE_AFTER_SWITCH` | May be removed only after its migration-ledger switch condition passes |

## Top-level inventory

| Path | Class | Current responsibility | Action |
|---|---|---|---|
| `README.md` | `CANONICAL` | Product goal, lifecycle, boundaries, current entry point | Keep concise and project-agnostic |
| `docs/` | `CANONICAL` | Architecture, roadmap, documentation authority, migration status, repository inventory | Only current OS documents live here |
| `src/` | `CANONICAL` | Portable Domain, contracts, Control Plane, Execution Plane and evidence services | Expand during Stages 2–5 |
| `test/` | `CANONICAL` | Portable unit, contract and integration tests | Expand during Stages 2–6 |
| `schemas/` | `CANONICAL` | JSON Schema runtime contracts | Created and stabilized in Stage 2 |
| `profiles/` | `PROFILE` | Project-agnostic declarative profiles | Populate after core contracts stabilize |
| `adapters/` | `ADAPTER` | Project/tool translation boundaries | Remove BossResume assumptions from generic adapters |
| `validation/` | `VALIDATION_RESERVED` | Synthetic and real-project validation packages | `validation/bossresume/` activates only in Stage 7 |
| `legacy/` | `HISTORICAL` | Legacy-category policy and future retired implementation index | Do not add new behavior |
| `migration-reference/bossresume-agent-loop/` | `MIGRATION_REFERENCE` | Immutable BossResume Agent Loop source snapshot | Never execute or modify; retain source manifest |
| `scripts/agent-loop/` | `COMPATIBILITY_ACTIVE` | Active compatibility runtime used for parity while Core is incomplete | Freeze feature growth; extract capability-by-capability |
| `agent-loop-docs/` | `COMPATIBILITY_ACTIVE` | Compatibility workflow fixtures, policies and historical run evidence | Not an OS product/architecture fact source |
| `projects/bossresume/` | `HISTORICAL` | Migrated BossResume governance and design reference | No new current OS decisions; Stage 7 uses `validation/bossresume/` |
| `templates/bossresume/` | `COMPATIBILITY_ACTIVE` | BossResume-specific prompt templates | Migrate to profile/capability packs or Stage 7 validation assets |
| `docs/compatibility/` | `HISTORICAL` | Compatibility behavior notes | Retain only while corresponding migration entry is open |
| `engine-migration.md` | `HISTORICAL` | Early migration note | Superseded by `docs/migration-ledger.md` |

## Compatibility runtime classification

### `scripts/agent-loop/`

All files are classified as `COMPATIBILITY_ACTIVE` until a migration-ledger entry reaches `SWITCHED`:

- CLI and orchestration: `cli.mjs`, `orchestrator.mjs`, `planner.mjs`, `preflight.mjs`.
- State and recovery: `state.mjs`, `state-cli.mjs`, `run-status.mjs`, `persistence.mjs`, `reconcile-state-sources.mjs`, `checkpoint.mjs`.
- Contracts and quality: `gate.mjs`, `gate-result-validator.mjs`, `registered-gates.mjs`, `issue-router.mjs`, `scope-guard.mjs`, `self-check-*`.
- Execution adapters: `codex-runner.mjs`, `tmux-runner.mjs`, `warp-runner.mjs`, `worktree.mjs`, `worktree-manifest.mjs`.
- Integration compatibility: `code-sync.mjs`, `merge-steward.mjs`.
- Agent prompt pack: `agents/`.
- Compatibility tests: `tests/`.

Rules:

1. No new generic feature is implemented only in this directory.
2. Bug fixes required to preserve parity are allowed and must be mirrored by a Core regression test.
3. A file becomes `REMOVE_AFTER_SWITCH` only after all its call sites use the portable replacement.
4. File-copy integration behavior must not be promoted into Core.

### `agent-loop-docs/`

- `process/`, `gate-results/`, `issues/`, `decisions/`, `reviews/`, `tech/`, `test-reports/`, `acceptance/`: compatibility fixtures and run protocol.
- `archive/history/`: `HISTORICAL`.
- BossResume PRD addenda and state-split issue: project-specific migration evidence.

These files cannot define the current OS roadmap, architecture, product goal, Domain enums or Core Gate vocabulary.

## BossResume reference classification

### `projects/bossresume/scripts-doc/ai-software-company/`

The six numbered documents, appendices, policy drafts, review reports and copied schemas are `HISTORICAL`. They preserve the reasoning that led to the current OS plan but are not current product, architecture, contract or status sources.

Specific rules:

- Do not update their “current state” sections.
- Do not copy their BossResume paths or business phases into Core.
- Reusable ideas must be rewritten into `docs/`, `schemas/`, `src/` or `profiles/` without project-specific fields.
- Empty copied schema placeholders are not Stage 2 contracts.
- The old BossResume stage tracker does not advance the OS roadmap.

### `adapters/bossresume.json` and `templates/bossresume/`

These are temporary compatibility assets, not proof of a completed project adapter model. During Stages 2–4 they must be decomposed into stable Project Profile, Workflow Profile, Agent Contract Pack, Capability Pack and runner adapters.

## Deletion and movement policy

Repository cleanup must preserve Git history and migration evidence. Therefore:

1. First freeze authority and classify files.
2. Build and test the portable replacement.
3. Record parity evidence in `docs/migration-ledger.md`.
4. Switch call sites.
5. Mark the old area `DELETABLE`.
6. Delete or archive only in a dedicated cleanup commit.

No active compatibility runtime or evidence is removed merely to make the directory tree look clean.

## Stage 1 completion decision

Stage 1 is complete when:

- Canonical documentation is limited to `README.md` and `docs/`.
- All noncanonical directories above have an explicit class.
- BossResume is reserved for Stage 7 validation rather than current delivery.
- The nine-stage roadmap and directory boundaries are machine-checked.
- Future implementation work is required to use `src/`, `schemas/`, `profiles/`, `adapters/`, `test/` and `validation/` according to this inventory.

This inventory satisfies those conditions. Physical migration continues under the capability switch conditions in Stages 2–5.