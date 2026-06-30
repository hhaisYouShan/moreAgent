# Dashboard Usage

## Overview

`moreagent dashboard` provides two modes:

1. **Static HTML** (default): generates a single HTML file for local inspection
2. **Serve mode** (`--serve`): starts a local HTTP server with live data

Both modes are designed for read-only inspection. They do not execute merge / resume / start actions.

## Static Mode (Default)

### Generate dashboard

```bash
moreagent dashboard
```

Default output: `.moreagent/dashboard/index.html`

### Generate and open in the default browser

```bash
moreagent dashboard --open
```

If open fails, the HTML file is still generated.

### Select a specific run

```bash
moreagent dashboard --run run-2026-06-29T12-00-00-abc123
```

The selected run is always included in the dashboard, even if it falls outside the latest runs prefetch range. (Previously, runs outside the limit range would cause a failure — now they are forcibly appended.)

### Limit prefetched runs

```bash
moreagent dashboard --limit 10
```

Controls how many recent runs are embedded into the HTML. If `--run` specifies a run outside this range, it is still included.

### Custom output path

```bash
moreagent dashboard --output /tmp/moreagent-dashboard.html
```

## Serve Mode (`--serve`)

Start a local HTTP server for live dashboard access:

```bash
moreagent dashboard --serve
moreagent dashboard --serve --watch
moreagent dashboard --serve --open
moreagent dashboard --serve --port 9000
moreagent dashboard --serve --host localhost
```

Defaults: host `127.0.0.1`, port `4317`.

### Endpoints

| Route | Description |
|-------|-------------|
| `GET /` | Dynamic dashboard HTML (rebuilt per request) |
| `GET /data.json` | Dashboard model JSON |
| `GET /health` | Server health check |
| Other | `404 Not found` |

### Auto-refresh (`--watch`)

```bash
moreagent dashboard --serve --watch
```

Enables 3000ms polling of `/data.json`. The page shows a "Refresh data" button in serve mode regardless — `--watch` adds automatic polling.

Requires `--serve`. Using `--watch` alone exits non-zero.

### `--host` and `--port`

```bash
moreagent dashboard --serve --host 127.0.0.1 --port 4317
```

- `--host` only accepts `127.0.0.1` or `localhost` (loopback only for security)
- `--port` must be a positive integer (1–65535), default `4317`
- Non-loopback hosts and invalid ports exit non-zero

### `--serve --open`

Opens `http://host:port/` in the default browser after the server starts. If open fails, the server continues running.

### `--output` in serve mode

`--output` only applies to static generation. When used with `--serve`, it is ignored and a message is printed.

## Parameter Combinations

```bash
# All flags composable
moreagent dashboard --run <id> --limit 5 --output /tmp/dash.html --open
moreagent dashboard --serve --watch --port 9000 --open
moreagent dashboard --serve --run <id> --limit 5 --open
```

## `--run` + `--limit` in serve mode

When `--run` selects a run outside the latest `--limit` range:

- The selected run is **always included** in the dashboard model
- `selectedRunId` persists across `/data.json` refreshes
- The run appears alongside the latest N runs (slightly exceeding the limit)

## Dashboard Page Areas

### 1. Run List

The sidebar shows recent prefetched runs with:

- run id, task summary, status, recommendation, profile, createdAt

Visual markers:

- **Red** left border: failed / NEEDS_REPAIR
- **Yellow** left border: running
- **Green** left border: MERGE_READY

### 2. Enhanced Summary

Top-level conclusion area for the selected run:

overallStatus, recommendation, canResume, canMerge, mainClean, worktree exists

### 3. Workflow Progress

Full workflow runs show 9 fixed phases (brain through review). States: completed (green), failed (red), pending (grey).

MVP runs show "workflow unavailable — MVP run" instead.

### 4. Gate / Test / Review

PRD Gate, Tech Gate, Test, Review — with unified color coding (green = APPROVED/PASS, red = CHANGES_REQUESTED/FAIL, neutral = unknown).

### 5. Merge Readiness

Explains why a run is MERGE_READY or BLOCKED, including canMerge, mainClean, worktree status, and blockedReason.

### 6. Repair Sessions

hasRepair, repairCount, repairRounds, and per-session repair details.

### 7. Sessions

Per-session table: agentName, status, duration, artifactDir, worktreePath.

### 8. JSON / Debug

Default collapsed. Expand to inspect raw status/report/workflow JSON with error details.

## MVP Run Degradation

MVP runs show "workflow unavailable — MVP run." This is expected — the run simply lacks full workflow phase data. It is not an error.

## Empty Dashboard

"No runs found" appears when there are no runs. Run a task first:

```bash
moreagent start --once --task "your task"
```

## Open Failed

If `--open` fails, the HTML file or server is still operational. Check the printed path/URL and access manually.

## Related Commands

```bash
moreagent report --latest
moreagent report --run run-2026-06-29T12-00-00-abc123
moreagent status --json
moreagent inspect --run run-2026-06-29T12-00-00-abc123 --workflow --json
```
