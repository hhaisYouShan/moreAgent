# Report Usage

## Overview

`moreagent report` gives a single-run acceptance summary.

Use it when you want:

1. one run's final decision
2. workflow progress summary
3. gate / test / review status
4. merge readiness
5. machine-readable JSON for scripts or CI

If you want a visual multi-run page, use `dashboard`.
If you want a focused single-run conclusion, use `report`.

## Basic Commands

## Latest run report

```bash
moreagent report --latest
```

Shows a text report for the latest run.

## Specific run report

```bash
moreagent report --run run-2026-06-29T12-00-00-abc123
```

Shows a text report for a specific run.

## Latest run report as JSON

```bash
moreagent report --latest --json
```

Useful for:

1. CI checks
2. shell scripts
3. comparing dashboard rendering with raw data

## Specific run report as JSON

```bash
moreagent report --run run-2026-06-29T12-00-00-abc123 --json
```

Useful when you need one run's exact machine-readable decision.

## `overallStatus` Meaning

`overallStatus` is the top-level judgment for a run.

## `PASSED`

Meaning:

- The run completed successfully
- The required checks passed

Typical implication:

- Check `recommendation` next

## `FAILED`

Meaning:

- The run failed
- Or a critical quality/gate decision failed

Typical implication:

- Look for repair / review / test failure causes

## `RUNNING`

Meaning:

- The run is still in progress

Typical implication:

- Not ready for merge or final judgment

## `PARTIAL`

Meaning:

- The run completed, but some important decision fields are unknown

Typical implication:

- Human review is needed

## `UNKNOWN`

Meaning:

- The system cannot produce a confident final state

Typical implication:

- Check raw data or debug output

## `recommendation` Meaning

`recommendation` tells you what to do next.

## `MERGE_READY`

Meaning:

- The run passed
- Merge conditions are satisfied

Typical implication:

- Safe to move into merge flow

## `BLOCKED`

Meaning:

- The run passed
- But merge is blocked by repository or worktree conditions

Typical implication:

- Check main repo cleanliness or worktree existence

## `NEEDS_REPAIR`

Meaning:

- The run failed and should go through repair or resume flow

Typical implication:

- Investigate failure owner and rerun appropriately

## `NEEDS_REVIEW`

Meaning:

- The run is not clearly failed, but some decision data is incomplete

Typical implication:

- Read details manually before acting

## `RUNNING`

Meaning:

- Still in progress

Typical implication:

- Wait or monitor

## `UNKNOWN`

Meaning:

- No stable next-step judgment is available

Typical implication:

- Check debug data or command output directly

## Merge Readiness

Merge readiness in `report` is determined by a combination of:

1. final run quality state
2. worktree existence
3. mergeability
4. main repository cleanliness

Practical reading order:

1. `overallStatus`
2. `recommendation`
3. `merge.canMerge`
4. `merge.mainClean`
5. `worktree.exists`
6. `merge.blockedReason`

Typical cases:

## Passed + merge ready

- `overallStatus = PASSED`
- `recommendation = MERGE_READY`

Interpretation:

- The run passed and merge conditions are satisfied

## Passed but blocked

- `overallStatus = PASSED`
- `recommendation = BLOCKED`

Interpretation:

- The code outcome may be acceptable
- But repository state still prevents merge

Common reasons:

1. main repository not clean
2. worktree missing
3. run not mergeable

## Report and Dashboard Relationship

`report` and `dashboard` use the same underlying command outputs, but they serve different users and moments.

## Use `report` when:

1. You want one run's final conclusion in the terminal
2. You want JSON for automation
3. You want a compact acceptance summary

## Use `dashboard` when:

1. You want a visual review of multiple runs
2. You want sidebar switching
3. You want sessions and debug tabs in one page
4. You want to inspect resilience or per-run detail issues visually

## Common Examples

Quick CLI review:

```bash
moreagent report --latest
```

Machine-readable CI check:

```bash
moreagent report --latest --json
```

Specific run after a failed test/review:

```bash
moreagent report --run run-2026-06-29T12-00-00-abc123
```

Visual follow-up:

```bash
moreagent dashboard --run run-2026-06-29T12-00-00-abc123 --open
```
