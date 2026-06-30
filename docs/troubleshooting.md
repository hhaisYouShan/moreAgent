# Troubleshooting

This document explains common dashboard/report errors and how to respond.

Each entry includes:

1. what you see
2. why it happens
3. what to do
4. which command is relevant

## No runs found

### What you see

- `No runs found`
- Or an empty dashboard

### Why it happens

1. No task has been run yet
2. `.moreagent/sessions.json` contains no run history

### What to do

Run a task first:

```bash
moreagent start --once --task "your task"
```

Then check:

```bash
moreagent status
moreagent dashboard
```

### Related commands

```bash
moreagent status
moreagent dashboard
```

## Run not found in prefetched range

### What you see

- `Run not found in prefetched range`

### Why it happens

1. You used `--run`
2. But that run is not included in the latest prefetched runs
3. Your `--limit` is too small

### What to do

Increase the prefetched range:

```bash
moreagent dashboard --run run-2026-06-29T12-00-00-abc123 --limit 20
```

Or inspect the run from CLI first:

```bash
moreagent status --run run-2026-06-29T12-00-00-abc123
```

### Related commands

```bash
moreagent dashboard --run <id> --limit <n>
moreagent status --run <id>
```

## Open failed

### What you see

- `Open failed: ...`
- But dashboard path is still printed

### Why it happens

1. The HTML file was generated
2. The browser open step failed
3. The system open command or browser association may be unavailable

### What to do

Open the printed HTML file manually.

For example:

```bash
moreagent dashboard --output /tmp/dash.html
open /tmp/dash.html
```

### Related commands

```bash
moreagent dashboard --open
moreagent dashboard --output <path> --open
```

## workflow unavailable / MVP run

### What you see

- `Workflow unavailable`
- `MVP run — workflow not available`

### Why it happens

This is expected for MVP runs.

MVP runs do not have the full 9-phase workflow data used by full workflow runs.

### What to do

Nothing is broken.

Use:

1. Summary
2. gate/test/review
3. sessions
4. report

to judge the run instead.

### Related commands

```bash
moreagent dashboard --run <id>
moreagent report --run <id>
```

## Report unavailable

### What you see

- `Report unavailable`

### Why it happens

The dashboard could not load `moreagent report --run <id> --json` successfully for that run.

Possible causes:

1. report command returned an error JSON
2. report output could not be parsed
3. run data is incomplete

### What to do

Run the report directly:

```bash
moreagent report --run <id>
moreagent report --run <id> --json
```

Then compare with dashboard JSON/debug.

### Related commands

```bash
moreagent report --run <id>
moreagent report --run <id> --json
```

## Detail unavailable

### What you see

- `Detail unavailable`

### Why it happens

The dashboard could not load `moreagent status --run <id> --json` successfully for that run.

This affects:

1. sessions
2. runtime session ids
3. artifact paths
4. worktree-related detail

### What to do

Run:

```bash
moreagent status --run <id>
moreagent status --run <id> --json
```

### Related commands

```bash
moreagent status --run <id>
moreagent status --run <id> --json
```

## Merge readiness unavailable

### What you see

- `Merge readiness unavailable`

### Why it happens

The dashboard/report could not derive stable merge data.

Possible reasons:

1. report detail is missing
2. merge fields are missing
3. worktree data is incomplete

### What to do

Check the run report:

```bash
moreagent report --run <id>
moreagent report --run <id> --json
```

Then inspect worktree and main repo state manually if needed.

### Related commands

```bash
moreagent report --run <id>
moreagent merge --run <id>
```

## Sessions unavailable

### What you see

- `Sessions unavailable`
- Or `No session data recorded`

### Why it happens

1. status detail could not be loaded
2. session data is missing
3. session list is empty for this run

### What to do

Check:

```bash
moreagent status --run <id>
moreagent inspect --run <id>
```

### Related commands

```bash
moreagent status --run <id>
moreagent inspect --run <id>
```

## main repository not clean

### What you see

- Report/dashboard says merge is blocked
- main repository is not clean

### Why it happens

Your main working tree has uncommitted changes.

Even if the run passed, merge readiness can still be blocked.

### What to do

Check:

```bash
git status
```

Then commit, stash, or clean up changes before merge flow.

### Related commands

```bash
moreagent report --run <id>
moreagent merge --run <id>
git status
```

## worktree missing

### What you see

- merge readiness blocked
- worktree missing

### Why it happens

The run references a worktree path that no longer exists.

This can happen if:

1. the worktree was manually removed
2. cleanup removed it
3. git worktree state is stale

### What to do

Inspect:

```bash
git worktree list
moreagent status --run <id>
moreagent inspect --run <id>
```

### Related commands

```bash
git worktree list
moreagent status --run <id>
moreagent inspect --run <id>
```

## JSON parse failed

### What you see

- `JSON parse failed`

### Why it happens

One of the JSON-producing subcommands returned invalid or unexpected stdout.

Typical sources:

1. `status --json`
2. `status --run <id> --json`
3. `report --run <id> --json`
4. `inspect --run <id> --workflow --json`

### What to do

Run the underlying command directly and inspect stdout:

```bash
moreagent status --json
moreagent status --run <id> --json
moreagent report --run <id> --json
moreagent inspect --run <id> --workflow --json
```

If one of these fails, the dashboard is only reflecting the upstream data problem.

### Related commands

```bash
moreagent status --json
moreagent status --run <id> --json
moreagent report --run <id> --json
moreagent inspect --run <id> --workflow --json
```
