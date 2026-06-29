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
```

Sessions are tracked in `.moreagent/sessions.json` for history and debugging.

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

## First Run (Recommended)

Start with a single agent to verify everything is set up correctly:

```bash
moreagent start --once --task "输出 OK" --agent architect
```

If that succeeds, run the full pipeline:

```bash
moreagent start --once --task "给 README 增加一个 Usage 示例"
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
