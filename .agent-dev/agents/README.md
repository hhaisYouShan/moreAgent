# MoreAgent Agents

This directory contains agent development configuration and examples.

## Agent Roles

MoreAgent uses a pipeline of specialized AI agents, each with a specific role:

| Role | Purpose | Modifies Code |
|---|---|---|
| **architect** | Analyzes requirements, designs architecture, creates implementation plan | No |
| **implementer** | Implements the solution based on the architect's plan | Yes |
| **tester** | Writes and runs tests, reports results | Yes |
| **reviewer** | Reviews code quality, test coverage, provides feedback | No |

## Agent Configuration

Each agent is defined in `.moreagent/config.yaml` with:

- `name`: Unique identifier
- `role`: Agent role type
- `canModifyCode`: Whether the agent needs a git worktree
- `branch`: Branch name for the worktree (code-modifying agents only)
- `prompt`: System prompt defining the agent's behavior
- `dependsOn`: Agents that must complete before this one runs

## Artifacts

Each agent produces artifacts in its run subdirectory:

```
.moreagent/runs/<run-id>/<agent-name>/
├── task.md                 # Task context
├── brain-plan.md           # Architecture plan (architect)
├── implementation-result.md # Implementation details (implementer)
├── test-report.md          # Test results (tester)
└── review-report.md        # Review findings (reviewer)
```

## Adding New Agents

1. Add agent definition to `config.yaml`
2. Define the agent's prompt and role
3. Set `canModifyCode` based on whether it needs a worktree
4. Set `dependsOn` for execution ordering
