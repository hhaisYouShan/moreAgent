# BossResume state-source compatibility

## Scope

This is the first MoreAgent compatibility slice. It compares MoreAgent's generic read-only state-source inspector with BossResume's existing `agent:reconcile` diagnostic. It does not replace the BossResume entrypoint, invoke an Agent, create a Worktree, or create an M0 Result.

## Adapter

- Project: `bossresume`
- Project PRD: `docs/prd/bossresume-full-refactor-prd.md`
- Adapter: `adapters/bossresume.json`
- Generic command:

```bash
node src/cli.mjs state inspect \
  --project /path/to/bossResume \
  --adapter adapters/bossresume.json
```

## Dual-run evidence

Validated against BossResume `master` merge commit `d400f508ecaeb0cf20b8c6dae7b182af0111ffd2`.

| Check | BossResume legacy diagnostic | MoreAgent Core |
| --- | --- | --- |
| State split | `splitDetected=false` | `splitDetected=false` |
| Workflow | `READY / PLAN / INTAKE / 0 / NONE / DRAFT` | Same canonical values |
| Current Run | `IDLE`, no run ID | Same canonical values |
| Current Tasks | Empty | Empty |
| Missing Artifact | None | None |
| Orphan/prunable Worktree | None | None |
| M0 | Not approved | Adapter keeps Product Agent and business code blocked |
| Auto | Off | Adapter declares `autoEnabled=false` |

## Cutover status

`NOT_SWITCHED`.

BossResume continues to use its existing `scripts/agent-loop/reconcile-state-sources.mjs`. MoreAgent currently provides a compatible, read-only observer. The next migration slices must add generic reconcile apply, Gate/Issue contracts, worktree lifecycle, and Agent runner adapters; each needs another dual-run acceptance before a BossResume call site changes.
