# BossResume Agent Loop migration ledger

## Purpose

This ledger tracks extraction of reusable capabilities from the BossResume Agent Loop into the project-agnostic AI Software Company OS.

BossResume is not the current delivery goal. It becomes the first real-project validation target in **Stage 7**, after the generic OS completes system-level testing in Stage 6.

Source baseline: `hhaisYouShan/bossResume@d400f508ecaeb0cf20b8c6dae7b182af0111ffd2`.

The compatibility implementation currently lives in `scripts/agent-loop/**`, `agent-loop-docs/**`, and BossResume reference material. These files are migration sources, not canonical product or architecture facts.

## Status vocabulary

```text
REFERENCE -> EXTRACTING -> DUAL_RUN_PASS -> SWITCHED -> DELETABLE -> REMOVED
```

| Capability | BossResume reference modules | MoreAgent destination | Status | Switch condition |
|---|---|---|---|---|
| State-source inspection | `state.mjs`, `reconcile-state-sources.mjs` | `src/core/state-sources.mjs` | `DUAL_RUN_PASS` | Generic inspection and fixtures retain parity |
| Reconcile apply and evidence | `reconcile-state-sources.mjs`, `run-status.mjs` | `src/core/reconcile.mjs` | `EXTRACTING` | Pointer, worktree, Artifact, and evidence recovery parity |
| Workflow state presentation | `state.mjs`, `state-cli.mjs`, `status.mjs` | Control Plane state + render adapters | `REFERENCE` | One canonical state with derived human views |
| Gate and Issue contracts | `gate.mjs`, `gate-result-validator.mjs`, `issue-router.mjs` | Domain/Schema + Control Plane | `EXTRACTING` | Unified conclusions, severity, ownership, and recheck semantics |
| Run, Task, and Event lifecycle | `run-status.mjs`, `persistence.mjs` | Domain + Control/Execution Plane | `EXTRACTING` | Resume, retry, stale-pointer, and idempotency tests pass |
| Worktree lifecycle | `worktree.mjs`, `worktree-manifest.mjs`, `merge-steward.mjs` | Execution Plane | `EXTRACTING` | No orphan/prunable regression and enforced ownership |
| Planner and orchestration | `planner.mjs`, `orchestrator.mjs`, `task-context.mjs` | Control Plane | `EXTRACTING` | Validated DAG, context, scheduling, repair, and convergence parity |
| Agent runners and prompts | `*-runner.mjs`, `agents/**` | Execution adapters and profiles | `REFERENCE` | Runner interface and adapter acceptance tests pass |
| Checkpoint policy | `m0-guard.mjs`, checkpoint contract | Generic checkpoint/policy contracts | `EXTRACTING` | Project-specific policy expressed entirely by profile/adapter |

## Migration rules

1. New generic features are implemented in Core, not in compatibility code.
2. Compatibility code receives only blocking fixes needed to preserve migration reference behavior.
3. Every capability requires contract tests and parity evidence before `SWITCHED`.
4. Once switched, there is one public entrypoint and one state owner.
5. BossResume business PRD, code, runtime state, acceptance, and business Artifacts remain in the BossResume repository.
6. Real BossResume execution does not begin during extraction; it begins at roadmap Stage 7.
