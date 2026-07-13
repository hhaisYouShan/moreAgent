# BossResume Agent Loop migration ledger

Source baseline: `hhaisYouShan/bossResume@d400f508ecaeb0cf20b8c6dae7b182af0111ffd2`.

Status vocabulary:

```text
REFERENCE -> EXTRACTING -> DUAL_RUN_PASS -> SWITCHED -> DELETABLE -> REMOVED
```

| Capability | BossResume reference modules | MoreAgent destination | Status | Switch condition |
| --- | --- | --- | --- | --- |
| State-source inspection | `state.mjs`, `reconcile-state-sources.mjs` | `src/core/state-sources.mjs` | `DUAL_RUN_PASS` | Keep read-only until generic apply passes |
| Reconcile apply and evidence | `reconcile-state-sources.mjs`, `run-status.mjs` | `src/core/reconcile.mjs` | `EXTRACTING` | Preserve pointers, worktrees and M0 boundary |
| Workflow state presentation | `state.mjs`, `state-cli.mjs`, `status.mjs` | `src/core/state.mjs`, adapter renderer | `REFERENCE` | JSON, Markdown and Round Context parity |
| Gate and Issue contracts | `gate.mjs`, `gate-result-validator.mjs`, `issue-router.mjs` | `src/contracts/` | `EXTRACTING` | Registered gates and structured Issue parity |
| Run, task and event lifecycle | `run-status.mjs`, `persistence.mjs` | `src/runtime/` | `EXTRACTING` | Resume and stale-pointer cases pass |
| Worktree lifecycle | `worktree.mjs`, `worktree-manifest.mjs`, `merge-steward.mjs` | `src/runtime/worktrees.mjs` | `EXTRACTING` | No orphan/prunable regression |
| Planner and orchestration | `planner.mjs`, `orchestrator.mjs`, `task-context.mjs` | `src/runtime/` | `REFERENCE` | Same task DAG and allowed scope |
| Agent runners and prompts | `*-runner.mjs`, `agents/**` | `src/runners/`, `templates/` | `REFERENCE` | Runner and prompt adapter acceptance |
| M0 policy | `m0-guard.mjs`, checkpoint contract | `src/contracts/checkpoint.mjs` + adapter | `REFERENCE` | M0 remains adapter policy, not core gate |

## Explicit non-migration

- BossResume business PRD, client/server code, product acceptance, user acceptance, and business artifacts remain in BossResume.
- Current runtime pointers, `.agent-runs`, `.agent-worktrees`, logs, and historical state are not part of the reference snapshot.
- MoreAgent's original implementation is not a compatibility target.
