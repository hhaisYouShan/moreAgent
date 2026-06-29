# References

## OpenCode CLI Integration

MoreAgent integrates with OpenCode CLI as the underlying AI runtime. 

The OpenCodeRuntimeAdapter calls `opencode` as a subprocess with:
- The agent's system prompt
- The current task
- Context from previous agents in the pipeline

### OpenCode CLI Usage

```bash
opencode [options] <task>
```

Options:
- `--model <model>` — AI model to use
- `--session <id>` — Session identifier

For MoreAgent, each agent gets a unique session ID based on the agent name + run ID.

## Git Worktrees

Code-modifying agents use `git worktree add` to create isolated working copies:

```bash
git worktree add ../worktrees/<agent>-<run-id> <branch>
```

This allows each agent to work on its own branch without conflicts.

## File Formats

### config.yaml

```yaml
version: "1.0"
project:
  name: "my-project"
agents:
  - name: architect
    role: architect
    canModifyCode: false
    prompt: |
      You are a senior software architect...
  - name: implementer
    role: implementer
    canModifyCode: true
    branch: feature/impl
    prompt: |
      You are a senior developer...
runtime:
  opencodePath: "opencode"
  timeout: 1800
```

### sessions.json

```json
{
  "runs": [
    {
      "id": "run-20260629-120000",
      "task": "build login page",
      "status": "completed",
      "createdAt": "2026-06-29T12:00:00Z",
      "sessions": [
        {
          "id": "architect-run-20260629-120000",
          "agentName": "architect",
          "runId": "run-20260629-120000",
          "status": "completed",
          "startedAt": "2026-06-29T12:00:01Z",
          "completedAt": "2026-06-29T12:05:00Z"
        }
      ]
    }
  ]
}
```

## Artifacts

Each agent produces these artifacts in its run subdirectory:

| Artifact | Description | Produced By |
|---|---|---|
| `task.md` | The task assigned to this agent | Orchestrator |
| `brain-plan.md` | Agent's analysis and plan | Architect |
| `implementation-result.md` | Code changes and explanation | Implementer |
| `test-report.md` | Test results and coverage | Tester |
| `review-report.md` | Code review findings | Reviewer |

If an agent's role doesn't produce a particular artifact, the file is created with a placeholder.
