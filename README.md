# MoreAgent

A project-level multi-agent / multi-session orchestration tool integrated with OpenCode CLI.

Each agent has an independent session, prompt, and artifact output directory. Code-modifying agents use isolated git worktrees.

## Install

```bash
git clone <repo-url> && cd moreagent
npm install
npm run build
npm link
```

If you get `zsh: permission denied: moreagent`, make sure the dist entry point is executable:

```bash
chmod +x dist/cli.js
```

## Usage

### Prerequisites

- Node.js >= 18
- [OpenCode CLI](https://github.com/opencode-ai/opencode) installed and on `PATH`
- Git (for isolated worktrees used by code-modifying agents)

### 1. Initialize

```bash
moreagent init
```

This creates `.moreagent/config.yaml`, `.moreagent/sessions.json`, `.moreagent/runs/`, `.moreagent/worktrees/`, and `.opencode/agents/` with default agent definitions.

### 2. Configure (optional)

Edit `.moreagent/config.yaml` to customize agent prompts, timeouts, or the OpenCode binary path:

```yaml
runtime:
  opencodePath: "opencode"   # Command or absolute path to opencode
  timeout: 1800              # Per-agent timeout in seconds
  maxRetries: 2
```

### 3. Run a Task

Run the full 4-agent pipeline (architect → implementer → tester → reviewer):

```bash
moreagent start --once --task "add a dark mode toggle to settings"
```

If `tester` fails, MoreAgent will retry from `implementer` and then rerun `tester`.
If `reviewer` fails, MoreAgent will retry from `implementer` and then rerun `tester` and `reviewer`.
The MVP retries at most 2 repair rounds in the same task worktree. It does not auto-merge or auto-push.
Repair loop triggers when the agent process fails or when the tester/reviewer artifact decision is marked as failed.
Repair session names such as `repair-1-implementer` are only used by MoreAgent for sessions and artifact directories; OpenCode still reuses the original agents like `implementer`, `tester`, and `reviewer`.

Example output:

```
Starting run: run-2026-06-29T11-22-00-abc123
Task: add a dark mode toggle to settings
Agents: architect, implementer, tester, reviewer

  Created task worktree: .moreagent/worktrees/agent-run-2026-06-29T11-22-00-abc123

--- Agent: architect (architect) ---
  Completed in 45.2s

--- Agent: implementer (implementer) ---
  Completed in 32.1s

--- Agent: tester (tester) ---
  Completed in 18.7s

--- Agent: reviewer (reviewer) ---
  Completed in 12.3s

Run run-2026-06-29T11-22-00-abc123 completed
Artifacts: .moreagent/runs/run-2026-06-29T11-22-00-abc123

--- Session Summary ---
  architect: OK (45s)
  implementer: OK (32s)
  tester: OK (19s)
  reviewer: OK (12s)
```

### Run a Single Agent

Pass `--agent <name>` to run only one agent. Useful for retrying a failed stage without re-running earlier agents:

```bash
moreagent start --once --task "add a dark mode toggle to settings" --agent implementer
```

### View Results

Each run produces artifacts under `.moreagent/runs/<run-id>/`:

```
.moreagent/runs/run-2026-06-29T11-22-00-abc123/
├── architect/
│   ├── task.md                    # Task context for the architect
│   └── brain-plan.md             # Architecture plan
├── implementer/
│   ├── task.md                    # Task context (includes architect's output)
│   └── implementation-result.md  # What was implemented
├── tester/
│   ├── task.md
│   └── test-report.md            # Test results & coverage
└── reviewer/
    ├── task.md
    └── review-report.md          # Code review findings

# Repair attempts use separate directories
# repair-1-implementer/
# repair-1-tester/
# repair-1-reviewer/
```

Sessions are tracked in `.moreagent/sessions.json` for history and debugging.

### View Status

Show the latest 10 runs:

```bash
moreagent status
```

Show the latest run with per-session details:

```bash
moreagent status --latest
```

### Dashboard Quick Start

Generate the static HTML dashboard:

```bash
moreagent dashboard
```

Generate and open the dashboard in the default browser:

```bash
moreagent dashboard --open
```

Generate a dashboard with a specific run selected:

```bash
moreagent dashboard --run run-2026-06-29T12-00-00-abc123
```

Control the number of prefetched runs:

```bash
moreagent dashboard --limit 5
```

Write to a custom output path:

```bash
moreagent dashboard --output /tmp/moreagent-dashboard.html
```

Typical combinations:

```bash
moreagent dashboard --run run-2026-06-29T12-00-00-abc123 --open
moreagent dashboard --limit 20 --open
moreagent dashboard --run run-2026-06-29T12-00-00-abc123 --limit 5 --output /tmp/dash.html --open
```

The dashboard is a static HTML file. It does not start a server, does not auto-refresh, and does not watch for changes.

### Report Quick Start

Show the latest workflow report:

```bash
moreagent report --latest
```

Show a specific run report:

```bash
moreagent report --run run-2026-06-29T12-00-00-abc123
```

Get machine-readable JSON:

```bash
moreagent report --latest --json
moreagent report --run run-2026-06-29T12-00-00-abc123 --json
```

Use `report` when you want a single run's final decision and merge readiness in one place.
Use `dashboard` when you want a visual multi-run view with sidebar switching and debug panels.

### JSON Output

Use `--json` when:

1. You want machine-readable output for scripts or CI.
2. You want to inspect structured data behind `status`, `inspect`, or `report`.
3. You want to compare raw command data with dashboard rendering.

Common examples:

```bash
moreagent status --json
moreagent status --run run-2026-06-29T12-00-00-abc123 --summary --json
moreagent inspect --run run-2026-06-29T12-00-00-abc123 --workflow --json
moreagent report --latest --json
```

JSON mode is especially useful for:

- CI checks
- automation scripts
- debugging dashboard data issues
- verifying `overallStatus`, `recommendation`, and merge readiness programmatically

### Clean State

Clean run artifacts and reset `sessions.json`:

```bash
moreagent clean --runs
```

Clean worktrees only:

```bash
moreagent clean --worktrees
```

Clean both runs and worktrees:

```bash
moreagent clean --all
```

### View Worktree Diff

Show git diff from the task worktree of the latest run:

```bash
moreagent diff
```

Show diff for a specific run:

```bash
moreagent diff --run run-2026-06-29T12-00-00-abc123
```

This shows `git status`, `git diff --stat`, and `git diff` from the task worktree — not the main project.

### Inspect Run Artifacts

Show a summary of the latest run with all session artifact paths:

```bash
moreagent inspect
```

Show a specific agent's primary artifact content:

```bash
moreagent inspect --agent reviewer
moreagent inspect --agent tester
moreagent inspect --agent implementer
```

Show a specific run:

```bash
moreagent inspect --run run-2026-06-29T12-00-00-abc123
```

For repair sessions (e.g. `repair-1-tester`), `--agent tester` finds the latest tester-related session first.

### Dashboard and Report Concepts

The dashboard and report commands are related, but they serve different purposes:

- `dashboard`
  - Static HTML view
  - Best for humans
  - Shows multiple runs, sidebar switching, sessions, workflow, debug JSON

- `report`
  - Single-run summary
  - Best for CLI review or CI consumption
  - Focuses on `overallStatus`, `recommendation`, gates, quality, and merge readiness

### MVP Run vs Full Workflow Run

In Dashboard and Report views:

- MVP run
  - Usually uses the architect / implementer / tester / reviewer pipeline
  - Dashboard shows `workflow unavailable / MVP run`
  - This is expected degradation, not an error

- Full workflow run
  - Uses the full multi-phase workflow
  - Dashboard shows the 9 workflow phases
  - Report includes full workflow phase progress and gate decisions

### Merge Readiness and Recommendation

The most important report/dashboard decision fields are:

- `overallStatus`
  - `PASSED`
  - `FAILED`
  - `RUNNING`
  - `PARTIAL`
  - `UNKNOWN`

- `recommendation`
  - `MERGE_READY`
  - `BLOCKED`
  - `NEEDS_REPAIR`
  - `NEEDS_REVIEW`
  - `RUNNING`
  - `UNKNOWN`

Practical interpretation:

- `MERGE_READY`
  - Run passed and is ready to merge
- `BLOCKED`
  - Run passed, but merge is blocked by worktree or main repo state
- `NEEDS_REPAIR`
  - Run failed and should go back through repair / resume flow
- `NEEDS_REVIEW`
  - Data is incomplete or partially unknown; check details manually

See:

- [dashboard-usage.md](docs/dashboard-usage.md)
- [report-usage.md](docs/report-usage.md)
- [troubleshooting.md](docs/troubleshooting.md)
- [docs index](docs/index.md)
- [architecture](docs/architecture.md)
- [roadmap](docs/mvp-roadmap.md)

### Artifact Decision Markers

Tester and reviewer artifacts include machine-readable markers used by the repair loop:

**test-report.md**: The first line must be exactly one of:
```
Result: PASS
Result: FAIL
```

**review-report.md**: The first line must be exactly one of:
```
Decision: APPROVED
Decision: CHANGES_REQUESTED
```

If an artifact is missing these markers, MoreAgent treats it as passed (compatible behavior). See `evaluateArtifactDecision` in `src/commands/start.ts` for the parsing logic.

## Project Structure

```
.moreagent/
├── config.yaml       # Agent and runtime configuration
├── sessions.json      # Session tracking
├── runs/              # Run outputs and artifacts
└── worktrees/         # Git worktrees for code-modifying agents
```

## Agents (MVP Pipeline)

| Agent | Role | Modifies Code |
|---|---|---|
| architect | Design & plan | No |
| implementer | Code implementation | Yes |
| tester | Test writing & execution | Yes |
| reviewer | Code review | No |

## Artifacts

Each run produces per-agent artifacts:
- `task.md` — Task context
- `brain-plan.md` — Architecture plan
- `implementation-result.md` — Implementation details
- `test-report.md` — Test results
- `review-report.md` — Review findings

Tester and reviewer reports support a minimal machine-readable decision protocol:
- `test-report.md`:
  - `Result: PASS`
  - `Result: FAIL`
- `review-report.md`:
  - `Decision: APPROVED`
  - `Decision: CHANGES_REQUESTED`

MoreAgent now seeds new report templates with default top lines:
- `test-report.md` starts with `Result: PASS`
- `review-report.md` starts with `Decision: APPROVED`

The OpenCode prompt for tester/reviewer also explicitly requires exactly one of these machine-readable lines near the top of the report.

Current MVP compatibility behavior:
- If `test-report.md` does not include `Result: PASS` or `Result: FAIL`, MoreAgent currently treats the tester session as passed.
- If `review-report.md` does not include `Decision: APPROVED` or `Decision: CHANGES_REQUESTED`, MoreAgent currently treats the reviewer session as passed.

Decision matching is line-based. Text such as `Result: FAILURES: 0` does not count as `Result: FAIL`.

## First Run (Recommended)

Start with a single agent to verify everything is set up correctly:

```bash
moreagent start --once --task "输出 OK" --agent architect
```

If that succeeds, run the full pipeline:

```bash
moreagent start --once --task "给 README 增加一个 Usage 示例"
```

### Manual Review Workflow

MoreAgent does NOT auto-merge or auto-push. After a run completes, follow this manual review process:

```bash
# 1. Check the run summary and session status
moreagent status --latest

# 2. Review the worktree diff (all code changes)
moreagent diff

# 3. Read the reviewer's findings
moreagent inspect --agent reviewer

# 4. Manually enter the worktree to review changes
cd .moreagent/worktrees/agent-run-<latest>
git status
git diff

# 5. If satisfied, manually merge (MoreAgent never does this):
git checkout main
git merge agent/run-<latest>
# OR cherry-pick specific changes

# 6. Clean up when done
moreagent clean --all
```

## Troubleshooting

### `spawn opencode ENOENT`

OpenCode CLI is not installed or not on `PATH`.

```bash
# Check if opencode is installed
which opencode

# If not found, install it first, or set the full path in .moreagent/config.yaml:
runtime:
  opencodePath: "/usr/local/bin/opencode"   # or your actual path
```

### `agent "architect" not found`

OpenCode cannot find the agent definition. Run `moreagent init` to regenerate the agent files:

```bash
moreagent init
```

This creates `.opencode/agents/architect.md` (and the other agents). Verify with:

```bash
opencode run --agent architect "只输出 OK"
```

### Git worktree creation fails

The pipeline includes code-modifying agents (implementer, tester) that require a git worktree. The reviewer also runs inside the task worktree to inspect the final diff. If worktree creation fails, the run is aborted — the main working directory is never used as a fallback.

**MoreAgent never creates commits automatically.** The project must be a git repo with at least one commit before running the full pipeline.

```bash
# Check if this is a git repo
git rev-parse --git-dir

# If not, initialize one and create the first commit manually
git init
git add .
git commit -m "Initial commit"

# Check for stale worktrees
git worktree list
git worktree prune
```

### Run hangs at `--- Agent: xxx ---`

This usually means the OpenCode subprocess is waiting for stdin. MoreAgent closes stdin immediately after spawning, but if you're running an older version, rebuild:

```bash
npm run build
```

### Permission denied when running `moreagent`

```bash
chmod +x dist/cli.js
npm link
```

## OpenCode Native Session Support

OpenCode supports native session resume with `-s <sessionId>`. MoreAgent leverages this:

| Feature | OpenCode Command | MoreAgent Behavior |
|---|---|---|
| New session | `opencode run --agent <name>` | First agent call; session ID captured via `opencode session list` |
| Continue session | `opencode run -s <id> --agent <name>` | Repair rounds reuse the base agent's session ID |
| Session labeling | `--title "moreagent-<sessionId>"` | Predictable session names for discovery |

Session IDs are stored in `.moreagent/sessions.json` under `runtimeSessionId`.

**Current session model:**
- **MoreAgent session** (`.moreagent/sessions.json`): orchestration-layer record — one per agent execution within a run
- **OpenCode session** (native SQLite store): conversation history — captured and reused across repair rounds

See `docs/opencode-session-research.md` for full details.

### Recoverable State

After a run (completed or interrupted), the following is preserved:
- `.moreagent/sessions.json` — run and session status with OpenCode session IDs
- `.moreagent/runs/<runId>/` — artifact reports per agent
- `stdout.log` / `stderr.log` — full agent output logs
- `.moreagent/worktrees/agent-<runId>/` — code changes on task branch
- OpenCode native sessions — recoverable via `opencode session list` and `opencode run -s <id>`

## License

MIT
