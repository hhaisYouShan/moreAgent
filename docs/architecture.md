# MoreAgent Architecture

## Overview

MoreAgent is a project-level multi-agent / multi-session orchestration tool that integrates with OpenCode CLI. It coordinates multiple AI agents, each with an independent session, prompt, and artifact output directory. Code-modifying agents share one isolated git worktree per run.

## Core Concepts

### Agent
An AI agent with a specific role (architect, implementer, tester, reviewer). Each agent has:
- **Independent session**: separate OpenCode process, called via `opencode run --agent <name>`
- **Independent prompt**: role-specific system prompt
- **Independent artifact directory**: per-run, per-agent output

### Run
A single execution triggered by `moreagent start --once --task "..."`. A run creates:
- A run directory: `.moreagent/runs/<run-id>/`
- Per-agent artifact directories: `.moreagent/runs/<run-id>/<agent-name>/`
- One task worktree: `.moreagent/worktrees/agent-<run-id>/` on branch `agent/<run-id>` (only if any agent has `canModifyCode: true`)

### Session
Represents a single agent's execution within a run. Tracked in `sessions.json`.

## Project Structure

```
project/
├── .moreagent/
│   ├── config.yaml
│   ├── sessions.json
│   ├── runs/
│   │   └── <run-id>/
│   │       ├── architect/
│   │       │   ├── task.md
│   │       │   ├── brain-plan.md
│   │       │   ├── stdout.log
│   │       │   └── stderr.log (if errors)
│   │       ├── implementer/
│   │       ├── tester/
│   │       └── reviewer/
│   └── worktrees/
│       └── agent-<run-id>/        # One per run, shared by code-modifying agents
```

## Component Diagram

```
CLI (cli.ts)
├── init command
└── start command
    ├── ConfigReader (config.ts)
    ├── SessionManager (session.ts)
    ├── WorktreeManager              →  Creates ONE worktree per run
    ├── OpenCodeRuntimeAdapter       →  spawns opencode run --agent <name>
    └── ArtifactWriter (artifacts.ts)
```

## Execution Flow

1. `moreagent start --once --task "build login page"`
2. Read `config.yaml` for agent definitions
3. If any agent has `canModifyCode: true`, create task worktree on branch `agent/<runId>`
4. Create run directory with unique ID
5. Run agents sequentially:
   a. Create agent artifact directory, write template artifacts
   b. Write `task.md` with agent-specific task + context from previous agents
   c. Execute `opencode run --agent <name> <prompt>` in the appropriate working dir
   d. Agent writes output to artifact files; stdout/logs saved as fallback
   e. On failure: stop pipeline immediately
   f. On success: read primary artifact for next agent's context
6. Output summary

## Worktree Strategy

- **One worktree per run**: `.moreagent/worktrees/agent-<runId>/`, branch `agent/<runId>`
- Only created when at least one agent in the pipeline has `canModifyCode: true`
- **implementer** and **tester** share the same worktree, executing serially
- **architect** and **reviewer** run in the original project directory (read-only)

## Agent Pipeline (MVP)

```
architect → implementer → tester → reviewer
   │            │           │          │
   │            │           │          └── review-report.md (in original repo)
   │            │           └── test-report.md     (in task worktree)
   │            └── implementation-result.md        (in task worktree)
   └── brain-plan.md                                (in original repo)
```

Each agent receives the task + all previous agents' primary artifact content as context. If an agent fails, the pipeline stops immediately.

## Artifact Handling

- Templates are written before agent execution
- Agent writes actual content to artifact files during execution
- After completion: if primary artifact still contains `<!--` (template markers), stdout is used as fallback
- stdout and stderr are always saved to `stdout.log` and `stderr.log`

## Design Principles

- **Keep it simple**: No over-abstraction, no unnecessary layers
- **File-based state**: JSON files, not databases
- **CLI-first**: No web UI in MVP
- **No auto merge/push**: All changes stay in worktrees until manual review
- **Fail fast**: Any agent failure stops the entire pipeline
