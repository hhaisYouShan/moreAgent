# MoreAgent Architecture

## Current Scope

This document reflects the current implemented shape of MoreAgent at V2.4.

MoreAgent is a local CLI orchestration tool built around:

1. file-based run state
2. OpenCode CLI agent execution
3. one isolated task worktree per code-changing run
4. artifact-driven workflow decisions
5. human-controlled merge as the final boundary

It is not a remote platform, not a database-backed system, and not an auto-merge bot.

## Current Capability Summary

At V2.4, the current architecture includes:

1. `init` project bootstrap
2. MVP pipeline execution
3. full workflow execution
4. repair loop and resume
5. JSON output for machine consumption
6. `report` for single-run acceptance summaries
7. `dashboard` for static HTML review
8. `status / inspect / diff / clean / merge` CLI support

## Core Concepts

### Run

A run is one logical execution unit.

Typical creation paths:

1. `moreagent start --once --task "..."`
2. `moreagent start --resume --latest`
3. `moreagent start --resume --run <id>`

A run owns:

1. one run id
2. one task
3. run-level status
4. per-session execution history
5. artifact directories under `.moreagent/runs/<run-id>/`
6. one task worktree when code modification is involved

### Session

A session is one agent execution inside a run.

Examples:

1. `architect`
2. `implementer`
3. `tester`
4. `reviewer`
5. `repair-1-implementer`
6. `repair-1-tester`
7. `repair-1-reviewer`

Sessions are persisted in `.moreagent/sessions.json` and are the source of truth for:

1. per-agent status
2. artifact paths
3. start/end timestamps
4. error messages
5. worktree association

### Runtime Session Mapping

MoreAgent also maintains OpenCode runtime session mappings.

Relevant files:

1. `.moreagent/sessions.json`
2. `.moreagent/runtime-sessions.json`

This split matters because:

1. MoreAgent session names are used for orchestration, artifacts, and status views
2. OpenCode runtime sessions track the underlying OpenCode conversation/session identity

### Worktree

For code-changing runs, MoreAgent isolates changes into one git worktree per run:

1. `.moreagent/worktrees/agent-<run-id>/`
2. branch naming under the run-specific agent branch

This is a deliberate boundary:

1. business code changes go into the task worktree
2. the main repository should remain clean until human merge

## Current Project Structure

```text
.moreagent/
├── config.yaml
├── sessions.json
├── tasks.json
├── runtime-sessions.json
├── runs/
│   └── <run-id>/
│       ├── <session-name>/
│       │   ├── task.md
│       │   ├── stdout.log
│       │   ├── stderr.log
│       │   └── primary artifact
│       └── ...
└── worktrees/
    └── agent-<run-id>/
```

## Workflow Shapes

MoreAgent currently supports two different workflow shapes.

### MVP Workflow

The MVP workflow is the simpler four-role path:

```text
architect -> implementer -> tester -> reviewer
```

Typical usage:

1. direct coding tasks
2. fast local iteration
3. smaller single-task runs

Typical artifacts:

1. `brain-plan.md`
2. `implementation-result.md`
3. `test-report.md`
4. `review-report.md`

### Full Workflow

The full workflow is the staged multi-phase workflow:

```text
brain
-> prd
-> prd-review
-> prd-gate
-> tech-plan
-> tech-gate
-> implementation
-> test
-> review
```

Typical characteristics:

1. phase checkpoints
2. gate decisions
3. repair and resume support at workflow level
4. richer acceptance reporting

Typical artifacts include:

1. `brain-plan.md`
2. `prd.md`
3. `frontend-prd-review.md`
4. `backend-prd-review.md`
5. `test-prd-review.md`
6. `prd-decision.md`
7. `frontend-plan.md`
8. `backend-plan.md`
9. `test-plan.md`
10. `tech-review.md`
11. `test-report.md`
12. `review-report.md`
13. `failure-analysis.md`

## Execution Model

## Agent Execution

MoreAgent invokes OpenCode CLI per agent session.

Architecturally, each session involves:

1. preparing the artifact directory
2. preparing `task.md` context
3. selecting the correct working directory
4. invoking the adapter against OpenCode CLI
5. collecting stdout/stderr
6. evaluating primary artifacts when needed
7. updating run/session state in JSON

The important current rule is:

1. MoreAgent session names and OpenCode agent names are not always identical
2. repair session names are MoreAgent-local labels
3. OpenCode still uses the base configured agent name such as `implementer`, `tester`, `reviewer`

## Worktree Strategy

Current strategy:

1. one task worktree per run
2. code-changing sessions reuse the same worktree
3. repair sessions continue in the same task worktree
4. merge is not automatic

This is how MoreAgent preserves:

1. isolation
2. reproducibility
3. human review before applying changes back to main

## Artifact Decision Protocol

Artifact files are not just human-readable output. Some of them are machine-evaluated protocol boundaries.

### Test Protocol

`test-report.md` supports:

```text
Result: PASS
Result: FAIL
```

### Review Protocol

`review-report.md` supports:

```text
Decision: APPROVED
Decision: CHANGES_REQUESTED
```

### Full Workflow Gate Protocols

Full workflow also relies on machine-readable gate artifacts:

1. `prd-decision*.md`
2. `tech-review*.md`
3. `failure-analysis.md`

Examples:

```text
Decision: APPROVED
Decision: CHANGES_REQUESTED
Owner: frontend
Owner: backend
Owner: tester
Owner: product
Owner: tech-plan
Owner: unknown
```

These protocol markers are used by:

1. repair loop entry decisions
2. report decision logic
3. inspect/status/report summaries

## Repair And Resume

## Repair Loop

Current minimal repair behavior:

1. if tester fails, go back to implementer, then rerun tester
2. if reviewer fails, go back to implementer, then rerun tester and reviewer
3. repair sessions produce isolated artifact directories
4. repair stays in the same task worktree

Repair can be triggered by:

1. process failure
2. tester artifact decision failure
3. reviewer artifact decision failure

### Resume

Resume exists at the run/workflow level.

Supported forms:

1. `moreagent start --resume --latest`
2. `moreagent start --resume --run <id>`
3. `moreagent start --once --task "..." --from-phase <phase>`

The architecture implication is:

1. runs persist enough workflow state to continue
2. completed phases are not recomputed blindly
3. repair and resume are separate concepts
   - repair is an internal loop within a run
   - resume is an explicit user-triggered continuation of an existing run

## Output Surfaces

Current operator-facing command surfaces are:

### `status`

Use `status` for run and session state inspection.

Current roles:

1. list recent runs
2. show latest run detail
3. show latest repair run
4. show latest full workflow run
5. show specific run detail
6. provide JSON summary/detail modes

### `inspect`

Use `inspect` for artifact-centric and workflow-centric inspection.

Current roles:

1. inspect latest run
2. inspect specific run
3. inspect a given agent artifact
4. inspect full workflow structure
5. provide JSON workflow output

### `report`

Use `report` for single-run acceptance judgment.

Current roles:

1. compute `overallStatus`
2. compute `recommendation`
3. summarize gates, test, review, repair, merge readiness
4. provide machine-readable JSON

### `dashboard`

Use `dashboard` for local visual review.

Current V2.4 behavior:

1. static HTML generation only
2. optional `--open`
3. prefetched recent runs
4. run sidebar switching
5. enhanced summary
6. workflow/gate/test/review panels
7. repair and merge readiness sections
8. JSON/debug sections

Current V3.0 status:

1. `dashboard --serve / --watch` is still design-stage, not yet implemented

## JSON Output Architecture

JSON output is now a first-class architectural layer, not an afterthought.

Current JSON-producing surfaces:

1. `status --json`
2. `inspect --json`
3. `report --json`

This matters because:

1. dashboard consumes CLI JSON-derived data
2. scripts and CI can consume the same structured data
3. text rendering and JSON rendering share the same underlying run truth

## Merge Boundary

Merge is intentionally manual.

Current architecture enforces:

1. runs may become merge-ready
2. MoreAgent may compute `MERGE_READY` or `BLOCKED`
3. main repository cleanliness matters
4. worktree existence matters
5. user still decides whether to apply merge

This is a hard boundary:

1. MoreAgent helps prepare and evaluate changes
2. it does not automatically merge or push as part of normal workflow execution

## Design Principles

Current architectural principles are:

1. file-based state over database state
2. CLI-first operation
3. local-only execution model
4. deterministic artifact and run history
5. worktree isolation before human merge
6. explicit protocol markers for machine judgment
7. human control over final code integration

## Document Boundary

This file describes the current implemented architecture at V2.4.

Historical PRD / tech-plan documents under `docs/v1.x`, `docs/v2.x`, and `docs/v3.0-*` are useful for:

1. rationale
2. rollout history
3. future design direction

They are not the sole source of truth for current behavior.

For current behavior, prefer:

1. `README.md`
2. this architecture document
3. current usage docs
4. current CLI implementation
