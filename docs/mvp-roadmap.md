# MoreAgent Roadmap

## Current Status

This roadmap reflects the current state after V3.0 completion and the currently confirmed next-stage route.

Current position:

1. V3.0 completed
2. V3.1 in progress
3. V3.2 planned
4. V4.x planned
5. V5.0 planned

This file is no longer a “pre-init MVP checklist”.
It is a current-state roadmap.

## Completed Foundations

- [x] `moreagent init`
- [x] `.moreagent/config.yaml`
- [x] `.moreagent/sessions.json`
- [x] `.moreagent/tasks.json`
- [x] `.moreagent/runtime-sessions.json`
- [x] run artifact directories under `.moreagent/runs/`
- [x] one task worktree per code-changing run
- [x] OpenCode CLI adapter integration
- [x] stdout/stderr persistence

## Completed Workflow Capabilities

- [x] MVP pipeline
- [x] full workflow pipeline
- [x] repair loop for tester/reviewer failure
- [x] artifact decision protocol for tester/reviewer
- [x] full workflow gate decision handling
- [x] failure analysis and owner-based repair routing
- [x] resume latest run
- [x] resume specific run
- [x] start from phase
- [x] queue-based loop execution
- [x] tmux visualization support

## Completed Inspection And Reporting

- [x] `status`
- [x] `status --latest`
- [x] `status --run <id>`
- [x] `status --latest-repair`
- [x] `status --latest-full`
- [x] `inspect`
- [x] `inspect --run <id>`
- [x] `inspect --agent <name>`
- [x] `inspect --workflow`
- [x] `report`
- [x] `report --latest`
- [x] `report --run <id>`
- [x] JSON output for `status / inspect / report`

## Completed Local Review Surfaces

- [x] static `dashboard`
- [x] `dashboard --open`
- [x] `dashboard --run <id>`
- [x] `dashboard --limit <n>`
- [x] `dashboard --output <path>`
- [x] dashboard usability hardening
- [x] dashboard resilience hardening
- [x] dashboard/report/troubleshooting user docs

## Completed Repository Control Capabilities

- [x] `diff`
- [x] `merge` dry-run
- [x] `merge --apply` with safety checks
- [x] `clean --runs`
- [x] `clean --worktrees`
- [x] `clean --all`

## Current Boundary

Already completed and should not be described as pending anymore:

1. JSON output
2. report
3. static dashboard
4. repair loop
5. resume
6. inspect/status/report command family
7. manual merge workflow

Current planned route:

1. V3.1 dashboard usability hardening
2. V3.2 one-click project integration
3. V4.0 PRD review meeting
4. V4.1 three-way tech plan review
5. V4.2 failure attribution and targeted return flow
6. V5.0 true multi-agent parallel worktree execution

## Near-Term Roadmap

### V3.0

- [x] Completed
- [x] `dashboard --serve`
- [x] `dashboard --serve --open`
- [x] `dashboard --serve --watch`
- [x] local HTTP dashboard service
- [x] browser-side `Refresh data`
- [x] polling `/data.json` in watch mode
- [x] test-safe server lifecycle and close handle

### V3.1

- [ ] dashboard usability hardening
- [ ] serve/watch startup information hardening
- [ ] runtime refresh status hardening
- [ ] no-runs watch handling hardening
- [ ] docs and regression test sync

### V3.2

- [ ] `moreagent init --full`
- [ ] full workflow config generation
- [ ] docs / agents / integration guide generation
- [ ] one-click existing project integration path

### V4.x

- [ ] V4.0 PRD review meeting
- [ ] V4.1 three-way tech plan review
- [ ] V4.2 failure attribution and targeted return flow

### V5.0

- [ ] multi-agent parallel worktree execution
- [ ] orchestrated parallel development / test / review
- [ ] unified convergence and observability

## Non-Goals Of The Current Roadmap

Still not part of the current target:

1. remote hosted dashboard service
2. login/auth
3. multi-user collaboration
4. automatic merge/push during workflow execution
5. database-backed runtime state

## Document Boundary

This file is a current roadmap, not a historical design archive.

For current usage and architecture, also see:

1. `README.md`
2. `docs/index.md`
3. `docs/architecture.md`

Historical design docs remain useful as archive material, but they are not the only source of truth for current completion state.
