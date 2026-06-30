# Dashboard Usage

## Overview

`moreagent dashboard` generates a static HTML dashboard for local inspection.

It is designed for:

1. Reviewing recent runs visually
2. Switching between runs from a sidebar
3. Reading workflow, gate, repair, merge readiness, and session information
4. Inspecting raw JSON/debug data when needed

It does **not**:

1. Start a server
2. Watch files
3. Auto-refresh
4. Execute merge / resume / start actions

## Basic Commands

## Generate dashboard

```bash
moreagent dashboard
```

Default output:

```text
.moreagent/dashboard/index.html
```

## Generate and open in the default browser

```bash
moreagent dashboard --open
```

Behavior:

1. Generate HTML first
2. Then try to open that HTML file in the system default browser

If open fails, the HTML file is still generated.

## Select a specific run

```bash
moreagent dashboard --run run-2026-06-29T12-00-00-abc123
```

This does not generate a single-run-only page.
It still builds a dashboard with recent runs, but preselects the requested run.

## Limit prefetched runs

```bash
moreagent dashboard --limit 10
```

This controls how many recent runs are embedded into the static HTML.

Important:

- Sidebar switching only works within the prefetched range.
- If `--run` points to a run outside the prefetched range, dashboard generation fails.

## Write to a custom output path

```bash
moreagent dashboard --output /tmp/moreagent-dashboard.html
```

Use this when you want to:

1. Save the dashboard outside the project directory
2. Share or archive a single HTML file
3. Pair with `--open`

## Parameter Combinations

## `--run + --open`

```bash
moreagent dashboard --run run-2026-06-29T12-00-00-abc123 --open
```

Meaning:

1. Generate dashboard
2. Preselect the given run
3. Open the generated HTML

## `--limit + --open`

```bash
moreagent dashboard --limit 5 --open
```

Meaning:

1. Embed the latest 5 runs
2. Open the generated dashboard

## `--output + --open`

```bash
moreagent dashboard --output /tmp/dash.html --open
```

Meaning:

1. Write `/tmp/dash.html`
2. Open `/tmp/dash.html`

## Full example

```bash
moreagent dashboard \
  --run run-2026-06-29T12-00-00-abc123 \
  --limit 5 \
  --output /tmp/moreagent-dash.html \
  --open
```

## Dashboard Page Areas

## 1. Run List

The sidebar shows recent prefetched runs.

Typical fields:

1. run id
2. task summary
3. status
4. recommendation
5. profile
6. createdAt short time

Use it to:

1. Spot failed runs quickly
2. Spot running runs quickly
3. Spot merge-ready runs quickly
4. Switch the detail view locally without re-running CLI

## 2. Enhanced Summary

This is the top-level conclusion area for the selected run.

Typical fields:

1. run id
2. task
3. status
4. overallStatus
5. recommendation
6. canResume
7. canMerge
8. mainClean
9. worktree exists

Use it when you want the shortest possible answer to:

1. Did this run pass?
2. Is it merge ready?
3. Is it blocked?
4. Can it be resumed?

## 3. Workflow Progress

For full workflow runs, this area shows the workflow phases.

Typical phases:

1. brain
2. prd
3. prd-review
4. prd-gate
5. tech-plan
6. tech-gate
7. implementation
8. test
9. review

States:

1. completed
2. failed
3. pending

For MVP runs, this area degrades intentionally instead of showing a workflow bar.

## 4. Gate / Test / Review

This section summarizes the key decision markers:

1. PRD Gate
2. Tech Gate
3. Test
4. Review

Common values:

1. `APPROVED`
2. `CHANGES_REQUESTED`
3. `PASS`
4. `FAIL`
5. `unknown`

Use this section when you want to quickly see whether:

1. planning gates passed
2. tests passed
3. review approved the output

## 5. Merge Readiness

This section explains whether the run is actually ready to merge.

Typical fields:

1. recommendation
2. canMerge
3. mainClean
4. worktree exists
5. blockedReason
6. worktree path
7. dirty file list

Interpretation:

- `MERGE_READY`
  - Passed and mergeable
- `BLOCKED`
  - Passed, but not mergeable yet

## 6. Repair Sessions

This section helps you understand whether a run entered the repair loop.

Typical fields:

1. hasRepair
2. repairCount
3. repairRounds
4. repair sessions
5. last failed session

Use it to answer:

1. Did the run need repair?
2. How many rounds did it take?
3. Which role last failed?

## 7. Sessions

The sessions table shows per-session execution details.

Typical fields:

1. agentName
2. status
3. startedAt
4. completedAt
5. duration
6. artifactDir
7. runtimeSessionId

This is the best place to inspect execution history at a lower level.

## 8. JSON / Debug

This section is for debugging, not for first-pass reading.

It usually contains:

1. status JSON
2. report JSON
3. workflow JSON
4. per-run error details

Use it when:

1. UI and raw data seem inconsistent
2. a detail block says unavailable
3. you need exact error code / message

## MVP Run Degradation

For MVP runs, Dashboard intentionally shows:

- `workflow unavailable`
- `MVP run — workflow not available`

This is expected behavior.

It does **not** mean:

1. the run failed
2. dashboard is broken
3. workflow parsing crashed

It only means the run does not have full workflow phase data.

## Empty Dashboard

If there are no runs, dashboard should render an empty state.

Typical message:

- `No runs found`

This usually means:

1. you have not run any tasks yet
2. `.moreagent/sessions.json` has no run history

Suggested next step:

```bash
moreagent start --once --task "your task"
```

## Open Failed

If you use:

```bash
moreagent dashboard --open
```

and the browser cannot be opened automatically, you should still see that the HTML was generated.

Typical meaning:

1. output file exists
2. browser open step failed

Check the printed path and open the file manually.

## Related Commands

Get a CLI report for one run:

```bash
moreagent report --latest
moreagent report --run run-2026-06-29T12-00-00-abc123
```

Get raw structured data:

```bash
moreagent status --json
moreagent report --latest --json
moreagent inspect --run run-2026-06-29T12-00-00-abc123 --workflow --json
```
