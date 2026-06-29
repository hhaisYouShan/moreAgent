# MoreAgent Architecture

## Overview

MoreAgent is a project-level multi-agent / multi-session orchestration tool that integrates with OpenCode CLI. It coordinates multiple AI agents, each with an independent session, prompt, and artifact output directory. Agents that modify code use isolated git worktrees.

## Core Concepts

### Agent
An AI agent with a specific role (architect, implementer, tester, reviewer). Each agent has:
- **Independent session**: separate OpenCode process
- **Independent prompt**: role-specific system prompt
- **Independent artifact directory**: per-run, per-agent output
- **Independent git worktree**: for code-modifying agents

### Run
A single execution of the orchestration triggered by `moreagent start --once --task "..."`. A run creates:
- A run directory: `.moreagent/runs/<run-id>/`
- Per-agent artifact directories: `.moreagent/runs/<run-id>/<agent-name>/`
- Worktrees: `.moreagent/worktrees/<agent-name>-<run-id>/`

### Session
Represents a single agent's execution within a run. Tracked in `sessions.json`.

## Project Structure

```
project/
├── .moreagent/               # MoreAgent project state
│   ├── config.yaml           # Project configuration
│   ├── sessions.json         # Session tracking
│   ├── runs/                 # Run outputs
│   │   └── <run-id>/
│   │       ├── run.json      # Run metadata
│   │       └── <agent-name>/
│   │           ├── task.md
│   │           ├── brain-plan.md
│   │           ├── implementation-result.md
│   │           ├── test-report.md
│   │           └── review-report.md
│   └── worktrees/            # Git worktrees for code-modifying agents
```

## Component Diagram

```
CLI (cli.ts)
├── init command    →  Creates .moreagent/ structure
└── start command   →  Orchestrates agent execution
    ├── ConfigReader (config.ts)      →  Reads config.yaml
    ├── SessionManager (session.ts)   →  Manages sessions.json
    ├── RunManager                    →  Creates run directories
    ├── WorktreeManager               →  Creates git worktrees
    ├── OpenCodeRuntimeAdapter        →  Calls OpenCode CLI per agent
    └── ArtifactWriter (artifacts.ts) →  Writes output artifacts
```

## Execution Flow

1. `moreagent start --once --task "build login page"`
2. Read `config.yaml` for agent definitions
3. Create run directory with unique ID
4. For each agent (sequentially in MVP):
   a. Create agent artifact directory
   b. Write `task.md` with the agent-specific task
   c. If `canModifyCode`: create git worktree
   d. Execute OpenCode with agent prompt + task
   e. Parse output into artifacts
   f. Update session status
5. Output summary

## Agent Pipeline (MVP)

```
architect → implementer → tester → reviewer
   │            │           │          │
   │            │           │          └── review-report.md
   │            │           └── test-report.md
   │            └── implementation-result.md
   └── brain-plan.md
```

Each agent receives the task + previous agent's output as context.

## Design Principles

- **Keep it simple**: No over-abstraction, no unnecessary layers
- **File-based state**: JSON files, not databases
- **CLI-first**: No web UI in MVP
- **No auto merge/push**: All changes stay in worktrees until manual review
