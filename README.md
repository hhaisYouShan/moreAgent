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

## License

MIT
