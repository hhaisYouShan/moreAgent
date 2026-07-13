# AI Software Company OS implementation roadmap

```yaml
status: active
version: 1.1
updated_at: 2026-07-13
current_stage: 2
machine_status: docs/program-status.json
```

## Program goal

Build a project-agnostic AI Software Company OS. BossResume is the first real-project validation target after the OS completes system-level testing; it is not the current business-delivery goal.

## Current progress

| Stage | Status |
|---|---|
| Stage 1 — Repository structure and documentation source-of-truth cleanup | `COMPLETED` |
| Stage 2 — Stabilize Domain and Schema Contracts | `IN_PROGRESS` |
| Stage 3 — Complete the Control Plane | `NOT_STARTED` |
| Stage 4 — Complete the Execution Plane | `NOT_STARTED` |
| Stage 5 — Evidence, Recovery, Integration, Release, Maintenance | `NOT_STARTED` |
| Stage 6 — Complete system-level testing | `NOT_STARTED` |
| Stage 7 — First real-project validation with BossResume | `NOT_STARTED` |
| Stage 8 — Correct the OS based on validation findings | `NOT_STARTED` |
| Stage 9 — Validate generality with a second project | `NOT_STARTED` |

Machine-readable progress is stored only in `docs/program-status.json`.

## Stage 1 — Repository structure and documentation source-of-truth cleanup

**Status:** `COMPLETED`

**Goal:** establish clear architectural boundaries and eliminate conflicting product facts.

Deliverables:

- Canonical root README, architecture document, roadmap, and documentation authority map.
- Clear separation of Core, adapters/profiles, validation projects, and legacy compatibility code.
- One source of truth for product goal, architecture, roadmap, migration status, runtime contracts, and runtime state.
- Legacy and BossResume-specific documents labeled as compatibility or validation material.
- Automated documentation-boundary verification.
- Complete repository classification in `docs/repository-inventory.md`.

Exit criteria:

- Canonical documents contain no statement that BossResume delivery is the current OS goal.
- No duplicate current roadmap or architecture authority remains.
- Repository target structure and migration rules are approved.
- `npm run verify:docs` passes.

Completion evidence:

- `README.md`
- `docs/README.md`
- `docs/architecture.md`
- `docs/repository-inventory.md`
- `docs/migration-ledger.md`
- `scripts/verify-doc-fact-sources.mjs`

## Stage 2 — Stabilize Domain and Schema Contracts

**Status:** `IN_PROGRESS`

**Goal:** define stable, project-agnostic runtime language before expanding execution.

Required contracts:

- Project, Workflow, Phase, Workstream, Task, Attempt, Run, Session, Workspace.
- Agent Contract and Agent Result.
- Gate, Issue, Artifact, Evidence, Event, Checkpoint, User Decision, Acceptance.
- Project Map, Requirement Trace, Context Manifest, Integration Evidence, Release Evidence.

Exit criteria:

- JSON Schemas compile and have positive/negative contract tests.
- Enum and status semantics are unified across Core and compatibility code.
- Contracts contain no BossResume-specific fields or paths.
- Compatibility mappings are explicit adapters, not core conditionals.

## Stage 3 — Complete the Control Plane

**Goal:** make all delivery decisions deterministic and recoverable.

Scope:

- Workflow Engine and legal transition validator.
- Task DAG generator and deterministic validator.
- Scheduler, dependency resolution, concurrency, locks, leases, heartbeat, and budgets.
- Gate Engine, Issue Router, policy and permission guards.
- Checkpoint, reconciliation, recovery planning, and non-convergence limits.

Exit criteria:

- Only the Control Plane can change Workflow and Task state.
- DAG cycles, conflicts, missing inputs, duplicate executions, and invalid transitions are rejected.
- Failures route to one Primary Owner with required recheck.
- State can be rebuilt from persisted facts and events.

## Stage 4 — Complete the Execution Plane

**Goal:** execute approved work through replaceable tools without leaking tool semantics into Core.

Scope:

- Agent runtime interfaces.
- OpenCode, Codex, and local process runners.
- tmux, Warp, and headless terminal adapters.
- Session, workspace, worktree, and process lifecycle.
- Controlled development, self-test, Review, test, and repair execution.
- Cancellation, timeout, retry, resume, and stale-process handling.

Exit criteria:

- Core can run the same Task through different runner adapters.
- Permissions and editable paths are enforced before execution.
- Parallel tasks run only when DAG and resource rules permit.
- An interrupted execution can resume or fail safely without duplicate side effects.

## Stage 5 — Complete Evidence, Recovery, Integration, Release, and Maintenance

**Goal:** close the full delivery and post-release operating loop.

Scope:

- Artifact Registry, Project Map, Requirement Trace, Context Manifest, and audit event store.
- Recovery, reconciliation, supersede, and evidence invalidation.
- Real Git integration branches and commits; no file-copy integration.
- Integration conflict attribution and verification.
- Release plan, migration dry run, health checks, rollback, incident artifacts.
- Continuous maintenance: monitoring, defects, dependency/security updates, change intake, and knowledge refresh.

Exit criteria:

- Every requirement traces to design, Task, commit, test, Gate, and acceptance.
- TEST decisions validate the Integration Commit, not isolated worktrees.
- Release and rollback are repeatable and evidence-backed.
- Post-release failures enter a controlled maintenance workflow.

## Stage 6 — Complete system-level testing

**Goal:** prove the OS itself is reliable before using a real business project.

Test layers:

- Unit and contract tests.
- Control Plane state-machine and DAG property tests.
- Runner and adapter integration tests.
- Concurrency, lock, lease, heartbeat, timeout, cancellation, and retry tests.
- Crash, stale pointer, orphan worktree, missing Artifact, and recovery tests.
- End-to-end synthetic project delivery.
- Security, permission, scope, secret, and budget tests.

Exit criteria:

- A synthetic project completes the full lifecycle from intake through maintenance.
- No duplicate active execution or uncontrolled state mutation is observed.
- Recovery tests preserve evidence and do not repeat irreversible side effects.
- Stage 7 validation entry checklist is approved.

## Stage 7 — First real-project validation with BossResume

**Goal:** validate the completed OS against an existing, non-trivial refactor project.

Rules:

- BossResume remains in its own repository.
- It connects through a Project Profile, Workflow Profile, capability pack, and adapter.
- No BossResume business rule may be added to Core.
- Validation records benchmark, defects, manual interventions, cost, time, quality, and recovery behavior.

Exit criteria:

- BossResume completes the agreed validation scope using the OS lifecycle.
- Product and user acceptance are real and independently recorded.
- All OS deficiencies are classified as Core, Profile, Adapter, documentation, or project-specific findings.

## Stage 8 — Correct the OS based on validation findings

**Goal:** remove assumptions exposed by the first real-project validation.

Scope:

- Fix Core defects and missing contracts.
- Generalize accidental BossResume assumptions.
- Improve Task decomposition, scheduling, context, integration, recovery, and user experience.
- Add regression tests for every accepted OS-level finding.

Exit criteria:

- All Blocking and Major OS findings are closed.
- BossResume-specific workarounds are removed from Core.
- The full synthetic suite and BossResume regression suite pass.

## Stage 9 — Validate generality with a second, different project

**Goal:** prove that the OS is not a single-project extraction.

The second project must differ materially from BossResume in at least two dimensions, such as:

- New project versus existing refactor.
- Frontend/backend technology stack.
- Database or migration model.
- Deployment model.
- Test tooling.
- Business domain.

Exit criteria:

- The second project connects without changing Core contracts or state semantics.
- Required differences are expressed through profiles, adapters, or capability packs.
- Cross-project findings produce a stable next-version plan.

## Execution rule

Stages execute in order. A later stage may be designed in advance, but implementation cannot declare it complete until the previous stage exit criteria pass. BossResume validation cannot begin before Stage 6 is approved.