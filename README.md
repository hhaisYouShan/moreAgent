# MoreAgent

A project-level multi-agent / multi-session orchestration tool integrated with OpenCode CLI.

Each agent has an independent session, prompt, and artifact output directory. Code-modifying agents use isolated git worktrees.

## Install

```bash
npm install
npm run build
npm link
```

## Quick Start

```bash
# Initialize a project
moreagent init

# Run a task through the agent pipeline
moreagent start --once --task "add user authentication"
```

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

## License

MIT
