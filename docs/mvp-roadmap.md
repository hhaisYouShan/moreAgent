# MoreAgent Roadmap

## Current Status

This roadmap reflects the current state through V2.4.

Current position:

1. V2.4 completed
2. V3.0 `dashboard --serve / --watch` pending

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

Still intentionally pending:

1. V3.0 `dashboard --serve`
2. V3.0 `dashboard --serve --watch`
3. browser-side auto-refresh in serve mode

## Near-Term Roadmap

### V2.4

- [x] Completed
- [x] User docs and troubleshooting docs aligned
- [x] Static dashboard flow documented

### V3.0

- [ ] `dashboard --serve`
- [ ] `dashboard --serve --open`
- [ ] `dashboard --serve --watch`
- [ ] local HTTP dashboard service
- [ ] browser-side `Refresh data`
- [ ] polling `/data.json` in watch mode
- [ ] test-safe server lifecycle and close handle

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
